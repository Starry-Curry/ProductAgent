"""Independent final-review regressions; isolated database and no hardware."""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wujian import butler_actions, domain
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, TaskRecord
from wujian.server import create_app
from wujian.workbench_check import valid_bridge_request


class WorkbenchArgumentContractTests(unittest.TestCase):
    def test_simulated_bridge_accepts_only_production_arguments(self):
        valid = [("read_state", {}), ("read_volume", {}),
                 *(("set_noise_mode", {"mode": mode}) for mode in ("off", "light", "balanced")),
                 *(("set_volume", {"level": value}) for value in (0, 35.5, 100))]
        for op, args in valid:
            with self.subTest(op=op, args=args):
                self.assertTrue(valid_bridge_request({"op": op, "args": args}))
        invalid = [("read_state", None), ("read_volume", []), ("read_state", {"item_id": "other"}),
                   ("set_noise_mode", {"mode": "transparent"}), ("set_noise_mode", {"mode": []}),
                   ("set_noise_mode", {"mode": "off", "item_id": "other"}),
                   *(("set_volume", {"level": value}) for value in (True, "35", -1, 101, float("nan"), float("inf"))),
                   ("set_volume", {"level": 35, "item_id": "other"}), ("set_volume", {}), ("shell", {})]
        for op, args in invalid:
            with self.subTest(op=op, args=args):
                self.assertFalse(valid_bridge_request({"op": op, "args": args}))


class PendingActionReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=False)
        self.app = create_app(self.settings)
        self.client = TestClient(self.app).__enter__()
        self.client.post("/api/auth/demo/xiaolin")
        self.user_id = "person_demo_owner"
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.user_id, item_ids=[])
            db.add(conversation); db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="明天九点提醒我检查滤芯，先给我看看。")
            db.add(message); db.commit(); self.message_id = message.id
        self.payload = {"title": "检查滤芯", "due_at": "2026-11-08T09:00:00+08:00"}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def propose(self, payload):
        with self.app.state.sessions() as db:
            return butler_actions.propose(db, self.user_id, self.message_id, "reminder", payload, self.settings)

    def test_identical_pending_tool_replay_returns_same_signed_review(self):
        first = self.propose(self.payload)
        replay = self.propose(dict(self.payload))
        self.assertEqual(replay.model_dump(), first.model_dump())
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, first.task_id).version, first.version)
        response = self.client.post(f"/api/tasks/{first.task_id}/action/confirm", json={"expected_version": first.version})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "confirmed")

    def test_same_message_changed_payload_cannot_silently_replace_review(self):
        first = self.propose(self.payload)
        with self.assertRaises(domain.DomainError) as denied:
            self.propose({**self.payload, "title": "不同的提醒内容"})
        self.assertEqual(denied.exception.status, 409)
        with self.app.state.sessions() as db:
            preview = butler_actions.preview(db, self.user_id, first.task_id, self.settings)
        self.assertEqual(preview.model_dump(), first.model_dump())

    def test_identical_gift_tool_replay_is_one_pending_review(self):
        payload = {"item_id": "item_demo_lamp", "recipient_id": "person_demo_friend", "message": "好好休息。"}
        with self.app.state.sessions() as db:
            first = butler_actions.propose(db, self.user_id, self.message_id, "gift", payload, self.settings)
        with self.app.state.sessions() as db:
            replay = butler_actions.propose(db, self.user_id, self.message_id, "gift", dict(payload), self.settings)
        self.assertEqual(replay.model_dump(), first.model_dump())


if __name__ == "__main__":
    unittest.main()
