"""Business boundary tests; these do not grade model intelligence."""
import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from wujian.config import Settings
from wujian.database import Asset, Conversation, Run
from wujian.server import create_app


class JourneyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), demo_mode=True))
        self.owner = TestClient(self.app)
        self.owner.__enter__()
        self.friend = TestClient(self.app)
        self.owner.post('/api/auth/demo/xiaolin')
        self.friend.post('/api/auth/demo/xiaoxia')
        self.item = 'item_demo_sunflower'
        self.owner_id, self.friend_id = 'person_demo_owner', 'person_demo_friend'

    def tearDown(self):
        self.friend.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def test_one_authored_event_is_visible_from_both_items(self):
        ids = ['item_demo_lamp', 'item_demo_stone']
        result = self.owner.post('/api/experiences', json={
            'title': '共同的一刻', 'text': '同一段经历，只保存一次。', 'item_ids': ids})
        self.assertEqual(result.status_code, 200, result.text)
        identity = result.json()['id']
        for item in ids:
            rows = self.owner.get('/api/experiences', params={'item_id': item}).json()
            self.assertEqual(sum(row['id'] == identity for row in rows), 1)
        self.assertFalse(self.friend.get('/api/experiences').json())

    def test_share_is_read_only_private_profile_stays_private_and_revocation_resets_context(self):
        self.assertEqual(self.friend.get(f'/api/items/{self.item}').status_code, 404)
        self.owner.post(f'/api/items/{self.item}/shares', json={'user_id': self.friend_id})
        shared = self.friend.get(f'/api/items/{self.item}').json()
        self.assertEqual(shared['access'], 'shared')
        self.assertEqual(shared['description'], '')
        self.assertEqual(shared['avatar']['personality'], '')
        payload = {key: shared[key] for key in ['name', 'kind', 'product', 'description', 'photo_id', 'state']}
        payload.update(avatar={}, expected_version=shared['version'])
        self.assertEqual(self.friend.put(f'/api/items/{self.item}', json=payload).status_code, 404)
        with self.app.state.sessions() as db:
            conversation = Conversation(id='shared_conversation', user_id=self.friend_id, agent_state={'old': 'private cached state'})
            db.add(conversation)
            db.flush()
            db.add(Run(id='shared_active_run',conversation_id=conversation.id,user_id=self.friend_id,status='running'))
            db.commit()
        self.owner.delete(f'/api/items/{self.item}/shares/{self.friend_id}')
        self.assertEqual(self.friend.get(f'/api/items/{self.item}').status_code, 404)
        with self.app.state.sessions() as db:
            conversation = db.get(Conversation, 'shared_conversation')
            self.assertIsNone(conversation.agent_state)
            self.assertEqual(conversation.context_revision, 1)
            self.assertEqual(db.get(Run, 'shared_active_run').status, 'interrupted')

    def test_original_html_is_downloaded_instead_of_executed_on_app_origin(self):
        path=Path(self.temp.name)/'original.html'
        path.write_text('<script>untrusted_source()</script>',encoding='utf-8')
        with self.app.state.sessions() as db:
            db.add(Asset(id='source_html',owner_id=self.owner_id,path=str(path),media_type='text/html',original_name='original.html'))
            db.commit()
        response=self.owner.get('/api/assets/source_html')
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.headers['content-disposition'].startswith('attachment;'))
        self.assertEqual(self.friend.get('/api/assets/source_html').status_code,404)

    def test_gift_transfers_selected_story_and_control_without_other_private_records(self):
        events = self.owner.get('/api/experiences', params={'item_id': self.item}).json()
        self.assertTrue(events)
        gift = self.owner.post('/api/gifts', json={
            'item_id': self.item, 'recipient_id': self.friend_id, 'experience_ids': [events[0]['id']],
            'message': '愿你找到自己的光', 'avatar': {'nickname': '小太阳', 'personality': '温柔，有幽默感'}})
        self.assertEqual(gift.status_code, 200, gift.text)
        identity = gift.json()['id']
        self.assertEqual(self.owner.post(f'/api/gifts/{identity}/accept').status_code, 404)
        first = self.friend.post(f'/api/gifts/{identity}/accept')
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.friend.post(f'/api/gifts/{identity}/accept').status_code, 200)
        received = self.friend.get(f'/api/items/{self.item}').json()
        self.assertEqual(received['owner_id'], self.friend_id)
        self.assertEqual(received['avatar']['gift_from'], first.json()['sender']['display_name'])
        self.assertEqual(self.owner.get(f'/api/items/{self.item}').status_code, 404)
        copies = self.friend.get('/api/experiences').json()
        self.assertEqual(len(copies), 1)
        self.assertEqual(copies[0]['origin_id'], events[0]['id'])
        self.assertEqual(copies[0]['creator_id'], self.friend_id)
        self.assertEqual(copies[0]['provenance']['author_id'], self.owner_id)
        self.assertEqual(copies[0]['provenance']['kind'], 'received_story')
        self.assertTrue(any(row['id'] == events[0]['id'] for row in self.owner.get('/api/experiences').json()))
        self.friend.post('/api/experiences', json={'title': '新的私人经历', 'text': '只在我这里', 'item_ids': [self.item]})
        self.assertFalse(any(row['title'] == '新的私人经历' for row in self.owner.get('/api/experiences').json()))

    def test_optimistic_change_prevents_overwrite(self):
        item = self.owner.get(f'/api/items/{self.item}').json()
        payload = {key: item[key] for key in ['name', 'kind', 'product', 'description', 'photo_id', 'state']}
        payload.update(avatar={}, expected_version=item['version'])
        self.assertEqual(self.owner.put(f'/api/items/{self.item}', json=payload).status_code, 200)
        self.assertEqual(self.owner.put(f'/api/items/{self.item}', json=payload).status_code, 409)

    def test_private_photos_and_session_origin_are_enforced(self):
        image = io.BytesIO()
        Image.new('RGB', (10, 10), 'gold').save(image, 'PNG')
        asset = self.owner.post('/api/assets', files={'file': ('photo.png', image.getvalue(), 'image/png')})
        self.assertEqual(asset.status_code, 200)
        identity = asset.json()['id']
        self.assertEqual(self.owner.get(f'/api/assets/{identity}').status_code, 200)
        self.assertEqual(self.friend.get(f'/api/assets/{identity}').status_code, 404)
        blocked = self.owner.post('/api/items', json={'name': 'external request'}, headers={'Origin': 'https://other.example'})
        self.assertEqual(blocked.status_code, 403)

    def test_removed_memory_is_not_silently_learned_again(self):
        from wujian import domain
        with self.app.state.sessions() as db:
            memory = domain.remember(db, self.owner_id, '喜欢安静读书', 'current_message')
        self.owner.delete('/api/memories/' + memory['id'])
        with self.app.state.sessions() as db:
            result = domain.remember(db, self.owner_id, '喜欢安静读书', 'later_message')
            self.assertEqual(result['status'], 'previously_removed')
        self.assertEqual(self.owner.get('/api/memories').json(), [])


if __name__ == '__main__':
    unittest.main()
