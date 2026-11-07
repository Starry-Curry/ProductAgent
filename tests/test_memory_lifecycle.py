"""Adversarial memory journeys using temporary SQL databases, never model calls.

People, ownership and conversations below are fictional. These checks establish
bounded source/literal suppression, not arbitrary semantic erasure or AI quality.
"""

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, make_database
from wujian.learning import Learning, apply_learning
from wujian.retrieval import authorized_documents


class MemoryLifecycleAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.owner = "person_demo_owner"
        self.friend = "person_demo_friend"
        self.clock = datetime(2026, 11, 6, 10, tzinfo=timezone.utc)
        with self.sessions() as db:
            domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def exchange(self, db, question, answer="好的。", conversation_id=None, user_id=None):
        if conversation_id is None:
            conversation = Conversation(user_id=user_id or self.owner)
            db.add(conversation)
            db.flush()
            conversation_id = conversation.id
        self.clock += timedelta(seconds=1)
        question_row = ChatMessage(conversation_id=conversation_id, role="user",
            text=question, created_at=self.clock.isoformat())
        db.add(question_row)
        db.flush()
        self.clock += timedelta(seconds=1)
        db.add(ChatMessage(conversation_id=conversation_id, role="assistant",
            text=answer, created_at=self.clock.isoformat()))
        db.commit()
        return question_row.id, conversation_id

    def remember(self, db, message_id, content, context="物品来源", kind="meaning", user_id=None):
        message = db.get(ChatMessage, message_id)
        return foundation.revise_memory(db, user_id or self.owner, message_id, content,
            attributes={"kind": kind, "context": context, "source_quote": message.text})

    def projected_exchanges(self, user_id=None):
        return {document["id"]: document["data"] for document in
            authorized_documents(self.sessions, user_id or self.owner).values()
            if document["kind"] == "conversation"}

    def test_identical_words_in_different_situations_do_not_overwrite_each_other(self):
        with self.sessions() as db:
            first, _ = self.exchange(db, "睡前读书我喜欢暖光。")
            second, _ = self.exchange(db, "拍照背景我也喜欢暖光。")
            left = self.remember(db, first, "喜欢暖光", "睡前读书", "preference")
            right = self.remember(db, second, "喜欢暖光", "拍照背景", "preference")
            self.assertNotEqual(left["id"], right["id"])
            retained = [row for row in domain.recall(db, self.owner) if row["content"] == "喜欢暖光"]
            self.assertEqual({row["attributes"]["context"] for row in retained}, {"睡前读书", "拍照背景"})

    def test_same_situation_repeated_is_idempotent(self):
        with self.sessions() as db:
            first, _ = self.exchange(db, "睡前读书我喜欢暖光。")
            second, _ = self.exchange(db, "还是那样，睡前读书我喜欢暖光。")
            left = self.remember(db, first, "喜欢暖光", "睡前读书", "preference")
            right = self.remember(db, second, "喜欢暖光", "睡前读书", "preference")
            self.assertEqual(left["id"], right["id"])

    def test_forgetting_one_context_does_not_erase_another_active_context(self):
        with self.sessions() as db:
            reading, _ = self.exchange(db, "睡前读书我喜欢暖光。")
            photography, _ = self.exchange(db, "拍照背景我也喜欢暖光。")
            old = self.remember(db, reading, "喜欢暖光", "睡前读书", "preference")
            retained = self.remember(db, photography, "喜欢暖光", "拍照背景", "preference")
            domain.remove_memory(db, self.owner, old["id"])
            current_ids = {row["id"] for row in domain.recall(db, self.owner)}
            self.assertIn(retained["id"], current_ids)
        projected = self.projected_exchanges()
        self.assertNotIn(reading, projected)
        self.assertIn(photography, projected)

    def test_different_kinds_with_same_text_are_not_silently_merged(self):
        with self.sessions() as db:
            message, _ = self.exchange(db, "这次只能用家里的东西。")
            constraint = self.remember(db, message, "只用已有物品", "周末拍照", "constraint")
            goal = self.remember(db, message, "只用已有物品", "周末拍照", "goal")
            self.assertNotEqual(constraint["id"], goal["id"])

    def test_forgetting_repeated_quote_does_not_delete_unrelated_exchange(self):
        with self.sessions() as db:
            original, conversation_id = self.exchange(db, "这块石头是我和小雨在青岛捡的。")
            unrelated, _ = self.exchange(db, "台灯放在书房左边的桌上。", conversation_id=conversation_id)
            repeated, _ = self.exchange(db, "说到那块石头，这块石头是我和小雨在青岛捡的。")
            memory = self.remember(db, original, "石头是和小雨在青岛捡的")
            domain.remove_memory(db, self.owner, memory["id"])
        projected = self.projected_exchanges()
        self.assertNotIn(original, projected)
        self.assertNotIn(repeated, projected)
        self.assertIn(unrelated, projected)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ChatMessage, original))
            self.assertIsNotNone(db.get(ChatMessage, repeated))

    def test_forgotten_content_in_assistant_echo_does_not_reenter_projection(self):
        with self.sessions() as db:
            original, _ = self.exchange(db, "我不想把杯子上小雨写的字磨掉。")
            memory = self.remember(db, original, "不想磨掉杯子上的字")
            echo, _ = self.exchange(db, "你帮我想个摆法。", "考虑到你不想磨掉杯子上的字，可以先只调整摆放。")
            domain.remove_memory(db, self.owner, memory["id"])
        self.assertNotIn(echo, self.projected_exchanges())

    def test_literal_content_normalization_handles_spacing_and_punctuation(self):
        with self.sessions() as db:
            original, _ = self.exchange(db, "这块石头来自青岛。")
            memory = self.remember(db, original, "这块石头来自青岛")
            repeated, _ = self.exchange(db, "这块石头，来自 青岛！")
            domain.remove_memory(db, self.owner, memory["id"])
        self.assertNotIn(repeated, self.projected_exchanges())

    def test_correction_keeps_new_report_and_other_old_context(self):
        with self.sessions() as db:
            original, conversation_id = self.exchange(db, "任何时候我都只喜欢暖黄光。")
            unrelated, _ = self.exchange(db, "拍照时可以挪动那盏灯。", conversation_id=conversation_id)
            memory = self.remember(db, original, "任何时候都只喜欢暖黄光", "所有场景", "preference")
            correction, _ = self.exchange(db, "补充一下，做手工我用白光，睡前读书才用暖光。")
            corrected = foundation.revise_memory(db, self.owner, correction,
                "做手工用白光，睡前读书用暖光", supersedes_id=memory["id"],
                attributes={"kind": "preference", "context": "手工与阅读", "source_quote": "做手工我用白光，睡前读书才用暖光"})
            self.assertFalse(db.get(Memory, memory["id"]).active)
            self.assertEqual(corrected["supersedes_id"], memory["id"])
        projected = self.projected_exchanges()
        self.assertNotIn(original, projected)
        self.assertIn(correction, projected)
        self.assertIn(unrelated, projected)

    def test_correction_quoting_old_words_is_not_discarded_as_retired_history(self):
        with self.sessions() as db:
            original, _ = self.exchange(db, "我只喜欢暖光。")
            memory = self.remember(db, original, "只喜欢暖光", "灯光", "preference")
            correction, _ = self.exchange(db, "之前说的‘我只喜欢暖光’不准确，做手工我更喜欢白光。")
            foundation.revise_memory(db, self.owner, correction,
                "做手工更喜欢白光", supersedes_id=memory["id"],
                attributes={"kind": "preference", "context": "做手工", "source_quote": "做手工我更喜欢白光"})
        projected = self.projected_exchanges()
        self.assertNotIn(original, projected)
        self.assertIn(correction, projected)

    def test_forgetting_is_scoped_to_one_person(self):
        with self.sessions() as db:
            original, _ = self.exchange(db, "我睡前喜欢暖光。")
            friend_message, _ = self.exchange(db, "我睡前喜欢暖光。", user_id=self.friend)
            memory = self.remember(db, original, "睡前喜欢暖光", "阅读", "preference")
            domain.remove_memory(db, self.owner, memory["id"])
        self.assertIn(friend_message, self.projected_exchanges(self.friend))

    def test_learning_forget_uses_original_evidence_not_only_withdrawal_request(self):
        with self.sessions() as db:
            original, _ = self.exchange(db, "这块石头是和小雨在青岛捡的。")
            repeated, _ = self.exchange(db, "那次的来源是这块石头是和小雨在青岛捡的。")
            memory = self.remember(db, original, "石头和小雨在青岛捡的")
            request, _ = self.exchange(db, "那段来源以后别再用来了解我了。")
            learning = Learning.model_validate({"knowledge_updates": [], "memory_updates": [{
                "operation": "forget", "memory_id": memory["id"], "content": "",
                "kind": "meaning", "context": "物品来源", "basis": "user_report",
                "source_quote": "那段来源以后别再用来了解我了。"}]})
            apply_learning(db, self.owner, request, learning)
            db.commit()
        self.assertNotIn(repeated, self.projected_exchanges())

    def test_legacy_memory_without_quote_still_suppresses_original_and_exact_content(self):
        with self.sessions() as db:
            original, conversation_id = self.exchange(db, "这个杯子有一段很私人的来历。")
            unrelated, _ = self.exchange(db, "杯子平时放书房。", conversation_id=conversation_id)
            repeated, _ = self.exchange(db, "那段很私人的来历")
            memory = foundation.revise_memory(db, self.owner, original, "那段很私人的来历")
            domain.remove_memory(db, self.owner, memory["id"])
        projected = self.projected_exchanges()
        self.assertNotIn(original, projected)
        self.assertNotIn(repeated, projected)
        self.assertIn(unrelated, projected)

    def test_history_rows_are_preserved_after_personal_understanding_is_removed(self):
        with self.sessions() as db:
            message, conversation_id = self.exchange(db, "这个杯子让我想起毕业那天。")
            memory = self.remember(db, message, "杯子让人想起毕业那天")
            before = list(db.scalars(select(ChatMessage.id).where(ChatMessage.conversation_id == conversation_id)))
            domain.remove_memory(db, self.owner, memory["id"])
            after = list(db.scalars(select(ChatMessage.id).where(ChatMessage.conversation_id == conversation_id)))
            self.assertEqual(before, after)
            self.assertNotIn(memory["id"], [row["id"] for row in domain.recall(db, self.owner)])

    def test_repeated_evidence_does_not_lose_earlier_source_on_forgetting(self):
        with self.sessions() as db:
            first, _ = self.exchange(db, "读书的时候开暖色的灯更舒服。")
            second, _ = self.exchange(db, "睡前还是开暖光吧。")
            old = self.remember(db, first, "暖光", "睡前阅读", "preference")
            latest = self.remember(db, second, "暖光", "睡前阅读", "preference")
            self.assertEqual(old["id"], latest["id"])
            domain.remove_memory(db, self.owner, latest["id"])
        projected = self.projected_exchanges()
        self.assertNotIn(first, projected)
        self.assertNotIn(second, projected)

    def test_explicit_new_correction_can_return_to_a_previously_superseded_preference(self):
        with self.sessions() as db:
            first, _ = self.exchange(db, "读书的时候我更喜欢暖光。")
            a = self.remember(db, first, "读书喜欢暖光", "读书", "preference")
            second, _ = self.exchange(db, "最近读书我改用白光，感觉清楚一点。")
            b = foundation.revise_memory(db, self.owner, second, "读书喜欢白光",
                supersedes_id=a["id"], attributes={"kind": "preference", "context": "读书",
                    "source_quote": "最近读书我改用白光，感觉清楚一点。"})
            third, _ = self.exchange(db, "试了一阵还是换回来，读书我更喜欢暖光。")
            c = foundation.revise_memory(db, self.owner, third, "读书喜欢暖光",
                supersedes_id=b["id"], attributes={"kind": "preference", "context": "读书",
                    "source_quote": "读书我更喜欢暖光"})
            current = [row for row in domain.recall(db, self.owner)
                if row["attributes"].get("context") == "读书"]
            self.assertEqual([row["content"] for row in current], ["读书喜欢暖光"])
            self.assertEqual(c.get("source_message_id"), third)
            self.assertFalse(db.get(Memory, b["id"]).active)


if __name__ == "__main__":
    unittest.main()
