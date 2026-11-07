"""Object boundaries and ordinary-object teaching, without paid calls."""
import asyncio
import copy
import io
import json
import tempfile
import time
import unittest
from unittest.mock import patch,AsyncMock
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock, DataBlock
from agentscope.state import AgentState
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

    def test_invalid_reference_repair_lists_only_current_owned_original_ids(self):
        with self.sessions() as db:
            db.add(SourceRecord(id='actual-current-source',owner_id=self.user,item_id=self.item['id'],title='SP-31 指南',
                url='https://publisher.example/guide',content='SP-31 先核对当前状态。',pages=[]))
            db.add(SourceRecord(id='private-foreign-source',owner_id='person_demo_friend',item_id=self.item['id'],title='私有来源',
                url='https://publisher.example/private',content='SP-31 私有记录。',pages=[]));db.commit()
        value=self.result();step=value['continuation']['plan']['entries'][0]['guidance']
        step.update(basis='document',evidence=[{'source_id':'invented-manual-id','quote':'SP-31 先核对当前状态。'}])
        with self.assertRaises(ValueError) as error:grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)
        self.assertIn('actual-current-source',str(error.exception));self.assertNotIn('private-foreign-source',str(error.exception))

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
        self.assertEqual(result['status'],'identity_not_matched');self.assertEqual(result['documents'][0]['source_id'],'read')

    def test_search_relevance_is_not_displaced_by_an_unrelated_pdf(self):
        seen=[]
        async def search(query):return {'query':query,'results':[
            {'url':'https://publisher.example.org/SP-31/guide'},
            {'url':'https://other.example.org/unrelated-car.pdf'},
            {'url':'https://publisher.example.org/SP-31/specs'}]}
        async def fetch(url,item_id):
            seen.append(url)
            with self.sessions() as db:
                source=SourceRecord(id='read',owner_id=self.user,item_id=item_id,title='SP-31 使用指南',url=url,
                    content='SP-31 使用指南，先核对当前状态。',pages=[])
                db.add(source);db.commit()
            return {'source_id':'read','url':url,'text':'SP-31 Original product guide.'}
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'连接',search=search,fetch=fetch,receipt=lambda *x:None))
        self.assertEqual(seen,['https://publisher.example.org/SP-31/guide'])
        self.assertEqual(result['status'],'read_candidates')

    def test_research_does_not_promote_repeated_hosts_or_stop_at_an_unmatched_page(self):
        seen=[]
        async def search(query):return {'query':query,'search_summary':'型号指南为下一候选，摘要仅作线索。','results':[
            {'url':'https://publisher.example.org/guide'},
            {'url':'https://farm.example.org/a'}, {'url':'https://farm.example.org/b'},
            {'url':'https://farm.example.org/c'}]}
        async def fetch(url,item_id):
            seen.append(url)
            with self.sessions() as db:
                source=SourceRecord(owner_id=self.user,item_id=item_id,title='资料',url=url,
                    content='品牌通用介绍。',pages=[])
                db.add(source);db.commit();identity=source.id
            return {'source_id':identity,'url':url,'text':'品牌通用介绍。'}
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'连接',search=search,fetch=fetch,receipt=lambda *x:None))
        self.assertEqual(seen[0],'https://publisher.example.org/guide')
        self.assertEqual(len(seen),2)
        self.assertTrue(result['searches'][0]['search_summary'])
        self.assertFalse(any(doc['model_mentioned'] for doc in result['documents']))

    def test_photo_identity_must_finish_before_model_dependent_search(self):
        async def forbidden(*args):self.fail('Photo identity must be read before searching a blank model')
        with self.sessions() as db:
            item=domain.accessible_item(db,self.user,self.item['id'])
            item.identity_notes={'brand':'测试'}
            db.add(Asset(id='nameplate',owner_id=self.user,path='not-read',media_type='image/jpeg',original_name='plate.jpg'))
            item.photo_id='nameplate';db.commit()
        result=asyncio.run(research_item(self.sessions,self.user,self.item['id'],'连接',search=forbidden,fetch=forbidden,receipt=lambda *x:None))
        self.assertEqual(result['status'],'identity_required')

    def test_provisional_photo_model_searches_identity_before_an_operating_recipe(self):
        from wujian.research import queries_for
        with self.sessions() as db:
            item=domain.accessible_item(db,self.user,self.item['id'])
            item.state={'identity_evidence':{'basis':'visual_inference','provisional':True}}
            queries=queries_for(item,'连接手机')
            self.assertIn('"SP-31"',queries[0]);self.assertIn('版本',queries[0])
            self.assertNotIn('连接手机',queries[0]);self.assertIn('连接手机',queries[1])

    def test_photo_edition_remains_a_candidate_and_cold_search_cannot_skip_original_research(self):
        from wujian.agent_runtime import make_tools
        toolkit=make_tools(self.settings,self.sessions,self.user,'question')
        async def call(tool_name,**args):
            result=None
            async for result in toolkit.call_tool(ToolCallBlock(id=tool_name,name=tool_name,input=json.dumps(args)),AgentState(session_id='test-chat')):pass
            return result
        async def journey():
            result=await call('update_item_identity',item_id=self.item['id'],name='测试音箱',
                product={'brand':'测试','model':'SP-31','edition':'外观推测版本'},basis='visual_inference')
            self.assertNotIn('error',str(result.state).lower())
            # The actual SDK must see JSON, not str(ToolResponse(...)).
            self.assertEqual(json.loads(result.content[0].text)['id'],self.item['id'])
            photo_path=Path(self.temp.name)/'sdk-photo.png';Image.new('RGB',(20,20),'white').save(photo_path)
            with self.sessions() as db:
                db.add(Asset(id='sdk-photo',owner_id=self.user,path=str(photo_path),media_type='image/png',original_name='photo.png'))
                domain.accessible_item(db,self.user,self.item['id']).photo_id='sdk-photo';db.commit()
            result=await call('inspect_item_photos',item_id=self.item['id'])
            self.assertTrue(any(isinstance(block,DataBlock) for block in result.content))
            with self.sessions() as db:
                item=domain.accessible_item(db,self.user,self.item['id'])
                self.assertEqual(item.product.get('edition'),'')
                self.assertEqual(item.state['identity_evidence']['candidate_product']['edition'],'外观推测版本')
            result=await call('search_public_web',query='测试 SP-31 说明书')
            self.assertIn('error',str(result.state).lower())
            self.assertIn('research_product',result.content[0].text)
            result=await call('research_product',item_id=self.item['id'],topic='连接')
            self.assertNotIn('error',str(result.state).lower())
            result=await call('search_public_web',query='未解决的具体问题')
            self.assertNotIn('error',str(result.state).lower())
        with patch('wujian.agent_runtime.search_web',new_callable=AsyncMock,return_value={'results':[]}) as search:
            asyncio.run(journey());self.assertEqual(search.await_count,3)

    def test_model_operation_cannot_be_laundered_as_general_and_prose_cannot_add_features(self):
        value=self.result()
        value['continuation']['plan']['entries'][0]['guidance'].update(kind='operate',instruction='对它说打开蓝牙。')
        with self.assertRaises(ValueError):grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)
        for text in ['等待顶部环形灯旋转。','指示灯开始蓝色闪烁。','如果没反应，长按顶部按键。']:
            value=self.result();value['answer']=text
            with self.subTest(text=text),self.assertRaises(ValueError):
                grounded_turn_schema(self.sessions,self.user,'question').model_validate(value)

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

    def test_translated_original_controls_and_battery_specs_are_supported_only_by_the_quote(self):
        from wujian.guidance import validate_specific_advice,validate_parameters
        entries=[{'guidance':{'evidence':[{'quote':'Turn the knob. Use one AA battery. Press and hold for 2 seconds.'}]}}]
        validate_specific_advice('旋转旋钮。装入5 号电池。长按2秒。',entries)
        validate_parameters('长按2秒。',entries)
        with self.assertRaises(domain.DomainError):validate_specific_advice('装入7号电池。',entries)
        with self.assertRaises(domain.DomainError):validate_specific_advice('用触控方式操作。',entries)

    def test_provider_outage_preserves_only_an_uncompleted_preparation_step(self):
        from wujian.assistance import preparation_turn
        value=preparation_turn({'focused_items':[self.item]},'请分步骤教我怎么用')
        result=grounded_turn_schema(self.sessions,self.user,'question').model_validate(value.model_dump())
        with self.sessions() as db:
            saved=commit_result(db,self.user,'question',result,'请分步骤教我怎么用')
        self.assertTrue(saved['task']['plan']['guidance']['research_pending'])
        self.assertEqual(saved['task']['plan']['entries'][0]['state'],'pending')
        self.assertEqual(saved['task']['plan']['entries'][0]['guidance']['kind'],'observe')

    def test_negative_feedback_can_ask_without_rewriting_plan_and_outage_keeps_same_task(self):
        from wujian.assistance import preparation_turn
        schema=grounded_turn_schema(self.sessions,self.user,'question')
        with self.sessions() as db:
            saved=commit_result(db,self.user,'question',schema.model_validate(self.result()),'请分步骤讲解怎么操作。')
            task=saved['task']
            db.add(ChatMessage(id='negative',conversation_id='test-chat',role='user',text='我还没找到，先别跳到下一步。'))
            db.commit()
        check=grounded_turn_schema(self.sessions,self.user,'negative')
        natural=check.model_validate({'answer':'你现在能看到哪些文字或标记？我先帮你认清位置。'})
        self.assertIsNone(natural.continuation)
        recovered=preparation_turn({'focused_items':[self.item],'active_task':task},'我还没找到，先别跳到下一步。')
        result=check.model_validate(recovered.model_dump())
        with self.sessions() as db:
            saved=commit_result(db,self.user,'negative',result,'我还没找到，先别跳到下一步。')
        self.assertEqual(saved['task']['id'],task['id'])
        self.assertEqual(saved['task']['plan']['guidance']['active_step_id'],task['plan']['guidance']['active_step_id'])
        self.assertTrue(all(e['state']=='pending' for e in saved['task']['plan']['entries']))
        self.assertIn('先停在这一步',saved['answer'])
        self.assertNotIn('按键',saved['answer'])


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
