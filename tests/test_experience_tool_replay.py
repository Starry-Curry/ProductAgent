"""Recording-tool retries share an originating user message, not global text.

The installed AgentScope FunctionTool adapter executes the actual make_tools
recording operation against real HTTP users/items and temporary SQLite.
No paid model, network, production database or source modification is used.
"""

import asyncio
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ExperienceRecord
from wujian.server import create_app


class ExperienceToolReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), rea_enabled=False,
            api_key="offline-no-network"))
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()
        self.user = self.ok(self.client.post("/api/auth/register", json={
            "username": "record_replay", "display_name": "模拟记录者",
            "password": "offline-fixture-only-123"}))
        self.item = self.ok(self.client.post("/api/items", json={
            "name": "外婆送的围巾", "kind": "nonstandard_object"}))
        self.payload = {"title": "找回围巾", "text": "把外婆送的围巾从旧箱子里找出来了。",
            "item_ids": [self.item["id"]], "occurred_on": "", "photo_ids": []}

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def message(self, text):
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.user["id"], title=text,
                item_ids=[self.item["id"]], entry_context={"intent": "general"})
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text=text)
            db.add(message)
            db.commit()
            return message.id

    def record(self, message_id, payload=None, *, user_id=None):
        # Rebuild the toolkit to model a resumed execution with a new SDK tool
        # instance. Scope remains the actual persisted originating message.
        toolkit = make_tools(self.app.state.settings, self.app.state.sessions,
            user_id or self.user["id"], message_id)
        tool = next(tool for tool in toolkit.tool_groups[0].tools if tool.name == "record_experience")
        reply = asyncio.run(tool(**(payload or self.payload)))
        return reply, json.loads(reply.content[0].text) if str(reply.state) == "success" else None

    def records(self):
        with self.app.state.sessions() as db:
            return list(db.scalars(select(ExperienceRecord).where(
                ExperienceRecord.creator_id == self.user["id"])))

    def test_same_message_same_record_payload_is_idempotent_across_toolkit_recreation(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        first, recorded = self.record(message)
        second, replayed = self.record(message)
        self.assertEqual(str(first.state), "success")
        self.assertEqual(str(second.state), "success")
        self.assertEqual(recorded["id"], replayed["id"],
            "Same originating message/payload was replayed into a second wall record")
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(recorded["result_kind"], "wall_write_receipt")
        self.assertFalse(recorded["allow_ai"])
        self.assertNotIn("text",recorded)

    def test_same_words_from_a_new_user_message_are_allowed_as_a_new_record(self):
        first = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        second = self.message("再帮我单独记一份：把外婆送的围巾从旧箱子里找出来了。")
        _, one = self.record(first)
        _, two = self.record(second)
        self.assertNotEqual(one["id"], two["id"])
        self.assertEqual(len(self.records()), 2)

    def test_one_message_can_ask_for_two_genuinely_different_records(self):
        message = self.message("帮我分开记两件事：找回了外婆的围巾；把围巾洗干净收进了抽屉。")
        _, one = self.record(message)
        _, two = self.record(message, {**self.payload, "title": "收好围巾",
            "text": "把围巾洗干净收进了抽屉。"})
        self.assertNotEqual(one["id"], two["id"])
        self.assertEqual(len(self.records()), 2)

    def test_deleted_record_is_not_resurrected_by_retry_of_its_old_message(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        _, recorded = self.record(message)
        self.ok(self.client.request("DELETE", f"/api/experiences/{recorded['id']}",
            json={"expected_version": recorded["version"]}))
        self.assertEqual(len(self.records()), 0)
        self.record(message)
        self.assertEqual(len(self.records()), 0,
            "Retry of the old recording request silently recreated a deleted memory-wall entry")

    def test_concurrent_identical_replays_wait_on_one_actual_record_transaction(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        with self.app.state.sessions() as db:
            engine = db.get_bind()
        start = threading.Barrier(2)
        second_begin = threading.Event()
        attempts_lock = threading.Lock()
        attempts = []
        overlapped = []

        def before_cursor(conn, cursor, statement, parameters, context, executemany):
            if statement.strip().upper() == "BEGIN IMMEDIATE":
                with attempts_lock:
                    attempts.append(threading.get_ident())
                    if len(attempts) == 2:
                        second_begin.set()

        def after_cursor(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO EXPERIENCES"):
                # The first writer has really inserted but has not committed.
                # Hold it until the second SDK caller attempts BEGIN IMMEDIATE.
                overlapped.append(second_begin.wait(3))

        def caller():
            start.wait(3)
            return self.record(message)

        event.listen(engine, "before_cursor_execute", before_cursor)
        event.listen(engine, "after_cursor_execute", after_cursor)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(caller)
                second = pool.submit(caller)
                replies = [first.result(timeout=8), second.result(timeout=8)]
        finally:
            event.remove(engine, "before_cursor_execute", before_cursor)
            event.remove(engine, "after_cursor_execute", after_cursor)
        self.assertEqual(overlapped, [True], "Did not exercise overlapping real write attempts")
        self.assertEqual(len(set(attempts)), 2)
        for reply, _ in replies:
            self.assertEqual(str(reply.state), "success", reply)
        self.assertEqual(replies[0][1]["id"], replies[1][1]["id"])
        self.assertEqual(len(self.records()), 1)
        with self.app.state.sessions() as db:
            receipts = db.get(ChatMessage, message).recorded_experiences
            self.assertEqual(list(receipts.values()), [replies[0][1]["id"]])

    def test_commit_failure_rolls_back_both_flushed_record_and_receipt(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        with self.app.state.sessions() as db:
            engine = db.get_bind()
        observed = {}

        def fail_after_actual_flush(db):
            if db.get_bind() is not engine:
                return
            db.flush()
            # Both business writes really reached SQLite in this transaction;
            # the injected fault is immediately before its durable commit.
            rows = list(db.scalars(select(ExperienceRecord).where(
                ExperienceRecord.creator_id == self.user["id"])))
            receipts = db.get(ChatMessage, message).recorded_experiences
            observed.update(record_count=len(rows), receipt_count=len(receipts))
            raise RuntimeError("controlled failure before durable recording commit")

        event.listen(Session, "before_commit", fail_after_actual_flush)
        try:
            reply, _ = self.record(message)
        finally:
            event.remove(Session, "before_commit", fail_after_actual_flush)
        self.assertEqual(str(reply.state), "error")
        self.assertEqual(observed, {"record_count": 1, "receipt_count": 1})
        with self.app.state.sessions() as db:
            self.assertEqual(list(db.scalars(select(ExperienceRecord).where(
                ExperienceRecord.creator_id == self.user["id"]))), [])
            self.assertEqual(db.get(ChatMessage, message).recorded_experiences, {})
        retried, result = self.record(message)
        self.assertEqual(str(retried.state), "success")
        self.assertEqual(len(self.records()), 1)
        with self.app.state.sessions() as db:
            self.assertEqual(list(db.get(ChatMessage, message).recorded_experiences.values()), [result["id"]])

    def test_replay_after_ai_withdrawal_and_edit_does_not_reveal_or_overwrite_new_words(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        _, recorded = self.record(message)
        stored=next(row for row in self.ok(self.client.get('/api/experiences')) if row['id']==recorded['id'])
        changed = self.ok(self.client.put(f"/api/experiences/{recorded['id']}", json={
            "title": stored["title"], "text": stored["text"], "item_ids": stored["item_ids"],
            "photo_ids": [], "occurred_on": None, "allow_ai": True,
            "expected_version": recorded["version"]}))
        _,allowed_replay=self.record(message)
        self.assertEqual(allowed_replay['status'],'already_recorded')
        self.assertEqual(allowed_replay['version'],changed['version'])
        private_text = "只放在回忆墙的新文字：围巾让我想起一件还不想与分身说的家事。"
        edited = self.ok(self.client.put(f"/api/experiences/{recorded['id']}", json={
            "title": "我自己留着的新标题", "text": private_text, "item_ids": stored["item_ids"],
            "photo_ids": [], "occurred_on": None, "allow_ai": False,
            "expected_version": changed["version"]}))
        reply, replayed = self.record(message)
        self.assertEqual(str(reply.state), "success")
        self.assertEqual(replayed['id'], recorded['id'])
        self.assertEqual(replayed['status'],'already_recorded')
        self.assertEqual(replayed['version'],edited['version'])
        self.assertFalse(replayed['allow_ai'])
        self.assertNotIn('text',replayed)
        rendered = json.dumps([block.model_dump(mode="json") for block in reply.content], ensure_ascii=False)
        self.assertNotIn(private_text, rendered)
        self.assertNotIn(edited["title"], rendered)
        with self.app.state.sessions() as db:
            rows = list(db.scalars(select(ExperienceRecord).where(
                ExperienceRecord.creator_id == self.user["id"])))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].text, private_text)
            self.assertEqual(rows[0].title, edited["title"])
            self.assertEqual(rows[0].version, edited["version"])
            self.assertFalse(rows[0].allow_ai)
            self.assertEqual(list(db.get(ChatMessage, message).recorded_experiences.values()), [recorded["id"]])

    def test_another_accounts_source_message_cannot_authorize_recording(self):
        message = self.message("帮我记下：把外婆送的围巾从旧箱子里找出来了。")
        other = TestClient(self.app)
        other.portal = self.client.portal
        try:
            stranger = self.ok(other.post("/api/auth/register", json={
                "username": "different_author", "display_name": "另一模拟用户",
                "password": "offline-fixture-only-123"}))
            # Empty associations keep this failure about source ownership,
            # rather than the unrelated fact that the scarf is not shared.
            reply, result = self.record(message, {**self.payload, "item_ids": []}, user_id=stranger["id"])
            self.assertEqual(str(reply.state), "error")
            self.assertIsNone(result)
            self.assertIn("当前用户的实际消息", reply.content[0].text)
            with self.app.state.sessions() as db:
                self.assertEqual(list(db.scalars(select(ExperienceRecord).where(
                    ExperienceRecord.creator_id.in_([self.user["id"], stranger["id"]])))), [])
                self.assertEqual(db.get(ChatMessage, message).recorded_experiences, {})
        finally:
            other.close()

    def test_conversation_receipt_links_the_real_record_without_granting_private_wall_content(self):
        from wujian.retrieval import authorized_documents
        message=self.message('帮我记下：把外婆送的围巾从旧箱子里找出来了。')
        _,recorded=self.record(message)
        with self.app.state.sessions() as db:
            question=db.get(ChatMessage,message)
            db.add(ChatMessage(conversation_id=question.conversation_id,role='assistant',text='记下了。'))
            db.commit()
        before=authorized_documents(self.app.state.sessions,self.user['id'])
        exchange=before[f'conversation/{message}']['data']
        self.assertEqual(exchange['record_receipts'],[{'experience_id':recorded['id'],
            'reference_kind':'record_write_receipt','ai_reference_allowed':False}])
        self.assertNotIn(f'experience/{recorded["id"]}',before)
        private='只在墙上保留的后来文字，不是原聊天里说过的话。'
        edited=self.ok(self.client.put(f'/api/experiences/{recorded["id"]}',json={
            'title':'另一个私人标题','text':private,'item_ids':[self.item['id']],
            'photo_ids':[],'occurred_on':None,'allow_ai':False,'expected_version':recorded['version']}))
        after=authorized_documents(self.app.state.sessions,self.user['id'])
        self.assertNotIn(private,json.dumps(after,ensure_ascii=False))
        self.assertNotIn(edited['title'],json.dumps(after,ensure_ascii=False))
        self.assertEqual(after[f'conversation/{message}']['data']['record_receipts'],exchange['record_receipts'])
        self.ok(self.client.request('DELETE',f'/api/experiences/{recorded["id"]}',json={'expected_version':edited['version']}))
        deleted=authorized_documents(self.app.state.sessions,self.user['id'])
        self.assertNotIn('record_receipts',deleted[f'conversation/{message}']['data'])
        with self.app.state.sessions() as db:
            self.assertEqual(list(db.get(ChatMessage,message).recorded_experiences.values()),[recorded['id']])


if __name__ == "__main__":
    unittest.main()
