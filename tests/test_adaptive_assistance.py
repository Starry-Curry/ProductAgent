"""Object boundaries and ordinary-object teaching, without paid calls."""
import asyncio
import copy
import io
import json
import tempfile
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock, DataBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient
from PIL import Image

from wujian import domain, foundation
from wujian.api_models import ItemCreate
from wujian.assistance import bind_task, item_photos, related_tasks, resolve_focus
from wujian.config import Settings
from wujian.database import Asset, ChatMessage, Conversation, SourceRecord, make_database
from wujian.research import research_item
from wujian.turns import TurnResult, commit_result, grounded_turn_schema


def plan_for(identity):
    return {'schema':'interaction/1','kind':'guidance','entries':[{'id':'observe',
        'title':'核对当前外观','item_id':identity,'group':'step','state':'pending',
        'guidance':{'kind':'observe','basis':'general','instruction':'先看看当前正在操作的位置。',
            'success_signal':'告诉我你看见的状态。','target_label':'物品外观'}}],
        'guidance':{'active_step_id':'observe','overview':['核对现状','核对操作依据','尝试并检查结果']}}


class ObjectBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.settings=Settings(data_dir=Path(self.temp.name),rea_enabled=False)
        self.settings.prepare();self.engine,self.sessions=make_database(self.settings);self.user='person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item=domain.create_item(db,self.user,ItemCreate(name='测试音箱',product={'brand':'测试','model':'SP-31'}))
            self.other=domain.create_item(db,self.user,ItemCreate(name='我的热压机',product={'brand':'测试','model':'HP-88'}))
            self.old=foundation.save_task(db,self.user,'seed','检查热压机',[self.other['id']],{},plan_for(self.other['id']))
            db.add(Conversation(id='test-chat',user_id=self.user,item_ids=[self.item['id']],entry_context={'intent':'guidance'}));db.flush()
            db.add(ChatMessage(id='question',conversation_id='test-chat',role='user',text='请分步骤讲解怎么操作。'));db.commit()

    def tearDown(self):
        self.engine.dispose();self.temp.cleanup()

    def result(self, identity=None, **kwargs):
        identity=identity or self.item['id']
        return {'answer':'先看看当前正在操作的位置。','assistance_mode':'teach','target_item_ids':[identity],
            'continuation':{'goal':'核对现状并学习使用','item_ids':[identity],'constraints':{},'plan':plan_for(identity),
                'task_id':None,'expected_version':None},**kwargs}

    def test_wrong_item_prose_and_foreign_task_are_rejected(self):
        schema=grounded_turn_schema(self.sessions,self.user,'question')
        for value in [{'answer':'在热压机上找到模式键。'},self.result(self.other['id'])]:
            with self.subTest(value=value),self.assertRaises(ValueError):schema.model_validate(value)

    def test_missing_teaching_plan_is_rejected_but_preparation_is_supported(self):
        schema=grounded_turn_schema(self.sessions,self.user,'question')
        with self.assertRaises(ValueError):schema.model_validate({'answer':'我可以一步步教你。'})
        result=schema.model_validate(self.result())
        with self.sessions() as db:
            saved=commit_result(db,self.user,'question',result,'请分步骤讲解怎么操作。')
            chat=db.get(Conversation,'test-chat')
            self.assertEqual(chat.entry_context['task_id'],saved['task']['id'])
            self.assertEqual(saved['task']['plan']['entries'][0]['state'],'pending')

    def test_wrong_task_binding_detaches_without_deleting_progress(self):
        with self.sessions() as db:
            with self.assertRaises(domain.DomainError):bind_task(db,self.user,[self.item['id']],{'task_id':self.old['id']})
            self.assertIsNone(bind_task(db,self.user,[self.item['id']],{'task_id':self.old['id']},detach=True)['task_id'])
            self.assertEqual(related_tasks(db,self.user,[self.item['id']]),[])

    def test_shared_or_similar_model_is_not_an_instance_switch(self):
        with self.sessions() as db:
            self.assertEqual(resolve_focus(db,self.user,'和 HP-88 相比有什么区别？',[self.item['id']]),[self.item['id']])
            self.assertEqual(resolve_focus(db,self.user,'现在换成 HP-88。',[self.item['id']]),[self.other['id']])
            self.assertEqual(resolve_focus(db,self.user,'不要再拿 HP-88 的答案回答这个音箱。',[self.item['id']]),[self.item['id']])

    def test_unrelated_source_cannot_ground_an_operation(self):
        with self.sessions() as db:
            source=SourceRecord(owner_id=self.user,item_id=self.other['id'],title='HP-88 SP-31',
                url='https://example.org/manual',origin='public_web',content='SP-31 按下已核对的电源按钮即可启动。',pages=[])
            db.add(source);db.commit();identity=source.id
        value=self.result();step=value['continuation']['plan']['entries'][0]['guidance']
        step.update(kind='operate',basis='document',evidence=[{'source_id':identity,'quote':'SP-31 按下已核对的电源按钮即可启动。','source_model':'SP-31'}])
        with self.assertRaises(ValueError):grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)

    def test_commercial_name_requires_an_explicit_source_identity_match(self):
        from wujian.assistance import identity_in_source
        with self.sessions() as db:
            item=domain.accessible_item(db,self.user,self.item['id'])
            item.identity_notes={**item.product,'commercial_name':'测试系列标准音箱'}
            source=SourceRecord(id='alias-proof',owner_id=self.user,item_id=item.id,title='测试系列标准音箱指南',
                url='https://publisher.example.org/guide',content='按下有电源标记的开关。',pages=[])
            self.assertFalse(identity_in_source(item,source))
            item.state={'identity_evidence':{'basis':'document_match','source_id':source.id,'provisional':False}}
            self.assertTrue(identity_in_source(item,source))
            source.id='another-source';self.assertFalse(identity_in_source(item,source))

    def test_research_distinguishes_search_failure_from_no_results(self):
        async def search(query):return {'available':False,'reason':'TimeoutError'}
        async def fetch(*args):self.fail('No fabricated candidate URL may be fetched')
        receipts=[]
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'功能',search=search,fetch=fetch,receipt=lambda *x:receipts.append(x)))
        self.assertEqual(result['status'],'search_unavailable');self.assertEqual(result['documents'],[])
        self.assertEqual(len(receipts),2)

    def test_research_can_read_a_different_candidate_after_failed_download(self):
        async def search(query):return {'query':query,'results':[{'url':'https://example.org/manual.pdf'},{'url':'https://example.org/support'}]}
        async def fetch(url,item_id):
            return {'available':False,'reason':'TimeoutError'} if url.endswith('.pdf') else {'source_id':'read','text':'source text','url':url}
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'功能',search=search,fetch=fetch,receipt=lambda *x:None))
        self.assertEqual(result['status'],'read_candidates');self.assertEqual(result['documents'][0]['source_id'],'read')

    def test_search_relevance_is_not_displaced_by_an_unrelated_pdf(self):
        seen=[]
        async def search(query):return {'query':query,'results':[
            {'url':'https://publisher.example.org/SP-31/guide'},
            {'url':'https://other.example.org/unrelated-car.pdf'},
            {'url':'https://publisher.example.org/SP-31/specs'}]}
        async def fetch(url,item_id):
            seen.append(url);return {'source_id':'read','url':url,'text':'Original product guide.'}
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'连接',search=search,fetch=fetch,receipt=lambda *x:None))
        self.assertEqual(seen,['https://publisher.example.org/SP-31/guide'])
        self.assertEqual(result['status'],'read_candidates')

    def test_old_photo_scope_is_not_relabelled_by_a_topic_switch(self):
        with self.sessions() as db:
            db.add(Asset(id='old-photo',owner_id=self.user,path='offline-not-read',media_type='image/jpeg',original_name='report.jpg'))
            chat=db.get(Conversation,'test-chat')
            db.add(ChatMessage(conversation_id=chat.id,role='user',text='先看看这个',photo_ids=['old-photo'],item_ids=[self.item['id']]))
            chat.item_ids=[self.other['id']];db.commit()
            self.assertEqual([a.id for a in item_photos(db,self.user,[self.item['id']])],['old-photo'])
            self.assertEqual(item_photos(db,self.user,[self.other['id']]),[])

    def test_unverified_battery_details_cannot_be_labelled_general_advice(self):
        value=self.result();value['answer']='翻过鼠标，装入一节AA电池。'
        step=value['continuation']['plan']['entries'][0]['guidance']
        step.update(kind='operate',instruction='装入一节AA电池。')
        with self.assertRaises(ValueError):grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)
        for instruction in ['设置温度145°C。','施加80kg压力。']:
            value=self.result();value['answer']=instruction
            value['continuation']['plan']['entries'][0]['guidance'].update(kind='operate',instruction=instruction)
            with self.subTest(instruction=instruction), self.assertRaises(ValueError):
                grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)

    def test_unverified_parameters_cannot_hide_in_success_signal(self):
        value=self.result()
        value['continuation']['plan']['entries'][0]['guidance']['success_signal']='等待15秒后指示灯闪烁。'
        with self.assertRaises(ValueError):grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)

    def test_provider_outage_preserves_only_an_uncompleted_preparation_step(self):
        from wujian.assistance import preparation_turn
        value=preparation_turn({'focused_items':[self.item]},'请分步骤教我怎么用')
        result=grounded_turn_schema(self.sessions,self.user,'question').model_validate(value.model_dump())
        with self.sessions() as db:
            saved=commit_result(db,self.user,'question',result,'请分步骤教我怎么用')
        self.assertTrue(saved['task']['plan']['guidance']['research_pending'])
        self.assertEqual(saved['task']['plan']['entries'][0]['state'],'pending')
        self.assertEqual(saved['task']['plan']['entries'][0]['guidance']['kind'],'observe')


