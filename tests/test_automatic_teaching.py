"""Ordinary physical help enters the native guide, not an authored website."""
import asyncio,copy,json,tempfile,time,unittest
from pathlib import Path
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase,ChatResponse
from agentscope.model._model_usage import ChatUsage
from agentscope.state import AgentState
from fastapi.testclient import TestClient
from sqlalchemy import select
from wujian import domain,coding_workbench
from wujian.agent_runtime import make_tools
from wujian.assistance import wants_steps,operation_help_requested
from wujian.config import Settings
from wujian.database import ChatMessage,Conversation,TaskRecord
from wujian.server import create_app
from wujian.turns import grounded_turn_schema


def teaching(identity):
    return {'answer':'先留在当前对话看一下设备上的提示；告诉我实际显示的文字，我们再接着处理。',
        'assistance_mode':'teach','target_item_ids':[identity],'continuation':{
            'goal':'解决当前物品的使用问题','item_ids':[identity],'constraints':{},'task_id':None,'expected_version':None,
            'plan':{'schema':'interaction/1','kind':'guidance','entries':[{'id':'current-state',
                'title':'核对现在的提示','item_id':identity,'group':'step','state':'pending',
                'guidance':{'kind':'observe','basis':'general','instruction':'看一下当前能读到的提示文字。',
                    'target_label':'设备上的提示','success_signal':'报告你实际看到的文字，没有提示也如实说。'}}],
                'guidance':{'active_step_id':'current-state'}}}}


class NativeTeacher(ChatModelBase):
    def __init__(self,capture):
        super().__init__(credential=None,model='offline-semantic-teacher',parameters=self.Parameters(),max_retries=0)
        self.formatter=OpenAIChatFormatter();self.capture=capture
    async def _call_api(self,model_name,messages,**kwargs):
        self.capture['prompt']='\n'.join(block.text for message in messages for block in message.content if hasattr(block,'text'))
        value=teaching(self.capture['item_id'])
        return ChatResponse(content=[ToolCallBlock(id='guide',name='GenerateStructuredOutput',input=json.dumps(value))],is_last=True,
            usage=ChatUsage(input_tokens=5,output_tokens=5,time=0))


class StartThenAnswer(NativeTeacher):
    async def _call_api(self,model_name,messages,**kwargs):
        self.capture['calls']=self.capture.get('calls',0)+1
        if self.capture['calls']==1:
            name='start_guidance';value={'item_id':self.capture['item_id'],'goal':'连接设备并解决脱机问题',
                'question':self.capture.get('question','现在是用 USB 线连电脑，还是连接 Wi-Fi？电脑上出现了什么提示？')}
        else:
            name='GenerateStructuredOutput';value={'answer':'我们先确认连接方式和电脑上的提示，再决定下一步。','continuation':None}
        return ChatResponse(content=[ToolCallBlock(id='start-'+str(self.capture['calls']),name=name,input=json.dumps(value))],is_last=True)


class AutomaticTeachingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.capture={'item_id':'item_demo_printer'}
        self.settings=Settings(data_dir=Path(self.temp.name),api_key='offline-no-network',rea_enabled=False)
        self.app=create_app(self.settings,model_factory=lambda _:NativeTeacher(self.capture))
        self.client=TestClient(self.app);self.client.__enter__();self.client.post('/api/auth/demo/xiaolin').raise_for_status()
    def tearDown(self):self.client.__exit__(None,None,None);self.temp.cleanup()
    def finish(self,payload):
        response=self.client.post('/api/chat',json=payload);response.raise_for_status();run=response.json();end=time.monotonic()+12
        while run['status'] in {'queued','running'} and time.monotonic()<end:
            time.sleep(.02);run=self.client.get('/api/runs/'+run['id']).json()
        self.assertEqual(run['status'],'completed',run)
        conversation=next(c for c in self.client.get('/api/conversations').json() if c['id']==run['conversation_id'])
        board=self.client.get('/api/tasks/'+conversation['entry_context']['task_id']+'/board').json()
        self.assertEqual(conversation['entry_context']['intent'],'guidance');self.assertEqual(board['kind'],'guidance')
        self.assertTrue(board['entries'][0]['guidance']['instruction']);self.assertEqual(board['completed_count'],0)
        return run,conversation,board
    def test_ordinary_printer_question_in_global_chat_needs_no_step_phrase_or_manual_selection(self):
        question='家里的打印机怎么连不上了？怎么开始打印啊？'
        self.assertFalse(wants_steps(question));self.assertTrue(operation_help_requested(question))
        _,conversation,board=self.finish({'text':question})
        self.assertEqual(conversation['item_ids'],['item_demo_printer'])
        self.assertIn('"intent":"guidance"',self.capture['prompt'])
        self.assertEqual(board['task']['item_ids'],['item_demo_printer'])
    def test_semantic_teach_mode_without_any_hint_phrase_still_enters_guidance(self):
        question='它终于被我拿出来了，陪我把这件事做成吧。'
        self.assertFalse(wants_steps(question));self.assertFalse(operation_help_requested(question))
        self.finish({'text':question,'item_ids':['item_demo_printer']})
    def test_start_tool_binds_native_controls_and_final_answer_does_not_duplicate_task(self):
        self.app.state.runner.model_factory=lambda _:StartThenAnswer(self.capture)
        run,conversation,board=self.finish({'text':'家里的打印机怎么连不上了？怎么开始打印啊？'})
        self.assertTrue(any(event.get('source')=='start_guidance' for event in run['events']))
        self.assertIn('USB',board['entries'][0]['guidance']['instruction'])
        with self.app.state.sessions() as db:
            tasks=[t for t in db.scalars(select(TaskRecord)) if t.goal=='连接设备并解决脱机问题']
            self.assertEqual(len(tasks),1)
    def test_theory_software_and_creative_requests_are_not_automatic_physical_help(self):
        for text in ['蓝牙连接的原理是什么，只讲原理。','给我的设备开发一个网页控制面板。','帮我安排一下卡片小游戏怎么开始。']:
            self.assertFalse(operation_help_requested(text),text)
    def test_followup_updates_current_question_in_same_task_preserving_prior_step(self):
        self.app.state.runner.model_factory=lambda _:StartThenAnswer(self.capture)
        _,chat,board=self.finish({'text':'家里的打印机怎么连不上了？'})
        old=copy.deepcopy(board['entries'][0]);identity=board['task']['id']
        self.capture.update(calls=0,question='明白，是 USB 连接且显示脱机。电脑用的是 Windows 还是 macOS？')
        _,_,updated=self.finish({'conversation_id':chat['id'],'text':'USB直连，有亮灯，电脑端显示脱机。'})
        self.assertEqual(updated['task']['id'],identity)
        self.assertEqual(next(e for e in updated['entries'] if e['id']==old['id']),old)
        active=updated['task']['plan']['guidance']['active_step_id']
        question=next(e['guidance']['instruction'] for e in updated['entries'] if e['id']==active)
        self.assertIn('Windows',question);self.assertNotEqual(active,old['id'])
    def test_semantic_teach_in_global_chat_cannot_omit_the_native_plan(self):
        with self.app.state.sessions() as db:
            chat=Conversation(user_id='person_demo_owner');db.add(chat);db.flush()
            message=ChatMessage(conversation_id=chat.id,role='user',text='它终于被我拿出来了，陪我把这件事做成吧。');db.add(message);db.commit();identity=message.id
        schema=grounded_turn_schema(self.app.state.sessions,'person_demo_owner',identity)
        with self.assertRaises((ValueError,domain.DomainError)):
            schema.model_validate({'answer':'给你一些建议。','assistance_mode':'teach','target_item_ids':['item_demo_printer']})
    def test_title_only_outline_is_not_an_interactive_step(self):
        with self.app.state.sessions() as db:
            chat=Conversation(user_id='person_demo_owner',item_ids=['item_demo_printer']);db.add(chat);db.flush()
            message=ChatMessage(conversation_id=chat.id,role='user',text='怎么开始打印？');db.add(message);db.commit();identity=message.id
        value=teaching('item_demo_printer');value['continuation']['plan']['entries'][0].pop('guidance')
        with self.assertRaises((ValueError,domain.DomainError)):
            grounded_turn_schema(self.app.state.sessions,'person_demo_owner',identity).model_validate(value)
    def test_start_tool_cannot_publish_an_operation_using_an_unread_source(self):
        with self.app.state.sessions() as db:
            chat=Conversation(user_id='person_demo_owner',item_ids=['item_demo_printer']);db.add(chat);db.flush()
            message=ChatMessage(conversation_id=chat.id,role='user',text='教我打印。');db.add(message);db.commit();identity=message.id
        toolkit=make_tools(self.settings,self.app.state.sessions,'person_demo_owner',identity,evidence_sources=set())
        async def call():
            result=None
            async for result in toolkit.call_tool(ToolCallBlock(id='unread',name='start_guidance',input=json.dumps({
                'item_id':'item_demo_printer','goal':'恢复打印','question':'执行这项操作。','kind':'operate',
                'source_id':'not-actually-read','source_line_start':1,'source_line_end':2})),AgentState(session_id=chat.id)):pass
            return result
        result=asyncio.run(call())
        self.assertIn('error',str(result.state).lower());self.assertIn('尚未实际读取',result.content[0].text)
        with self.app.state.sessions() as db:self.assertIsNone(db.get(Conversation,chat.id).entry_context.get('task_id'))
    def call_create(self,text):
        with self.app.state.sessions() as db:
            chat=Conversation(user_id='person_demo_owner',item_ids=['item_demo_printer']);db.add(chat);db.flush()
            message=ChatMessage(conversation_id=chat.id,role='user',text=text);db.add(message);db.commit();identity=message.id
        toolkit=make_tools(self.settings,self.app.state.sessions,'person_demo_owner',identity)
        async def call():
            result=None
            async for result in toolkit.call_tool(ToolCallBlock(id='create',name='create_workbench',input=json.dumps({
                'item_id':'item_demo_printer','goal':text,'source_quote':text})),AgentState(session_id=chat.id)):pass
            return result
        return asyncio.run(call())
    def test_3d_camera_teaching_cannot_be_redirected_into_a_website(self):
        result=self.call_create('能不能生成一个一步一步的讲解，包含3D示意图和实时跟踪，在这个对话里做。')
        self.assertIn('error',str(result.state).lower());self.assertIn('原生guidance',result.content[0].text)
        with self.app.state.sessions() as db:self.assertFalse(any(t.plan.get('schema')=='workbench/1' for t in db.scalars(select(TaskRecord))))
    def test_explicit_software_creation_is_preserved(self):
        result=self.call_create('给我的打印机做一个网页小工具，用来手动记录每次打印。')
        self.assertNotIn('error',str(result.state).lower(),result)
    def test_existing_workbench_does_not_capture_a_new_in_chat_teaching_request(self):
        with self.app.state.sessions() as db:
            chat=Conversation(user_id='person_demo_owner',item_ids=['item_demo_printer']);db.add(chat);db.flush()
            original=ChatMessage(conversation_id=chat.id,role='user',text='给打印机写一个网页工具。');db.add(original);db.commit()
            artifact=coding_workbench.create(db,'person_demo_owner',original.id,'item_demo_printer','打印记录工具',original.text)
            chat.entry_context={'intent':'general','task_id':artifact['task_id']};db.commit();chat_id=chat.id
        _,conversation,board=self.finish({'conversation_id':chat_id,'text':'一步一步教我连接，带3D和摄像头追踪，在这个对话里进行。'})
        self.assertNotEqual(board['task']['id'],artifact['task_id'])
        with self.app.state.sessions() as db:self.assertEqual(db.get(TaskRecord,artifact['task_id']).plan['schema'],'workbench/1')
