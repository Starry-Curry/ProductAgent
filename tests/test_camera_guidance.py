import unittest
import base64,io,tempfile
from pathlib import Path
from unittest.mock import AsyncMock,patch
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import update
from pydantic import ValidationError
from wujian.camera_guidance import Grounding,select_target
from wujian.config import Settings
from wujian.database import TaskRecord
from wujian.server import create_app


class GroundingBoundaries(unittest.TestCase):
    def test_user_spatial_hint_resolves_geometry_without_trusting_model_primary_choice(self):
        def answer(boxes):return Grounding(visible=False,bbox=None,candidates=boxes,label='桌腿',confidence=.95,explanation='需要核对')
        chosen=select_target(answer([[100,200,200,650],[400,600,500,900],[600,400,700,850]]),'bottommost')
        self.assertTrue(chosen.visible);self.assertEqual(chosen.bbox,(400,600,500,900))
        tied=select_target(answer([[100,600,200,900],[400,600,500,905]]),'bottommost')
        self.assertFalse(tied.visible)
    def test_high_confidence_does_not_choose_between_two_instances(self):
        answer=Grounding(visible=True,bbox=[100,100,400,600],candidates=[[100,100,400,600],[500,100,800,600]],
            label='两副相同耳机',confidence=.98,explanation='模型原先擅自选左侧')
        selected=select_target(answer)
        self.assertFalse(selected.visible);self.assertIsNone(selected.bbox)

    def test_normalized_coordinates_missing_and_ambiguous_targets(self):
        common={'label':'电源按钮','confidence':.8,'explanation':'当前帧模型判断，非操作成功。','candidates':[[100,200,300,400]]}
        self.assertEqual(Grounding(**common,visible=True,bbox=[100,200,300,400]).bbox,(100,200,300,400))
        self.assertIsNone(Grounding(**common,visible=False,bbox=None).bbox)
        for box in [[-1,0,100,100],[0,0,1000,999],[300,200,100,400],None]:
            with self.assertRaises(ValidationError):Grounding(**common,visible=True,bbox=box)
        with self.assertRaises(ValidationError):Grounding(**common,visible=False,bbox=[0,0,10,10])


class GroundingHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.app=create_app(Settings(data_dir=Path(self.temp.name),api_key='offline-no-network',rea_enabled=False))
        self.client=TestClient(self.app).__enter__();self.client.post('/api/auth/demo/xiaolin')
        self.board=self.client.post('/api/task-boards',json={'goal':'看看标签','kind':'guidance','item_ids':['item_demo_lamp'],
            'entries':[{'id':'label','title':'核对标签','item_id':'item_demo_lamp','group':'step','guidance':{
                'kind':'observe','instruction':'看看标签上的文字。','target_label':'标签'}}]}).json()
        image=io.BytesIO();Image.new('RGBA',(20,20),(0,0,0,0)).save(image,format='PNG')
        self.asset=self.client.post('/api/assets',files={'file':('transparent.png',image.getvalue(),'image/png')}).json()['id']
        self.payload={'expected_version':1,'step_id':'label','frame_id':self.asset}
        self.url='/api/tasks/'+self.board['task']['id']+'/grounding'

    def tearDown(self):
        self.client.__exit__(None,None,None);self.temp.cleanup()

    def test_preflight_permissions_and_version_skip_paid_call(self):
        with patch('wujian.camera_guidance.locate',new_callable=AsyncMock) as model:
            self.assertEqual(self.client.post(self.url,json={**self.payload,'expected_version':2}).status_code,409)
            self.assertEqual(self.client.post(self.url,json={**self.payload,'frame_id':'not-owned'}).status_code,404)
            other=TestClient(self.app)
            other.post('/api/auth/demo/xiaoxia')
            self.assertEqual(other.post(self.url,json=self.payload).status_code,404)
            other.close()
            model.assert_not_called()

    def test_transparency_and_inflight_version_change_are_checked(self):
        async def changed(settings,encoded,target):
            pixel=Image.open(io.BytesIO(base64.b64decode(encoded))).getpixel((0,0))
            self.assertEqual(pixel,(255,255,255))
            with self.app.state.sessions() as db:
                db.execute(update(TaskRecord).where(TaskRecord.id==self.board['task']['id']).values(version=2));db.commit()
            return Grounding(visible=True,bbox=[100,100,900,900],label='标签',confidence=.8,explanation='离线结构测试',candidates=[[100,100,900,900]])
        with patch('wujian.camera_guidance.locate',side_effect=changed):
            self.assertEqual(self.client.post(self.url,json=self.payload).status_code,409)
        board=self.client.get('/api/tasks/'+self.board['task']['id']+'/board').json()
        self.assertEqual(board['entries'][0]['state'],'pending')
