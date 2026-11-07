"""Native AgentScope tools against real SQLite, without provider/network calls.

People, ownership and events are synthetic; MJTD01SYL is a mainland model.
These verify enforced write/read contracts, not a model's semantic judgment.
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import func, select

from wujian import domain, interactions
from wujian.agent_runtime import make_tools
from wujian.api_models import ExperienceChange, ItemCreate
from wujian.config import Settings
from wujian.database import (
    ChatMessage, Conversation, ExperienceRecord, Household, HouseholdItem,
    HouseholdMember, Profile, User, make_database,
)


class FamilyAgentWriteTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings=Settings(data_dir=Path(self.temp.name),api_key='',rea_enabled=False)
        self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        self.addCleanup(self.engine.dispose)
        with self.sessions() as db:
            db.add_all([User(id=key,username=key,display_name=key,password_hash='offline')
                        for key in ['daughter','mother','stranger']])
            db.flush()
            db.add_all([Household(id='home',name='我们家',creator_id='daughter'),
                        Household(id='invited-home',name='尚未加入',creator_id='stranger')])
            db.flush()
            db.add_all([HouseholdMember(household_id='home',user_id=key,status='active')
                        for key in ['daughter','mother']])
            db.add(HouseholdMember(household_id='invited-home',user_id='daughter',status='invited'))
            db.commit()
            self.item=domain.create_item(db,'daughter',ItemCreate(name='书房米家台灯1S',
                product={'brand':'米家','model':'MJTD01SYL','market':'CN'}))
            self.private=domain.create_item(db,'daughter',ItemCreate(name='私人石头',kind='nonstandard_object'))
            db.add(HouseholdItem(household_id='home',item_id=self.item['id'],shared_by='daughter'))
            db.commit()

    def message(self,text,*,author='daughter',role='user'):
        with self.sessions() as db:
            conversation=Conversation(user_id=author,item_ids=[self.item['id']])
            db.add(conversation);db.flush()
            message=ChatMessage(conversation_id=conversation.id,role=role,text=text)
            db.add(message);db.commit()
            return message.id

    def tools(self,message_id):
        return {tool.name:tool for tool in make_tools(self.settings,self.sessions,
            'daughter',message_id).tool_groups[0].tools}

    def call(self,tool,**kwargs):
        reply=asyncio.run(tool(**kwargs))
        return reply,json.loads(reply.content[0].text) if str(reply.state)=='success' else reply.content[0].text

    def record(self,message_id,**changes):
        return self.call(self.tools(message_id)['record_experience'],**{
            'title':'一起读书','text':'今晚妈妈陪我一起在台灯旁读书。',
            'item_ids':[self.item['id']],**changes})

    def test_explicit_current_family_request_shares_one_record_but_ai_stays_independent(self):
        message=self.message('帮我记下今晚读书这件事，共享到家里，让家人能看到。')
        reply,receipt=self.record(message,household_id='home',family_share_quote='共享到家里，让家人能看到')
        self.assertEqual(str(reply.state),'success',receipt)
        self.assertEqual(receipt['household_id'],'home')
        self.assertEqual(receipt['actual_visibility'],'household_members')
        self.assertFalse(receipt['allow_ai'])
        self.assertFalse(receipt['family_ai_readable'])
        self.assertNotIn('text',receipt)
        self.assertNotIn('title',receipt)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)),1)
            self.assertEqual([row['id'] for row in domain.list_experiences(db,'mother')],[receipt['id']])
            self.assertEqual(domain.list_experiences(db,'mother',for_ai=True),[])

    def test_mentioning_mother_does_not_share_and_ai_permission_does_not_publish(self):
        current=self.message('妈妈今天陪我读书了，帮我记下，以后聊天也可以参考这段。')
        reply,receipt=self.record(current,allow_ai=True,ai_consent_quote='以后聊天也可以参考这段')
        self.assertEqual(str(reply.state),'success',receipt)
        self.assertIsNone(receipt['household_id'])
        self.assertEqual(receipt['actual_visibility'],'author_only')
        self.assertTrue(receipt['allow_ai'])
        with self.sessions() as db:
            self.assertEqual(domain.list_experiences(db,'mother'),[])

    def test_explicit_family_and_separate_ai_permission_are_both_preserved(self):
        current=self.message('帮我记下，共享到家里；以后聊天也可以参考这段。')
        reply,receipt=self.record(current,household_id='home',family_share_quote='共享到家里',
            allow_ai=True,ai_consent_quote='以后聊天也可以参考这段')
        self.assertEqual(str(reply.state),'success',receipt)
        self.assertTrue(receipt['family_ai_readable'])
        with self.sessions() as db:
            self.assertEqual([row['id'] for row in domain.list_experiences(db,'mother',for_ai=True)],[receipt['id']])

    def test_real_probe_empty_optional_household_id_keeps_private_without_a_repair_turn(self):
        current=self.message('刚刚去公园走了十分钟，心情好多了，帮我给自己记一段，别放到家庭里。')
        reply,receipt=self.record(current,household_id='',item_ids=[],text='刚刚去公园走了十分钟，心情好多了。')
        self.assertEqual(str(reply.state),'success',receipt)
        self.assertIsNone(receipt['household_id'])
        self.assertEqual(receipt['actual_visibility'],'author_only')
        with self.sessions() as db:
            self.assertEqual(domain.list_experiences(db,'mother'),[])

    def test_family_quote_must_be_nonempty_and_in_the_current_owned_user_message(self):
        old=self.message('共享到家里')
        current=self.message('今天这件事帮我记下。')
        assistant=self.message('共享到家里',role='assistant')
        foreign=self.message('共享到家里',author='stranger')
        for message,quote in [(current,'共享到家里'),(old,''),(old,'  '),(assistant,'共享到家里'),(foreign,'共享到家里')]:
            with self.subTest(message=message,quote=quote):
                reply,detail=self.record(message,household_id='home',family_share_quote=quote)
                self.assertEqual(str(reply.state),'error',detail)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)),0)

    def test_unknown_invited_or_mixed_item_scope_is_rejected_without_partial_record(self):
        current=self.message('帮我记下，共享到家里。')
        for changes in [{'household_id':'unknown'}, {'household_id':'invited-home'},
                        {'household_id':'home','item_ids':[]},
                        {'household_id':'home','item_ids':[self.item['id'],self.private['id']]}]:
            reply,detail=self.record(current,family_share_quote='共享到家里',**changes)
            self.assertEqual(str(reply.state),'error',detail)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)),0)

    def test_household_read_tool_exposes_only_active_scope(self):
        reply,value=self.call(self.tools(self.message('帮我看看这是哪个家。'))['list_households'])
        self.assertEqual(str(reply.state),'success')
        self.assertEqual(value,[{'id':'home','name':'我们家','member_names':['daughter','mother'],
                                'item_ids':[self.item['id']]}])
        self.assertNotIn(self.private['id'],json.dumps(value))
        self.assertNotIn('invited-home',json.dumps(value))

    def test_replayed_receipt_reports_actual_withdrawn_visibility_without_republishing(self):
        current=self.message('帮我记下，共享到家里。')
        _,receipt=self.record(current,household_id='home',family_share_quote='共享到家里')
        with self.sessions() as db:
            row=db.get(ExperienceRecord,receipt['id'])
            interactions.change_experience(db,'daughter',row.id,ExperienceChange(title=row.title,text=row.text,
                item_ids=row.item_ids,photo_ids=row.photo_ids,expected_version=row.version,household_id=None))
        reply,replayed=self.record(current,household_id='home',family_share_quote='共享到家里')
        self.assertEqual(str(reply.state),'success',replayed)
        self.assertEqual(replayed['status'],'already_recorded')
        self.assertEqual(replayed['actual_visibility'],'author_only')
        self.assertIsNone(replayed['household_id'])
        with self.sessions() as db:
            self.assertEqual(domain.list_experiences(db,'mother'),[])
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)),1)

    def test_both_item_write_tools_filter_withdrawn_gift_hints_from_native_results(self):
        secret='生日那晚窗台上的秘密纸条'
        allowed='允许对话的另一份彩蛋'
        with self.sessions() as db:
            stories=[]
            for identity,allow in [('withdrawn',False),('permitted',True)]:
                row=ExperienceRecord(id=identity,creator_id='daughter',title='收到的故事',text='真实原文',
                    item_ids=[self.item['id']],item_labels={self.item['id']:self.item['name']},
                    origin_id='sender-'+identity,allow_ai=allow)
                db.add(row);stories.append(row)
            profile=db.get(Profile,('daughter',self.item['id']))
            profile.avatar={'enabled':True,'nickname':'小灯','gift_memories':[
                {'experience_id':'withdrawn','hint':secret,'trigger_words':['生日'],'unlocked':False},
                {'experience_id':'permitted','hint':allowed,'trigger_words':['读书'],'unlocked':False}]}
            db.commit()
        message=self.message('台灯搬到书房了，名字改成书房灯。')
        tools=self.tools(message)
        renamed,value=self.call(tools['update_item_identity'],item_id=self.item['id'],name='书房灯',
            product=self.item['product'],basis='user_report')
        self.assertEqual(str(renamed.state),'success',value)
        self.assertNotIn(secret,renamed.content[0].text)
        self.assertIn(allowed,renamed.content[0].text)
        self.assertEqual(value['item_id'],self.item['id'])
        self.assertNotIn('product_id',value)
        with self.sessions() as db:
            canonical=domain.item_view(db,'daughter',domain.accessible_item(db,'daughter',self.item['id']))
            self.assertIn(secret,json.dumps(canonical,ensure_ascii=False))
        moved,value=self.call(tools['update_item_condition'],item_id=self.item['id'],changes={'location':'书房'},
            source_quote='台灯搬到书房了',expected_version=canonical['version'])
        self.assertEqual(str(moved.state),'success',value)
        self.assertNotIn(secret,moved.content[0].text)
        self.assertIn(allowed,moved.content[0].text)
