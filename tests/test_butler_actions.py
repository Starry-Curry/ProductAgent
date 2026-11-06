"""Adversarial two-account HTTP/SQLite checks; no external model calls.

People and ownership are fictional. A real user message is installed as a test
fixture because posting it through the production run endpoint invokes a model.
"""
import asyncio
import concurrent.futures
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from wujian import butler_actions, domain
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ExperienceRecord, Friendship, Gift, Profile, Reminder, TaskRecord, uid
from wujian.server import create_app


class ButlerActionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=False)
        self.app = create_app(self.settings)
        self.owner = TestClient(self.app).__enter__()
        self.friend = TestClient(self.app)
        self.owner.post("/api/auth/demo/xiaolin")
        self.friend.post("/api/auth/demo/xiaoxia")
        self.owner_id, self.friend_id = "person_demo_owner", "person_demo_friend"

    def tearDown(self):
        self.friend.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def item(self):
        return self.ok(self.owner.post("/api/items", json={"name": "送给小雨的杯子",
            "kind": "nonstandard_object", "description": "模拟人物的礼物"}))

    def story(self, item):
        return self.ok(self.owner.post("/api/experiences", json={"title": "毕业那天",
            "text": "那天下着雨，我们在教学楼门口互赠杯子。", "item_ids": [item["id"]]}))

    def message(self, text="周六上午九点，提醒家里人看看滤芯该不该换了。"):
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.owner_id, title="模拟用户的真实请求", item_ids=[])
            db.add(conversation)
            db.flush()
            message = ChatMessage(id=uid(), conversation_id=conversation.id, role="user", text=text)
            db.add(message)
            db.commit()
            return message.id

    def propose(self, kind="reminder", payload=None, message_id=None):
        if payload is None:
            payload = {"title": "看看滤芯该不该更换了", "due_at": "2026-11-07T09:00:00+08:00"}
        with self.app.state.sessions() as db:
            return butler_actions.propose(db, self.owner_id, message_id or self.message(),
                kind, payload, self.settings).model_dump()

    def count(self, model):
        with self.app.state.sessions() as db:
            return db.scalar(select(func.count()).select_from(model))

    def confirm(self, action, client=None):
        return (client or self.owner).post(f"/api/tasks/{action['task_id']}/action/confirm",
            json={"expected_version": action["version"]})

    def gift_action(self):
        item = self.item()
        story = self.story(item)
        action = self.propose("gift", {"item_id": item["id"], "recipient_id": self.friend_id,
            "message": "以后看见它，就想起一起毕业的那个下午。", "experience_ids": [story["id"]]},
            self.message("把这个杯子送给小雨，再附上毕业那天的回忆。"))
        return action, item, story

    def test_prepare_only_builds_private_task_and_requires_explicit_confirmation(self):
        before = self.count(Reminder)
        action = self.propose()
        self.assertEqual(action["status"], "pending")
        self.assertEqual(self.count(Reminder), before)
        self.assertEqual(self.friend.get(f"/api/tasks/{action['task_id']}/action").status_code, 404)
        self.assertEqual(self.confirm(action, self.friend).status_code, 404)
        result = self.ok(self.confirm(action))
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(self.count(Reminder), before + 1)
        with self.app.state.sessions() as db:
            task, reminder = db.get(TaskRecord, action["task_id"]), db.get(Reminder, result["result_id"])
            self.assertEqual(task.status, "completed")
            self.assertEqual(reminder.title, "看看滤芯该不该更换了")
            self.assertEqual(task.plan["pending_action"]["result_id"], reminder.id)
        repeat = self.ok(self.confirm(action))
        self.assertEqual(repeat["result_id"], result["result_id"])
        self.assertEqual(self.count(Reminder), before + 1)

    def test_prepare_gift_then_confirm_is_one_pending_gift_not_ownership_transfer(self):
        before = self.count(Gift)
        action, item, story = self.gift_action()
        self.assertEqual(self.count(Gift), before)
        result = self.ok(self.confirm(action))
        self.assertEqual(self.count(Gift), before + 1)
        with self.app.state.sessions() as db:
            gift = db.get(Gift, result["result_id"])
            self.assertEqual(gift.status, "pending")
            self.assertEqual(gift.snapshot["experiences"][0]["id"], story["id"])
        self.assertEqual(self.ok(self.owner.get(f"/api/items/{item['id']}"))["owner_id"], self.owner_id)
        self.assertEqual(self.ok(self.confirm(action))["result_id"], result["result_id"])
        self.assertEqual(self.count(Gift), before + 1)

    def test_cancel_does_not_execute_and_later_confirm_remains_cancelled(self):
        before = self.count(Reminder)
        action = self.propose()
        cancelled = self.ok(self.owner.post(f"/api/tasks/{action['task_id']}/action/cancel",
            json={"expected_version": action["version"]}))
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(self.ok(self.confirm(action))["status"], "cancelled")
        self.assertEqual(self.count(Reminder), before)

    def test_stale_review_cannot_execute(self):
        action = self.propose()
        response = self.owner.post(f"/api/tasks/{action['task_id']}/action/confirm",
            json={"expected_version": action["version"] + 1})
        self.assertEqual(response.status_code, 409)

    def test_item_changes_after_review_require_new_review(self):
        action, item, _ = self.gift_action()
        self.ok(self.owner.patch(f"/api/items/{item['id']}/presentation", json={
            "expected_version": item["version"], "attention": "paused"}))
        before = self.count(Gift)
        self.assertEqual(self.confirm(action).status_code, 409)
        self.assertEqual(self.count(Gift), before)

    def test_story_changes_after_review_require_new_review(self):
        action, _, story = self.gift_action()
        payload = {key: story[key] for key in ("title", "text", "item_ids", "photo_ids", "allow_ai", "occurred_on")}
        self.ok(self.owner.put(f"/api/experiences/{story['id']}", json={**payload,
            "text": "这是后来修改过的故事，不是此前确认的内容。", "expected_version": story["version"]}))
        before = self.count(Gift)
        self.assertEqual(self.confirm(action).status_code, 409)
        self.assertEqual(self.count(Gift), before)

    def test_household_membership_is_rechecked_when_confirmed(self):
        before = self.count(Reminder)
        action = self.propose("reminder", {"title": "看看滤芯", "due_at": "2026-11-07T09:00:00+08:00",
            "assignee_id": self.friend_id, "household_id": "household_demo_home", "item_id": "item_demo_lamp"})
        self.ok(self.owner.delete(f"/api/households/household_demo_home/members/{self.friend_id}"))
        self.assertIn(self.confirm(action).status_code, (403, 404, 409))
        self.assertEqual(self.count(Reminder), before)

    def test_friendship_is_rechecked_when_confirmed(self):
        action, _, _ = self.gift_action()
        with self.app.state.sessions() as db:
            db.execute(delete(Friendship).where((Friendship.sender_id == self.owner_id) | (Friendship.recipient_id == self.owner_id)))
            db.commit()
        before = self.count(Gift)
        self.assertIn(self.confirm(action).status_code, (400, 403, 409))
        self.assertEqual(self.count(Gift), before)

    def test_copied_signature_or_unsigned_generic_task_cannot_execute(self):
        action = self.propose()
        with self.app.state.sessions() as db:
            plan = copy.deepcopy(db.get(TaskRecord, action["task_id"]).plan)
        copied = self.ok(self.owner.post("/api/tasks", json={"goal": "复制的假草稿", "plan": plan}))
        self.assertEqual(self.owner.get(f"/api/tasks/{copied['id']}/action").status_code, 409)
        self.assertEqual(self.confirm({"task_id": copied["id"], "version": copied["version"]}).status_code, 409)
        plan["pending_action"].pop("signature")
        unsigned = self.ok(self.owner.post("/api/tasks", json={"goal": "没有签名的草稿", "plan": plan}))
        self.assertEqual(self.confirm({"task_id": unsigned["id"], "version": unsigned["version"]}).status_code, 409)

    def test_editing_review_title_details_payload_status_or_result_invalidates_signature(self):
        for field in ("title", "details", "payload", "status", "result"):
            with self.subTest(field=field):
                action = self.propose(message_id=self.message("给我整理一条提醒，先确认再发。"))
                with self.app.state.sessions() as db:
                    row = db.get(TaskRecord, action["task_id"])
                    plan = copy.deepcopy(row.plan)
                    if field == "title":
                        row.goal = "表面显示的标题已经被伪造"
                    elif field == "details":
                        plan["pending_action"]["details"] = ["表面上是另外一位接收人"]
                    elif field == "payload":
                        plan["pending_action"]["payload"]["title"] = "实际发出不同内容"
                    elif field == "status":
                        plan["pending_action"]["status"] = "confirmed"
                    else:
                        plan["pending_action"]["result_id"] = "not-a-real-result"
                    row.plan = plan
                    db.commit()
                self.assertEqual(self.confirm(action).status_code, 409)

    def test_parallel_confirmations_create_one_canonical_record(self):
        action = self.propose()
        before = self.count(Reminder)
        second = TestClient(self.app)
        second.post("/api/auth/demo/xiaolin")
        self.addCleanup(second.close)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda client: self.confirm(action, client), (self.owner, second)))
        self.assertEqual([response.status_code for response in results], [200, 200])
        self.assertEqual(results[0].json()["result_id"], results[1].json()["result_id"])
        self.assertEqual(self.count(Reminder), before + 1)

    def test_failure_after_gift_flush_rolls_back_gift_and_task_receipt(self):
        action, _, _ = self.gift_action()
        before = self.count(Gift)
        original = domain.create_gift
        def fail_after_flush(db, user_id, payload, *, commit=True):
            original(db, user_id, payload, commit=commit)
            raise domain.DomainError("模拟业务写入后、总事务提交前失败", 409)
        with patch("wujian.domain.create_gift", side_effect=fail_after_flush):
            self.assertEqual(self.confirm(action).status_code, 409)
        self.assertEqual(self.count(Gift), before)
        pending = self.ok(self.owner.get(f"/api/tasks/{action['task_id']}/action"))
        self.assertEqual(pending["status"], "pending")
        self.assertIsNone(pending["result_id"])
        self.ok(self.confirm(action))
        self.assertEqual(self.count(Gift), before + 1)

    def test_native_tools_prepare_action_cards_without_sending(self):
        item = self.item()
        message_id = self.message("把杯子送给小雨；明天九点提醒我准备好，先给我看看。")
        tools = {tool.name: tool for tool in make_tools(self.settings,
            self.app.state.sessions, self.owner_id, message_id).tool_groups[0].tools}
        before_reminders, before_gifts = self.count(Reminder), self.count(Gift)
        for name, arguments in [("prepare_reminder", {"title": "把杯子准备好", "assignee_id": self.owner_id,
                "due_at": "2026-11-07T09:00:00+08:00"}),
                ("prepare_gift", {"item_id": item["id"], "recipient_id": self.friend_id, "message": "毕业快乐"})]:
            reply = asyncio.run(tools[name](**arguments))
            self.assertEqual(str(reply.state), "success", reply)
            result = json.loads(reply.content[0].text)
            self.assertEqual(result["execution"], "awaiting_user_confirmation")
            self.assertEqual(result["status"], "pending")
            self.assertEqual(reply.metadata["action_task_id"], result["task_id"])
            self.ok(self.owner.get(f"/api/tasks/{result['task_id']}/action"))
        self.assertEqual(self.count(Reminder), before_reminders)
        self.assertEqual(self.count(Gift), before_gifts)

    def test_native_gift_does_not_implicitly_send_private_self_use_personality(self):
        item = self.item()
        private_personality = "Private self-use note: owner talks here about conflict with a coworker."
        with self.app.state.sessions() as db:
            profile = db.get(Profile, (self.owner_id, item["id"]))
            profile.avatar = {"enabled": True, "nickname": "Little cup", "form": "cup",
                "personality": private_personality, "growth_dismissed_ids": ["private-growth-reference"]}
            db.commit()
        message_id = self.message("Send my cup to my friend, without my private memories.")
        tools = {tool.name: tool for tool in make_tools(self.settings,
            self.app.state.sessions, self.owner_id, message_id).tool_groups[0].tools}
        reply = asyncio.run(tools["prepare_gift"](item_id=item["id"], recipient_id=self.friend_id,
            message="Remember to drink water."))
        self.assertEqual(str(reply.state), "success", reply)
        action = json.loads(reply.content[0].text)
        self.assertNotIn(private_personality, json.dumps(action))
        result = self.ok(self.confirm(action))
        with self.app.state.sessions() as db:
            gift = db.get(Gift, result["result_id"])
            self.assertEqual(gift.snapshot["avatar"]["nickname"], "Little cup")
            self.assertEqual(gift.snapshot["avatar"]["form"], "cup")
            self.assertEqual(gift.snapshot["avatar"]["personality"], "")
            self.assertEqual(gift.snapshot["avatar"]["growth_dismissed_ids"], [])
            self.assertEqual(gift.snapshot["experiences"], [])
            self.assertEqual(db.get(Profile, (self.owner_id, item["id"])).avatar["personality"], private_personality)

    def test_native_gift_explicit_personality_is_reviewed_and_sent(self):
        item = self.item()
        gift_personality = "Speak like a warm little cup: encourage my friend to rest and drink water."
        message_id = self.message("Give this cup a warm companion voice before sending it to my friend.")
        tools = {tool.name: tool for tool in make_tools(self.settings,
            self.app.state.sessions, self.owner_id, message_id).tool_groups[0].tools}
        reply = asyncio.run(tools["prepare_gift"](item_id=item["id"], recipient_id=self.friend_id,
            message="Take care of yourself.", gift_personality=gift_personality))
        self.assertEqual(str(reply.state), "success", reply)
        action = json.loads(reply.content[0].text)
        self.assertTrue(any(gift_personality in detail for detail in action["details"]))
        result = self.ok(self.confirm(action))
        with self.app.state.sessions() as db:
            gift = db.get(Gift, result["result_id"])
            self.assertEqual(gift.snapshot["avatar"]["personality"], gift_personality)
            self.assertEqual(gift.snapshot["experiences"], [])


if __name__ == "__main__":
    unittest.main()
