"""Unanswered SQL chat remains searchable without becoming a completed result.

Actual FastAPI/AgentScope, temporary SQL and keyword-only ReMe. Sony SRS-XB100
is a real domestic model; people, ownership and dialogue are explicit fixtures.
Only the model boundary is offline; no provider, embedding or hardware calls.
"""
import asyncio
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from agentscope.message import ToolCallBlock
from agentscope.model import ChatResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

import test_failed_turn_recovery as recovery
from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ExperienceRecord, Run
from wujian.retrieval import Retrieval, authorized_documents
from wujian.server import create_app


WORDS = "邻居已经睡了，先别外放，也别往墙上粘东西。"
STORY = "今天和小雨一起挑了几首歌，留着周末听。"
PRIVATE_WALL_EDIT = "后来补记：那天其实是为了安慰家里生病的亲人，这段只留墙里。"
OWNER = "person_demo_owner"
FRIEND = "person_demo_friend"


class HistoryControl(recovery.RecoveryControl):
    def __init__(self):
        super().__init__()
        self.mode = "fail"
        self.item_id = ""
        self.waiting = threading.Event()
        self.cancelled = threading.Event()

    def factory(self, settings):
        self.round += 1
        return HistoryModel(self, self.round, self.mode)


class HistoryModel(recovery.RecoveryModel):
    def __init__(self, control, round_number, mode):
        super().__init__(control, round_number)
        self.mode = mode
        self.calls = 0

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.mode == "wait":
            self.control.waiting.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.control.cancelled.set()
                raise
        if self.mode == "record" and self.calls == 1:
            return ChatResponse(content=[ToolCallBlock(id="record-before-terminal-failure",
                name="record_experience", input=json.dumps({"title": "一起挑歌", "text": STORY,
                    "item_ids": [self.control.item_id], "occurred_on": ""}, ensure_ascii=False))], is_last=True)
        if self.mode in {"fail", "record"}:
            raise TimeoutError("Explicit offline failure after the actual user message")
        arguments = {"answer": "好，我们接着聊。", "continuation": None,
            "learning": {"knowledge_updates": [], "memory_updates": []}}
        return ChatResponse(content=[ToolCallBlock(id=f"history-{self.round_number}",
            name="GenerateStructuredOutput", input=json.dumps(arguments, ensure_ascii=False))], is_last=True)


class UnansweredHistoryRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.control = HistoryControl()
        self.app = create_app(Settings(data_dir=Path(self.directory.name),
            api_key="offline-no-provider", rea_enabled=False), model_factory=self.control.factory)
        self.client = TestClient(self.app).__enter__()
        self.ok(self.client.post("/api/auth/demo/xiaolin"))
        item = self.ok(self.client.post("/api/items", json={"name": "书桌上的索尼音箱（模拟拥有）",
            "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
        self.control.item_id = item["id"]
        # Explicit supported keyword mode, independent from the offline model key.
        self.keyword_settings = Settings(data_dir=Path(self.directory.name), api_key="", rea_enabled=False)
        self.retrieval = Retrieval(self.keyword_settings, self.app.state.sessions)

    def tearDown(self):
        self.client.portal.call(self.retrieval.close)
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def terminal(self, mode="fail", text=WORDS):
        self.control.mode = mode
        run = self.ok(self.client.post("/api/chat", json={"text": text,
            "item_ids": [self.control.item_id]}))
        if mode == "wait":
            self.assertTrue(self.control.waiting.wait(3))
            return run
        deadline = time.monotonic() + 5
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "failed", run)
        return run

    def message(self, run):
        with self.app.state.sessions() as db:
            return db.scalar(select(ChatMessage).where(ChatMessage.run_id == run["id"],
                ChatMessage.role == "user"))

    def search(self, user_id=OWNER, query="邻居 外放 墙"):
        result = self.client.portal.call(self.retrieval.search, user_id, query, ["conversation"], 30)
        self.assertEqual(result["mode"], "keyword_only")
        return result["results"]

    def assert_unanswered(self, rows, message, run, text=WORDS):
        hit = next((row for row in rows if row["id"] == message.id), None)
        self.assertIsNotNone(hit, "The terminal unanswered user text is absent from actual ReMe results")
        self.assertEqual(hit["kind"], "conversation")
        value = hit["data"]
        self.assertEqual(value["conversation_id"], run["conversation_id"])
        self.assertEqual(value["user_message_id"], message.id)
        self.assertEqual(value["user_text"], text)
        self.assertFalse(value.get("assistant_text"), "A failed turn must not invent an assistant answer")
        self.assertEqual(value["run_status"], run["status"])
        self.assertEqual(value["evidence_kind"], "historical_unanswered_user_message")
        return value

    def test_failed_original_is_found_in_a_new_conversation_and_after_real_reme_restart(self):
        run = self.terminal()
        message = self.message(run)
        self.control.mode = "success"
        new = self.ok(self.client.post("/api/chat", json={"text": "之前说过那个音箱晚上怎么用，帮我找找。"}))
        self.assertNotEqual(new["conversation_id"], run["conversation_id"])
        self.assert_unanswered(self.search(), message, run)
        self.client.portal.call(self.retrieval.close)
        self.retrieval = Retrieval(self.keyword_settings, self.app.state.sessions)
        self.assert_unanswered(self.search(), message, run)
        self.assertNotIn(message.id, [row["id"] for row in self.search(FRIEND)])
        self.assertEqual(self.client.get("/api/conversations/" + run["conversation_id"] + "/messages").status_code, 200)

    def test_actual_running_turn_is_not_indexed_but_its_cancelled_original_is(self):
        run = self.terminal("wait")
        message = self.message(run)
        self.assertNotIn("conversation/" + message.id, authorized_documents(self.app.state.sessions, OWNER))
        self.assertNotIn(message.id, [row["id"] for row in self.search()])
        self.ok(self.client.post("/api/runs/" + run["id"] + "/cancel"))
        self.assertTrue(self.control.cancelled.wait(3))
        run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "interrupted")
        self.assert_unanswered(self.search(), message, run)

    def test_real_forgetting_policy_removes_previously_indexed_failed_user_text(self):
        run = self.terminal()
        message = self.message(run)
        self.assert_unanswered(self.search(), message, run)
        with self.app.state.sessions() as db:
            memory = foundation.revise_memory(db, OWNER, message.id, "睡觉时间不外放也不粘墙",
                item_id=self.control.item_id,
                attributes={"kind": "constraint", "context": "今晚使用音箱", "source_quote": WORDS})
            domain.remove_memory(db, OWNER, memory["id"])
        self.assertNotIn("conversation/" + message.id, authorized_documents(self.app.state.sessions, OWNER))
        self.assertNotIn(message.id, [row["id"] for row in self.search()])
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(ChatMessage, message.id).text, WORDS)

    def test_queued_and_success_without_an_assistant_are_not_unanswered_terminal_evidence(self):
        with self.app.state.sessions() as db:
            messages = []
            for state in ("queued", "running", "completed"):
                conversation = Conversation(user_id=OWNER, item_ids=[self.control.item_id])
                db.add(conversation)
                db.flush()
                run = Run(conversation_id=conversation.id, user_id=OWNER, status=state)
                db.add(run)
                db.flush()
                message = ChatMessage(conversation_id=conversation.id, run_id=run.id, role="user", text=WORDS)
                db.add(message)
                db.flush()
                messages.append(message.id)
            db.commit()
        docs = authorized_documents(self.app.state.sessions, OWNER)
        self.assertTrue(all("conversation/" + identity not in docs for identity in messages))
        self.assertFalse({row["id"] for row in self.search()} & set(messages))

    def test_failed_real_wall_write_exposes_only_its_receipt_not_the_ai_off_wall_body(self):
        text = WORDS + "帮我记一下，" + STORY
        run = self.terminal("record", text)
        message = self.message(run)
        self.assertEqual(len(message.recorded_experiences), 1)
        identity = next(iter(message.recorded_experiences.values()))
        with self.app.state.sessions() as db:
            story = domain.experience_view(db.get(ExperienceRecord, identity))
        self.assertFalse(story["allow_ai"])
        payload = {key: story[key] for key in ("title", "text", "item_ids", "photo_ids", "occurred_on", "allow_ai")}
        payload.update(text=PRIVATE_WALL_EDIT, expected_version=story["version"])
        self.ok(self.client.put("/api/experiences/" + identity, json=payload))
        value = self.assert_unanswered(self.search(), message, run, text)
        self.assertEqual(value["record_receipts"], [{"experience_id": identity,
            "reference_kind": "record_write_receipt", "ai_reference_allowed": False}])
        docs = authorized_documents(self.app.state.sessions, OWNER)
        self.assertNotIn("experience/" + identity, docs)
        self.assertNotIn(PRIVATE_WALL_EDIT, json.dumps(value, ensure_ascii=False))
        self.assertNotIn(message.id, [row["id"] for row in self.search(FRIEND)])
        with self.app.state.sessions() as db:
            self.assertFalse(db.get(ExperienceRecord, identity).allow_ai)
