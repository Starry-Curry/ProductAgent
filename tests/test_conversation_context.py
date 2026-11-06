"""SQL replay, permissions and bounded media; no provider or user database."""
import base64
import json
import tempfile
import unittest
from pathlib import Path

from wujian import domain
from wujian.api_models import ExperienceCreate
from wujian.config import Settings
from wujian.conversation_context import build_conversation_context, read_conversation_photo
from wujian.database import Asset, ChatMessage, Conversation, Run, SourceRecord, make_database


class ConversationContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name))
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
