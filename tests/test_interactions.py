"""Two-account HTTP journeys for the interaction foundation; no model calls."""
import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from wujian import domain
from wujian.config import Settings
from wujian.database import Conversation, ExperienceRecord
from wujian.server import create_app


class InteractionJourneys(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), rea_enabled=False))
        self.owner = TestClient(self.app).__enter__()
        self.friend = TestClient(self.app)
        self.owner.post('/api/auth/demo/xiaolin')
        self.friend.post('/api/auth/demo/xiaoxia')
        self.owner_id, self.friend_id = 'person_demo_owner', 'person_demo_friend'

    def tearDown(self):
        self.friend.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def item(self, name='测试杯子'):
        return self.ok(self.owner.post('/api/items', json={
            'name': name, 'kind': 'nonstandard_object', 'description': '只对自己保留的理解'}))

    def story(self, item_ids=(), photos=()):
        return self.ok(self.owner.post('/api/experiences', json={
            'title': '真实操作记录', 'text': '两件东西陪我度过了这个下午。',
            'item_ids': list(item_ids), 'photo_ids': list(photos)}))

    def board(self, item_id=None):
        return self.ok(self.owner.post('/api/task-boards', json={
            'goal': '周末出行准备', 'constraints': {'private_note': '不随清单公开'},
            'entries': [{'id': 'first', 'title': '准备杯子', 'item_id': item_id},
                        {'id': 'water', 'title': '买水', 'group': 'buy'}]}))

    def test_workspace_and_preferences_are_account_scoped(self):
        original = self.ok(self.owner.get('/api/workspace'))
        self.assertEqual(len(original['households']), 1)
        self.assertEqual(len({row['id'] for row in original['items']}), len(original['items']))
        self.ok(self.owner.put('/api/preferences', json={'companion_name': '团团', 'display_mode': 'large'}))
        self.assertEqual(self.ok(self.owner.get('/api/workspace'))['preferences']['companion_name'], '团团')
        self.assertEqual(self.ok(self.friend.get('/api/preferences'))['display_mode'], 'normal')

    def test_household_invitation_is_separate_from_friendship_and_read_only(self):
        item = self.item()
        house = self.ok(self.owner.post('/api/households', json={'name': '共同的家'}))
        self.ok(self.owner.post(f"/api/households/{house['id']}/items", json={'item_id': item['id']}))
        self.ok(self.owner.post(f"/api/households/{house['id']}/invitations", json={'user_id': self.friend_id}))
        invited = next(row for row in self.ok(self.friend.get('/api/households')) if row['id'] == house['id'])
        self.assertEqual(invited['item_ids'], [])
        self.assertEqual(self.friend.get(f"/api/items/{item['id']}").status_code, 404)
        self.ok(self.friend.post(f"/api/households/{house['id']}/accept"))
        shared = self.ok(self.friend.get(f"/api/items/{item['id']}"))
        self.assertEqual(shared['description'], '')
        self.assertFalse(shared['avatar']['enabled'])
        self.assertEqual(self.friend.patch(f"/api/items/{item['id']}/presentation", json={'expected_version': 1, 'attention': 'paused'}).status_code, 404)
        self.ok(self.owner.delete(f"/api/households/{house['id']}/members/{self.friend_id}"))
        self.assertEqual(self.friend.get(f"/api/items/{item['id']}").status_code, 404)

    def test_one_memory_wall_record_edits_across_items_and_ai_permission(self):
        left, right = self.item('左杯'), self.item('右杯')
        story = self.story([left['id'], right['id']])
        self.assertFalse(story['allow_ai'])
        with self.app.state.sessions() as db:
            self.assertNotIn(story['id'], [row['id'] for row in domain.list_experiences(db, self.owner_id, for_ai=True)])
        payload = {key: story[key] for key in ['title', 'text', 'item_ids', 'photo_ids', 'occurred_on', 'allow_ai']}
        payload.update(text='改过的同一段原文', allow_ai=True, expected_version=story['version'])
        updated = self.ok(self.owner.put(f"/api/experiences/{story['id']}", json=payload))
        self.assertEqual(self.owner.put(f"/api/experiences/{story['id']}", json=payload).status_code, 409)
        for item in [left, right]:
            rows = self.ok(self.owner.get('/api/experiences', params={'item_id': item['id']}))
            self.assertEqual([row['text'] for row in rows], ['改过的同一段原文'])
        self.ok(self.owner.request('DELETE', f"/api/experiences/{story['id']}", json={'expected_version': updated['version']}))
        with self.app.state.sessions() as db:
            self.assertIsNone(db.get(ExperienceRecord, story['id']))

    def test_story_share_includes_photo_but_not_private_item_tag_or_ai_permission(self):
        image = io.BytesIO()
        Image.new('RGB', (20, 20), 'blue').save(image, format='PNG')
        photo = self.ok(self.owner.post('/api/assets', files={'file': ('cup.png', image.getvalue(), 'image/png')}))
        item = self.item()
        story = self.story([item['id']], [photo['id']])
        self.assertEqual(self.friend.get(f"/api/assets/{photo['id']}").status_code, 404)
        self.ok(self.owner.post(f"/api/experiences/{story['id']}/shares", json={'user_id': self.friend_id}))
        shared = next(row for row in self.ok(self.friend.get('/api/experiences')) if row['id'] == story['id'])
        self.assertEqual(shared['item_ids'], [])
        self.assertEqual(shared['item_labels'], {})
        self.assertFalse(shared['allow_ai'])
        self.assertEqual(self.friend.get(f"/api/assets/{photo['id']}").status_code, 200)
        self.ok(self.owner.delete(f"/api/experiences/{story['id']}/shares/{self.friend_id}"))
        self.assertNotIn(story['id'], [row['id'] for row in self.ok(self.friend.get('/api/experiences'))])
        self.assertEqual(self.friend.get(f"/api/assets/{photo['id']}").status_code, 404)

    def test_reminder_read_accept_complete_never_repairs_the_item(self):
        reminder = next(row for row in self.ok(self.friend.get('/api/reminders')) if row['id'] == 'reminder_demo_thermos')
        self.assertEqual(self.owner.post(f"/api/reminders/{reminder['id']}/feedback", json={'expected_version': reminder['version'], 'action': 'complete'}).status_code, 403)
        result = self.ok(self.friend.post(f"/api/reminders/{reminder['id']}/feedback", json={'expected_version': reminder['version'], 'action': 'read'}))
        self.assertEqual(result['status'], 'in_progress')
        payload = {'expected_version': result['version'], 'action': 'complete', 'note': '实际处理后留下报告'}
        completed = self.ok(self.friend.post(f"/api/reminders/{reminder['id']}/feedback", json=payload))
        self.assertTrue(completed['completed'])
        self.assertEqual(self.ok(self.friend.post(f"/api/reminders/{reminder['id']}/feedback", json=payload))['version'], completed['version'])
        item = self.ok(self.friend.get('/api/items/item_demo_thermos'))
        self.assertEqual(item['state']['presentation']['attention'], 'paused')

    def test_shared_checklist_acceptance_cas_and_readiness_are_real_records(self):
        item = self.item()
        board = self.board(item['id'])
        identity = board['task']['id']
        self.assertEqual(self.owner.post(f'/api/tasks/{identity}/shares', json={'user_id': self.friend_id}).status_code, 404)
        self.ok(self.owner.post(f"/api/items/{item['id']}/shares", json={'user_id': self.friend_id}))
        self.ok(self.owner.post(f'/api/tasks/{identity}/shares', json={'user_id': self.friend_id}))
        invited = self.ok(self.friend.get(f'/api/tasks/{identity}/board'))
        self.assertEqual(invited['task']['constraints'], {})
        payload = {'expected_version': 1, 'state': 'ready'}
        self.assertEqual(self.friend.patch(f'/api/tasks/{identity}/entries/first', json=payload).status_code, 404)
        self.ok(self.friend.post(f'/api/tasks/{identity}/accept'))
        first = self.ok(self.friend.patch(f'/api/tasks/{identity}/entries/first', json=payload))
        repeated = self.ok(self.friend.patch(f'/api/tasks/{identity}/entries/first', json=payload))
        self.assertEqual(repeated['task']['version'], first['task']['version'])
        self.assertEqual(self.owner.patch(f'/api/tasks/{identity}/entries/water', json=payload).status_code, 409)
        ready = self.ok(self.owner.patch(f'/api/tasks/{identity}/entries/water', json={**payload, 'expected_version': first['task']['version']}))
        self.assertEqual(ready['task']['status'], 'ready')
        self.assertEqual(ready['completed_count'], 2)
        self.assertNotEqual(ready['task']['status'], 'completed')
        self.ok(self.owner.delete(f'/api/tasks/{identity}/shares/{self.friend_id}'))
        self.assertEqual(self.friend.get(f'/api/tasks/{identity}/board').status_code, 404)

    def test_unavailable_item_cannot_be_marked_ready_and_wish_is_not_inventory(self):
        board = self.board('item_demo_thermos')
        self.assertEqual(self.owner.patch(f"/api/tasks/{board['task']['id']}/entries/first", json={'expected_version': 1, 'state': 'ready'}).status_code, 409)
        before = len(self.ok(self.friend.get('/api/items')))
        self.ok(self.friend.post('/api/wishes', json={'title': '私人的想要'}))
        self.ok(self.friend.post('/api/wishes', json={'title': '公开心愿', 'visible_to_friends': True}))
        self.assertEqual(len(self.ok(self.friend.get('/api/items'))), before)
        space = self.ok(self.owner.get(f'/api/friends/{self.friend_id}/space'))
        self.assertIn('公开心愿', [row['title'] for row in space['wishes']])
        self.assertNotIn('私人的想要', [row['title'] for row in space['wishes']])
        self.assertEqual(self.friend.post('/api/wishes', json={'title': '坏链接', 'url': 'javascript:alert(1)'}).status_code, 400)

    def test_assignment_waits_for_acceptance_and_blocks_other_assignees(self):
        board = self.board('item_demo_mat')
        identity = board['task']['id']
        self.ok(self.owner.post(f'/api/tasks/{identity}/shares', json={'user_id': self.friend_id}))
        endpoint = f'/api/tasks/{identity}/entries/first/assignee'
        self.assertEqual(self.owner.patch(endpoint, json={'expected_version': 1, 'assignee_id': self.friend_id}).status_code, 400)
        self.ok(self.friend.post(f'/api/tasks/{identity}/accept'))
        assigned = self.ok(self.owner.patch(endpoint, json={'expected_version': 1, 'assignee_id': self.owner_id}))
        self.assertEqual(self.friend.patch(f'/api/tasks/{identity}/entries/first', json={'expected_version': assigned['task']['version'], 'state': 'ready'}).status_code, 403)
        self.assertEqual(self.friend.patch(endpoint, json={'expected_version': assigned['task']['version'], 'assignee_id': self.friend_id}).status_code, 403)
        reassigned = self.ok(self.owner.patch(endpoint, json={'expected_version': assigned['task']['version'], 'assignee_id': self.friend_id}))
        ready = self.ok(self.friend.patch(f'/api/tasks/{identity}/entries/first', json={'expected_version': reassigned['task']['version'], 'state': 'ready'}))
        self.assertEqual(ready['entries'][0]['updated_by'], self.friend_id)

    def test_legacy_private_source_is_not_opened_by_household_item_access(self):
        from wujian.database import SourceRecord
        from wujian.source_access import readable_source
        with self.app.state.sessions() as db:
            source = SourceRecord(owner_id=self.owner_id, item_id='item_demo_lamp', title='私人的旧笔记', url='', content='私人内容')
            db.add(source)
            db.commit()
            self.assertEqual(readable_source(db, self.owner_id, source.id).id, source.id)
            with self.assertRaises(domain.DomainError):
                readable_source(db, self.friend_id, source.id)

    def test_task_resume_is_idempotent_and_browsing_does_not_retarget_it(self):
        board = self.board()
        identity = board['task']['id']
        first = self.ok(self.owner.post(f'/api/tasks/{identity}/conversation'))
        second = self.ok(self.owner.post(f'/api/tasks/{identity}/conversation'))
        self.assertEqual(first['conversation_id'], second['conversation_id'])
        self.ok(self.owner.get('/api/items/item_demo_lamp'))
        with self.app.state.sessions() as db:
            thread = db.get(Conversation, first['conversation_id'])
            self.assertEqual(thread.entry_context['task_id'], identity)
            self.assertEqual(thread.item_ids, [])
            self.assertEqual(len(db.scalars(select(Conversation).where(Conversation.id == thread.id)).all()), 1)

    def test_success_of_old_plan_does_not_complete_a_revised_plan(self):
        task = self.ok(self.owner.post('/api/tasks', json={'goal': '折纸收纳', 'plan': {'steps': ['旧折法']}}))
        reported = self.ok(self.owner.post(f"/api/tasks/{task['id']}/feedback", json={'expected_version': task['version'], 'text': '旧折法完成了', 'outcome': 'success'}))
        payload = {'task_id': task['id'], 'goal': task['goal'], 'expected_version': reported['version'], 'plan': {'steps': ['新折法']}, 'status': 'completed'}
        self.assertEqual(self.owner.post('/api/tasks', json=payload).status_code, 400)
        payload['plan'] = task['plan']
        self.assertEqual(self.ok(self.owner.post('/api/tasks', json=payload))['status'], 'completed')

    def test_gift_decisions_and_transfer_revoke_household_access(self):
        item = self.item()
        self.ok(self.owner.post('/api/households/household_demo_home/items', json={'item_id': item['id']}))
        story = self.story([item['id']])
        gift = self.ok(self.owner.post('/api/gifts', json={'item_id': item['id'], 'recipient_id': self.friend_id, 'experience_ids': [story['id']]}))
        accepted = self.ok(self.friend.post(f"/api/gifts/{gift['id']}/accept"))
        self.assertEqual(accepted['status'], 'accepted')
        self.assertEqual(self.owner.get(f"/api/items/{item['id']}").status_code, 404)
        self.assertEqual(self.ok(self.friend.get(f"/api/items/{item['id']}"))['description'], '')
        self.assertEqual(self.ok(self.friend.post(f"/api/gifts/{gift['id']}/accept"))['id'], gift['id'])
        other = self.item('待取消的礼物')
        gift = self.ok(self.owner.post('/api/gifts', json={'item_id': other['id'], 'recipient_id': self.friend_id}))
        cancelled = self.ok(self.owner.post(f"/api/gifts/{gift['id']}/decision", json={'action': 'cancel'}))
        self.assertEqual(cancelled['status'], 'cancelled')
        self.assertEqual(self.friend.post(f"/api/gifts/{gift['id']}/accept").status_code, 409)

    def test_reminder_item_must_belong_to_the_selected_household(self):
        house = self.ok(self.owner.post('/api/households', json={'name': '另一个家'}))
        self.ok(self.owner.post(f"/api/households/{house['id']}/invitations", json={'user_id': self.friend_id}))
        self.ok(self.friend.post(f"/api/households/{house['id']}/accept"))
        response = self.owner.post('/api/reminders', json={'title': '检查保温壶', 'item_id': 'item_demo_thermos',
            'household_id': house['id'], 'assignee_id': self.friend_id, 'due_at': '2026-11-06T10:00:00+08:00'})
        self.assertEqual(response.status_code, 400, response.text)

    def test_gift_does_not_erase_authored_task_but_resource_is_no_longer_usable(self):
        item = self.item()
        board = self.board(item['id'])
        gift = self.ok(self.owner.post('/api/gifts', json={'item_id': item['id'], 'recipient_id': self.friend_id}))
        self.ok(self.friend.post(f"/api/gifts/{gift['id']}/accept"))
        retained = self.ok(self.owner.get(f"/api/tasks/{board['task']['id']}/board"))
        self.assertEqual(retained['entries'][0]['title'], '准备杯子')
        self.assertIn(board['task']['id'], [task['id'] for task in self.ok(self.owner.get('/api/tasks'))])
        self.assertEqual(self.owner.patch(f"/api/tasks/{board['task']['id']}/entries/first", json={'expected_version': 1, 'state': 'ready'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
