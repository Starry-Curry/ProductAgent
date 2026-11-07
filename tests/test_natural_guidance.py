"""Regressions from real repeated replies, blocking metadata and lost feedback."""
import asyncio
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase,ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient

from wujian import domain,foundation,guidance
from wujian.api_models import ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage,Conversation,SourceRecord,TaskRecord,Run,make_database
from wujian.server import create_app
from wujian.turns import TurnResult,commit_result,grounded_turn_schema


class NaturalTeachingTests(unittest.TestCase):
    def test_old_unverified_instruction_does_not_block_a_new_observation(self):
        with self.sessions() as db:
            task=db.get(TaskRecord,self.task['id'])
            legacy=copy.deepcopy(task.plan)
            legacy['entries'][0]['guidance'].update(kind='operate',instruction='长按未核验的旧按钮。',if_not_found='长按另一个旧按钮。')
            task.plan=legacy;db.commit()
        delta={'schema':'interaction/1','kind':'guidance','entries':[{'id':'new-observation',
            'title':'核对实际现象','item_id':'item_demo_lamp','group':'step','state':'pending',
            'guidance':{'kind':'observe','basis':'general','instruction':'先说一下目前能看到什么。'}}],
            'guidance':{'active_step_id':'new-observation'}}
        value={'answer':'前面的记录保留，我们先核对你现在看到的现象。','continuation':{
            'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},'plan':delta,
            'task_id':self.task['id'],'expected_version':1}}
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate(value)
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'report',result,'我有一个装不上，怎么办？')
            self.assertEqual(saved['task']['plan']['guidance']['active_step_id'],'new-observation')
            self.assertEqual(len(saved['task']['plan']['entries']),2)
            changed=copy.deepcopy(saved['task']['plan'])
            changed['entries'][0]['guidance']['instruction']='同时长按另一个未核验按钮。'
            with self.assertRaises(domain.DomainError):guidance.validate_plan(db,self.owner,['item_demo_lamp'],changed,'report',saved['task']['plan'])

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.tmp.name));self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        self.owner='person_demo_owner'
        self.plan={'schema':'interaction/1','kind':'guidance','entries':[{'id':'cap','title':'安装脚垫',
            'item_id':'item_demo_lamp','group':'step','state':'pending',
            'guidance':{'kind':'observe','basis':'general','instruction':'先核对接触处的外观。','target_label':'接触处'}}]}
        with self.sessions() as db:
            domain.seed_demo(db)
            self.task=foundation.save_task(db,self.owner,'seed','检查连接处',['item_demo_lamp'],{},copy.deepcopy(self.plan))
            c=Conversation(id='conversation',user_id=self.owner,entry_context={'intent':'guidance','task_id':self.task['id']})
            db.add(c);db.flush()
            db.add(ChatMessage(id='report',conversation_id=c.id,role='user',text='我有一个装不上，怎么办？'))
            db.commit()

    def tearDown(self):
        self.engine.dispose();self.tmp.cleanup()

    def test_current_reply_is_not_replaced_by_old_plan_and_natural_report_is_saved(self):
        plan=copy.deepcopy(self.plan)
        plan['entries'][0]['state']='unchanged'
        plan['entries'][0]['guidance']['observed_quote']='我有一个装不上，怎么办？'
        plan['entries'].append({'id':'inspect','title':'看一下卡住的位置','item_id':'item_demo_lamp','group':'step',
            'guidance':{'kind':'observe','basis':'general','instruction':'先别硬压，看看有没有歪斜或异物。','target_label':'卡住的位置'}})
        plan['guidance']={'active_step_id':'inspect'}
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate({
            'answer':'先别继续硬压。看看装不上的这一件有没有歪斜或异物；可以拍一下卡住的位置。',
            'continuation':{'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},'plan':plan,
                'task_id':self.task['id'],'expected_version':1,'feedback_quote':'我有一个装不上，怎么办？','outcome':'failure','status':'in_progress'}})
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'report',result,'我有一个装不上，怎么办？')
            self.assertEqual(saved['answer'],result.answer)
            self.assertNotIn('留意一下：',saved['answer'])
            self.assertNotIn('做完告诉我你看到或听到了什么',saved['answer'])
            self.assertEqual(saved['task']['id'],self.task['id'])
            self.assertEqual(saved['task']['plan']['entries'][0]['state'],'unchanged')
            self.assertEqual(saved['task']['plan']['guidance']['active_step_id'],'inspect')
            self.assertEqual(saved['task']['plan']['guidance']['observations'][-1]['text'],'我有一个装不上，怎么办？')

    def test_delta_plan_preserves_earlier_steps(self):
        delta=copy.deepcopy(self.plan)
        delta['entries']=[{'id':'inspect','title':'看一下卡住的位置','item_id':'item_demo_lamp','group':'step',
            'guidance':{'kind':'observe','basis':'general','instruction':'看看卡住的位置是否歪斜。','target_label':'卡住的位置'}}]
        delta['guidance']={'active_step_id':'inspect'}
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate({'answer':'先别硬压，看看卡住的位置。',
            'continuation':{'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},'plan':delta,
                'task_id':self.task['id'],'expected_version':1,'feedback_quote':'我有一个装不上，怎么办？','outcome':'failure','status':'in_progress'}})
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'report',result,'我有一个装不上，怎么办？')
            self.assertEqual([e['id'] for e in saved['task']['plan']['entries']],['cap','inspect'])

    def test_simple_help_can_answer_without_a_plan_or_manual(self):
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate({'answer':'先别硬压，看看连接处是否歪斜；没核验型号前先不拆开。'})
        self.assertIsNone(result.continuation)
        self.assertEqual(result.learning.memory_updates,[])

    def test_answer_without_plan_delta_keeps_statement_without_marking_success(self):
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate({'answer':'先别硬压，看看卡住的位置。'})
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'report',result,'我有一个装不上，怎么办？')
            self.assertEqual(saved['task']['id'],self.task['id'])
            self.assertEqual(saved['task']['plan']['entries'][0]['state'],'pending')
            self.assertEqual(saved['task']['plan']['guidance']['observations'][-1]['text'],'我有一个装不上，怎么办？')
            self.assertEqual(saved['task']['plan']['guidance']['observations'][-1]['outcome'],'unknown')

    def test_source_lines_are_resolved_before_checking_a_natural_explanation(self):
        with self.sessions() as db:
            model=domain.accessible_item(db,self.owner,'item_demo_lamp').product['model']
            db.add(SourceRecord(id='manual-for-explanation',owner_id=self.owner,item_id='item_demo_lamp',title=model+' 指南',
                url='https://publisher.example/guide',content=model+' 按住电源按钮2秒，指示灯亮起。',pages=[]))
            db.add(ChatMessage(id='explain',conversation_id='conversation',role='user',text='这一步怎么按？'));db.commit()
        plan=copy.deepcopy(self.plan)
        plan['entries']=[{'id':'press','title':'启动','item_id':'item_demo_lamp','group':'step','guidance':{
            'kind':'operate','basis':'document','instruction':'按住电源按钮2秒。',
            'evidence':[{'source_id':'manual-for-explanation','source_line_start':1,'source_line_end':1}]}}]
        plan['guidance']={'active_step_id':'press'}
        value={'answer':'这里需要持续按住电源按钮2秒，看到指示灯亮起就松手，不用反复点。',
            'continuation':{'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},'plan':plan,
                'task_id':self.task['id'],'expected_version':self.task['version']}}
        result=grounded_turn_schema(self.sessions,self.owner,'explain').model_validate(value)
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'explain',result,'这一步怎么按？')
            self.assertTrue(saved['answer'].startswith(value['answer']));self.assertIn('https://publisher.example/guide',saved['answer'])
            latest=db.get(TaskRecord,self.task['id'])
            question=ChatMessage(id='followup',conversation_id='conversation',role='user',text='再讲清楚一点。')
            db.add(question);db.commit()
        # A clarification can use existing verified evidence without rewriting
        # the task just to make the answer pass the schema.
        result=grounded_turn_schema(self.sessions,self.owner,'followup').model_validate({'answer':'按住电源按钮2秒，看到灯亮再松手。'})
        self.assertIsNone(result.continuation)

    def test_reply_after_confirmation_clears_waiting_without_falsely_finishing_goal(self):
        from wujian.api_models import GuidanceFeedback
        from sqlalchemy import select
        with self.sessions() as db:
            run=guidance.start_feedback(db,self.owner,self.task['id'],GuidanceFeedback(
                expected_version=self.task['version'],step_id='cap',outcome='done',receipt_id='checked-once'))
            message=db.scalar(select(ChatMessage).where(ChatMessage.run_id==run.id))
            message_id,question=message.id,message.text
        result=grounded_turn_schema(self.sessions,self.owner,message_id).model_validate({
            'answer':'你已经看过接触处了。它现在是歪着卡住，还是完全套不进去？'})
        with self.sessions() as db:
            saved=commit_result(db,self.owner,message_id,result,question)
            self.assertFalse(saved['task']['plan']['guidance']['awaiting_reply'])
            self.assertIsNone(saved['task']['plan']['guidance']['active_step_id'])
            self.assertEqual(saved['task']['plan']['entries'][0]['state'],'ready')
            self.assertNotEqual(saved['task']['status'],'completed')
            self.assertEqual(saved['answer'],result.answer)

    def test_reply_can_explain_another_feature_from_an_actually_read_applicable_source(self):
        with self.sessions() as db:
            model=domain.accessible_item(db,self.owner,'item_demo_lamp').product['model']
            other=domain.create_item(db,self.owner,ItemCreate(name='另一件测试物品'))
            db.add(SourceRecord(id='read-feature',owner_id=self.owner,item_id='item_demo_lamp',title=model+' 功能指南',
                url='https://publisher.example/feature',content=model+' 使用触摸面板调节此功能。',pages=[]))
            db.add(SourceRecord(id='wrong-feature',owner_id=self.owner,item_id=other['id'],title='其他物品指南',
                url='https://publisher.example/other',content=model+' 使用触摸面板调节此功能。',pages=[]))
            db.add(Run(id='feature-run',user_id=self.owner,conversation_id='conversation',status='running',
                events=[{'type':'research_source','source_id':'read-feature'}]));db.flush()
            db.add(ChatMessage(id='feature-question',conversation_id='conversation',role='user',text='这个功能怎么调？',run_id='feature-run'))
            db.commit()
        schema=grounded_turn_schema(self.sessions,self.owner,'feature-question')
        result=schema.model_validate({'answer':'这个功能用触控面板调节。'})
        self.assertIsNone(result.continuation)
        for events in [[],[{'type':'research_source','source_id':'wrong-feature'}]]:
            with self.sessions() as db:
                db.get(Run,'feature-run').events=events;db.commit()
            with self.assertRaises((ValueError,domain.DomainError)):schema.model_validate({'answer':'这个功能用触控面板调节。'})

    def test_paraphrased_feedback_keeps_user_words_and_does_not_infer_success(self):
        value={'answer':'先别继续硬压。你看到的是边缘歪了，还是接触面没对齐？',
            'continuation':{'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},'plan':copy.deepcopy(self.plan),
                'task_id':self.task['id'],'expected_version':self.task['version'],
                'feedback_quote':'有一件无法安装','outcome':'success','status':'in_progress'}}
        result=grounded_turn_schema(self.sessions,self.owner,'report').model_validate(value)
        self.assertEqual(result.continuation.feedback_quote,'我有一个装不上，怎么办？')
        self.assertEqual(result.continuation.outcome,'unknown')
        with self.sessions() as db:
            saved=commit_result(db,self.owner,'report',result,'我有一个装不上，怎么办？')
            self.assertEqual(saved['answer'],value['answer'])
            self.assertEqual(saved['task']['feedback'][-1]['outcome'],'unknown')
            self.assertNotEqual(saved['task']['status'],'completed')

    def test_web_source_page_metadata_does_not_invent_a_pdf_page(self):
        with self.sessions() as db:
            model=domain.accessible_item(db,self.owner,'item_demo_lamp').product['model']
            db.add(SourceRecord(id='html-guide',owner_id=self.owner,item_id='item_demo_lamp',title=model+' 指南',
                url='https://publisher.example/guide',content=model+' 请先核对连接处的外观。',pages=[]));db.commit()
            plan=copy.deepcopy(self.plan)
            plan['entries'][0]['guidance'].update(basis='document',evidence=[{
                'source_id':'html-guide','quote':'请先核对连接处的外观。','page':1}])
            checked=guidance.validate_plan(db,self.owner,['item_demo_lamp'],plan,'report')
            self.assertIsNone(checked['entries'][0]['guidance']['evidence'][0]['page'])

    def test_free_reply_cannot_borrow_another_actions_number_from_the_same_manual(self):
        with self.sessions() as db:
            model=domain.accessible_item(db,self.owner,'item_demo_lamp').product['model']
            db.add(SourceRecord(id='two-actions',owner_id=self.owner,item_id='item_demo_lamp',title=model+' 指南',
                url='https://publisher.example/actions',content=model+' 按住电源按钮2秒启动。\n初始化时按住7秒。',pages=[]))
            db.add(Run(id='actions-run',user_id=self.owner,conversation_id='conversation',status='running',
                events=[{'type':'research_source','source_id':'two-actions'}]));db.flush()
            db.add(ChatMessage(id='actions-question',conversation_id='conversation',role='user',text='这一步怎么启动？',run_id='actions-run'));db.commit()
        plan=copy.deepcopy(self.plan);plan['entries'][0]['guidance'].update(kind='operate',basis='document',
            instruction='按住电源按钮2秒启动。',evidence=[{'source_id':'two-actions','quote':'按住电源按钮2秒启动。'}])
        value={'answer':'按住电源按钮7秒启动。','continuation':{'goal':self.task['goal'],'item_ids':['item_demo_lamp'],'constraints':{},
            'plan':plan,'task_id':self.task['id'],'expected_version':self.task['version']}}
        schema=grounded_turn_schema(self.sessions,self.owner,'actions-question')
        with self.assertRaises((ValueError,domain.DomainError)):schema.model_validate(value)
        value['answer']='这里按住电源按钮2秒就可以启动，不用反复点。'
        self.assertEqual(schema.model_validate(value).answer,value['answer'])

    def test_free_explanation_does_not_invent_a_control_side_or_short_press(self):
        known='左单元上有电源按钮。右侧单元有触摸面板。按住电源按钮2秒关闭。'
        guidance.validate_specific_advice('电源在左侧，触控面板在右侧。',[],known)
        guidance.validate_specific_advice('电源在左侧。',[],'The power button is on the left side.')
        guidance.validate_specific_advice('找到电源符号的按钮，按住2秒。',[],known)
        for reply in ['在右耳罩上，有一个圆形按钮，就是开关机用的那个。','先按一下电源键把它关掉。']:
            with self.subTest(reply=reply),self.assertRaises(domain.DomainError):
                guidance.validate_specific_advice(reply,[],known)

    def test_general_observation_is_allowed_but_model_operations_require_evidence(self):
        plan=copy.deepcopy(self.plan);plan['entries'][0]['guidance'].update(kind='operate',instruction='长按底座按钮。')
        with self.sessions() as db:
            with self.assertRaises(domain.DomainError):guidance.validate_plan(db,self.owner,['item_demo_lamp'],plan,'report')
            plan['entries'][0]['guidance'].update(kind='observe',instruction='核对当前外观。')
            guidance.validate_plan(db,self.owner,['item_demo_lamp'],plan,'report')
            plan['entries'][0]['guidance']['basis']='document'
            with self.assertRaises(domain.DomainError):guidance.validate_plan(db,self.owner,['item_demo_lamp'],plan,'report')

    def test_default_document_basis_does_not_invalidate_old_diagram_signature(self):
        entry=copy.deepcopy(self.plan['entries'][0]);entry['guidance'].pop('basis')
        original=guidance.step_signature(entry)
        entry['guidance']['basis']='document'
        self.assertEqual(original,guidance.step_signature(entry))

    def test_useful_generic_help_does_not_launder_invented_model_reset_or_connector(self):
        with self.sessions() as db:
            for answer in ['这款灯使用USB-C接口，可以换一条线。','请长按底座电源键5秒复位。']:
                with self.subTest(answer=answer):
                    with self.assertRaises(Exception):grounded_turn_schema(self.sessions,self.owner,'report').model_validate({'answer':answer})
            guidance.validate_specific_advice('检查原装供电连接是否插稳，然后观察是否有变化。',[], '')
            guidance.validate_specific_advice('你刚才按了7秒，先告诉我看到什么。',[], '')
            guidance.validate_specific_advice('如果使用USB-C供电，先检查连接。',[], '')
            guidance.validate_specific_advice('检查USB-C线是否插稳。',[], '我的这个物品是USB-C供电')


class SearchFailureModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None,model='offline-only',parameters=self.Parameters(),max_retries=0)
        self.calls=0;self.formatter=OpenAIChatFormatter()
    async def _call_api(self,model_name,messages,tools=None,tool_choice=None,**kwargs):
        self.calls+=1
        name='search_public_web' if self.calls==1 else 'GenerateStructuredOutput'
        args={'query':'台灯不亮 初步排查'} if self.calls==1 else {'answer':'资料暂时没取到。先检查外部供电和开关，再告诉我是否有任何指示灯反应。'}
        return ChatResponse(content=[ToolCallBlock(id=f'call-{self.calls}',name=name,input=json.dumps(args))],is_last=True,
            usage=ChatUsage(input_tokens=10,output_tokens=10,time=0))


class SearchFailureTests(unittest.TestCase):
    def test_search_timeout_is_observed_and_sdk_still_returns_one_useful_answer(self):
        async def unavailable(*args):await asyncio.sleep(3)
        with tempfile.TemporaryDirectory() as folder:
            settings=Settings(data_dir=Path(folder),api_key='offline-only',rea_enabled=False)
            settings.research_timeout_seconds=.02
            app=create_app(settings,model_factory=lambda _:SearchFailureModel())
            with patch('wujian.agent_runtime.search_web',unavailable),TestClient(app) as client:
                client.post('/api/auth/demo/xiaolin')
                run=client.post('/api/chat',json={'text':'台灯不亮怎么办？'}).json()
                end=time.monotonic()+7
                while run['status'] in {'queued','running'} and time.monotonic()<end:
                    time.sleep(.02);run=client.get('/api/runs/'+run['id']).json()
                self.assertEqual(run['status'],'completed',run)
                self.assertIn('外部供电',run['text'])
                self.assertTrue(any(e['type']=='research_unavailable' and e['reason']=='TimeoutError' for e in run['events']))
                messages=client.get('/api/conversations/'+run['conversation_id']+'/messages').json()
                self.assertEqual([m['role'] for m in messages],['user','assistant'])
                self.assertEqual(messages[-1]['text'],run['text'])


