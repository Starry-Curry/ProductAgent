"""Creative entry uses the same agent and records observed research, offline only."""
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.database import SourceRecord
from wujian.knowledge import source_excerpt
from wujian.server import create_app


class CreativeModel(ChatModelBase):
    def __init__(self, research=True, clarification=False):
        super().__init__(credential=None, model='offline-creative-test', parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.calls, self.research, self.clarification = 0, research, clarification

    async def _call_api(self, model_name, messages, tools=None, tool_choice=None, **kwargs):
        self.calls += 1
        if self.research and self.calls == 1:
            name, args = 'search_public_web', {'query':'石头公开绘画案例'}
        elif self.research and self.calls == 2:
            name, args = 'fetch_document', {'url':'https://example.com/stone-case', 'item_id':'item_demo_stone'}
        else:
            name = 'GenerateStructuredOutput'
            args = {'answer':'想获得怎样的体验？' if self.clarification else '参考公开案例后，先用可擦除方式小范围试试。',
                'continuation':None if self.clarification else {'goal':'石头的新可能', 'item_ids':['item_demo_stone'],
                    'constraints':{'no_permanent_change':True}, 'plan':{'schema':'interaction/1','kind':'idea',
                    'entries':[{'id':'trial','title':'先在可擦除的表面试画','group':'step','state':'pending'}]},
                    'task_id':None,'expected_version':None,'status':'exploring','feedback_quote':'','outcome':'unknown'},
                'learning':{'knowledge_updates':[],'memory_updates':[]}, 'story_refs':[]}
        return ChatResponse(content=[ToolCallBlock(id=f'creative-{self.calls}',name=name,input=json.dumps(args))],is_last=True,
            usage=ChatUsage(input_tokens=10,output_tokens=4,time=0))


class CreativeJourneyTests(unittest.TestCase):
    def run_case(self, research=True, clarification=False):
        with tempfile.TemporaryDirectory() as folder:
            app = create_app(Settings(data_dir=Path(folder),api_key='offline-no-network',rea_enabled=False),
                model_factory=lambda _:CreativeModel(research,clarification))

            async def retained_source(*args, **kwargs):
                with app.state.sessions() as db:
                    row = SourceRecord(owner_id='person_demo_owner',item_id='item_demo_stone',origin='public_web',
                        title='Offline public case fixture',url='https://example.com/stone-case',content='Try a removable mark on a sample before painting.')
                    db.add(row)
                    db.commit()
                    return source_excerpt(row)

            with patch('wujian.agent_runtime.search_web',new=AsyncMock(return_value={'results':[{'url':'https://example.com/stone-case'}], 'search_summary':'offline fixture'})), \
                 patch('wujian.agent_runtime.fetch_source',new=retained_source), TestClient(app) as client:
                client.post('/api/auth/demo/xiaolin')
                response = client.post('/api/creative-explorations',json={'goal':'让石头有点新意思，不永久改造','item_ids':['item_demo_stone']})
                self.assertEqual(response.status_code,200,response.text)
                run = response.json()
                started = time.monotonic()
                while run['status'] in {'queued','running'} and time.monotonic()-started < 12:
                    time.sleep(.03)
                    run = client.get('/api/runs/'+run['id']).json()
                tasks = [task for task in client.get('/api/tasks').json() if task['goal']=='石头的新可能']
                thread = next(row for row in client.get('/api/conversations').json() if row['id']==run['conversation_id'])
                self.assertEqual(thread['item_ids'],['item_demo_stone'])
                self.assertEqual(thread['entry_context']['intent'],'creative')
                self.assertEqual(thread['title'],'让石头有点新意思，不永久改造')
                if research:
                    self.assertEqual(run['status'],'completed',run)
                    self.assertEqual([event['type'] for event in run['events'] if event['type'].startswith('research_')],['research_search','research_source'])
                    self.assertEqual(tasks[0]['plan']['kind'],'idea')
                    self.assertEqual(tasks[0]['plan']['entries'][0]['state'],'pending')
                    self.assertNotEqual(tasks[0]['status'],'completed')
                elif clarification:
                    self.assertEqual(run['status'],'completed',run)
                    self.assertEqual(tasks,[])
                else:
                    self.assertEqual(run['status'],'failed',run)
                    self.assertIn('公开案例',run['error'])
                    self.assertEqual(tasks,[])
                    self.assertEqual(run['text'],'')

    def test_sources_are_actual_tool_receipts_and_survive_progress_and_final_save(self):
        self.run_case()

    def test_generated_plan_without_research_is_not_published_as_a_sourced_idea(self):
        self.run_case(research=False)

    def test_clarification_without_a_plan_does_not_invent_sources(self):
        self.run_case(research=False,clarification=True)

    def test_entry_checks_item_permissions_and_rejects_blank_goal_before_running(self):
        with tempfile.TemporaryDirectory() as folder:
            app=create_app(Settings(data_dir=Path(folder),api_key='offline-no-network',rea_enabled=False),
                model_factory=lambda _:CreativeModel())
            with TestClient(app) as client:
                client.post('/api/auth/demo/xiaoxia')
                denied=client.post('/api/creative-explorations',json={'goal':'看看它','item_ids':['item_demo_stone']})
                self.assertEqual(denied.status_code,404)
                self.assertEqual(client.post('/api/creative-explorations',json={'goal':'   '}).status_code,400)
                self.assertEqual(client.get('/api/conversations').json(),[])


if __name__ == '__main__':
    unittest.main()
