"""Evidence, correction and transfer under realistic fictional household reports."""

import tempfile
import unittest
from pathlib import Path

from wujian import domain, foundation
from wujian.api_models import GiftCreate, ItemCreate, ProductSpec
from wujian.config import Settings
from wujian.database import (
    ChatMessage,
    Conversation,
    Memory,
    SourceRecord,
    make_database,
)
from wujian.devices import bind_target, device_context, owned_target
from wujian.evidence import locate_quote
from wujian.turns import TurnResult, commit_result, grounded_turn_schema


class UnderstandingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name))
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.owner, self.friend = "person_demo_owner", "person_demo_friend"
        with self.sessions() as db:
            domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def message(self, db, text):
        chat = Conversation(user_id=self.owner)
        db.add(chat)
        db.flush()
        message = ChatMessage(conversation_id=chat.id, role="user", text=text)
        db.add(message)
        db.commit()
        return message.id

    def headphones(self, db, **kwargs):
        spec = ProductSpec(
            brand="Sony 索尼",
            model="WH-CH720N",
            market="CN",
            edition="大陆版",
            **kwargs,
        )
        return domain.create_item(
            db, self.owner, ItemCreate(name="通勤耳机", product=spec)
        )

    def source(self, db, item):
        # This fixture tests storage boundaries; the separate real-model script
        # fetches the genuine official page and never treats this as live proof.
        source = SourceRecord(
            owner_id=self.owner,
            item_id=item["id"],
            origin="public_web",
            title="WH-CH720N 官方指南测试摘录",
            url="https://helpguide.sony.net/mdr/2966/v1/zh-cn/contents/TP1000777286.html",
            content="WH-CH720N\n当配对后续设备时，按住\n（电源）按钮约5秒钟或以上手动进入配对模式。",
        )
        db.add(source)
        db.commit()
        return source

    def result(self, knowledge=None, memories=None, **kwargs):
        return TurnResult.model_validate(
            {
                "answer": "先按已核对的条件试一次。",
                "continuation": None,
                "learning": {
                    "knowledge_updates": knowledge or [],
                    "memory_updates": memories or [],
                },
                "story_refs": [],
                **kwargs,
            }
        )

    def knowledge(self, item, source, **kwargs):
        return {
            "item_id": item["id"],
            "kind": "procedure",
            "content": "已有配对记录时需手动进入配对模式",
            "conditions": {
                "requirements": ["已具有其他设备的配对信息"],
                "limits": [],
                "unknowns": ["尚未观察这副耳机的实际指示灯"],
            },
            "basis": "document",
            "scope": "product",
            "source_id": source.id,
            "source_quote": "按住（电源）按钮约5秒钟或以上手动进入配对模式。",
            "source_model": "WH-CH720N",
            **kwargs,
        }

    def test_source_urls_and_names_do_not_split_model_or_leak_instance_metadata(self):
        with self.sessions() as db:
            first = self.headphones(db, source_urls=["https://example.org/manual-a"])
            second = self.headphones(db, source_urls=["https://example.org/manual-b"])
            self.assertEqual(first["product_id"], second["product_id"])
            self.assertNotEqual(
                first["product"]["source_urls"], second["product"]["source_urls"]
            )
            changed = self.headphones(db, firmware_version="test-other-version")
            self.assertNotEqual(first["product_id"], changed["product_id"])

    def test_model_learning_preserves_literal_evidence_and_rejects_wrong_model(self):
        with self.sessions() as db:
            item = self.headphones(db)
            source = self.source(db, item)
            message = self.message(db, "旧手机连过，现在想连接新的手机。")
            candidate = self.knowledge(item, source)
            schema = grounded_turn_schema(self.sessions, self.owner, message)
            bad = self.result(
                knowledge=[{**candidate, "source_model": "WH-1000XM5"}]
            ).model_dump()
            with self.assertRaises(domain.DomainError):
                schema.model_validate(bad)
            valid = schema.model_validate(
                self.result(knowledge=[candidate]).model_dump()
            )
            committed = commit_result(
                db, self.owner, message, valid, "旧手机连过，现在想连接新的手机。"
            )
            self.assertEqual(
                committed["learned"]["knowledge"][0]["source_quote"],
                candidate["source_quote"].replace("按住", "按住\n"),
            )
            self.assertEqual(
                len(foundation.known_claims(db, self.owner, item["id"])), 1
            )
            commit_result(
                db, self.owner, message, valid, "旧手机连过，现在想连接新的手机。"
            )
            self.assertEqual(
                len(foundation.known_claims(db, self.owner, item["id"])), 1
            )
            self.assertIsNone(
                locate_quote(source.content, "按钮约7秒钟或以上手动进入配对模式。")
            )
            anchored = self.knowledge(
                item, source, source_quote="", source_line_start=3, source_line_end=3
            )
            checked = schema.model_validate(
                self.result(knowledge=[anchored]).model_dump()
            )
            self.assertEqual(
                checked.learning.knowledge_updates[0].source_quote,
                "（电源）按钮约5秒钟或以上手动进入配对模式。",
            )

    def test_native_feedback_reports_quote_and_model_errors_together(self):
        with self.sessions() as db:
            item = self.headphones(db)
            source = self.source(db, item)
            source.title = "通用蓝牙指南"
            source.content = "打开蓝牙后，观察设备实际显示的配对状态。"
            db.commit()
            message = self.message(db, "先帮我看资料，暂时别动耳机。")
            bad = self.result(knowledge=[self.knowledge(item, source,
                source_quote="并没有出现在原文中的命令")]).model_dump()
            import time
            schema = grounded_turn_schema(self.sessions, self.owner, message,
                deadline_at=time.monotonic()+30)
            with self.assertRaises(ValueError) as failure:
                schema.model_validate(bad)
            text = str(failure.exception)
            self.assertIn("source_quote", text)
            self.assertIn("WH-CH720N", text)
            self.assertIn("本轮还剩", text)
            self.assertEqual(foundation.known_claims(db, self.owner, item["id"]), [])

    def test_optional_learning_can_be_omitted_without_dropping_answer(self):
        from wujian.learning import Learning
        self.assertEqual(Learning.model_validate({}).model_dump(),
            {"knowledge_updates":[], "memory_updates":[]})

    def test_frozen_natural_preferences_and_curly_quoted_nickname_both_save(self):
        from sqlalchemy import select
        text = "平时跟我聊天，我不想每段结尾都被追问。以后除非真缺关键条件，就别用问号收尾；我需要的时候会自己接着说。我工作间那台爱普生，我习惯叫它‘小墨’，不是正式型号。今天先到这儿。"
        nickname_quote = "我工作间那台爱普生，我习惯叫它'小墨'，不是正式型号。"
        with self.sessions() as db:
            item = domain.create_item(db, self.owner, ItemCreate(name="工作间的爱普生",
                product=ProductSpec(brand="爱普生", model="L8188", market="CN")))
            message_id = self.message(db, text)
            result = self.result(memories=[
                {"operation": "add", "content": "平时聊天除非缺关键条件，避免每段以追问结尾",
                 "kind": "preference", "context": "日常对话表达", "source_quote": "以后除非真缺关键条件，就别用问号收尾"},
                {"operation": "add", "content": "习惯把工作间的爱普生打印机叫小墨，不是正式型号",
                 "item_id": item["id"], "kind": "meaning", "context": "这台打印机的昵称", "source_quote": nickname_quote}])
            checked = grounded_turn_schema(self.sessions, self.owner, message_id).model_validate(result.model_dump())
            self.assertEqual(checked.learning.memory_updates[1].source_quote,
                "我工作间那台爱普生，我习惯叫它‘小墨’，不是正式型号。")
            saved = commit_result(db, self.owner, message_id, checked, text)
            self.assertEqual(len(saved["learned"]["memories"]), 2)
            rows = list(db.scalars(select(Memory).where(Memory.source_message_id == message_id)))
            self.assertEqual(len(rows), 2)
            self.assertIn("‘小墨’", next(row.attributes["source_quote"] for row in rows if row.item_id == item["id"]))

    def test_user_quote_reanchoring_changes_typography_not_words_or_word_boundaries(self):
        from wujian.evidence import locate_user_quote
        self.assertEqual(locate_user_quote("我叫它‘小墨’。", "我叫它'小墨'。"), "我叫它‘小墨’。")
        self.assertEqual(locate_user_quote('call  it “ink”', 'call it "ink"'), 'call  it “ink”')
        for original, rewritten in (("I am not able", "I am notable"),
                ("我不喜欢‘红色’", "我喜欢'红色'"), ("型号 A1", "型号 A2"),
                ("先不要分享", "现在可以分享")):
            with self.subTest(original=original, rewritten=rewritten):
                self.assertIsNone(locate_user_quote(original, rewritten))

    def test_optional_independent_learning_keeps_valid_entry_and_reports_rejection(self):
        with self.sessions() as db:
            text = "平时别在末尾追问，打印机叫‘小墨’。"
            message_id = self.message(db, text)
            result = self.result(memories=[
                {"operation": "add", "content": "日常聊天避免在末尾追问", "kind": "preference",
                 "context": "日常聊天", "source_quote": "平时别在末尾追问"},
                {"operation": "add", "content": "家里还有一台佳能打印机", "kind": "meaning",
                 "context": "拥有物品", "source_quote": "我还有一台佳能打印机"}],
                answer="两个习惯我记下了。")
            saved = commit_result(db, self.owner, message_id, result, text)
            self.assertEqual(len(saved["learned"]["memories"]), 1)
            self.assertEqual(len(saved["learned"]["rejected"]), 1)
            self.assertIn("1条理解未能核对依据，未保存", saved["answer"])
            self.assertEqual(len(domain.recall(db, self.owner)), 1)

    def test_partial_learning_does_not_split_correlated_changes_to_same_old_memory(self):
        with self.sessions() as db:
            old = domain.remember(db, self.owner, "阅读时喜欢白光", "old-fixture")
            text = "阅读改成暖光，另一个建议我还没确认。"
            message_id = self.message(db, text)
            changes = [
                {"operation": "replace", "memory_id": old["id"], "content": "阅读时喜欢暖光",
                 "kind": "preference", "context": "阅读照明", "source_quote": "阅读改成暖光"},
                {"operation": "forget", "memory_id": old["id"], "content": "",
                 "kind": "preference", "context": "阅读照明", "source_quote": "请删除这条旧偏好"}]
            with self.assertRaises(domain.DomainError):
                commit_result(db, self.owner, message_id, self.result(memories=changes), text)
            db.expire_all()
            self.assertTrue(db.get(Memory, old["id"]).active)

    def test_memory_correction_and_task_validation_share_one_transaction(self):
        with self.sessions() as db:
            old = domain.remember(
                db, self.owner, "任何时候都只喜欢暖黄光", "earlier-report"
            )
            text = "补充一下，做手工时我喜欢白光，平时读书仍喜欢暖黄光。"
            message = self.message(db, text)
            changes = [
                {
                    "operation": "replace",
                    "memory_id": old["id"],
                    "content": "做手工时喜欢白光，平时读书喜欢暖黄光",
                    "kind": "preference",
                    "context": "区分手工和阅读情境",
                    "source_quote": text,
                }
            ]
            result = self.result(
                memories=changes,
                continuation={
                    "goal": "阅读角",
                    "item_ids": ["not-an-accessible-item"],
                    "constraints": {},
                    "plan": {},
                    "task_id": None,
                    "expected_version": None,
                },
            )
            with self.assertRaises(domain.DomainError):
                commit_result(db, self.owner, message, result, text)
            db.expire_all()
            self.assertTrue(db.get(Memory, old["id"]).active)
            result.continuation = None
            commit_result(db, self.owner, message, result, text)
            current = domain.recall(db, self.owner)
            self.assertEqual(len(current), 1)
            self.assertEqual(current[0]["attributes"]["context"], "区分手工和阅读情境")
            self.assertFalse(db.get(Memory, old["id"]).active)

    def test_shared_and_gifted_product_retains_public_evidence_without_private_notes(
        self,
    ):
        with self.sessions() as db:
            item = self.headphones(db)
            source = self.source(db, item)
            source.item_id = (
                None  # actual sources may be retained before binding an instance
            )
            db.commit()

            message = self.message(db, "请帮我核对用法。")
            commit_result(
                db,
                self.owner,
                message,
                self.result(knowledge=[self.knowledge(item, source)]),
                "请帮我核对用法。",
            )
            private = domain.remember(
                db, self.owner, "这份礼物让我想起私人烦恼", message, item["id"]
            )
            domain.share_item(db, self.owner, item["id"], self.friend)
            shared = foundation.known_claims(db, self.friend, item["id"])
            self.assertEqual(shared[0]["content"], shared[0]["source_quote"])
            from wujian.source_access import readable_source

            self.assertEqual(readable_source(db, self.friend, source.id).id, source.id)
            domain.share_item(db, self.owner, item["id"], self.friend, revoke=True)
            with self.assertRaises(domain.DomainError):
                readable_source(db, self.friend, source.id)

            gift = domain.create_gift(
                db, self.owner, GiftCreate(item_id=item["id"], recipient_id=self.friend)
            )
            self.assertEqual(gift["snapshot"]["public_source_ids"], [source.id])
            domain.accept_gift(db, self.friend, gift["id"])
            received = foundation.known_claims(db, self.friend, item["id"])
            self.assertTrue(received)
            copied = db.get(SourceRecord, received[0]["source_id"])
            self.assertEqual(copied.owner_id, self.friend)
            self.assertEqual(copied.content, source.content)
            self.assertFalse(domain.recall(db, self.friend))
            self.assertTrue(db.get(Memory, private["id"]).active)

    def test_rea_context_reuses_identity_and_evidence_without_personal_stories(self):
        with self.sessions() as db:
            item = self.headphones(db)
            target = bind_target(
                db, self.owner, item["id"], "browser_cdp", "http://127.0.0.1:9222"
            )
            context = device_context(
                db, self.owner, owned_target(db, self.owner, target["id"])
            )
            self.assertEqual(context["product"]["model"], "WH-CH720N")
            self.assertEqual(context["item_version"], item["version"])
            self.assertNotIn("memories", context)
            self.assertNotIn("experiences", context)
            self.assertFalse(context["control_effect_verified"])


if __name__ == "__main__":
    unittest.main()
