"""Native final-tool repair uses the real task write rules, with no preview writes.

Real FastAPI/AgentScope orchestration and an isolated SQLite database. A
deterministic offline model first proposes an unperformed plan as completed,
then corrects it only after receiving the actual business-rule tool error.
"""

import json
import tempfile
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, TaskRecord
from wujian.server import create_app


class PlanRepairModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None, model="offline-final-contract-repair",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.item_id = ""
        self.calls = 0
        self.saw_real_task_error = False

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.calls > 2:
            raise AssertionError("Expected one rejected final and one repaired final")
        if self.calls == 2:
            feedback = json.dumps(messages, ensure_ascii=False, default=str)
            self.saw_real_task_error = "新方案还没有实际结果，不能直接标为完成" in feedback
            if not self.saw_real_task_error:
                raise AssertionError("Model did not receive the actual save_task business-rule error")
        arguments = {
            "answer": "准备步骤列好了，用家里的空白卡片开始，不需要买东西。",
            "story_refs": [], "source_refs": [],
            "learning": {
                "knowledge_updates": [],
                "memory_updates": [{
                    "operation": "add", "kind": "constraint", "context": "卡片小游戏",
                    "content": "卡片小游戏先不购买新东西", "basis": "user_report",
                    "source_quote": "先别买东西",
                }],
            },
            "continuation": {
                "goal": "用空白卡片准备十分钟小游戏",
                "item_ids": [self.item_id], "constraints": {"no_purchase": True},
                "task_id": None, "expected_version": None,
                "status": "completed" if self.calls == 1 else "ready",
                "feedback_quote": "", "outcome": "unknown",
                "plan": {"schema": "interaction/1", "kind": "guidance", "entries": [{
                    "id": "prepare", "title": "每人写一句线索", "item_id": self.item_id,
                    "group": "step", "note": "先准备卡片，还没有开始实际游戏", "state": "pending",
                }]},
            },
        }
        return ChatResponse(content=[ToolCallBlock(id=f"plan-repair-{self.calls}",
            name="GenerateStructuredOutput", input=json.dumps(arguments, ensure_ascii=False))],
            is_last=True, usage=ChatUsage(input_tokens=10, output_tokens=5, time=0))


class FinalContractRecoveryTests(unittest.TestCase):
    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_new_completed_plan_is_repaired_and_validation_leaves_no_preview_writes(self):
        model = PlanRepairModel()
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network",
                rea_enabled=False), model_factory=lambda _settings: model)
            with TestClient(app) as client:
                user = self.ok(client.post("/api/auth/register", json={"username": "plan_probe",
                    "display_name": "模拟测试者", "password": "offline-fixture-only-123"}))
                item = self.ok(client.post("/api/items", json={
                    "name": "空白卡片", "kind": "nonstandard_object"}))
                model.item_id = item["id"]
                run = self.ok(client.post("/api/chat", json={
                    "text": "想拿家里的空白卡片玩个十分钟小游戏，帮我列个准备步骤，先别买东西。",
                    "item_ids": [item["id"]]}))
                deadline = time.monotonic() + 5
                while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
                    time.sleep(0.02)
                    run = self.ok(client.get("/api/runs/" + run["id"]))
                self.assertEqual(run["status"], "completed", run)
                self.assertEqual(model.calls, 2)
                self.assertTrue(model.saw_real_task_error)
                self.assertEqual(run["error"], "")
                self.assertIn("准备步骤列好了", run["text"])
                with app.state.sessions() as db:
                    tasks = list(db.scalars(select(TaskRecord).where(TaskRecord.user_id == user["id"])))
                    self.assertEqual(len(tasks), 1, "Validation previews must not leave extra tasks")
                    self.assertEqual(tasks[0].status, "ready")
                    self.assertEqual(tasks[0].version, 1, "A validation preview must not advance task version")
                    self.assertEqual(tasks[0].feedback, [])
                    self.assertEqual(tasks[0].plan["entries"][0]["state"], "pending")
                    memories = list(db.scalars(select(Memory).where(Memory.user_id == user["id"])))
                    self.assertEqual(len(memories), 1)
                    self.assertTrue(memories[0].active)
                    self.assertEqual(memories[0].attributes["source_quote"], "先别买东西")
                    messages = list(db.scalars(select(ChatMessage).where(ChatMessage.run_id == run["id"])))
                    self.assertCountEqual([row.role for row in messages], ["user", "assistant"])
                    source = next(row.id for row in messages if row.role == "user")
                    self.assertEqual(tasks[0].source_message_id, source)
                    self.assertEqual(memories[0].source_message_id, source)
                    self.assertEqual(db.get(Conversation, run["conversation_id"]).context_revision, 0)


if __name__ == "__main__":
    unittest.main()
