"""Received gift stories through the native final schema and real SQL commit.

People, ownership and stories are synthetic. MJTD01SYL is a domestic product
identity; these tests cover authorization/presentation, not model intelligence
or observed operation of a lamp. No model or network request is made.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import func, select, text

from wujian import domain, foundation, interactions
from wujian.agent_runtime import personal_context
from wujian.api_models import AvatarSpec, ExperienceCreate, GiftAccept, GiftCreate, GiftSurprise, ItemCreate, ProductSpec
from wujian.config import Settings
from wujian.database import Asset, ChatMessage, Conversation, ExperienceRecord, Gift, ItemRecord, Memory, Profile, User, make_database
from wujian.learning import Learning
from wujian.retrieval import authorized_documents
from wujian.turns import TurnResult, commit_result, grounded_turn_schema


class GiftStoryDisplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="")
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.addCleanup(self.engine.dispose)
        self.sender, self.recipient, self.other = "person_demo_owner", "person_demo_friend", "independent-user"
        with self.sessions() as db:
            domain.seed_demo(db)
            db.add(User(id=self.other, username="independent", display_name="模拟第三人", password_hash="not-used"))
            db.commit()
            self.item = domain.create_item(db, self.sender, ItemCreate(
                name="小雨做的陶杯", kind="nonstandard_object",
                avatar=AvatarSpec(enabled=True, nickname="小杯", form="cup", color="#7594a1",
                    personality="温和，慢慢听；不冒充小雨实时本人。")))
            self.lamp = domain.create_item(db, self.sender, ItemCreate(
                name="书房的小米台灯1S", kind="standard_product",
                product=ProductSpec(brand="小米", commercial_name="米家台灯1S", model="MJTD01SYL", market="中国大陆")))
            # The bytes are a synthetic attachment marker; no image analysis is
            # requested. Acceptance must give its copied Asset recipient scope.
            path = Path(self.temp.name) / "selected-photo.jpg"
            path.write_bytes(b"synthetic-photo-not-for-image-analysis")
            photo = Asset(owner_id=self.sender, path=str(path), media_type="image/jpeg", original_name="赠礼选中的照片.jpg")
            db.add(photo)
            db.commit()
            self.photo_id = photo.id
            self.story = domain.create_experience(db, self.sender, ExperienceCreate(
                title="毕业那天留下的蓝点", text="模拟回忆：我在杯底画了一颗蓝点，想让收到它的人想起海。",
                item_ids=[self.item["id"]], photo_ids=[photo.id], occurred_on="2026-06-20", allow_ai=True))
            private = domain.create_experience(db, self.sender, ExperienceCreate(
                title="没有选择随礼物分享", text="赠送者私人秘密：模拟银行柜子暗号。", item_ids=[self.item["id"]], allow_ai=True))
            self.sender_private_story_id = private["id"]
            self.gift = domain.create_gift(db, self.sender, GiftCreate(
                item_id=self.item["id"], recipient_id=self.recipient, message="忙的时候也记得喝点水。",
                experience_ids=[self.story["id"]], avatar=AvatarSpec(**{
                    key: value for key, value in self.item["avatar"].items() if key in AvatarSpec.model_fields}),
                surprises=[GiftSurprise(experience_id=self.story["id"], hint="杯底藏着一点海。", trigger_words=["蓝点", "海"])]))
            domain.accept_gift(db, self.recipient, self.gift["id"], acceptance=GiftAccept(wake_avatar=True, allow_story_ai=True))
            self.received_id = db.scalar(select(ExperienceRecord.id).where(
                ExperienceRecord.creator_id == self.recipient, ExperienceRecord.origin_id == self.story["id"]))

    def message(self, db, *, user=None, role="user", intent="persona", item_ids=None, text="杯底是不是藏着一份给我的小心意？"):
        conversation = Conversation(user_id=user or self.recipient,
            item_ids=[self.item["id"]] if item_ids is None else item_ids, entry_context={"intent": intent})
        db.add(conversation)
        db.flush()
        message = ChatMessage(conversation_id=conversation.id, role=role, text=text)
        db.add(message)
        db.commit()
        return message

    def result(self, **changes):
        values = {"learning": Learning(), "continuation": None,
            "answer": "这点小心意还在，看看原来的记录吧。", "story_refs": [self.received_id]}
        values.update(changes)
        return TurnResult(**values)

    def display(self, message, result=None, *, actor=None, abort_after_render=False):
        """The same final SQL sequence as AgentRunner, without a model call."""
        with self.sessions() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            committed = commit_result(db, actor or self.recipient, message.id,
                result or self.result(), message.text, commit=False)
            db.add(ChatMessage(conversation_id=message.conversation_id, role="assistant", text=committed["answer"]))
            if abort_after_render:
                raise RuntimeError("模拟最终聊天写入前中止")
            db.commit()
            return committed

    def assert_progress(self, expected):
        with self.sessions() as db:
            profile = db.get(Profile, (self.recipient, self.item["id"]))
            self.assertEqual(profile.avatar["gift_memories"][0]["unlocked"], expected)

    def valid_learning(self, message):
        return Learning.model_validate({"memory_updates": [{"operation": "add", "content": "累的时候想先安静听一会儿",
            "item_id": self.item["id"], "kind": "preference", "context": "疲惫的时候", "source_quote": message.text}]})

    def test_native_schema_preview_does_not_persist_display_progress_or_learning(self):
        with self.sessions() as db:
            message = self.message(db, text="累的时候，我想先安静听一会儿。也想看看杯底的故事。")
            version = db.get(ItemRecord, self.item["id"]).version
        proposed = self.result(learning=self.valid_learning(message))
        checked = grounded_turn_schema(self.sessions, self.recipient, message.id).model_validate(proposed.model_dump())
        self.assertEqual(checked.story_refs, [self.received_id])
        self.assert_progress(False)
        with self.sessions() as db:
            self.assertEqual(db.get(ItemRecord, self.item["id"]).version, version)
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory).where(Memory.user_id == self.recipient)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.role == "assistant")), 0)

    def test_invalid_source_rolls_back_learning_and_story_progress_without_answer(self):
        with self.sessions() as db:
            message = self.message(db, text="累的时候，我想先安静听一会儿。也想看看杯底的故事。")
        proposed = self.result(learning=self.valid_learning(message), source_refs=["does-not-exist"])
        with self.assertRaises(domain.DomainError):
            self.display(message, proposed)
        self.assert_progress(False)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory).where(Memory.user_id == self.recipient)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.role == "assistant")), 0)

    def test_invalid_other_final_field_does_not_commit_story_or_learning(self):
        with self.sessions() as db:
            message = self.message(db, text="累的时候，我想先安静听一会儿。也想看看杯底的故事。")
        proposed = self.result(learning=self.valid_learning(message), continuation={
            "goal": "顺便整理杯子的用法", "item_ids": [self.item["id"]], "constraints": {},
            "plan": {"schema": "interaction/1", "kind": "idea", "entries": [{"id": "first", "title": "试一试", "group": "not-a-valid-group"}]},
            "task_id": None, "expected_version": None})
        with self.assertRaises(domain.DomainError):
            self.display(message, proposed)
        self.assert_progress(False)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory).where(Memory.user_id == self.recipient)), 0)

    def test_final_story_display_and_progress_are_atomic_attributed_and_idempotent(self):
        with self.sessions() as db:
            message = self.message(db)
            profile = db.get(Profile, (self.recipient, self.item["id"]))
            profile.avatar = {**profile.avatar, "nickname": "我家的小海", "color": "#a1b2c3",
                "personality": "接收者选择的慢性子", "growth_enabled": False, "growth_dismissed_ids": ["old-trait"]}
            db.commit()
            previous = copy.deepcopy(profile.avatar)
            version = db.get(ItemRecord, self.item["id"]).version
            count = db.scalar(select(func.count()).select_from(ExperienceRecord))
        proposed = self.result(story_refs=[self.received_id, self.received_id])
        rendered = self.display(message, proposed)["answer"]
        self.assertIn(f"来自{self.gift['sender']['display_name']}的记录", rendered)
        self.assertEqual(rendered.count(self.story["text"]), 1)
        self.assertNotIn("你留下的记录", rendered)
        with self.sessions() as db:
            received = db.get(ExperienceRecord, self.received_id)
            self.assertNotEqual(received.photo_ids, [self.photo_id])
            for identity in received.photo_ids:
                self.assertEqual(db.get(Asset, identity).owner_id, self.recipient)
                self.assertIn(f"![这段记录的照片](/api/assets/{identity})", rendered)
            self.assertNotIn(f"/api/assets/{self.photo_id}", rendered)
            expected = copy.deepcopy(previous)
            expected["gift_memories"][0]["unlocked"] = True
            self.assertEqual(db.get(Profile, (self.recipient, self.item["id"])).avatar, expected)
            self.assertEqual(db.get(ItemRecord, self.item["id"]).version, version + 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)), count)
            self.assertEqual(db.scalar(select(ChatMessage.text).where(ChatMessage.conversation_id == message.conversation_id,
                ChatMessage.role == "assistant")), rendered)
        self.display(message, proposed)
        with self.sessions() as db:
            self.assertEqual(db.get(ItemRecord, self.item["id"]).version, version + 1)

    def test_aborted_final_persistence_rolls_back_answer_progress_and_learning_together(self):
        with self.sessions() as db:
            message = self.message(db, text="累的时候，我想先安静听一会儿。也想看看杯底的故事。")
            version = db.get(ItemRecord, self.item["id"]).version
        with self.assertRaisesRegex(RuntimeError, "最终聊天"):
            self.display(message, self.result(learning=self.valid_learning(message)), abort_after_render=True)
        self.assert_progress(False)
        with self.sessions() as db:
            self.assertEqual(db.get(ItemRecord, self.item["id"]).version, version)
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory).where(Memory.user_id == self.recipient)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.role == "assistant")), 0)

    def test_other_valid_conversation_can_display_but_does_not_mark_this_persona(self):
        for kwargs in ({"intent": "general"}, {"item_ids": [self.lamp["id"]]},
                       {"item_ids": [self.item["id"], self.lamp["id"]]}):
            with self.subTest(context=kwargs):
                with self.sessions() as db:
                    message = self.message(db, **kwargs)
                self.assertIn(self.story["text"], self.display(message)["answer"])
                self.assert_progress(False)

    def test_disabled_or_archived_persona_does_not_mark_display_progress(self):
        for condition in ("avatar-disabled", "archived"):
            with self.subTest(condition=condition):
                with self.sessions() as db:
                    message = self.message(db)
                    profile = db.get(Profile, (self.recipient, self.item["id"]))
                    profile.avatar = {**profile.avatar, "enabled": condition != "avatar-disabled"}
                    db.get(ItemRecord, self.item["id"]).archived = condition == "archived"
                    db.commit()
                self.display(message)
                self.assert_progress(False)

    def test_unavailable_story_is_not_rendered_or_marked(self):
        with self.sessions() as db:
            message = self.message(db)
        for condition in ("ai-withdrawn", "deleted"):
            with self.subTest(condition=condition):
                with self.sessions() as db:
                    story = db.get(ExperienceRecord, self.received_id)
                    if condition == "deleted":
                        interactions.delete_experience(db, self.recipient, story.id, story.version)
                    else:
                        story.allow_ai = False
                        db.commit()
                with self.assertRaises(domain.DomainError):
                    self.display(message)
                self.assert_progress(False)

    def test_explicit_plain_acceptance_and_retry_do_not_grant_story_chat(self):
        with self.sessions() as db:
            story = domain.create_experience(db, self.sender, ExperienceCreate(title="台灯下写的便签",
                text="模拟：把愿望写成小纸条，放在台灯下面。", item_ids=[self.lamp["id"]], allow_ai=True))
            gift = domain.create_gift(db, self.sender, GiftCreate(item_id=self.lamp["id"], recipient_id=self.recipient,
                experience_ids=[story["id"]], avatar=AvatarSpec(enabled=True, nickname="小灯"),
                surprises=[GiftSurprise(experience_id=story["id"], hint="灯下有一句话。")]))
            domain.accept_gift(db, self.recipient, gift["id"], acceptance=GiftAccept(wake_avatar=False, allow_story_ai=False))
            received = db.scalar(select(ExperienceRecord).where(ExperienceRecord.creator_id == self.recipient,
                ExperienceRecord.origin_id == story["id"]))
            domain.accept_gift(db, self.recipient, gift["id"], acceptance=GiftAccept(wake_avatar=True, allow_story_ai=True))
            self.assertFalse(db.get(Profile, (self.recipient, self.lamp["id"])).avatar["enabled"])
            self.assertFalse(db.get(ExperienceRecord, received.id).allow_ai)
            message = self.message(db, item_ids=[self.lamp["id"]])
        with self.assertRaises(domain.DomainError):
            self.display(message, self.result(story_refs=[received.id]))

    def test_deleted_story_does_not_leave_an_unfulfillable_hint_on_the_card(self):
        with self.sessions() as db:
            story = db.get(ExperienceRecord, self.received_id)
            interactions.delete_experience(db, self.recipient, story.id, story.version)
            current = domain.item_view(db, self.recipient, domain.accessible_item(db, self.recipient, self.item["id"]))
            self.assertEqual(current["avatar"].get("gift_memories", []), [])
            self.assertEqual(current["avatar"]["nickname"], "小杯")

    def test_revoked_story_hint_stays_on_owner_card_but_is_absent_from_agent_projection(self):
        with self.sessions() as db:
            db.get(ExperienceRecord, self.received_id).allow_ai = False
            db.commit()
            item = domain.item_view(db, self.recipient, domain.accessible_item(db, self.recipient, self.item["id"]))
            hint = self.gift["snapshot"]["surprises"][0]["hint"]
            self.assertEqual(item["avatar"]["gift_memories"][0]["hint"], hint)
            self.assertFalse(item["avatar"]["gift_memories"][0]["chat_allowed"])
            self.assertEqual(domain.agent_item_view(item)["avatar"]["gift_memories"], [])
            self.assertEqual(db.get(Profile, (self.recipient, self.item["id"])).avatar["gift_memories"][0]["hint"], hint)
        documents = json.dumps(authorized_documents(self.sessions, self.recipient), ensure_ascii=False)
        self.assertNotIn(hint, documents)
        self.assertNotIn(self.story["text"], documents)


    def test_transfer_and_display_do_not_copy_private_chats_or_new_recipient_life_back_to_sender(self):
        with self.sessions() as db:
            giver_message = self.message(db, user=self.sender, item_ids=[self.lamp["id"]], text="赠送者未分享的聊天：模拟工作秘密。")
            receiver_message = self.message(db, text="接收者新聊天秘密：今天工作不开心，先别告诉小雨。")
            foundation.revise_memory(db, self.recipient, receiver_message.id,
                "接收者新聊天秘密：工作不开心", item_id=self.item["id"], attributes={"source_quote": receiver_message.text})
            receiver_story = domain.create_experience(db, self.recipient, ExperienceCreate(
                title="接收后的私密一天", text="接收者私人照片故事：模拟搬家后的第一天。", item_ids=[self.item["id"]], allow_ai=True))
            donor_context = json.dumps(personal_context(db, self.sender, [], persona=False), ensure_ascii=False)
            self.assertNotIn(receiver_message.text, donor_context)
            self.assertNotIn(receiver_story["text"], donor_context)
            snapshot = json.dumps(domain.gift_view(db, db.get(Gift, self.gift["id"])), ensure_ascii=False)
            self.assertNotIn(receiver_message.text, snapshot)
            self.assertNotIn(receiver_story["text"], snapshot)
            self.assertNotIn(giver_message.text, snapshot)
            self.assertNotIn("赠送者私人秘密", snapshot)
        self.display(receiver_message)
        donor_docs = json.dumps(authorized_documents(self.sessions, self.sender), ensure_ascii=False)
        receiver_docs = json.dumps(authorized_documents(self.sessions, self.recipient), ensure_ascii=False)
        self.assertNotIn(receiver_message.text, donor_docs)
        self.assertNotIn(receiver_story["text"], donor_docs)
        self.assertNotIn(giver_message.text, receiver_docs)
        self.assertNotIn("赠送者私人秘密", receiver_docs)
        self.assertIn(receiver_story["text"], receiver_docs)

    def test_sharing_received_item_back_exposes_neither_recipient_chat_nor_persona(self):
        with self.sessions() as db:
            message = self.message(db, text="我自己的新默契：下班时叫我小鲸鱼，但不要告诉送礼的人。")
            foundation.revise_memory(db, self.recipient, message.id,
                "接收者私密称呼是小鲸鱼", item_id=self.item["id"], attributes={"source_quote": message.text})
            profile = db.get(Profile, (self.recipient, self.item["id"]))
            profile.avatar = {**profile.avatar, "nickname": "只有我知道的小鲸鱼", "personality": "接收者自己的新性格"}
            db.commit()
            domain.share_item(db, self.recipient, self.item["id"], self.sender)
            shared = domain.item_view(db, self.sender, domain.accessible_item(db, self.sender, self.item["id"]))
            self.assertNotIn("小鲸鱼", json.dumps(shared, ensure_ascii=False))
            self.assertNotIn("接收者自己的新性格", json.dumps(shared, ensure_ascii=False))
            sender_message = self.message(db, user=self.sender)
        with self.assertRaises(domain.DomainError):
            self.display(sender_message, actor=self.sender)
        donor_docs = json.dumps(authorized_documents(self.sessions, self.sender), ensure_ascii=False)
        self.assertNotIn(message.text, donor_docs)
        self.assertNotIn("小鲸鱼", donor_docs)


if __name__ == "__main__":
    unittest.main()
