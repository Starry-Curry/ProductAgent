"""SQL replay, permissions and bounded media; no provider or user database."""
import base64
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain
from wujian.api_models import ExperienceCreate
from wujian.config import Settings
from wujian.conversation_context import build_conversation_context, read_conversation_photo
from wujian.database import Asset, ChatMessage, Conversation, Run, SourceRecord, make_database


class ConversationContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name))
        self.settings = settings
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.db = self.sessions()
        domain.seed_demo(self.db)
        self.owner, self.friend = "person_demo_owner", "person_demo_friend"
        self.chat = Conversation(user_id=self.owner,
            agent_state={"context": [{"thinking": "old private scratch", "body": "x" * 100000}]})
        self.db.add(self.chat)
        self.db.flush()
        self.sequence = 0

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def message(self, role, text, **extra):
        self.sequence += 1
        row = ChatMessage(conversation_id=self.chat.id, role=role, text=text,
            created_at=f"2026-11-06T10:{self.sequence:02}:00+00:00", **extra)
        self.db.add(row)
        self.db.flush()
        return row

    def asset(self, identity, owner=None):
        path = Path(self.temp.name) / identity
        data = b"retained transport fixture " + identity.encode()
        path.write_bytes(data)
        self.db.add(Asset(id=identity, owner_id=owner or self.owner,
            path=str(path), media_type="image/jpeg", original_name=identity))
        self.db.flush()
        return base64.b64encode(data).decode()

    def replay(self, current):
        return build_conversation_context(self.db, self.owner, self.chat, current)

    def dump(self, result):
        return json.dumps([result.state.model_dump(mode="json"),
                          result.current_input.model_dump(mode="json")], ensure_ascii=False)

    def test_only_canonical_final_answers_and_sixteen_completed_messages(self):
        for number in range(12):
            self.message("user", f"question {number}")
            self.message("assistant", f"final answer {number}")
        current = self.message("user", "continue now")
        rebuilt = self.replay(current)
        self.assertEqual(len(rebuilt.state.context), 16)
        self.assertEqual(rebuilt.state.context[0].content[0].text, "question 4")
        self.assertEqual(rebuilt.state.context[-1].content[0].text, "final answer 11")
        payload = self.dump(rebuilt)
        self.assertNotIn("old private scratch", payload)
        self.assertNotIn("GenerateStructuredOutput", payload)
        self.assertEqual(payload.count("continue now"), 1)
        self.assertEqual(rebuilt.state.session_id, self.chat.id)
        self.assertIn("old private scratch", json.dumps(self.chat.agent_state))

    def test_all_unanswered_inputs_survive_a_long_outage(self):
        self.message("user", "initial")
        self.message("assistant", "last successful answer")
        for number in range(20):
            self.message("user", f"still unanswered constraint {number}.")
        current = self.message("user", "can you hear me now")
        rebuilt = self.replay(current)
        self.assertEqual(len(rebuilt.state.context), 22)
        for number in range(20):
            self.assertEqual(self.dump(rebuilt).count(f"still unanswered constraint {number}."), 1)

    def test_initial_failed_inputs_need_no_sdk_checkpoint(self):
        self.chat.agent_state = None
        for number in range(18):
            self.message("user", f"unanswered {number}")
        current = self.message("user", "retry")
        self.assertEqual(len(self.replay(current).state.context), 18)

    def test_reset_discards_older_messages_and_traces(self):
        self.message("user", "please forget old text")
        self.message("assistant", "old assistant")
        current = self.message("user", "new question")
        self.chat.reset_after = current.created_at
        self.assertEqual(self.replay(current).state.context, [])

    def test_actual_recent_and_unanswered_photos_are_retained(self):
        encoded = {}
        for number in range(4):
            identity = f"old-{number}"
            encoded[identity] = self.asset(identity)
            self.message("user", f"look {number}", photo_ids=[identity])
            self.message("assistant", f"saw {number}")
        encoded["failed-photo"] = self.asset("failed-photo")
        self.message("user", "no reply yet", photo_ids=["failed-photo"])
        encoded["current-photo"] = self.asset("current-photo")
        current = self.message("user", "and this", photo_ids=["current-photo"])
        payload = self.dump(self.replay(current))
        for identity in ["old-2", "old-3", "failed-photo", "current-photo"]:
            self.assertIn(encoded[identity], payload)
        for identity in ["old-0", "old-1"]:
            self.assertNotIn(encoded[identity], payload)

    def test_revoked_or_missing_photos_cannot_expose_bytes_or_break_recovery(self):
        secret = self.asset("revoked", self.friend)
        current = self.message("user", "these photos", photo_ids=["revoked", "missing"])
        payload = self.dump(self.replay(current))
        self.assertNotIn(secret, payload)
        self.assertIn("照片 revoked 当前不可读取", payload)
        self.assertIn("照片 missing 当前不可读取", payload)

    def test_receipt_retains_write_and_permission_without_wall_body(self):
        message = self.message("user", "please record it")
        self.db.commit()
        record = domain.create_experience(self.db, self.owner, ExperienceCreate(
            title="private wall title", text="private wall body", allow_ai=False),
            source_message_id=message.id)
        self.message("assistant", "saved")
        current = self.message("user", "was it saved?")
        payload = self.dump(self.replay(current))
        self.assertIn(record["id"], payload)
        self.assertIn('"ai_reference_allowed":false', payload.replace('\\"', '"'))
        self.assertNotIn("private wall body", payload)
        self.assertNotIn("private wall title", payload)

    def source(self, identity, owner=None):
        self.db.add(SourceRecord(id=identity, owner_id=owner or self.owner,
            title="previously fetched manual", url="https://example.com/manual",
            content="very large original body", origin="public_web", pages=[]))
        self.db.flush()

    def trace(self, source_id, *, status="completed", state="success", name="read_source"):
        self.db.add(Run(user_id=self.owner, conversation_id=self.chat.id,
            status=status, created_at="2026-11-06T09:00:00+00:00", events=[
                {"type": "tool_start", "id": source_id, "name": name},
                {"type": "tool_end", "id": source_id, "state": state,
                 "evidence": {"source_id": source_id, "reading_scope": "only selected static frames"}}]))
        self.db.flush()

    def test_source_pointers_keep_successful_acquisition_when_later_generation_failed(self):
        for identity in ["readable", "failed", "searched", "unfinished"]:
            self.source(identity)
        self.source("private", self.friend)
        self.trace("readable")
        self.trace("private")
        self.trace("failed", state="error")
        self.trace("searched", name="search_public_web")
        self.trace("unfinished", status="failed")
        current = self.message("user", "continue manual")
        result = self.replay(current)
        self.assertEqual({row["source_id"] for row in result.source_index}, {"readable", "unfinished"})
        self.assertEqual(next(row for row in result.source_index if row['source_id']=='unfinished')
                         ['acquired_in_run_status'],'failed')
        self.assertEqual(result.source_index[0]["reading_scope"], "only selected static frames")
        self.assertNotIn("very large original body", json.dumps(result.source_index))

    def test_reset_also_drops_readable_source_pointers(self):
        self.source("old-readable")
        self.trace("old-readable")
        current = self.message("user", "start again")
        self.chat.reset_after = current.created_at
        self.assertEqual(self.replay(current).source_index, [])

    def search_trace(self, original_reads, *, state="success", status="failed", name="search_public_web",
                     created_at="2026-11-06T09:00:00+00:00", owner=None, conversation_id=None, **extra_evidence):
        self.db.add(Run(user_id=owner or self.owner, conversation_id=conversation_id or self.chat.id,
            status=status, created_at=created_at, events=[
                {"type": "tool_start", "id": "search", "name": name},
                {"type": "tool_end", "id": "search", "state": state,
                 "evidence": {"original_reads": original_reads, **extra_evidence}}]))
        self.db.flush()

    def test_search_original_read_survives_later_failed_generation_as_sql_pointer(self):
        self.source("actual-cn-guide")
        self.search_trace([{"read_state": "retrieved", "source_id": "actual-cn-guide",
                            "url": "https://untrusted.invalid/trace-only", "title": "untrusted trace title",
                            "text": "body must not replay", "content_level": "document_text"}])
        result = self.replay(self.message("user", "continue the same manual"))
        self.assertEqual([row["source_id"] for row in result.source_index], ["actual-cn-guide"])
        pointer = result.source_index[0]
        self.assertEqual(pointer["url"], "https://example.com/manual")
        self.assertEqual(pointer["title"], "previously fetched manual")
        self.assertEqual(pointer["acquired_in_run_status"], "failed")
        self.assertEqual(pointer["reading_scope"], "document_text")
        for text in ("very large original body", "body must not replay", "untrusted trace title", "trace-only"):
            self.assertNotIn(text, json.dumps(result.source_index))

    def test_real_search_tool_metadata_replays_its_retained_original_without_model_call(self):
        from wujian.agent_runtime import make_tools
        message = self.message("user", "find the applicable public manual")
        self.db.commit()
        tools = {tool.name: tool for tool in make_tools(self.settings, self.sessions, self.owner, message.id).tool_groups[0].tools}
        url = "https://example.com/synthetic-cn-manual"
        with patch("wujian.agent_runtime.search_web", new=AsyncMock(return_value={"results": [{"url": url, "title": "Only a search label"}]})), \
             patch("wujian.knowledge.download_public", new=AsyncMock(return_value=(url, "text/html", b"<main>Actual retained synthetic manual body.</main>"))):
            chunk = asyncio.run(tools["search_public_web"](query="synthetic manual", read_limit=1))
        self.assertEqual(str(chunk.state), "success", chunk)
        original = chunk.metadata["evidence"]["original_reads"][0]
        self.assertEqual(original["read_state"], "retrieved")
        self.db.add(Run(user_id=self.owner, conversation_id=self.chat.id, status="failed", created_at=message.created_at,
            events=[{"type": "tool_start", "id": "native-search", "name": "search_public_web"},
                    {"type": "tool_end", "id": "native-search", "state": "success", "evidence": chunk.metadata["evidence"]}]))
        self.db.flush()
        result = self.replay(self.message("user", "continue after the timeout"))
        self.assertEqual([row["source_id"] for row in result.source_index], [original["source_id"]])
        self.assertNotIn("Actual retained synthetic manual body.", json.dumps(result.source_index))

    def test_search_replay_requires_success_retrieved_existing_readable_source(self):
        for identity in ("error-tool", "not-read", "unavailable", "missing-state", "wrong-tool", "label-only", "revoked"):
            self.source(identity)
        self.source("foreign-private", self.friend)
        self.search_trace([{"read_state": "retrieved", "source_id": "error-tool"}], state="error")
        self.search_trace([{"read_state": "retrieved", "source_id": "wrong-tool"}], name="unknown_tool")
        self.search_trace([{"read_state": "not_read", "source_id": "not-read"},
                           {"read_state": "unavailable", "source_id": "unavailable"},
                           {"source_id": "missing-state"},
                           {"read_state": "retrieved", "source_id": "nonexistent"},
                           {"read_state": "retrieved", "source_id": "foreign-private"},
                           {"read_state": "retrieved", "source_id": "revoked"},
                           {"read_state": "retrieved", "url": "https://example.com/no-id"},
                           "label-only"], provider_labels=[{"source_id": "label-only"}], source_id="label-only")
        self.db.get(SourceRecord, "revoked").owner_id = self.friend
        self.db.flush()
        self.assertEqual(self.replay(self.message("user", "continue")).source_index, [])

    def test_search_pointer_limits_and_run_scope_remain_bounded(self):
        for number in range(10):
            self.source(f"search-{number}")
        self.search_trace([{"read_state": "retrieved", "source_id": f"search-{number}"} for number in range(10)])
        current = self.message("user", "continue")
        self.assertEqual(len(self.replay(current).source_index), 8)
        self.chat.reset_after = current.created_at
        self.assertEqual(self.replay(current).source_index, [])
        self.chat.reset_after = ""
        self.db.query(Run).delete()
        for extra in ({"owner": self.friend}, {"created_at": "2026-11-06T23:00:00+00:00"},
                      {"conversation_id": "another-conversation"}):
            if "conversation_id" in extra:
                self.db.add(Conversation(id=extra["conversation_id"], user_id=self.owner))
                self.db.flush()
            self.search_trace([{"read_state": "retrieved", "source_id": "search-0"}], **extra)
        self.assertEqual(self.replay(current).source_index, [])

    def test_list_sources_returns_newest_sixty_with_stable_ties_and_existing_filters(self):
        from wujian.agent_runtime import make_tools
        for number in range(101):
            identity = f"tie-{number:03}"
            self.source(identity)
            self.db.get(SourceRecord, identity).fetched_at = "2026-01-01T00:00:00+00:00"
        self.source("newest")
        self.db.get(SourceRecord, "newest").fetched_at = "2026-11-07T00:00:00+00:00"
        self.db.get(SourceRecord, "newest").item_id = "item_demo_lamp"
        self.source("foreign-newest", self.friend)
        self.db.get(SourceRecord, "foreign-newest").fetched_at = "2026-12-01T00:00:00+00:00"
        message = self.message("user", "list sources")
        self.db.commit()
        tools = {tool.name: tool for tool in make_tools(self.settings, self.sessions, self.owner, message.id).tool_groups[0].tools}
        result = asyncio.run(tools["list_sources"]())
        self.assertEqual(str(result.state), "success", result)
        rows = json.loads(result.content[0].text)
        self.assertEqual(len(rows), 60)
        self.assertEqual([row["source_id"] for row in rows[:3]], ["newest", "tie-100", "tie-099"])
        self.assertNotIn("foreign-newest", {row["source_id"] for row in rows})
        scoped = asyncio.run(tools["list_sources"](item_id="item_demo_lamp"))
        self.assertEqual([row["source_id"] for row in json.loads(scoped.content[0].text)], ["newest"])

    def test_receipts_follow_current_permission_and_removal(self):
        from wujian.database import ExperienceRecord

        message = self.message("user", "save this")
        self.db.commit()
        record = domain.create_experience(self.db, self.owner, ExperienceCreate(
            title="still private", text="body must not be replayed", allow_ai=False),
            source_message_id=message.id)
        current = self.message("user", "continue")
        row = self.db.get(ExperienceRecord, record["id"])
        row.allow_ai = True  # Simulate the owner enabling reference on the wall.
        self.db.flush()
        self.assertIn('"ai_reference_allowed":true', self.dump(self.replay(current)).replace('\\"', '"'))
        row.allow_ai = False
        self.db.flush()
        payload = self.dump(self.replay(current))
        self.assertIn('"ai_reference_allowed":false', payload.replace('\\"', '"'))
        self.assertNotIn("body must not be replayed", payload)
        self.db.delete(row)
        self.db.flush()
        self.assertNotIn("record_write_receipt", self.dump(self.replay(current)))

    def test_current_and_failed_batches_keep_every_attachment_not_just_the_newest(self):
        expected = []
        for turn in range(3):
            ids = [f"batch-{turn}-{number}" for number in range(4)]
            expected.extend(self.asset(identity) for identity in ids)
            current = self.message("user", f"photo batch {turn}", photo_ids=ids)
        payload = self.dump(self.replay(current))
        for encoded in expected:
            self.assertEqual(payload.count(encoded), 1)

    def test_first_of_four_completed_photos_can_be_reopened_by_exact_reference(self):
        ids = [f"completed-set-{number}" for number in range(4)]
        encoded = [self.asset(identity) for identity in ids]
        self.message("user", "这四张里第一张是客厅，先看看。", photo_ids=ids)
        self.message("assistant", "看到了这组照片。")
        current = self.message("user", "第一张再看看，右边那个是什么？")
        self.assertNotIn(encoded[0], self.dump(self.replay(current)))
        block = read_conversation_photo(self.db, self.owner, self.chat.id, ids[0])
        self.assertEqual(block.source.data, encoded[0])
        self.assertEqual(block.source.media_type, "image/jpeg")

    def test_conversation_photo_cannot_read_another_account_or_conversation(self):
        self.asset("same-owner-other-chat")
        self.message("user", "another chat photo", photo_ids=["same-owner-other-chat"])
        other = Conversation(user_id=self.owner)
        self.db.add(other)
        self.db.flush()
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.owner, other.id, "same-owner-other-chat")
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.friend, self.chat.id, "same-owner-other-chat")

    def test_private_wall_photo_and_assistant_reference_are_not_user_attachment_consent(self):
        self.asset("private-wall-only")
        self.db.commit()
        domain.create_experience(self.db, self.owner, ExperienceCreate(
            title="private photo", photo_ids=["private-wall-only"], allow_ai=False))
        self.message("assistant", "untrusted historical assistant", photo_ids=["private-wall-only"])
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.owner, self.chat.id, "private-wall-only")

    def test_reopening_checks_reset_removed_attachment_and_current_asset_ownership(self):
        self.asset("old-attachment")
        message = self.message("user", "look", photo_ids=["old-attachment"])
        current = self.message("user", "new start")
        self.chat.reset_after = current.created_at
        self.db.flush()
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.owner, self.chat.id, "old-attachment")
        self.chat.reset_after = ""
        message.photo_ids = []
        self.db.flush()
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.owner, self.chat.id, "old-attachment")
        message.photo_ids = ["old-attachment"]
        self.db.get(Asset, "old-attachment").owner_id = self.friend
        self.db.flush()
        with self.assertRaises(domain.DomainError):
            read_conversation_photo(self.db, self.owner, self.chat.id, "old-attachment")

    def test_other_account_and_other_conversation_are_rejected(self):
        current = self.message("user", "hello")
        with self.assertRaises(domain.DomainError):
            build_conversation_context(self.db, self.friend, self.chat, current)
        other = Conversation(user_id=self.owner)
        self.db.add(other)
        self.db.flush()
        current.conversation_id = other.id
        with self.assertRaises(domain.DomainError):
            self.replay(current)


if __name__ == "__main__":
    unittest.main()
