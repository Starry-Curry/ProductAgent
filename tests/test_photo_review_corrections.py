"""Independent review regressions; transport/SQL only, no paid model calls."""
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from wujian.config import Settings
from wujian.database import ExperienceRecord, ExperienceShare
from wujian.photo_matching import VisualMatches
from wujian.server import create_app


class PhotoReviewCorrections(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key='offline-no-provider',
                                       demo_mode=False, rea_enabled=False))
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.owner = self.register('photo_review_owner')
        image = io.BytesIO()
        Image.new('RGB', (48, 32), 'blue').save(image, 'JPEG')
        self.photo = self.client.post('/api/assets', files={
            'file': ('synthetic-contract.jpg', image.getvalue(), 'image/jpeg')}).json()['id']
        self.item = self.create_item('有刻字的手作杯')
        response = self.client.post('/api/experiences', json={
            'title': '只有照片的一刻', 'photo_ids': [self.photo], 'allow_ai': False})
        response.raise_for_status()
        self.story = response.json()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.app.state.sessions.kw['bind'].dispose()
        self.temp.cleanup()

    def register(self, username):
        self.client.post('/api/auth/register', json={'username': username,
            'password': 'synthetic-local-review-password', 'display_name': username}).raise_for_status()
        return self.client.get('/api/me').json()['id']

    def create_item(self, name):
        response = self.client.post('/api/items', json={
            'name': name, 'kind': 'nonstandard_object', 'photo_id': self.photo})
        response.raise_for_status()
        return response.json()

    def linked(self):
        result = VisualMatches(matches=[{
            'item_id': self.item['id'], 'photo_ids': [self.photo], 'verdict': 'same_instance',
            'evidence_kind': 'distinctive_detail', 'reference_detail': '私人参考照底部刻字',
            'observed_detail': '契约测试假定的同一刻字，不作为视觉准确率证据',
            'explanation': '离线模拟观察，仅验证共同writer与投影',
        }])
        with patch('wujian.photo_matching.observe_photos', new=AsyncMock(return_value=result)):
            response = self.client.post(f"/api/experiences/{self.story['id']}/photo-matches",
                                        json={'expected_version': 1})
        response.raise_for_status()
        return response.json()['experience']

    def test_shared_story_keeps_author_but_excludes_visual_and_consent_details(self):
        row = self.linked()
        self.assertIn('photo_associations', row['provenance'])
        reader = self.register('photo_review_reader')
        with self.app.state.sessions() as db:
            record = db.get(ExperienceRecord, row['id'])
            record.provenance = {**record.provenance,
                'ai_consent': {'quote': 'synthetic private consent receipt'},
                'future_private_field': 'must not leak'}
            db.add(ExperienceShare(experience_id=row['id'], user_id=reader))
            db.commit()
        shared = self.client.get('/api/experiences').json()[0]
        self.assertEqual(shared['item_ids'], [])
        self.assertEqual(shared['item_labels'], {})
        self.assertEqual(shared['provenance']['author_id'], self.owner)
        for field in ['photo_associations', 'ai_consent', 'future_private_field']:
            self.assertNotIn(field, shared['provenance'])
        self.assertNotIn('私人参考照', str(shared))

    def test_unlink_and_replace_photo_prune_active_evidence_in_same_record(self):
        row = self.linked()
        for scenario in ['unlink', 'replace_photo']:
            with self.subTest(scenario=scenario):
                # Restore an active visual relation before each correction.
                with self.app.state.sessions() as db:
                    record = db.get(ExperienceRecord, row['id'])
                    record.item_ids = [self.item['id']]
                    record.provenance = {**record.provenance, 'photo_associations': {
                        self.item['id']: {'photo_ids': [self.photo], 'reference_detail': 'old comparison'}}}
                    version = record.version
                    db.commit()
                payload = {'title': row['title'], 'text': '用户补充的原话',
                    'item_ids': [] if scenario == 'unlink' else [self.item['id']],
                    'photo_ids': [self.photo] if scenario == 'unlink' else [],
                    'allow_ai': True, 'expected_version': version}
                response = self.client.put(f"/api/experiences/{row['id']}", json=payload)
                response.raise_for_status()
                self.assertNotIn('photo_associations', response.json()['provenance'])
                with self.app.state.sessions() as db:
                    records = list(db.scalars(select(ExperienceRecord)))
                    self.assertEqual(len(records), 1)
                    self.assertEqual(records[0].id, row['id'])
                    self.assertNotIn('photo_associations', records[0].provenance)

    def test_twenty_fifth_reference_reachable_through_explicit_continuation(self):
        items = [self.item] + [self.create_item(f'模拟物品{i}') for i in range(24)]
        observations = []
        async def observer(_, photos, references):
            observations.append([ref['reference_item'] for ref in references])
            return VisualMatches(matches=[])
        with patch('wujian.photo_matching.observe_photos', new=observer):
            first = self.client.post(f"/api/experiences/{self.story['id']}/photo-matches",
                                    json={'expected_version': 1})
            first.raise_for_status()
            first = first.json()
            second = self.client.post(f"/api/experiences/{self.story['id']}/photo-matches",
                json={'expected_version': 1, 'exclude_item_ids': first['examined_item_ids']})
            second.raise_for_status()
            second = second.json()
        self.assertEqual([len(batch) for batch in observations], [24, 1])
        self.assertEqual(first['remaining_items'], 1)
        self.assertEqual(second['remaining_items'], 0)
        self.assertEqual(set(first['examined_item_ids'] + second['examined_item_ids']),
                         {item['id'] for item in items})
        self.assertEqual(self.client.get('/api/experiences').json()[0]['version'], 1)


if __name__ == '__main__':
    unittest.main()
