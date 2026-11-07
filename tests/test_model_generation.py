"""Generation failover, billable-request recovery and existing task boundaries; offline only."""
import base64
import io
import json
import struct
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx
from PIL import Image

from wujian.model_generation.assets import inspect_glb, write_json
from wujian.model_generation.bailian import Bailian3DClient, Config, ProviderError
from wujian.model_generation.service import GenerationError, cloud_generate, generate_sync, run_lock
from wujian.model_generation.settings import GenerationSettings


def glb():
    binary = struct.pack('<9f3H', 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 2)
    doc = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 36},
                           {'buffer': 0, 'byteOffset': 36, 'byteLength': 6}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1, 1, 0]},
                         {'bufferView': 1, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
           'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0}
    encoded = json.dumps(doc).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    chunks = struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary
    return struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks


def photo():
    out = io.BytesIO()
    Image.new('RGB', (64, 64), 'blue').save(out, 'PNG')
    return out.getvalue()


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = GenerationSettings(cache=self.root, cloud=Config('offline-test'))

    def tearDown(self):
        self.temp.cleanup()

    def result(self, config, folder):
        destination = folder / 'cloud.glb'
        destination.write_bytes(glb())
        return destination, {'task_id': 'provider-task'}

    def local(self, config, folder):
        destination = folder / 'local.glb'
        destination.write_bytes(glb())
        return destination, {'model': 'tencent/Hunyuan3D-2mini', 'texture': False}

    def test_cloud_first_cache_and_owner_isolation(self):
        with patch('wujian.model_generation.service.cloud_generate', side_effect=self.result) as cloud, patch('wujian.model_generation.service.local_generate') as local:
            first = generate_sync(self.config, 'owner-a', photo())
            second = generate_sync(self.config, 'owner-a', photo())
            other = generate_sync(self.config, 'owner-b', photo())
        self.assertEqual(first['provider'], 'aliyun-bailian/tripo')
        self.assertTrue(second['cache_hit'])
        self.assertNotEqual(first['path'], other['path'])
        self.assertEqual(cloud.call_count, 2)
        local.assert_not_called()

    def test_cloud_failure_or_corrupt_glb_falls_back(self):
        for broken in ['failure', 'invalid-glb']:
            with self.subTest(broken=broken):
                def cloud(config, folder):
                    if broken == 'failure':
                        raise ProviderError('Unavailable', 'offline')
                    file = folder / 'cloud.glb'
                    file.write_bytes(b'not-a-model')
                    return file, {}
                with patch('wujian.model_generation.service.cloud_generate', side_effect=cloud), patch('wujian.model_generation.service.local_generate', side_effect=self.local):
                    value = generate_sync(self.config, broken, photo())
                self.assertEqual(value['provider'], 'local/hunyuan-mini')
                self.assertFalse(value['physical_operation_verified'])
                self.assertEqual([a['status'] for a in value['attempts']], ['failed', 'succeeded'])

    def test_explicit_local_switch_makes_no_paid_submission(self):
        with patch('wujian.model_generation.service.cloud_generate') as cloud, patch('wujian.model_generation.service.local_generate', side_effect=self.local):
            value = generate_sync(replace(self.config, local_only=True), 'manual-local', photo())
        cloud.assert_not_called()
        self.assertEqual(value['provider'], 'local/hunyuan-mini')

    def test_both_fail_without_a_fake_success(self):
        for error in [TimeoutError('timeout'), httpx.ReadTimeout('offline')]:
            with self.subTest(error=type(error).__name__), patch('wujian.model_generation.service.cloud_generate', side_effect=error), patch('wujian.model_generation.service.local_generate', side_effect=GenerationError('missing CUDA')):
                with self.assertRaises(GenerationError):
                    generate_sync(self.config, type(error).__name__, photo())

    def test_same_input_lock_prevents_concurrent_submission(self):
        lock = self.root / '.lock'
        with run_lock(lock):
            with self.assertRaises(GenerationError):
                with run_lock(lock):
                    self.fail('Acquired an already-held lock')

    def test_glb_rejects_truncation_external_files_and_empty_geometry(self):
        model = self.root / 'test.glb'
        model.write_bytes(glb())
        self.assertEqual(inspect_glb(model)['faces'], 1)
        for value in [glb()[:-2], glb().replace(b'POSITION', b'NOTITION'), glb().replace(b'"byteLength": 42', b'"byteLength": 99')]:
            model.write_bytes(value)
            with self.assertRaises(ValueError):
                inspect_glb(model)

    def test_timeout_keeps_original_task_and_does_not_resubmit(self):
        folder = self.root / 'job'
        folder.mkdir()
        (folder / 'input.jpg').write_bytes(photo())
        config = GenerationSettings(cache=self.root, cloud=Config('offline'), cloud_wait=0, poll_interval=0)
        client = Mock()
        client.upload.return_value = 'oss://dashscope/test.jpg'
        client.submit.return_value = {'output': {'task_id': 'existing'}}
        client.task.return_value = {'output': {'task_status': 'RUNNING'}}
        with patch('wujian.model_generation.service.Bailian3DClient') as create:
            create.return_value.__enter__.return_value = client
            for _ in range(2):
                with self.assertRaises(ProviderError):
                    cloud_generate(config, folder)
        self.assertEqual(client.submit.call_count, 1)
        self.assertEqual(json.loads((folder / 'cloud-state.json').read_text())['task_id'], 'existing')

    def test_unknown_submission_is_never_repeated(self):
        folder = self.root / 'unknown'
        folder.mkdir()
        write_json(folder / 'cloud-state.json', {'status': 'submission_unknown'})
        with patch('wujian.model_generation.service.Bailian3DClient') as client:
            with self.assertRaises(ProviderError):
                cloud_generate(self.config, folder)
        client.assert_not_called()

    def test_bearer_token_never_reaches_model_download_host(self):
        requests = []
        def respond(request):
            requests.append(request)
            if request.url.host == 'openapi.cdn.tripo3d.com':
                return httpx.Response(200, content=glb())
            return httpx.Response(200, json={'output': {'task_id': 'cloud-id'}})
        with Bailian3DClient(Config('do-not-disclose'), transport=httpx.MockTransport(respond)) as client:
            client.submit('oss://dashscope/input.jpg', 'Tripo/Tripo-H3.1', {})
            client.download('https://openapi.cdn.tripo3d.com/result.glb', self.root / 'download.glb')
            with self.assertRaises(ProviderError):
                client.download('https://127.0.0.1/private', self.root / 'bad.glb')
        self.assertEqual(requests[0].headers['authorization'], 'Bearer do-not-disclose')
        self.assertEqual(requests[0].headers['x-dashscope-ossresourceresolve'], 'enable')
        self.assertNotIn('authorization', requests[1].headers)

    def test_redirects_are_validated_without_forwarding_credentials(self):
        seen = []
        def respond(request):
            seen.append(request)
            return httpx.Response(302, headers={'location': 'https://127.0.0.1/private'})
        with Bailian3DClient(Config('private-key'), transport=httpx.MockTransport(respond)) as client:
            with self.assertRaises(ProviderError):
                client.download('https://openapi.cdn.tripo3d.com/model.glb', self.root / 'test.glb')
        self.assertEqual(len(seen), 1)
        self.assertNotIn('authorization', seen[0].headers)


class MeshTaskTests(unittest.TestCase):
    def setUp(self):
        from test_lessons import LessonJourneyTests
        self.journey = LessonJourneyTests()
        self.journey.setUp()
        self.client = self.journey.client
        self.app = self.journey.app
        self.model = self.journey.tmp.name + '/fixture.glb'
        Path(self.model).write_bytes(glb())

    def tearDown(self):
        self.journey.tearDown()

    def generate(self):
        board = self.journey.board()
        result = {'path': Path(self.model), 'provider': 'local/hunyuan-mini', 'model': 'mini',
                  'geometry': inspect_glb(Path(self.model)), 'attempts': [{'provider': 'cloud', 'status': 'failed'}, {'provider': 'local', 'status': 'succeeded'}]}
        payload = {'step_id': 'power', 'expected_version': board['task']['version'], 'use_model': True}
        with patch('wujian.model_generation.teaching.generate_model', new_callable=AsyncMock, return_value=result) as generate:
            response = self.client.post('/api/tasks/' + self.journey.task + '/diagram', json=payload)
        return response, generate

    def test_existing_entry_renders_mesh_without_advancing_step(self):
        response, generate = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        board = response.json()
        mesh = board['task']['plan']['visualizations']['power']['mesh']
        self.assertTrue(mesh['fallback'])
        self.assertEqual(board['completed_count'], 0)
        self.assertEqual(board['task']['plan']['guidance']['active_step_id'], 'power')
        self.assertEqual(self.client.get('/api/assets/' + mesh['asset_id']).status_code, 200)
        again, generate = self.generate()
        self.assertEqual(again.status_code, 200)
        generate.assert_not_called()
        self.client.post('/api/auth/logout')
        self.assertEqual(self.client.get('/api/assets/' + mesh['asset_id']).status_code, 401)

    def test_future_step_stale_version_foreign_photo_cannot_generate(self):
        board = self.journey.board()
        with patch('wujian.model_generation.teaching.generate_model', new_callable=AsyncMock) as generate:
            for change, status in [({'step_id': 'press'}, 409), ({'expected_version': board['task']['version'] + 1}, 409), ({'photo_ids': ['no-such-photo']}, 404)]:
                payload = {'step_id': 'power', 'expected_version': board['task']['version'], 'use_model': True, **change}
                response = self.client.post('/api/tasks/' + self.journey.task + '/diagram', json=payload)
                self.assertEqual(response.status_code, status, response.text)
            generate.assert_not_called()

    def test_render_grounding_reuses_task_guard_and_does_not_write_completion(self):
        response, _ = self.generate()
        board = response.json()
        mesh = board['task']['plan']['visualizations']['power']['mesh']
        from wujian.camera_guidance import Grounding
        answer = Grounding(visible=True, bbox=[100, 200, 200, 300], label='按钮', confidence=.9, explanation='推测', candidates=[[100, 200, 200, 300]])
        payload = {'step_id': 'power', 'expected_version': board['task']['version'], 'model_asset_id': mesh['asset_id'], 'render_base64': base64.b64encode(photo()).decode()}
        with patch('wujian.model_generation.grounding.locate_render', new_callable=AsyncMock, return_value=answer) as locate:
            response = self.client.post('/api/tasks/' + self.journey.task + '/diagram/locate', json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()['visible'])
            locate.assert_awaited_once()
            response = self.client.post('/api/tasks/' + self.journey.task + '/diagram/locate', json={**payload, 'model_asset_id': 'other-model'})
            self.assertEqual(response.status_code, 409)
        after = self.journey.board()
        self.assertEqual(after['completed_count'], 0)
        self.assertEqual(after['task']['version'], board['task']['version'])
