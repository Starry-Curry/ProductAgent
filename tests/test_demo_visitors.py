"""Browser visitors get independent published demo worlds, including family accounts."""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ItemRecord
from wujian.server import create_app


class DemoVisitorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.app = create_app(Settings(data_dir=Path(cls.temp.name), api_key='',
                                     rea_enabled=False, demo_isolation=True, showcase_enabled=True))
        cls.lifecycle = TestClient(cls.app).__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.lifecycle.__exit__(None, None, None)
        cls.temp.cleanup()

    def visitor(self):
        client = TestClient(self.app)
        self.addCleanup(client.close)
        return client

    def login(self, client, persona='xiaolin'):
        response = client.post('/api/auth/demo/' + persona)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_all_four_accounts_isolated_even_with_same_client_ip(self):
        first, second = self.visitor(), self.visitor()
        for persona in ['xiaolin', 'xiaoxia', 'mom', 'grandpa']:
            a, b = self.login(first, persona), self.login(second, persona)
            self.assertNotEqual(a['id'], b['id'])
            self.assertEqual(a['display_name'], b['display_name'])
        self.assertEqual(first.post('/api/auth/demo/unknown').status_code, 404)

    def test_conversation_item_asset_and_task_cannot_cross_visitors(self):
        first, second = self.visitor(), self.visitor()
        a, b = self.login(first), self.login(second)
        chats = first.get('/api/conversations').json()
        self.assertIn('烫印机', chats[0]['title'])
        chat = chats[0]
        self.assertEqual(second.get('/api/conversations/' + chat['id'] + '/messages').status_code, 404)
        item = first.get('/api/items').json()[0]
        self.assertEqual(second.get('/api/items/' + item['id']).status_code, 404)
        if item.get('photo_id'):
            self.assertEqual(first.get('/api/assets/' + item['photo_id']).status_code, 200)
            self.assertEqual(second.get('/api/assets/' + item['photo_id']).status_code, 404)
        task = first.get('/api/tasks').json()[0]
        self.assertEqual(first.get('/api/tasks/' + task['id'] + '/board').status_code, 200)
        self.assertEqual(second.get('/api/tasks/' + task['id'] + '/board').status_code, 404)
        with self.app.state.sessions() as db:
            db.add(ChatMessage(conversation_id=chat['id'], role='user', text='visitor A private marker'))
            db.get(ItemRecord, item['id']).name = 'visitor A private item'
            db.commit()
        self.assertNotIn('visitor A private marker', second.get('/api/conversations').text)
        self.assertNotIn('visitor A private item', second.get('/api/items').text)
        # Same published history is present, but its IDs and subsequent messages differ.
        other = second.get('/api/conversations').json()[0]
        self.assertNotEqual(chat['id'], other['id'])
        self.assertNotIn('visitor A private marker', second.get('/api/conversations/' + other['id'] + '/messages').text)

    def test_switch_resumes_but_logout_starts_a_fresh_demo_world(self):
        client = self.visitor()
        first = self.login(client)
        self.login(client, 'mom')
        self.assertEqual(self.login(client)['id'], first['id'])
        client.post('/api/auth/logout')
        self.assertEqual(client.get('/api/me').status_code, 401)
        self.assertNotEqual(self.login(client)['id'], first['id'])

    def test_actual_workspace_is_curated_and_as2_starts_at_first_step(self):
        client = self.visitor()
        self.login(client)
        workspace = client.get('/api/workspace').json()
        chat = workspace['conversations'][0]
        self.assertIn('烫印机', chat['title'])
        for conversation in workspace['conversations']:
            messages = client.get('/api/conversations/' + conversation['id'] + '/messages').json()
            self.assertEqual(messages[-1]['role'], 'assistant')
        messages = client.get('/api/conversations/' + chat['id'] + '/messages').json()
        self.assertEqual(len(messages), 2)
        task = next(t for t in workspace['tasks'] if t['plan'].get('guidance', {}).get('lesson'))
        board = client.get('/api/tasks/' + task['id'] + '/board').json()
        self.assertEqual(board['completed_count'], 0)
        self.assertEqual(task['plan']['guidance']['active_step_id'], 'power')
        self.assertEqual(task['plan']['guidance']['observations'], [])

    def test_old_shared_demo_sessions_are_rejected(self):
        from itsdangerous import TimestampSigner
        import base64, json
        client = self.visitor()
        value = base64.b64encode(json.dumps({'user_id':'person_demo_owner'}).encode())
        signed = TimestampSigner(self.app.state.settings.session_secret).sign(value).decode()
        client.cookies.set('session', signed)
        self.assertEqual(client.get('/api/me').status_code, 401)

    def test_complete_step_stays_in_visitor_chat_even_with_stale_seed_reference(self):
        from unittest.mock import patch
        from wujian.database import TaskRecord
        client = self.visitor()
        user = self.login(client)
        workspace = client.get('/api/workspace').json()
        chat = workspace['conversations'][0]
        task = next(t for t in workspace['tasks'] if t['plan'].get('guidance', {}).get('lesson'))
        with self.app.state.sessions() as db:
            row = db.get(TaskRecord, task['id'])
            source = db.get(ChatMessage, row.source_message_id)
            self.assertEqual(db.get(Conversation, source.conversation_id).user_id, user['id'])
            # Existing visitors can still have the former, now-trimmed source ID.
            self.assertIsNotNone(db.get(ChatMessage, 'd171d756d2b04b04bc5c8970b7cfefa4'))
            row.source_message_id = 'd171d756d2b04b04bc5c8970b7cfefa4'
            db.commit()
        self.app.state.settings.api_key = 'offline-test-only'
        try:
            with patch.object(self.app.state.runner, 'start'):
                response = client.post('/api/tasks/' + task['id'] + '/guidance-feedback', json={
                    'expected_version':task['version'], 'step_id':'power',
                    'outcome':'done', 'receipt_id':'visitor-complete-receipt'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['conversation_id'], chat['id'])
            history = client.get('/api/conversations/' + response.json()['conversation_id'] + '/messages')
            self.assertEqual(history.status_code, 200)
            self.assertEqual(history.json()[-1]['run_id'], response.json()['id'])
            # Repair the former live failure without losing its report/history.
            from wujian.database import Run
            from scripts.repair_demo_conversation_links import repair
            with self.app.state.sessions() as db:
                run = db.get(Run, response.json()['id'])
                run.status, run.error = 'failed', '步骤反馈必须来自当前教学对话'
                run.conversation_id = 'd19fff1f10e84080b25148d61bb93c47'
                for message in db.scalars(select(ChatMessage).where(ChatMessage.run_id == run.id)):
                    message.conversation_id = run.conversation_id
                db.commit()
            fixed = repair(self.app.state.settings)
            self.assertEqual(fixed['repaired_runs'], 1)
            self.assertEqual(fixed['reset_failed_reports'], 1)
            recovered = client.get('/api/tasks/' + task['id'] + '/board').json()
            self.assertEqual(recovered['conversation_id'], chat['id'])
            self.assertEqual(recovered['task']['plan']['guidance']['active_step_id'], 'power')
            self.assertEqual(recovered['entries'][0]['state'], 'pending')
        finally:
            self.app.state.settings.api_key = ''


if __name__ == '__main__':
    unittest.main()