class DeadlineRecoveryTests(unittest.TestCase):
    def test_sdk_swallowed_deadline_still_recovers_once_without_business_writes(self):
        class InterruptedAgent:
            def __init__(self,model,state,**kwargs):self.model=model;self.state=state
            async def reply_stream(self,*args,**kwargs):
                yield SimpleNamespace(type='text_block_delta',delta='旧步骤旧步骤')
                try:await asyncio.sleep(5)
                except asyncio.CancelledError:
                    # Match SDK behavior: cancellation becomes interrupted,
                    # rather than escaping as TimeoutError.
                    yield SimpleNamespace(type='reply_end',finished_reason='interrupted')
        with tempfile.TemporaryDirectory() as folder:
            settings=Settings(data_dir=Path(folder),api_key='offline-no-network',rea_enabled=False)
            settings.agent_timeout_seconds=.03
            with patch('wujian.agent_runtime.Agent',InterruptedAgent),patch('wujian.agent_runtime.answer_without_research',
                new_callable=AsyncMock,return_value='先检查外部供电。资料未及时取到，也可以先看看是否有亮灯反应。') as recovery:
                with TestClient(create_app(settings)) as client:
                    client.post('/api/auth/demo/xiaolin')
                    run=client.post('/api/chat',json={'text':'台灯不亮，先帮我看看。'}).json()
                    end=time.monotonic()+7
                    while run['status'] in {'queued','running'} and time.monotonic()<end:
                        self.assertEqual(run['text'],'')
                        time.sleep(.02);run=client.get('/api/runs/'+run['id']).json()
                    self.assertEqual(run['status'],'completed',run)
                    self.assertNotIn('旧步骤',run['text'])
                    self.assertTrue(any(e['type']=='answer_recovery' and e['reason']=='timeout' for e in run['events']))
                    recovery.assert_awaited_once()
                    messages=client.get('/api/conversations/'+run['conversation_id']+'/messages').json()
                    self.assertEqual(len(messages),2)
                    self.assertFalse(any(e['type']=='continuation_saved' for e in run['events']))