class TeachingModel(ChatModelBase):
    def __init__(self, state):
        super().__init__(credential=None,model='offline-only',parameters=self.Parameters(),max_retries=0)
        self.formatter=OpenAIChatFormatter();self.capture=state

    async def _call_api(self,model_name,messages,**kwargs):
        self.capture['messages']=messages
        identity=self.capture['item_id']
        value={'answer':'先看看当前正在操作的位置，告诉我你看见什么。','assistance_mode':'teach','target_item_ids':[identity],
            'continuation':{'goal':'核对现状并学习使用','item_ids':[identity],'constraints':{},'plan':plan_for(identity),
                'task_id':None,'expected_version':None}}
        return ChatResponse(content=[ToolCallBlock(id='reply',name='GenerateStructuredOutput',input=json.dumps(value))],is_last=True,
            usage=ChatUsage(input_tokens=10,output_tokens=10,time=0))


class OrdinaryItemJourneyTests(unittest.TestCase):
    def test_existing_photo_enters_main_model_and_unpacked_items_start_teaching(self):
        from wujian.server import create_app
        with tempfile.TemporaryDirectory() as folder:
            capture={};app=create_app(Settings(data_dir=Path(folder),api_key='offline-only',rea_enabled=False),model_factory=lambda _:TeachingModel(capture))
            with TestClient(app) as client:
                client.post('/api/auth/demo/xiaolin')
                picture=io.BytesIO();Image.new('RGB',(80,60),'white').save(picture,'PNG')
                photo=client.post('/api/assets',files={'file':('photo.png',picture.getvalue(),'image/png')}).json()['id']
                for name in ['没有教学包的台灯','没有教学包的手工作品']:
                    item=client.post('/api/items',json={'name':name,'photo_id':photo}).json();capture['item_id']=item['id']
                    run=client.post('/api/chat',json={'text':'请分步骤带我操作。','item_ids':[item['id']]}).json()
                    end=time.monotonic()+10
                    while run['status'] in {'queued','running'} and time.monotonic()<end:
                        time.sleep(.02);run=client.get('/api/runs/'+run['id']).json()
                    self.assertEqual(run['status'],'completed',run)
                    self.assertTrue(any(isinstance(block,DataBlock) for message in capture['messages'] for block in message.content))
                    threads=client.get('/api/conversations').json();thread=next(row for row in threads if row['id']==run['conversation_id'])
                    board=client.get('/api/tasks/'+thread['entry_context']['task_id']+'/board').json()
                    self.assertEqual(board['task']['item_ids'],[item['id']]);self.assertEqual(board['completed_count'],0)
                    self.assertFalse(board['task']['plan']['guidance'].get('lesson'))
                replacement=client.post('/api/items',json={'name':'没有照片的另一件物品'}).json()
                capture['item_id']=replacement['id']
                switched=client.post('/api/chat',json={'text':'现在请分步骤观察这件物品。',
                    'conversation_id':run['conversation_id'],'item_ids':[replacement['id']]}).json()
                end=time.monotonic()+10
                while switched['status'] in {'queued','running'} and time.monotonic()<end:
                    time.sleep(.02);switched=client.get('/api/runs/'+switched['id']).json()
                self.assertEqual(switched['status'],'completed',switched)
                self.assertFalse(any(isinstance(block,DataBlock) for message in capture['messages'] for block in message.content))
