"""Public assets must reproduce a first-step lesson without private paths or FFmpeg."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from scripts.demo_assets import asset_path,verify_bundle
from scripts.run_as2_demo import prepare_demo
from wujian.config import ROOT,Settings
from wujian.server import create_app


class PublicDemoTests(unittest.TestCase):
    def test_bundle_prepares_ready_aids_without_ffmpeg_and_preserves_sessions(self):
        with tempfile.TemporaryDirectory() as temporary,patch('shutil.which',return_value=None):
            settings=Settings(data_dir=Path(temporary),api_key='',rea_enabled=False)
            first=prepare_demo(settings,ROOT/'demo/as2')
            self.assertEqual(prepare_demo(settings,ROOT/'demo/as2')['task_id'],first['task_id'])
            second=prepare_demo(settings,ROOT/'demo/as2',new_session=True)
            self.assertNotEqual(second['task_id'],first['task_id'])
            with TestClient(create_app(settings)) as client:
                client.post('/api/auth/demo/xiaolin')
                for identity in [first['task_id'],second['task_id']]:
                    response=client.get('/api/tasks/'+identity+'/board');self.assertEqual(response.status_code,200,response.text)
                    board=response.json();plan=board['task']['plan'];self.assertEqual(board['completed_count'],0)
                    self.assertEqual(plan['guidance']['active_step_id'],'power');self.assertEqual(len(plan['visualizations']),12)
                    self.assertEqual(plan['guidance']['pictures']['power']['evidence_kind'],'reviewed_photo_annotation')
                    self.assertEqual(client.get('/api/assets/'+plan['guidance']['reference']['image_id']).status_code,200)
                    self.assertEqual(client.get('/api/assets/'+plan['guidance']['demo_video_id']).headers['content-type'],'video/mp4')
                    self.assertEqual(client.post('/api/tasks/'+identity+'/diagram',json={'expected_version':board['task']['version'],'step_id':'power'}).status_code,200)
                self.assertEqual(client.post('/api/chat',json={'text':'自由问答需要配置真实 Key'}).status_code,503)

    def test_checksum_failure_does_not_silently_seed_an_incomplete_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'picture.jpg').write_bytes(b'not-the-expected-asset')
            (folder/'manifest.json').write_text(json.dumps({'schema':'wujian-demo-assets/1','id':'loklik-as2',
                'files':[{'path':'picture.jpg','bytes':22,'sha256':'0'*64}]}),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'checksum failed'):verify_bundle(folder)

    def test_bundle_paths_cannot_read_outside_the_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'bundle').mkdir();(folder/'outside.env').write_text('private',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'outside'):asset_path(folder/'bundle','../outside.env')
