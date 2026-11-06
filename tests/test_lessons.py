"""User journeys around a real-object lesson; no paid calls or physical devices."""
import io,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import AsyncMock,patch

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase,ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

from wujian.config import Settings
from wujian.database import ChatMessage
from wujian.lessons import LessonAction,profile_supported,validate_action
from wujian.server import create_app
from scripts.seed_as2_demo import seed


class QuestionModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None,model='offline-only',parameters=self.Parameters(),max_retries=0)
        self.formatter=OpenAIChatFormatter()
    async def _call_api(self,model_name,messages,**kwargs):
        return ChatResponse(content=[ToolCallBlock(id='answer',name='GenerateStructuredOutput',input=json.dumps({
            'answer':'先看面板最左侧带电源符号的圆形按键。你现在还没完成这一步，我们先留在这里。',
            'continuation':None,'learning':{'knowledge_updates':[],'memory_updates':[]},'story_refs':[]}))],
            is_last=True,usage=ChatUsage(input_tokens=10,output_tokens=10,time=0))


class LessonJourneyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();folder=Path(self.tmp.name);media=folder/'media';(media/'pic').mkdir(parents=True)
        for name in ['1.jpg','5.jpg']:Image.new('RGB',(80,100),'white').save(media/'pic'/name)
        (media/'pic/movie.mp4').write_bytes(b'offline-placeholder-not-a-tracking-test')
        manual=folder/'manual.pdf';writer=PdfWriter()
        for _ in range(6):writer.add_blank_page(width=100,height=100)
        with manual.open('wb') as file:writer.write(file)
        settings=Settings(data_dir=folder/'data',api_key='offline-no-network',rea_enabled=False)
        manifest=seed(settings,media,manual,clean=True,prepare_video=False);self.item=manifest['item_id']
        self.app=create_app(settings,model_factory=lambda _:QuestionModel())
        self.client=TestClient(self.app).__enter__();self.client.post('/api/auth/demo/xiaolin')
        self.run=self.wait(self.client.post('/api/guidance',json={'item_id':self.item,'question':'我不知道怎么用，请带我一步步来。'}))
        self.conversation=self.run['conversation_id']
        self.task=next(event['task_id'] for event in self.run['events'] if event['type']=='continuation_saved')

    def tearDown(self):self.client.__exit__(None,None,None);self.tmp.cleanup()

    def wait(self,response):
        self.assertEqual(response.status_code,200,response.text);run=response.json();end=time.monotonic()+9
        while run['status'] in {'queued','running'} and time.monotonic()<end:
            time.sleep(.01);run=self.client.get('/api/runs/'+run['id']).json()
        self.assertEqual(run['status'],'completed',run);return run

    def board(self):return self.client.get('/api/tasks/'+self.task+'/board').json()

    def chat(self,text):return self.wait(self.client.post('/api/chat',json={'text':text,'conversation_id':self.conversation}))

    def done(self,receipt=None):
        board=self.board();payload={'expected_version':board['task']['version'],'step_id':board['task']['plan']['guidance']['active_step_id'],
            'outcome':'done','receipt_id':receipt or 'test-receipt-'+str(board['task']['version'])}
        return self.wait(self.client.post('/api/tasks/'+self.task+'/guidance-feedback',json=payload)),payload

    def test_initial_step_and_reviewed_aids_are_ready_without_a_model_call(self):
        self.assertIn('第 1 步',self.run['text']);self.assertNotIn('第 2 步',self.run['text'])
        self.assertEqual(self.run['usage']['scope'],'reviewed_procedure_no_model_call')
        board=self.board();self.assertEqual(board['completed_count'],0)
        with patch('wujian.teaching_diagram.generate_scene',new_callable=AsyncMock) as model:
            response=self.client.post('/api/tasks/'+self.task+'/diagram',json={'expected_version':board['task']['version'],'step_id':'power'})
            self.assertEqual(response.status_code,200,response.text);model.assert_not_called()
        self.assertIn('mode',board['task']['plan']['visualizations'])

    def test_confirmation_is_idempotent_and_only_advances_one_step(self):
        run,payload=self.done('single-click-receipt')
        self.assertIn('第 2 步',run['text']);board=self.board();version=board['task']['version']
        self.assertEqual(board['completed_count'],1);self.assertEqual(board['entries'][1]['state'],'pending')
        retried=self.wait(self.client.post('/api/tasks/'+self.task+'/guidance-feedback',json=payload))
        self.assertEqual(retried['id'],run['id']);self.assertEqual(self.board()['task']['version'],version)

    def test_questions_and_negative_report_keep_the_current_step(self):
        self.chat('电源键在哪一侧？我没有找到。')
        board=self.board();self.assertEqual(board['task']['plan']['guidance']['active_step_id'],'power')
        self.assertEqual(board['completed_count'],0)
        self.assertIn('没有找到',board['task']['plan']['guidance']['observations'][-1]['text'])
        explained=self.chat('这一步怎么做？');self.assertIn('不需要长按',explained['text'])
        self.assertEqual(self.board()['completed_count'],0)

    def test_future_step_and_checklist_api_cannot_bypass_confirmation(self):
        board=self.board();version=board['task']['version']
        self.assertEqual(self.client.post('/api/tasks/'+self.task+'/guidance-feedback',json={
            'expected_version':version,'step_id':'press','outcome':'done','receipt_id':'skip-attempt'}).status_code,409)
        self.assertEqual(self.client.patch('/api/tasks/'+self.task+'/entries/press',json={
            'expected_version':version,'state':'ready'}).status_code,409)
        self.assertEqual(self.client.post('/api/tasks/'+self.task+'/diagram',json={
            'expected_version':version,'step_id':'press'}).status_code,409)
        self.assertEqual(self.board()['completed_count'],0)

    def test_pause_and_material_gate_are_retained(self):
        self.chat('暂停');board=self.board()
        self.assertEqual(board['task']['plan']['guidance']['lesson']['phase'],'paused')
        response=self.client.post('/api/tasks/'+self.task+'/guidance-feedback',json={
            'expected_version':board['task']['version'],'step_id':'power','outcome':'done','receipt_id':'paused-receipt'})
        self.assertEqual(response.status_code,409)
        self.chat('继续教学');self.done();board=self.board()
        blocked=self.client.post('/api/tasks/'+self.task+'/guidance-feedback',json={
            'expected_version':board['task']['version'],'step_id':'mode','outcome':'done','receipt_id':'missing-material'})
        self.assertEqual(blocked.status_code,409);self.assertEqual(self.board()['completed_count'],1)
        self.chat('我用普通刻字膜，包装要求145℃、15秒、80kg。')
        self.assertEqual(self.board()['completed_count'],1)
        self.done();self.assertEqual(self.board()['task']['plan']['guidance']['active_step_id'],'preheat')

    def test_whole_workflow_can_resume_to_completion(self):
        self.done();self.chat('我用普通刻字膜烫棉帆布袋，包装适用145℃、15秒、80kg。')
        while self.board()['task']['status']!='completed':self.done()
        board=self.board();self.assertEqual(board['completed_count'],12)
        self.assertIsNone(board['task']['plan']['guidance']['active_step_id'])
        self.assertTrue(any(report['outcome']=='success' for report in board['task']['feedback']))

    def test_model_cannot_call_uncertain_words_a_confirmation(self):
        board=self.board()
        with self.app.state.sessions() as db:
            message=ChatMessage(id='uncertain',conversation_id=self.conversation,role='user',text='我还没完成，这样对了吗？')
            db.add(message);db.commit()
            with self.assertRaises(Exception):validate_action(db,'person_demo_owner',message.id,LessonAction(kind='confirm',
                task_id=self.task,step_id='power',expected_version=board['task']['version'],observed_quote=message.text))
        profile=board['task']['plan']['guidance']['lesson']['definition']['profiles'][0]
        self.assertFalse(profile_supported(profile,'普通刻字膜不是145℃、15秒、80kg。'))
        self.assertFalse(profile_supported(profile,'普通刻字膜1450℃、15秒、80kg。'))

    def test_retrieval_excludes_geometry_and_full_procedure_definition(self):
        from wujian.retrieval import authorized_documents
        document=authorized_documents(self.app.state.sessions,'person_demo_owner')['task/'+self.task]
        self.assertNotIn('visualizations',document['data']['plan'])
        self.assertNotIn('definition',document['data']['plan']['guidance']['lesson'])
        self.assertIn('active_step_id',document['text'])

    def test_picture_uses_owned_photo_and_never_confirms_step(self):
        from wujian.camera_guidance import Grounding
        board=self.board()
        with patch('wujian.camera_guidance.locate',new_callable=AsyncMock,return_value=Grounding(
            visible=True,bbox=(100,200,200,300),label='电源键',confidence=.9,candidates=[(100,200,200,300)],explanation='离线边界测试')) as call:
            response=self.client.post('/api/tasks/'+self.task+'/picture',json={'expected_version':board['task']['version'],'step_id':'power'})
            self.assertEqual(response.status_code,200,response.text)
            result=response.json();self.assertEqual(result['completed_count'],0)
            self.assertEqual(result['task']['plan']['guidance']['active_step_id'],'power')
            picture=result['task']['plan']['guidance']['pictures']['power'];self.assertIn('point',picture)
            self.assertEqual(self.client.get('/api/assets/'+picture['image_id']).status_code,200)
            again=self.client.post('/api/tasks/'+self.task+'/picture',json={'expected_version':result['task']['version'],'step_id':'power'})
            self.assertEqual(again.status_code,200);self.assertEqual(call.await_count,1)
            self.assertEqual(self.client.post('/api/tasks/'+self.task+'/picture',json={'expected_version':result['task']['version'],'step_id':'press'}).status_code,409)

    def test_negative_answer_check_is_not_bypassed_by_a_short_question(self):
        from wujian.lessons import grounded_lesson_schema
        from pydantic import ValidationError
        with self.app.state.sessions() as db:
            message=ChatMessage(id='negative-screen',conversation_id=self.conversation,role='user',text='屏幕没有亮，接下来怎么办？')
            db.add(message);db.commit()
        schema=grounded_lesson_schema(self.app.state.sessions,'person_demo_owner','negative-screen')
        with self.assertRaises(ValidationError):schema(answer='1. 先检查电源。\n2. 再检查背后的总开关。')
        with self.assertRaises(ValidationError):schema(answer='把机器背后的总开关拨到开。')
        with self.assertRaises(ValidationError):schema(answer='看看机器侧面或背面有没有独立的总电源开关，如果有就打开。')
        with self.app.state.sessions() as db:
            db.add(ChatMessage(id='asked-auto',conversation_id=self.conversation,role='user',text='A 键不是电源吗？'));db.commit()
        auto_schema=grounded_lesson_schema(self.app.state.sessions,'person_demo_owner','asked-auto')
        with self.assertRaises(ValidationError):auto_schema(answer='A 键是最右侧的品牌启动键。')
        auto_schema(answer='A 键切换自动熨压模式。开机应使用最左侧带 ⏻ 的电源键。')

    def test_static_picture_stays_visible_when_cloud_grounding_times_out(self):
        board=self.board()
        with patch('wujian.camera_guidance.locate',new_callable=AsyncMock,side_effect=TimeoutError):
            response=self.client.post('/api/tasks/'+self.task+'/picture',json={'expected_version':board['task']['version'],'step_id':'power'})
        self.assertEqual(response.status_code,200,response.text)
        picture=response.json()['task']['plan']['guidance']['pictures']['power']
        self.assertEqual(picture['evidence_kind'],'unannotated_source_image')
        self.assertNotIn('point',picture);self.assertEqual(response.json()['completed_count'],0)

    def test_other_chat_cannot_overwrite_reviewed_lesson_or_its_models(self):
        from wujian.database import Conversation,TaskRecord
        from wujian.turns import grounded_turn_schema,commit_result
        board=self.board();plan=board['task']['plan']
        bad={**plan,'guidance':{'active_step_id':'mode'}}
        with self.app.state.sessions() as db:
            conversation=Conversation(user_id='person_demo_owner',entry_context={'intent':'general'})
            db.add(conversation);db.flush()
            message=ChatMessage(conversation_id=conversation.id,role='user',text='继续聊一下模式键');db.add(message);db.commit()
            schema=grounded_turn_schema(self.app.state.sessions,'person_demo_owner',message.id)
            result=schema(answer='模式键用于切换预置，原来的教学进度保留。',continuation={
                'goal':'学会使用AS2','task_id':self.task,'expected_version':board['task']['version'],
                'item_ids':[self.item],'constraints':{},'plan':bad,'status':'in_progress'})
            self.assertIsNone(result.continuation)
            commit_result(db,'person_demo_owner',message.id,result,message.text)
            self.assertTrue(db.get(TaskRecord,self.task).plan['guidance']['lesson'])
        self.assertEqual(self.board()['task']['plan']['visualizations']['mode']['nature'],'reviewed_schematic')

    def test_reviewed_diagram_is_restored_without_a_qwen_downgrade(self):
        from wujian.database import TaskRecord
        with self.app.state.sessions() as db:
            task=db.get(TaskRecord,self.task);visual=dict(task.plan['visualizations'])
            visual['power']={'nature':'model_generated_schematic','scene':{'parts':[]}}
            task.plan={**task.plan,'visualizations':visual};db.commit()
        board=self.board()
        with patch('wujian.teaching_diagram.generate_scene',new_callable=AsyncMock) as model:
            response=self.client.post('/api/tasks/'+self.task+'/diagram',json={'expected_version':board['task']['version'],'step_id':'power'})
        self.assertEqual(response.status_code,200,response.text);model.assert_not_called()
        restored=response.json()['task']['plan']['visualizations']['power']
        self.assertEqual(restored['nature'],'reviewed_schematic');self.assertGreater(len(restored['scene']['parts']),20)
