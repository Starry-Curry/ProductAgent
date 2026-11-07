import io
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch,AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import update

from wujian.config import Settings
from wujian.database import TaskRecord
from wujian.server import create_app,FrontendStaticFiles
from wujian.teaching_diagram import DiagramPart,DiagramScene


class DiagramPhotoTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=create_app(Settings(data_dir=Path(self.tmp.name),api_key='offline-no-network',rea_enabled=False))
        self.client=TestClient(self.app).__enter__();self.client.post('/api/auth/demo/xiaolin')
        image=io.BytesIO();Image.new('RGB',(80,60),'white').save(image,format='PNG')
        self.photo=self.client.post('/api/assets',files={'file':('sample.png',image.getvalue(),'image/png')}).json()['id']
        self.board=self.client.post('/api/task-boards',json={'goal':'观察物品外观','kind':'guidance','item_ids':['item_demo_lamp'],
            'entries':[{'id':'see','title':'看看连接处','item_id':'item_demo_lamp','group':'step',
                'guidance':{'kind':'observe','basis':'general','instruction':'看看外部连接处。','target_label':'连接处'}}]}).json()
        self.url='/api/tasks/'+self.board['task']['id']+'/diagram'
        self.payload={'expected_version':1,'step_id':'see','photo_ids':[self.photo]}

    def tearDown(self):self.client.__exit__(None,None,None);self.tmp.cleanup()

    def scene(self):return DiagramScene(title='外观示意',parts=[DiagramPart(id='body',name='外壳',size=[20,40,20],pos=[0,20,0])],
        focus_ids=['body'],explanation='看看外观。',uncertainty='简化示意，尺寸未实测。')

    def test_photo_driven_general_step_without_manual_preserves_pending(self):
        with patch('wujian.teaching_diagram.generate_scene',new_callable=AsyncMock,return_value=self.scene()) as model:
            result=self.client.post(self.url,json=self.payload)
            self.assertEqual(result.status_code,200,result.text)
            self.assertTrue(any(part['type']=='image_url' for part in model.call_args.args[3]))
        board=result.json();self.assertEqual(board['entries'][0]['state'],'pending')
        saved=board['task']['plan']['visualizations']['see'];self.assertEqual(saved['photo_ids'],[self.photo])

    def test_unowned_photo_and_stale_version_skip_model(self):
        with patch('wujian.teaching_diagram.generate_scene',new_callable=AsyncMock) as model:
            self.assertEqual(self.client.post(self.url,json={**self.payload,'photo_ids':['not-owned']}).status_code,404)
            self.assertEqual(self.client.post(self.url,json={**self.payload,'expected_version':2}).status_code,409)
            model.assert_not_called()

    def test_inflight_task_change_cannot_publish_old_scene(self):
        async def changed(*args):
            with self.app.state.sessions() as db:
                db.execute(update(TaskRecord).where(TaskRecord.id==self.board['task']['id']).values(version=2));db.commit()
            return self.scene()
        with patch('wujian.teaching_diagram.generate_scene',side_effect=changed):
            self.assertEqual(self.client.post(self.url,json=self.payload).status_code,409)
        board=self.client.get('/api/tasks/'+self.board['task']['id']+'/board').json()
        self.assertFalse(board['task']['plan'].get('visualizations'))


class GeometryAndServingTests(unittest.TestCase):
    def test_rods_use_connected_endpoints_instead_of_guessed_rotation(self):
        part=DiagramPart(id='rod',name='支杆',size=[10,1,10],pos=[0,0,0],endpoints=[[0,0,0],[100,100,0]])
        self.assertAlmostEqual(part.size[1],math.sqrt(20000));self.assertEqual(part.pos,(50,50,0))
        self.assertAlmostEqual(part.rot[2],-math.pi/4)

    def test_module_and_wasm_types_do_not_depend_on_windows_registry(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder);(path/'runtime.mjs').write_text('export const value=1;',encoding='utf-8');(path/'runtime.wasm').write_bytes(b'\0asm')
            app=FastAPI();app.mount('/assets',FrontendStaticFiles(directory=path))
            with TestClient(app) as client:
                self.assertTrue(client.get('/assets/runtime.mjs').headers['content-type'].startswith('text/javascript'))
                self.assertEqual(client.get('/assets/runtime.wasm').headers['content-type'],'application/wasm')
