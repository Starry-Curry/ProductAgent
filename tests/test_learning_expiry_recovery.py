"""A real AgentScope final-tool error must remain repairable by the model.

Real HTTP, SDK tool orchestration and temporary SQLite; all users/statements
are fictional and the controlled model performs no provider/network calls.
"""

import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import Settings
from wujian.database import ChatMessage, Memory
from wujian.server import create_app


class ExpiryRepairModel(ChatModelBase):
    def __init__(self, invalid_expiry, corrected_expiry):
        super().__init__(credential=None, model="offline-learning-expiry-repair",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.invalid_expiry = invalid_expiry
        self.corrected_expiry = corrected_expiry
        self.calls = 0
        self.saw_repairable_expiry_error = False

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.calls > 2:
            raise AssertionError("Expected one rejected final and one corrected final")
        if self.calls == 2:
            # Inspect the actual SDK-formatted feedback from the rejected tool,
            # rather than injecting or mocking the validator's error ourselves.
            feedback = json.dumps(messages, ensure_ascii=False, default=str)
            self.saw_repairable_expiry_error = (
                "临时条件" in feedback and "时区" in feedback and "ISO" in feedback
            )
            if not self.saw_repairable_expiry_error:
                raise AssertionError("Model did not receive the actual expiry validation error")
        arguments = {
            "answer": "好，这两天先给你准备起来不超过十分钟的玩法。",
            "continuation": None,
            "source_refs": [],
            "story_refs": [],
            "learning": {
                "knowledge_updates": [],
                "memory_updates": [{
                    "operation": "add",
                    "content": "这两天只想尝试准备时间不超过十分钟的玩法",
                    "kind": "constraint",
                    "context": "这两天的创意玩法推荐",
                    "basis": "user_report",
                    "source_quote": "这两天只想做十分钟就能开始的玩法",
                    "expires_at": self.invalid_expiry if self.calls == 1 else self.corrected_expiry,
                }],
            },
        }
        return ChatResponse(content=[ToolCallBlock(id=f"expiry-{self.calls}",
            name="GenerateStructuredOutput", input=json.dumps(arguments, ensure_ascii=False))],
            is_last=True, usage=ChatUsage(input_tokens=10, output_tokens=5, time=0))


class LearningExpiryRecoveryTests(unittest.TestCase):
    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_invalid_expiry_is_repaired_in_native_final_tool_before_commit(self):
        future = datetime.now(timezone.utc) + timedelta(days=2)
        corrected = future.isoformat()
        for invalid in ("2020-01-01T12:00:00+08:00", future.replace(tzinfo=None).isoformat()):
            with self.subTest(invalid_expiry=invalid), tempfile.TemporaryDirectory() as directory:
                model = ExpiryRepairModel(invalid, corrected)
                app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network",
                    rea_enabled=False), model_factory=lambda _settings: model)
                with TestClient(app) as client:
                    user = self.ok(client.post("/api/auth/register", json={
                        "username": "expiry_probe", "display_name": "模拟测试者",
                        "password": "offline-fixture-only-123"}))
                    run = self.ok(client.post("/api/chat", json={
                        "text": "这两天只想做十分钟就能开始的玩法，轻松一点就好。",
                        "item_ids": []}))
                    deadline = time.monotonic() + 5
                    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
                        time.sleep(0.02)
                        run = self.ok(client.get("/api/runs/" + run["id"]))
                    self.assertEqual(run["status"], "completed", run)
                    self.assertEqual(model.calls, 2, "Invalid expiry was not rejected within the model repair loop")
                    self.assertTrue(model.saw_repairable_expiry_error)
                    self.assertIn("十分钟", run["text"])
                    self.assertEqual(run["error"], "")
                    with app.state.sessions() as db:
                        memories = list(db.scalars(select(Memory).where(Memory.user_id == user["id"])))
                        self.assertEqual(len(memories), 1, "Rejected draft must never create a second memory")
                        memory = memories[0]
                        self.assertTrue(memory.active)
                        self.assertEqual(datetime.fromisoformat(memory.expires_at), future)
                        self.assertEqual(memory.attributes["source_quote"], "这两天只想做十分钟就能开始的玩法")
                        self.assertEqual(memory.source_message_id, db.scalar(select(ChatMessage.id).where(
                            ChatMessage.run_id == run["id"], ChatMessage.role == "user")))
                        replies = list(db.scalars(select(ChatMessage).where(
                            ChatMessage.run_id == run["id"], ChatMessage.role == "assistant")))
                        self.assertEqual(len(replies), 1)
                        self.assertEqual(replies[0].text, run["text"])


if __name__ == "__main__":
    unittest.main()
