"""Shared domestic lamp changes while another user's Agent is reasoning.

Real FastAPI, AgentScope tool orchestration and temporary SQLite; controllable
offline model only. The MJTD01SYL identity is real, ownership/reports fictional.
"""

import asyncio
import json
import re
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import Settings
from wujian import foundation
from wujian.database import ChatMessage, Conversation, Grant, KnowledgeClaim, Memory, TaskRecord
from wujian.server import create_app
from wujian.turns import commit_result as actual_commit_result


class StateGate:
    def __init__(self, modes):
        self.modes = iter(modes)
        self.item_id = ""
        self.read_finished = threading.Event()
        self.release = threading.Event()
        self.reader_observed_available = False
        self.memory_id = None

    def factory(self, _settings):
        return StateModel(self, next(self.modes))


class StateModel(ChatModelBase):
    def __init__(self, control, mode):
        super().__init__(credential=None, model="offline-state-continuity",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.control, self.mode, self.calls = control, mode, 0

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.calls == 1:
            name, arguments = "read_item", {"item_id": self.control.item_id}
            if self.mode == "writer":
                name = "update_item_condition"
                arguments.update(changes={"availability": "unavailable",
                    "presentation": {"attention": "paused", "note": "台灯坏了，请先别用"}},
                    source_quote="台灯坏了，先暂停使用", expected_version=1)
            elif self.mode == "identity":
                name = "update_item_identity"
                arguments.update(name="书房的米家台灯1S", product={"brand": "米家", "model": "MJTD01SYL", "market": "CN"},
                    basis="user_report")
        else:
            if self.mode == "reader":
                observed = json.dumps(messages, ensure_ascii=False, default=str)
                self.control.reader_observed_available = bool(re.search(
                    r'availability[\\"\s:]+available', observed))
                self.control.read_finished.set()
                while not self.control.release.is_set():
                    await asyncio.sleep(0.01)
            name = "GenerateStructuredOutput"
            arguments = {"answer": "已把台灯记为暂停使用，处理前先别用。" if self.mode == "writer"
                else "台灯现在可用，可以用它布置阅读角。", "learning": {"knowledge_updates": [], "memory_updates": []},
                "story_refs": [], "source_refs": [], "continuation": None}
            if self.mode in {"reader", "atomic_failure"}:
                arguments["continuation"] = {"goal": "用当前可用台灯布置阅读角",
                    "item_ids": [self.control.item_id], "constraints": {}, "task_id": None,
                    "expected_version": None, "plan": {"schema": "interaction/1", "kind": "guidance",
                    "entries": [{"id": "lamp", "title": "打开台灯开始阅读", "item_id": self.control.item_id,
                        "group": "step", "note": "刚才读取的台灯可用", "state": "pending"}]}}
                if self.mode == "atomic_failure":
                    arguments["learning"] = {
                        "memory_updates": [{"operation": "add", "content": "布置阅读角不能往墙上打孔",
                            "item_id": self.control.item_id, "kind": "constraint", "context": "阅读角布置",
                            "basis": "user_report", "source_quote": "不要往墙上打孔"}],
                        "knowledge_updates": [{"item_id": self.control.item_id, "content": "这盏台灯当前放在书房",
                            "kind": "observation", "basis": "user_report", "scope": "item",
                            "source_quote": "台灯放书房",
                            "conditions": {"requirements": [], "limits": [], "unknowns": []}}]}
            elif self.mode == "learning":
                arguments["answer"] = "好，读书时按你现在的偏好用白光。"
                arguments["learning"]["memory_updates"] = [{"operation": "replace",
                    "memory_id": self.control.memory_id, "item_id": self.control.item_id,
                    "content": "读书改用白光", "kind": "preference", "context": "读书",
                    "basis": "user_report", "source_quote": "读书改用白光，之前说暖光不准确"}]
            elif self.mode == "identity":
                arguments["answer"] = "已核对并更新为书房的米家台灯1S。"
        return ChatResponse(content=[ToolCallBlock(id=f"{self.mode}-{self.calls}", name=name,
            input=json.dumps(arguments, ensure_ascii=False))], is_last=True,
            usage=ChatUsage(input_tokens=10, output_tokens=5, time=0))


class StateContinuityTests(unittest.TestCase):
    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def finished(self, client, run):
        deadline = time.monotonic() + 5
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(0.02)
            run = self.ok(client.get("/api/runs/" + run["id"]))
        self.assertNotIn(run["status"], {"queued", "running"}, run)
        return run

    def run_shared_journey(self, access, mutation="agent"):
        control = StateGate(["reader", "writer"] if mutation == "agent" else ["reader"])
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=control.factory)
            with TestClient(app) as owner:
                friend = TestClient(app)
                # Two cookie jars, one running ASGI event loop. A bare second
                # TestClient creates a per-request portal and cancels its
                # background Agent when that request exits, hiding this race.
                friend.portal = owner.portal
                try:
                    self.ok(owner.post("/api/auth/demo/xiaolin"))
                    self.ok(friend.post("/api/auth/demo/xiaoxia"))
                    item = self.ok(owner.post("/api/items", json={"name": "书房米家台灯1S",
                        "product": {"brand": "米家", "commercial_name": "米家台灯1S", "model": "MJTD01SYL", "market": "CN"},
                        "state": {"availability": "available"}}))
                    control.item_id = item["id"]
                    if access == "household":
                        house = self.ok(owner.post("/api/households", json={"name": "模拟共同的家"}))
                        self.ok(owner.post(f"/api/households/{house['id']}/items", json={"item_id": item["id"]}))
                        self.ok(owner.post(f"/api/households/{house['id']}/invitations", json={"user_id": "person_demo_friend"}))
                        self.ok(friend.post(f"/api/households/{house['id']}/accept"))
                        with app.state.sessions() as db:
                            self.assertIsNone(db.get(Grant, (item["id"], "person_demo_friend")))
                    else:
                        self.ok(owner.post(f"/api/items/{item['id']}/shares", json={"user_id": "person_demo_friend"}))
                    reader = self.ok(friend.post("/api/chat", json={"text": "这盏灯能用吗？帮我布置个阅读角。",
                        "item_ids": [item["id"]]}))
                    self.assertTrue(control.read_finished.wait(5), "reader did not finish actual read_item")
                    self.assertTrue(control.reader_observed_available, "reader did not receive the old available state")
                    with app.state.sessions() as db:
                        before = db.get(Conversation, reader["conversation_id"]).context_revision
                    if mutation == "agent":
                        writer = self.ok(owner.post("/api/chat", json={"text": "台灯坏了，先暂停使用",
                            "item_ids": [item["id"]]}))
                        writer = self.finished(owner, writer)
                        self.assertEqual(writer["status"], "completed", writer)
                    else:
                        self.ok(owner.put("/api/items/" + item["id"], json={
                            **{key: item[key] for key in ("name", "kind", "product", "description", "photo_id")},
                            "avatar": {key: item["avatar"][key] for key in ("enabled", "nickname", "personality", "color")},
                            "state": {"availability": "unavailable", "presentation": {"attention": "paused"}},
                            "expected_version": item["version"]}))
                        writer = {"status": "HTTP item edit 200"}
                    updated = self.ok(friend.get("/api/items/" + item["id"]))
                    self.assertEqual(updated["state"]["availability"], "unavailable")
                    with app.state.sessions() as db:
                        after = db.get(Conversation, reader["conversation_id"]).context_revision
                    control.release.set()
                    reader = self.finished(friend, reader)
                    with app.state.sessions() as db:
                        stale_tasks = list(db.scalars(select(TaskRecord).where(
                            TaskRecord.user_id == "person_demo_friend",
                            TaskRecord.goal == "用当前可用台灯布置阅读角")))
                        conversation = db.get(Conversation, reader["conversation_id"])
                        observed = {"access": access, "reader_revision_before": before,
                            "reader_revision_after": after, "writer_status": writer["status"],
                            "reader_status": reader["status"], "reader_text": reader["text"],
                            "stale_plan_count": len(stale_tasks), "reader_agent_state_saved": bool(conversation.agent_state)}
                    self.assertFalse("台灯现在可用" in reader["text"] or stale_tasks or after <= before,
                        "outdated shared-state result was delivered/committed: " + json.dumps(observed, ensure_ascii=False))
                finally:
                    control.release.set()
                    friend.close()

    def test_household_only_reader_does_not_receive_pre_change_plan(self):
        self.run_shared_journey("household")

    def test_direct_grant_reader_is_protected_even_after_context_revision_changes(self):
        self.run_shared_journey("grant")

    def test_http_item_editor_change_cancels_household_readers_old_reasoning(self):
        self.run_shared_journey("household", mutation="http_editor")

    def test_state_reporting_run_is_not_cancelled_by_its_own_tool_write(self):
        control = StateGate(["writer"])
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=control.factory)
            with TestClient(app) as owner:
                self.ok(owner.post("/api/auth/demo/xiaolin"))
                item = self.ok(owner.post("/api/items", json={"name": "米家台灯1S",
                    "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"},
                    "state": {"availability": "available"}}))
                control.item_id = item["id"]
                run = self.ok(owner.post("/api/chat", json={"text": "台灯坏了，先暂停使用", "item_ids": [item["id"]]}))
                run = self.finished(owner, run)
                self.assertEqual(run["status"], "completed", run)
                self.assertIn("暂停使用", run["text"])

    def test_identity_tool_own_revision_is_acknowledged_without_cancelling_its_reply(self):
        control = StateGate(["identity"])
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=control.factory)
            with TestClient(app) as owner:
                self.ok(owner.post("/api/auth/demo/xiaolin"))
                item = self.ok(owner.post("/api/items", json={"name": "刚录的台灯",
                    "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"}}))
                control.item_id = item["id"]
                run = self.ok(owner.post("/api/chat", json={"text": "这是米家台灯1S，放在书房，帮我把名字改好。",
                    "item_ids": [item["id"]]}))
                run = self.finished(owner, run)
                self.assertEqual(run["status"], "completed", run)
                updated = self.ok(owner.get("/api/items/" + item["id"]))
                self.assertEqual(updated["name"], "书房的米家台灯1S")
                self.assertEqual(updated["version"], 2)

    def test_final_learning_correction_does_not_cancel_its_own_acknowledgement(self):
        control = StateGate(["learning"])
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=control.factory)
            with TestClient(app) as owner:
                self.ok(owner.post("/api/auth/demo/xiaolin"))
                item = self.ok(owner.post("/api/items", json={"name": "米家台灯1S",
                    "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"}}))
                control.item_id = item["id"]
                with app.state.sessions() as db:
                    old = foundation.revise_memory(db, "person_demo_owner", "earlier-fictional-report",
                        "读书喜欢暖光", item_id=item["id"], attributes={"kind": "preference", "context": "读书",
                            "source_quote": "我读书喜欢暖光"})
                    control.memory_id = old["id"]
                run = self.ok(owner.post("/api/chat", json={"text": "读书改用白光，之前说暖光不准确",
                    "item_ids": [item["id"]]}))
                run = self.finished(owner, run)
                self.assertEqual(run["status"], "completed", run)
                memories = self.ok(owner.get("/api/memories"))
                current = [row["content"] for row in memories if row["item_id"] == item["id"]]
                self.assertEqual(current, ["读书改用白光"])

    def test_final_reply_failure_rolls_back_already_flushed_plan_and_learning(self):
        control = StateGate(["atomic_failure"])
        flushed = {}

        def fail_after_real_business_flush(db, user_id, message_id, result, question, **kwargs):
            actual_commit_result(db, user_id, message_id, result, question, **kwargs)
            # This is after the actual SQL business functions and flush, not
            # a mocked plan/memory writer or merely a call-count assertion.
            flushed["commit_argument"] = kwargs.get("commit", True)
            flushed["plans"] = len(list(db.scalars(select(TaskRecord).where(
                TaskRecord.user_id == user_id, TaskRecord.goal == "用当前可用台灯布置阅读角"))))
            flushed["memories"] = len(list(db.scalars(select(Memory).where(Memory.item_id == control.item_id))))
            flushed["knowledge"] = len(list(db.scalars(select(KnowledgeClaim).where(KnowledgeClaim.item_id == control.item_id))))
            raise RuntimeError("synthetic reply-save failure after real business flush")

        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=control.factory)
            with TestClient(app) as owner:
                self.ok(owner.post("/api/auth/demo/xiaolin"))
                item = self.ok(owner.post("/api/items", json={"name": "书房米家台灯1S",
                    "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"},
                    "state": {"availability": "available"}}))
                control.item_id = item["id"]
                with patch("wujian.agent_runtime.commit_result", side_effect=fail_after_real_business_flush), \
                     self.assertLogs("wujian.agent_runtime", level="ERROR"):
                    run = self.ok(owner.post("/api/chat", json={"text": "台灯放书房，帮我布置阅读角，不要往墙上打孔。",
                        "item_ids": [item["id"]]}))
                    run = self.finished(owner, run)
                self.assertEqual(flushed, {"commit_argument": False, "plans": 1, "memories": 1, "knowledge": 1})
                self.assertEqual(run["status"], "failed", run)
                self.assertEqual(run["text"], "")
                with app.state.sessions() as db:
                    self.assertEqual(list(db.scalars(select(TaskRecord).where(
                        TaskRecord.goal == "用当前可用台灯布置阅读角"))), [])
                    self.assertEqual(list(db.scalars(select(Memory).where(Memory.item_id == item["id"]))), [])
                    self.assertEqual(list(db.scalars(select(KnowledgeClaim).where(KnowledgeClaim.item_id == item["id"]))), [])
                    messages = list(db.scalars(select(ChatMessage).where(
                        ChatMessage.conversation_id == run["conversation_id"])))
                    self.assertEqual([message.role for message in messages], ["user"])
