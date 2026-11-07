"""A retried forget must not interrupt a later chat or rewrite retirement.

Actual HTTP, AgentScope and temporary SQL with a gated offline provider boundary.
Sony SRS-XB100 is a domestic model; people, ownership and dialogue are fixtures.
"""
import asyncio
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from fastapi.testclient import TestClient

from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory
from wujian.memory_lifecycle import history_policy
from wujian.server import create_app


class WaitingModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None, model="offline-forget-retry",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.entered = threading.Event()
        self.gate = None

    async def _call_api(self, model_name, messages, **kwargs):
        self.gate = asyncio.Event()
        self.entered.set()
        await self.gate.wait()
        value = {"answer": "好，我们就从今天的事聊起。", "continuation": None,
            "learning": {"knowledge_updates": [], "memory_updates": []}}
        return ChatResponse(content=[ToolCallBlock(id="reply-after-forget",
            name="GenerateStructuredOutput", input=json.dumps(value, ensure_ascii=False))], is_last=True)


class ForgetRetryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.model = WaitingModel()
        self.app = create_app(Settings(data_dir=Path(self.directory.name),
            api_key="offline-no-provider", rea_enabled=False), model_factory=lambda _: self.model)
        self.client = TestClient(self.app).__enter__()
        self.ok(self.client.post("/api/auth/demo/xiaolin"))
        self.owner = "person_demo_owner"
        item = self.ok(self.client.post("/api/items", json={"name": "桌上的索尼音箱（模拟拥有）",
            "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
        self.item_id = item["id"]
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.owner, item_ids=[self.item_id])
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="这阵子晚上别给我推荐外放的玩法。")
            db.add(message)
            db.flush()
            self.memory = foundation.revise_memory(db, self.owner, message.id,
                "这阵子晚上不外放", item_id=self.item_id,
                attributes={"kind": "constraint", "context": "最近晚上使用音箱", "source_quote": message.text})

    def tearDown(self):
        if self.model.gate is not None:
            self.client.portal.call(self.model.gate.set)
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def forget(self):
        return self.ok(self.client.delete("/api/memories/" + self.memory["id"]))

    def snapshot(self):
        with self.app.state.sessions() as db:
            row = db.get(Memory, self.memory["id"])
            conversations = {row.id: (row.context_revision, row.reset_after)
                for row in db.query(Conversation).filter_by(user_id=self.owner)}
            return json.loads(json.dumps(row.attributes)), conversations

    def waiting_chat(self):
        run = self.ok(self.client.post("/api/chat", json={"text": "今天想聊聊路上遇到的一件小事。", "item_ids": [self.item_id]}))
        self.assertTrue(self.model.entered.wait(3))
        return run

    def finish(self, run):
        self.client.portal.call(self.model.gate.set)
        deadline = time.monotonic() + 5
        current = self.ok(self.client.get("/api/runs/" + run["id"]))
        while current["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            current = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(current["status"], "completed", current)

    def test_http_retry_preserves_retirement_and_later_running_chat(self):
        self.forget()
        run = self.waiting_chat()
        before = self.snapshot()
        self.assertEqual(self.forget(), {"status": "removed"})
        self.assertEqual(self.ok(self.client.get("/api/runs/" + run["id"]))["status"], "running")
        self.assertEqual(self.snapshot(), before)
        self.assertNotIn(self.memory["id"], [row["id"] for row in self.ok(self.client.get("/api/memories"))])
        self.ok(self.client.post("/api/auth/demo/xiaoxia"))
        self.assertEqual(self.client.delete("/api/memories/" + self.memory["id"]).status_code, 404)
        self.ok(self.client.post("/api/auth/demo/xiaolin"))
        self.finish(run)

    def test_retry_with_a_previously_loaded_active_row_does_not_interrupt_new_chat(self):
        with self.app.state.sessions() as stale:
            loaded = stale.get(Memory, self.memory["id"])
            self.assertTrue(loaded.active)
            self.forget()
            run = self.waiting_chat()
            before = self.snapshot()
            # Reproduce a duplicate request that read active=True before the
            # first deletion committed, then resumes after a later chat starts.
            self.assertTrue(loaded.active)
            domain.remove_memory(stale, self.owner, loaded.id)
            self.assertEqual(self.ok(self.client.get("/api/runs/" + run["id"]))["status"], "running")
            self.assertEqual(self.snapshot(), before)
        self.finish(run)

    def test_stale_session_forget_retains_newly_accumulated_evidence(self):
        with self.app.state.sessions() as stale:
            loaded = stale.get(Memory, self.memory["id"])
            self.assertEqual(len(loaded.attributes["evidence"]), 1)
            with self.app.state.sessions() as newer:
                conversation = Conversation(user_id=self.owner, item_ids=[self.item_id])
                newer.add(conversation)
                newer.flush()
                message = ChatMessage(conversation_id=conversation.id, role="user", text="晚上还是先别外放，怕吵到隔壁。")
                newer.add(message)
                newer.flush()
                message_id = message.id
                latest = foundation.revise_memory(newer, self.owner, message.id,
                    "这阵子晚上不外放", item_id=self.item_id,
                    attributes={"kind": "constraint", "context": "最近晚上使用音箱", "source_quote": message.text})
                self.assertEqual(latest["id"], self.memory["id"])
            self.assertEqual(len(loaded.attributes["evidence"]), 1, "Reproduce the earlier loaded evidence")
            domain.remove_memory(stale, self.owner, loaded.id)
        with self.app.state.sessions() as db:
            retired = db.get(Memory, self.memory["id"])
            evidence_ids = {row["message_id"] for row in retired.attributes["evidence"]}
            self.assertEqual(evidence_ids, {self.memory["source_message_id"], message_id})
            self.assertFalse(retired.active)
            self.assertTrue(evidence_ids <= history_policy(db, self.owner).source_ids)

    def test_old_superseded_id_does_not_rewrite_retirement_or_forget_its_replacement(self):
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.owner, item_ids=[self.item_id])
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="现在只有工作日晚上需要安静，周末白天可以放歌。")
            db.add(message)
            db.flush()
            replacement = foundation.revise_memory(db, self.owner, message.id,
                "工作日晚上不外放", item_id=self.item_id, supersedes_id=self.memory["id"],
                attributes={"kind": "constraint", "context": "工作日晚上使用音箱", "source_quote": message.text})
        run = self.waiting_chat()
        before = self.snapshot()
        self.assertEqual(before[0]["retirement"]["reason"], "superseded")
        self.forget()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.ok(self.client.get("/api/runs/" + run["id"]))["status"], "running")
        self.assertIn(replacement["id"], [row["id"] for row in self.ok(self.client.get("/api/memories"))])
        self.finish(run)
