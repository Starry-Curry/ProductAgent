"""Real AgentScope orchestration with an offline model; no network or paid API."""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.server import create_app


class ScriptedModel(ChatModelBase):
    def __init__(self, mode='tool'):
        super().__init__(credential=None, model='offline-test-only', parameters=self.Parameters(), max_retries=0)
        self.calls, self.mode = 0, mode
        self.formatter = OpenAIChatFormatter()

    async def _call_api(self, model_name, messages, tools=None, tool_choice=None, **kwargs):
        self.calls += 1
        if self.mode == 'wait':
            await asyncio.sleep(30)
        if self.calls == 1 or self.mode == 'loop':
            args = {'item_id':'item_demo_lamp'}
            name='read_item'
            if self.mode == 'identity':
                name='update_item_identity'
                args.update(name='我的台灯',product={'brand':'米家','model':'MJTD01SYL'},basis='user_report')
            return ChatResponse(content=[ToolCallBlock(id=f'test-call-{self.calls}', name=name,
                input=json.dumps(args))], is_last=True,
                usage=ChatUsage(input_tokens=10, output_tokens=3, time=0))
        return ChatResponse(content=[ToolCallBlock(id=f'final-{self.calls}',name='GenerateStructuredOutput',input=json.dumps({'answer':'离线 SDK 集成测试完成。','continuation':None,'learning':{'knowledge_updates':[],'memory_updates':[]},'story_refs':[]}))],is_last=True,
                            usage=ChatUsage(input_tokens=11,output_tokens=4,time=0))


class AgentIntegrationTests(unittest.TestCase):
    def execute_case(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            app=create_app(Settings(data_dir=Path(directory),api_key='offline-test-no-network'),
                           model_factory=lambda _: ScriptedModel(mode))
            with TestClient(app) as client:
                client.post('/api/auth/demo/xiaolin')
                response=client.post('/api/chat',json={'text':'请读取台灯信息'})
                self.assertEqual(response.status_code,200,response.text)
                run=response.json()
                if mode=='wait':
                    client.post('/api/runs/'+run['id']+'/cancel')
                started=time.monotonic()
                while run['status'] in {'queued','running'} and time.monotonic()-started<8:
                    time.sleep(.02)
                    run=client.get('/api/runs/'+run['id']).json()
                if mode in {'tool','identity'}:
                    self.assertEqual(run['status'],'completed',run)
                    self.assertEqual(run['text'],'离线 SDK 集成测试完成。')
                    self.assertTrue(any(event.get('type')=='tool_start' for event in run['events']))
                    self.assertTrue(all(event.get('state')=='success' for event in run['events'] if event['type']=='tool_end'))
                    if mode=='identity':
                        item=client.get('/api/items/item_demo_lamp').json()
                        self.assertEqual(item['name'],'我的台灯')
                        self.assertEqual(item['state']['identity_evidence']['basis'],'user_report')
                    self.assertEqual(run['usage']['input_tokens'],21)
                    history=client.get('/api/conversations/'+run['conversation_id']+'/messages').json()
                    self.assertEqual([row['role'] for row in history],['user','assistant'])
                    follow=client.post('/api/chat',json={'text':'继续', 'conversation_id':run['conversation_id']})
                    self.assertEqual(follow.status_code,200)
                    follow_run=follow.json()
                    while follow_run['status'] in {'queued','running'} and time.monotonic()-started<8:
                        time.sleep(.02)
                        follow_run=client.get('/api/runs/'+follow_run['id']).json()
                    self.assertEqual(follow_run['status'],'completed',follow_run)
                elif mode=='loop':
                    self.assertEqual(run['status'],'failed',run)
                    self.assertIn('exceed_max_iters',run['error'])
                else:
                    self.assertEqual(run['status'],'interrupted',run)

    def test_native_sdk_tools_events_usage_and_state_restore(self):
        self.execute_case('tool')

    def test_iteration_exhaustion_is_not_success(self):
        self.execute_case('loop')

    def test_nested_identity_contract_reaches_domain_operation(self):
        self.execute_case('identity')

    def test_cancel_is_not_success(self):
        self.execute_case('wait')


if __name__=='__main__':
    unittest.main()
