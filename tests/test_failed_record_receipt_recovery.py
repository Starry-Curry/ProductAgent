"""A real wall write followed by a simulated provider failure; no paid APIs."""
import json
import tempfile
import unittest
from pathlib import Path

from agentscope.message import ToolCallBlock
from agentscope.model import ChatResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

import test_failed_turn_recovery as recovery
from wujian.config import Settings
from wujian.database import ChatMessage, ExperienceRecord
from wujian.server import create_app


STORY = "昨天下班买了个热红薯，捂在手里好暖。"


class ReceiptControl(recovery.RecoveryControl):
    item_id = ""

    def factory(self, _settings):
        self.round += 1
        return ReceiptModel(self, self.round)


class ReceiptModel(recovery.RecoveryModel):
    def __init__(self, control, round_number):
        super().__init__(control, round_number)
        self.calls = 0

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.round_number == 2 and self.calls == 1:
            return ChatResponse(content=[ToolCallBlock(id="record-before-outage",
                name="record_experience", input=json.dumps({"title": "下班的热红薯", "text": STORY,
                    "item_ids": [self.control.item_id], "occurred_on": ""}, ensure_ascii=False))], is_last=True)
        return await super()._call_api(model_name, messages, **kwargs)


class FailedRecordReceiptRecoveryTests(unittest.TestCase):
    ok = recovery.FailedTurnRecoveryTests.ok
    chat = recovery.FailedTurnRecoveryTests.chat

    def test_successful_wall_write_receipt_survives_failed_reply_and_restart_without_read_consent(self):
        with tempfile.TemporaryDirectory() as directory:
            control = ReceiptControl()
            settings = Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False)

            def create():
                return create_app(settings, model_factory=control.factory)

            app = create()
            with TestClient(app) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                item = self.ok(client.post("/api/items", json={"name": "朋友钩的小鲸鱼",
                    "kind": "nonstandard_object"}))
                control.item_id = item["id"]
                first = self.chat(client, "今天想和小鲸鱼待一会儿。", item_ids=[item["id"]])
                self.assertEqual(first["status"], "completed", first)
                failed = self.chat(client, "帮我记下：" + STORY, first["conversation_id"])
                self.assertEqual(failed["status"], "failed", failed)
                with app.state.sessions() as db:
                    wall = [row for row in db.scalars(select(ExperienceRecord).where(
                        ExperienceRecord.creator_id == "person_demo_owner")) if item["id"] in row.item_ids]
                    self.assertEqual(len(wall), 1)
                    identity = wall[0].id
                    self.assertFalse(wall[0].allow_ai)
                    source = db.scalar(select(ChatMessage).where(ChatMessage.run_id == failed["id"], ChatMessage.role == "user"))
                    self.assertIn(identity, source.recorded_experiences.values())
            with TestClient(create()) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                resumed = self.chat(client, "刚才那段存好了吗？", first["conversation_id"])
                self.assertEqual(resumed["status"], "completed", resumed)
                request = control.requests[3][0]
                self.assertTrue(identity in request, "Actual wall write receipt was lost after reply failure")
                # Receipt metadata cannot make the new wall text AI-readable.
                blocks = [block["text"] for message in json.loads(request)
                    for block in (message.get("content") or []) if isinstance(block, dict)
                    and block.get("type") == "text" and "\nrecord_receipts=" in block.get("text", "")]
                self.assertEqual(len(blocks), 1)
                receipts = json.loads(blocks[0].split("\nrecord_receipts=", 1)[1].split("\n", 1)[0])
                self.assertEqual(receipts, [{"experience_id": identity,
                    "reference_kind": "record_write_receipt", "ai_reference_allowed": False}])
                self.assertEqual(request.count(STORY), 1)
