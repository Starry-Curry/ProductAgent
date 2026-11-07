"""Native SDK evidence typing; synthetic media, no provider or device calls."""
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from test_agent_plan_contract import ContractModel
from test_observation_trace import CHILD, PARENT, video_fixture
from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import KnowledgeClaim, SourceRecord
from wujian.server import create_app


class ObservationEvidenceBasisTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.model=ContractModel()
        self.app=create_app(Settings(data_dir=Path(self.folder.name),api_key="offline-no-network",rea_enabled=False),
                            model_factory=lambda _:self.model)
        self.client=TestClient(self.app).__enter__()
        self.user=self.client.post('/api/auth/demo/xiaolin').json()['id']
        self.item=self.client.post('/api/items',json={'name':'测试纸杯','kind':'nonstandard_object'}).json()['id']
        with self.app.state.sessions() as db:
            db.add_all([SourceRecord(id=CHILD,owner_id=self.user,origin='video_frame_sample',
                title='合成抽帧观察',url='https://www.bilibili.com/video/BV1pa4y1B7f8/',content='{}',pages=[]),
                SourceRecord(id='text-only',owner_id=self.user,origin='upload',title='文字原文',
                    url='',content='原作者明确写了把纸杯横放。',pages=[]),
                SourceRecord(id='foreign-frame',owner_id='person_demo_friend',origin='video_frame_sample',
                    title='别人的私有观察',url='',content='{}',pages=[])])
            db.commit()

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.folder.cleanup()

    def test_native_visual_learning_is_provisional_without_full_answer_regeneration(self):
        final={'answer':'这里实际提供的是两个时刻的画面，完整动作仍未知。','continuation':None,
               'source_refs':[CHILD],'story_refs':[],
               'learning':{'memory_updates':[],'knowledge_updates':[{'item_id':self.item,'kind':'case',
                   'content':'测试样本中的摆放解释，尚未试用。',
                   'conditions':{'requirements':[],'limits':[],'unknowns':['完整动作与真实效果未知']},
                   'basis':'document','scope':'product','source_id':CHILD,'source_quote':'',
                   'source_model':'模型不能凭空给抽帧赋予型号适配'}]}}
        self.model.proposals=[{'_tool_name':'read_source','_arguments':{'source_id':CHILD}},final]
        with patch('wujian.agent_runtime.retained_video_frames',side_effect=lambda *a:video_fixture()):
            run=self.client.post('/api/chat',json={'text':'看看这些画面，留个可以再试的想法。',
                'item_ids':[self.item],'entry_context':{'intent':'creative'}}).json()
            deadline=time.monotonic()+8
            while run['status'] in {'queued','running'} and time.monotonic()<deadline:
                time.sleep(.02)
                run=self.client.get('/api/runs/'+run['id']).json()
        self.assertEqual(run['status'],'completed',run)
        self.assertEqual(self.model.calls,2,'A source-type correction must not regenerate the final answer')
        self.assertIn(video_fixture()['frames'][0]['base64'],self.model.inputs[1])
        with self.app.state.sessions() as db:
            claim=db.scalar(select(KnowledgeClaim).where(KnowledgeClaim.item_id==self.item))
            self.assertIsNotNone(claim)
            self.assertEqual((claim.basis,claim.status,claim.product_id),('inference','provisional',None))
            self.assertEqual(claim.source_id,CHILD)
            self.assertEqual(claim.source_quote,'')
            self.assertEqual(claim.conditions['reading_scope'],'sampled_video_frames_not_full_video')

    def test_text_document_still_requires_literal_evidence(self):
        with self.app.state.sessions() as db, self.assertRaises(domain.DomainError):
            foundation.save_claim(db,self.user,'test',self.item,'不能伪造原作者的文字。',{},
                                  'document','item','text-only','根本没有的原话')

    def test_declared_inference_cannot_promote_observed_instance_to_product(self):
        with self.app.state.sessions() as db:
            saved=foundation.save_claim(db,self.user,'test',self.item,'只有这几个时刻的观察解释。',
                {'source_lines':{'start':1,'end':2},'identity_match':'model_text_matched'},
                'inference','product',CHILD,'不是作者的原话')
            claim=db.get(KnowledgeClaim,saved['id'])
            self.assertEqual((claim.basis,claim.product_id,claim.item_id),('inference',None,self.item))
            self.assertEqual(claim.source_quote,'')
            self.assertNotIn('source_lines',claim.conditions)
            self.assertEqual(claim.conditions['identity_match'],'unverified')

    def test_source_type_normalization_cannot_grant_private_access(self):
        with self.app.state.sessions() as db, self.assertRaises(domain.DomainError):
            foundation.normalize_claim_evidence(db,self.user,'document','product','foreign-frame','')
