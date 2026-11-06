"""Actual SDK/HTTP/SQL plan contracts; people and ownership are simulated.

Only the external model boundary is deterministic. No provider or device calls.
"""
import copy
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

from wujian.api_models import TaskEntry
from wujian.config import Settings
from wujian.database import TaskRecord
from wujian.server import create_app


class ContractModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None, model="offline-plan-contract",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.calls = 0
        self.proposals = []
        self.inputs = []
        self.tools = None

    async def _call_api(self, model_name, messages, **kwargs):
        self.inputs.append(json.dumps(messages, ensure_ascii=False, default=str))
        self.tools = kwargs.get("tools")
        index = self.calls
        self.calls += 1
        if index >= len(self.proposals):
            raise AssertionError("Unexpected SDK retry beyond the supplied repair")
        return ChatResponse(content=[ToolCallBlock(id=f"proposal-{self.calls}",
            name="GenerateStructuredOutput", input=json.dumps(self.proposals[index], ensure_ascii=False))],
            is_last=True, usage=ChatUsage(input_tokens=10, output_tokens=5, time=0))


class AgentPlanContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.model = ContractModel()
        self.app = create_app(Settings(data_dir=Path(self.directory.name), api_key="offline-no-network",
            rea_enabled=False), model_factory=lambda _settings: self.model)
        self.client = TestClient(self.app).__enter__()
        self.user = self.ok(self.client.post("/api/auth/register", json={"username": "plan_contract",
            "display_name": "模拟用户小禾", "password": "offline-fixture-only-123"}))
        self.item = self.ok(self.client.post("/api/items", json={"name": "家里的空白卡片",
            "kind": "nonstandard_object"}))

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def proposal(self, entries, board=None, quote="", legacy=None):
        return {"answer": "先从卡片开始，准备好了再继续。", "story_refs": [], "source_refs": [],
            "learning": {"knowledge_updates": [], "memory_updates": []}, "continuation": {
                "goal": "准备卡片小游戏", "item_ids": [self.item["id"]], "constraints": {},
                "plan": legacy if legacy is not None else {"schema": "interaction/1", "kind": "guidance", "entries": entries},
                "task_id": board["task"]["id"] if board else None,
                "expected_version": board["task"]["version"] if board else None,
                "status": "in_progress" if board else "ready", "feedback_quote": quote, "outcome": "unknown"}}

    def entry(self, identity="fold", state="pending"):
        return {"id": identity, "title": "折一张纸作为起点", "item_id": self.item["id"],
            "group": "step", "note": "尚未试过这个玩法", "state": state}

    def run_turn(self, proposals, text="帮我安排一下卡片小游戏怎么开始。"):
        self.model.proposals = proposals
        run = self.ok(self.client.post("/api/chat", json={"text": text, "item_ids": [self.item["id"]]}))
        deadline = time.monotonic() + 5
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "completed", run)
        with self.app.state.sessions() as db:
            tasks = list(db.scalars(select(TaskRecord).where(TaskRecord.user_id == self.user["id"])))
            self.assertEqual(len(tasks), 1, "Preview/repair must not create extra tasks")
            return copy.deepcopy(tasks[0].plan), copy.deepcopy(tasks[0].feedback)

    def board(self):
        return self.ok(self.client.post("/api/task-boards", json={"goal": "准备卡片小游戏",
            "kind": "guidance", "entries": [self.entry()]}))

    def test_new_proposal_progress_repairs_and_native_schema_exposes_entry_contract(self):
        invalid = self.proposal([self.entry("fold", "ready"), self.entry("find", "not_found"),
            self.entry("keep", "unchanged")])
        repaired = self.proposal([self.entry("fold"), self.entry("find"), self.entry("keep")])
        plan, feedback = self.run_turn([invalid, repaired])
        self.assertEqual(self.model.calls, 2, "Unreported proposal progress must produce a native tool error")
        self.assertIn("pending", self.model.inputs[1])
        self.assertEqual([entry["state"] for entry in plan["entries"]], ["pending"] * 3)
        self.assertEqual(feedback, [])
        parameters = next(tool["function"]["parameters"] for tool in self.model.tools
            if tool.get("function", {}).get("name") == "GenerateStructuredOutput")
        def entry_schemas(value):
            if isinstance(value, dict):
                if "entries" in value.get("properties", {}):
                    yield value["properties"]["entries"]["items"]
                for child in value.values():
                    yield from entry_schemas(child)
            elif isinstance(value, list):
                for child in value:
                    yield from entry_schemas(child)
        nested = next(entry_schemas(parameters))
        expected = TaskEntry.model_json_schema()["properties"]
        for field in ("group", "state"):
            self.assertEqual(nested["properties"][field]["enum"], expected[field]["enum"])

    def test_existing_ui_progress_is_preserved_and_added_entry_starts_pending(self):
        board = self.board()
        board = self.ok(self.client.patch(f"/api/tasks/{board['task']['id']}/entries/fold",
            json={"expected_version": board["task"]["version"], "state": "ready"}))
        old = copy.deepcopy(board["entries"][0])
        invalid = self.proposal([self.entry("fold", "pending"), self.entry("another", "ready")], board)
        repaired = self.proposal([old, self.entry("another")], board)
        plan, feedback = self.run_turn([invalid, repaired], "再给我加一步吧。")
        self.assertEqual(self.model.calls, 2)
        self.assertEqual(plan["entries"][0], old)
        self.assertEqual(plan["entries"][1]["state"], "pending")
        self.assertEqual(feedback, [])

    def test_current_actual_feedback_can_advance_entries_without_claiming_success(self):
        board = self.board()
        quote = "第一张纸折好了，第二步没找到夹子。"
        plan, feedback = self.run_turn([self.proposal([
            self.entry("fold", "ready"), self.entry("find", "not_found")], board, quote)], quote)
        self.assertEqual(self.model.calls, 1)
        self.assertEqual([entry["state"] for entry in plan["entries"]], ["ready", "not_found"])
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["outcome"], "unknown")

    def test_legacy_dictionary_plan_remains_unchanged(self):
        legacy = {"steps": ["折一张卡片"], "notes": {"word": "ready"}}
        plan, feedback = self.run_turn([self.proposal([], legacy=legacy)])
        self.assertEqual(self.model.calls, 1)
        self.assertEqual(plan, legacy)
        self.assertEqual(feedback, [])


if __name__ == "__main__":
    unittest.main()
