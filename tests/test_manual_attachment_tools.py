"""Real SDK source tools and SQL replay over synthetic manual transport."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from test_manual_attachment_reader import LANDING, TARGET, landing, pdf_bytes
from wujian import domain
from wujian.api_models import ItemCreate
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.conversation_context import build_conversation_context
from wujian.database import ChatMessage, Conversation, Run, make_database
from wujian.turns import TurnResult, commit_result


class ManualAttachmentToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.directory.name),api_key='offline-no-network');self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings);self.owner='person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item=domain.create_item(db,self.owner,ItemCreate(name='合成设备',
                product={'brand':'Synthetic fixture','model':'FictionalModel','market':'CN'}))['id']
            conversation=Conversation(user_id=self.owner,item_ids=[self.item]);db.add(conversation);db.flush()
            message=ChatMessage(conversation_id=conversation.id,role='user',text='先读取这份手册。')
            db.add(message);db.commit();self.message=message.id;self.conversation=conversation.id
        self.evidence=set()
        toolkit=make_tools(self.settings,self.sessions,self.owner,self.message,evidence_sources=self.evidence)
        self.tools={tool.name:tool for tool in toolkit.tool_groups[0].tools}

    def tearDown(self):
        self.engine.dispose();self.directory.cleanup()

    async def transport(self,url,**_):
        if url==LANDING:return url,'text/html',landing()
        self.assertEqual(url,TARGET)
        return url,'application/pdf',pdf_bytes()

    async def test_fetch_document_evidence_link_and_applicability_describe_actual_pdf(self):
        with patch('wujian.knowledge.download_public',new=AsyncMock(side_effect=self.transport)):
            response=await self.tools['fetch_document'](url=LANDING,item_id=self.item)
        self.assertEqual(str(response.state),'success')
        value=json.loads(response.content[0].text)
        self.assertEqual(value['page_count'],1)
        self.assertEqual(value['manual_resolution']['pdf_obtained'],True)
        identity=value['source_id']
        self.assertNotEqual(identity,value['landing_source']['source_id'])
        self.assertEqual(response.metadata['evidence']['source_id'],identity)
        self.assertEqual(response.metadata['evidence']['url'],TARGET)
        self.assertEqual(response.metadata['evidence']['document_read_chain'],value['document_read_chain'])
        self.assertEqual(response.metadata['evidence']['manual_resolution'],value['manual_resolution'])
        self.assertEqual(self.evidence,{identity})
        self.assertEqual(value['applicability']['targets'][0]['model'],'FictionalModel')
        self.assertTrue(value['applicability']['targets'][0]['model_in_source_text'])
        self.assertFalse(value['applicability']['procedure_compatibility_verified'])
        result=TurnResult.model_validate({'learning':{},'continuation':None,'answer':'已取得文件，具体操作仍需核对。','source_refs':[identity]})
        with self.sessions() as db:
            answer=commit_result(db,self.owner,self.message,result,'先读取这份手册。')['answer']
        self.assertIn(TARGET,answer);self.assertNotIn(LANDING,answer)

    async def test_search_original_reads_and_failed_run_replay_point_to_pdf(self):
        discovery={'query':'synthetic manual','results':[{'url':LANDING,'title':'FictionalModel User Manual'}],
            'evidence_kind':'search_result_not_full_document'}
        with patch('wujian.agent_runtime.search_web',new=AsyncMock(return_value=discovery)),patch(
            'wujian.knowledge.download_public',new=AsyncMock(side_effect=self.transport)):
            response=await self.tools['search_public_web'](query='synthetic manual',read_limit=1,item_id=self.item)
        self.assertEqual(str(response.state),'success')
        value=json.loads(response.content[0].text)
        original=value['results'][0]['original'];identity=original['source_id']
        self.assertEqual(original['page_count'],1)
        self.assertEqual(value['results'][0]['url'],LANDING,'Discovery URL remains the discovered landing')
        read=response.metadata['evidence']['original_reads'][0]
        self.assertEqual((read['source_id'],read['url']),(identity,TARGET))
        self.assertEqual(read['document_read_chain'],original['document_read_chain'])
        self.assertTrue(read['manual_resolution']['pdf_obtained'])
        self.assertEqual(self.evidence,{identity})
        with self.sessions() as db:
            run=Run(user_id=self.owner,conversation_id=self.conversation,status='failed',events=[
                {'type':'tool_start','name':'search_public_web','id':'synthetic-search'},
                {'type':'tool_end','id':'synthetic-search','state':'success','evidence':response.metadata['evidence']}])
            db.add(run);db.commit()
            self.assertEqual(db.get(Run,run.id).events[-1]['evidence']['original_reads'][0]['document_read_chain'][-1]['source_id'],identity)
            current=ChatMessage(conversation_id=self.conversation,role='user',text='继续沿刚才的手册。')
            db.add(current);db.flush()
            replay=build_conversation_context(db,self.owner,db.get(Conversation,self.conversation),current)
        self.assertEqual(len(replay.source_index),1)
        self.assertEqual((replay.source_index[0]['source_id'],replay.source_index[0]['url']),(identity,TARGET))
        self.assertEqual(replay.source_index[0]['acquired_in_run_status'],'failed')

    async def test_special_bilibili_reader_returns_directly_without_manual_attachment_resolution(self):
        url='https://www.bilibili.com/video/BV1pa4y1B7f8/'
        value={'source_id':'synthetic-video','url':url,'title':'Synthetic public video page',
            'content_level':'public_video_page_or_metadata_not_video_observation'}
        with patch.dict(os.environ,{'WUJIAN_COMMUNITY_PROVIDER':'mediacrawler'}),patch(
            'wujian.community_sources.fetch_bilibili_source',new=AsyncMock(return_value=value)) as community,patch(
            'wujian.agent_runtime.fetch_source',new=AsyncMock()) as manual:
            response=await self.tools['fetch_document'](url=url)
        self.assertEqual(str(response.state),'success')
        community.assert_awaited_once();manual.assert_not_awaited()
        self.assertEqual(json.loads(response.content[0].text)['source_id'],'synthetic-video')


if __name__=='__main__':unittest.main()
