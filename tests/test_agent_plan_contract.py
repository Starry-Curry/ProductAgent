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
from wujian.database import SourceRecord, TaskRecord
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
        proposal=self.proposals[index]
        return ChatResponse(content=[ToolCallBlock(id=f"proposal-{self.calls}",
            name=proposal.get("_tool_name","GenerateStructuredOutput"),
            input=json.dumps(proposal.get("_arguments",proposal), ensure_ascii=False))],
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

    def run_turn(self, proposals, text="帮我安排一下卡片小游戏怎么开始。", *, entry_intent="general"):
        self.model.proposals = proposals
        run = self.ok(self.client.post("/api/chat", json={"text": text, "item_ids": [self.item["id"]],
            "entry_context":{"intent":entry_intent}}))
        deadline = time.monotonic() + 8
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "completed", run)
        with self.app.state.sessions() as db:
            tasks = list(db.scalars(select(TaskRecord).where(TaskRecord.user_id == self.user["id"])))
            self.assertEqual(len(tasks), 1, "Preview/repair must not create extra tasks")
            return copy.deepcopy(tasks[0].plan), copy.deepcopy(tasks[0].feedback)

    def board(self, constraints=None):
        return self.ok(self.client.post("/api/task-boards", json={"goal": "准备卡片小游戏",
            "kind": "guidance", "entries": [self.entry()], "constraints":constraints or {}}))

    def stored_constraints(self):
        with self.app.state.sessions() as db:
            return copy.deepcopy(db.scalar(select(TaskRecord).where(
                TaskRecord.user_id == self.user["id"])).constraints)

    def test_short_agent_continuation_keeps_previous_exclusions(self):
        board = self.board({"不购买":True, "不要实验":True})
        proposal = self.proposal([self.entry()], board)
        proposal["continuation"]["constraints"] = {"桌沿":"夹子夹不上"}
        self.run_turn([proposal], "桌沿太厚，夹不上，先换个摆法。")
        self.assertEqual(self.stored_constraints(),
            {"不购买":True, "不要实验":True, "桌沿":"夹子夹不上"})

    def test_constraint_changes_without_feedback_return_native_repair(self):
        board = self.board({"不购买":True})
        invalid = self.proposal([self.entry()], board)
        invalid["continuation"]["constraints"] = {"不购买":None}
        repaired = self.proposal([self.entry()], board)
        self.run_turn([invalid,repaired], "继续上次的玩法。")
        self.assertEqual(self.model.calls,2)
        self.assertEqual(self.stored_constraints(),{"不购买":True})

    def test_explicit_constraint_deletion_survives_rolled_back_native_preview(self):
        board = self.board({"不购买":True,"预算":0})
        quote = "可以买了，预算改成二十元。"
        proposal = self.proposal([self.entry()],board,quote)
        proposal["continuation"]["constraints"] = {"不购买":None,"预算":20}
        self.run_turn([proposal],quote)
        self.assertEqual(self.model.calls,1)
        self.assertEqual(self.stored_constraints(),{"预算":20})

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
        proposal = self.proposal([self.entry("fold", "ready"), self.entry("find")], board, quote)
        proposal["continuation"]["progress_reports"] = [
            {"entry_id":"fold", "action_result":"completed", "source_quote":"第一张纸折好了"}]
        plan, feedback = self.run_turn([proposal], quote)
        self.assertEqual(self.model.calls, 1)
        self.assertEqual([entry["state"] for entry in plan["entries"]], ["ready", "pending"])
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["outcome"], "unknown")
        self.assertEqual(feedback[0]["progress_reports"][0]["entry_id"], "fold")
        self.assertEqual(feedback[0]["progress_reports"][0]["source_quote"], "第一张纸折好了")

    def test_opening_settings_quote_does_not_unlock_version_step(self):
        board = self.ok(self.client.post("/api/task-boards", json={
            "goal":"了解电视的软件版本", "kind":"guidance", "entries":[
                {**self.entry("version"),"title":"查看并报告软件版本"}]}))
        quote="我只打开设置了，里面有通用和关于本机，接下来点哪个？"
        invalid=self.proposal([{**self.entry("version","ready"),"title":"查看并报告软件版本"}],board,quote)
        repaired=copy.deepcopy(invalid)
        repaired["continuation"]["plan"]["entries"][0]["state"]="pending"
        plan, feedback=self.run_turn([invalid,repaired],quote)
        self.assertEqual(self.model.calls,2)
        self.assertEqual(plan["entries"][0]["state"],"pending")
        self.assertNotIn("progress_reports", feedback[0])

    def test_one_entry_report_cannot_change_another_entry_or_new_proposal(self):
        board=self.ok(self.client.post("/api/task-boards",json={
            "goal":"准备纸卡", "kind":"guidance", "entries":[self.entry(),self.entry("second")]}))
        quote="第一张纸折好了，后面的还没开始。"
        invalid=self.proposal([self.entry("fold","ready"),self.entry("second","ready"),self.entry("new","ready")],board,quote)
        invalid["continuation"]["progress_reports"]=[{"entry_id":"fold","action_result":"completed","source_quote":"第一张纸折好了"}]
        repaired=copy.deepcopy(invalid)
        for entry in repaired["continuation"]["plan"]["entries"][1:]:
            entry["state"]="pending"
        plan,_=self.run_turn([invalid,repaired],quote)
        self.assertEqual(self.model.calls,2)
        self.assertEqual([entry["state"] for entry in plan["entries"]],["ready","pending","pending"])

    def test_progress_report_can_change_only_existing_step_and_requires_current_quote(self):
        board=self.board()
        invalid=self.proposal([self.entry()],board)
        invalid["continuation"]["progress_reports"]=[{"entry_id":"fold","action_result":"completed","source_quote":"纸折好了"}]
        repaired=self.proposal([self.entry()],board)
        plan,_=self.run_turn([invalid,repaired],"先等等，纸还没折。")
        self.assertEqual(self.model.calls,2)
        self.assertEqual(plan["entries"][0]["state"],"pending")

    def test_reported_ui_entry_cannot_disappear_when_the_model_abbreviates_plan(self):
        board=self.board()
        board=self.ok(self.client.patch(f"/api/tasks/{board['task']['id']}/entries/fold",json={
            "expected_version":board["task"]["version"],"state":"ready"}))
        plan,_=self.run_turn([self.proposal([self.entry("next")],board)],"下一步怎么做？")
        self.assertEqual({entry["id"]:entry["state"] for entry in plan["entries"]},
                         {"next":"pending","fold":"ready"})

    def test_report_cannot_transfer_completion_to_renamed_action(self):
        board=self.board()
        invalid=self.proposal([{**self.entry("fold","ready"),"title":"把纸剪成小方块"}],board)
        invalid["continuation"]["progress_reports"]=[{"entry_id":"fold","action_result":"completed","source_quote":"纸折好了"}]
        repaired=self.proposal([self.entry()],board)
        plan,_=self.run_turn([invalid,repaired],"纸折好了，但没有剪。")
        self.assertEqual(self.model.calls,2)
        self.assertEqual(plan["entries"][0]["title"],"折一张纸作为起点")

    def test_new_proposal_is_not_execution_even_with_a_current_feedback_quote(self):
        quote="纸我拿出来了。"
        invalid=self.proposal([self.entry("fold","ready")],quote=quote)
        repaired=self.proposal([self.entry("fold")],quote=quote)
        plan,_=self.run_turn([invalid,repaired],quote)
        self.assertEqual(self.model.calls,2)
        self.assertEqual(plan["entries"][0]["state"],"pending")

    def test_report_alone_persists_current_evidence_and_preview_does_not_apply_twice(self):
        board=self.board()
        proposal=self.proposal([self.entry()],board)
        proposal["continuation"]["plan"]["entries"][0]["note"]=""
        proposal["continuation"]["progress_reports"]=[{
            "entry_id":"fold","action_result":"completed","source_quote":"纸折好了"}]
        plan,feedback=self.run_turn([proposal],"纸折好了，后面的还没弄。")
        self.assertEqual(self.model.calls,1)
        self.assertEqual(plan["entries"][0]["state"],"ready")
        self.assertEqual(plan["entries"][0]["note"],board["entries"][0]["note"])
        self.assertEqual(len(feedback),1)
        self.assertEqual(feedback[0]["progress_reports"][0]["entry_title"],"折一张纸作为起点")

    def test_a_report_cannot_claim_completion_of_a_new_entry(self):
        board=self.board()
        quote="纸我拿出来了。"
        invalid=self.proposal([self.entry(),self.entry("new","ready")],board,quote)
        invalid["continuation"]["progress_reports"]=[{
            "entry_id":"new","action_result":"completed","source_quote":quote}]
        repaired=self.proposal([self.entry(),self.entry("new")],board,quote)
        plan,_=self.run_turn([invalid,repaired],quote)
        self.assertEqual(self.model.calls,2)
        self.assertEqual([entry["state"] for entry in plan["entries"]],["pending","pending"])

    def test_legacy_dictionary_plan_remains_unchanged(self):
        legacy = {"steps": ["折一张卡片"], "notes": {"word": "ready"}}
        plan, feedback = self.run_turn([self.proposal([], legacy=legacy)])
        self.assertEqual(self.model.calls, 1)
        self.assertEqual(plan, legacy)
        self.assertEqual(feedback, [])

    def source(self, identity):
        with self.app.state.sessions() as db:
            db.add(SourceRecord(id=identity,owner_id=self.user["id"],origin="upload",
                title="原作者笔记",url="",content="成功读取以后才交给模型的独特正文",pages=[]))
            db.commit()

    def test_creative_bare_citation_requires_successful_native_read(self):
        identity="unread-bare-source"
        self.source(identity)
        proposal=self.proposal([self.entry()])
        proposal["source_refs"]=[identity]
        self.run_turn([proposal,{"_tool_name":"read_source","_arguments":{"source_id":identity}},proposal],
            entry_intent="creative")
        self.assertEqual(self.model.calls,3)
        self.assertIn("尚未实际读取",self.model.inputs[1])
        self.assertIn("成功读取以后才交给模型的独特正文",self.model.inputs[2])

    def test_creative_inline_citation_cannot_bypass_reading(self):
        identity="a"*32
        self.source(identity)
        invalid=self.proposal([self.entry()])
        invalid["answer"]+=f"[{identity}]"
        repaired=self.proposal([self.entry()])
        self.run_turn([invalid,repaired],entry_intent="creative")
        self.assertEqual(self.model.calls,2)
        self.assertIn("尚未实际读取",self.model.inputs[1])

    def test_failed_navigation_read_does_not_grant_citation_permission(self):
        identity="unavailable-navigation"
        self.source(identity)
        invalid=self.proposal([self.entry()])
        invalid["source_refs"]=[identity]
        repaired=self.proposal([self.entry()])
        self.run_turn([{"_tool_name":"read_source","_arguments":{"source_id":identity,"link_query":""}},
            invalid,repaired],entry_intent="creative")
        self.assertEqual(self.model.calls,3)
        self.assertIn("尚未实际读取",self.model.inputs[2])
        self.assertNotIn("成功读取以后才交给模型的独特正文",self.model.inputs[1])


if __name__ == "__main__":
    unittest.main()
