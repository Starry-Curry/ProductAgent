"""Realistic state transitions and mature-engine integration; no model-quality claims."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from wujian import domain, foundation
from wujian.api_models import ItemCreate, ProductSpec
from wujian.config import ROOT, Settings
from wujian.database import (
    ChatMessage,
    Conversation,
    Memory,
    SourceRecord,
    TaskRecord,
    make_database,
)
from wujian.retrieval import Retrieval


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        with self.sessions() as db:
            domain.seed_demo(db)
        self.owner = "person_demo_owner"
        self.friend = "person_demo_friend"

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def message(self, db, content):
        conversation = Conversation(user_id=self.owner)
        db.add(conversation)
        db.flush()
        message = ChatMessage(
            conversation_id=conversation.id, role="user", text=content
        )
        db.add(message)
        db.commit()
        return message.id

    def test_corrected_and_expired_personal_understanding_is_not_current(self):
        with self.sessions() as db:
            old = domain.remember(db, self.owner, "我喜欢暖黄光", "earlier-rental-chat")
            changed = foundation.revise_memory(
                db,
                self.owner,
                "new-user-report",
                "做手工时改用白光，平时仍喜欢暖黄光",
                supersedes_id=old["id"],
            )
            self.assertEqual(changed["supersedes_id"], old["id"])
            self.assertFalse(db.get(Memory, old["id"]).active)
            # Historical temporary illness is retained as history, excluded from current constraints.
            expired = Memory(
                id="past-eye-strain",
                user_id=self.owner,
                content="这两天眼睛不舒服",
                source_message_id="past-week-chat",
                expires_at="2026-01-01T00:00:00+00:00",
            )
            db.add(expired)
            db.commit()
            current = domain.recall(db, self.owner)
            self.assertEqual([r["id"] for r in current], [changed["id"]])
            with self.assertRaises(domain.DomainError):
                foundation.revise_memory(
                    db,
                    self.friend,
                    "wrong-user",
                    "我的另一种偏好",
                    supersedes_id=changed["id"],
                )

    def test_product_knowledge_reused_but_instance_failures_and_corrections_do_not_leak(
        self,
    ):
        spec = ProductSpec(brand="Sony 索尼", model="WH-CH720N", market="CN")
        with self.sessions() as db:
            left = domain.create_item(
                db, self.owner, ItemCreate(name="自己的耳机", product=spec)
            )
            right = domain.create_item(
                db, self.owner, ItemCreate(name="同型号的备用耳机", product=spec)
            )
            other = domain.create_item(
                db, self.friend, ItemCreate(name="朋友的耳机", product=spec)
            )
            self.assertEqual(left["product_id"], right["product_id"])
            source = SourceRecord(
                owner_id=self.owner,
                item_id=left["id"],
                title="检索器已取得的官方配对说明片段",
                url="https://helpguide.sony.net/mdr/2966/v1/zh-cn/contents/TP1000777286.html",
                content="当您配对第二个或后续设备时，按住电源按钮约5秒钟或以上手动进入配对模式。",
            )
            db.add(source)
            db.commit()
            claim = foundation.save_claim(
                db,
                self.owner,
                "manual-reading",
                left["id"],
                "后续设备需手动进入配对模式",
                {"scenario": "已有配对信息后增加设备"},
                "document",
                "product",
                source.id,
                "按住电源按钮约5秒钟或以上手动进入配对模式",
            )
            self.assertEqual(
                foundation.known_claims(db, self.owner, right["id"])[0]["id"],
                claim["id"],
            )
            self.assertFalse(foundation.known_claims(db, self.friend, other["id"]))
            message = self.message(db, "自己的耳机右耳今天没有声音，备用的没问题。")
            foundation.save_claim(
                db,
                self.owner,
                message,
                left["id"],
                "右耳当前无声音",
                {"observed": "今天"},
                "user_report",
                "item",
                source_quote="自己的耳机右耳今天没有声音",
            )
            self.assertEqual(
                len(foundation.known_claims(db, self.owner, right["id"])), 1
            )
            with self.assertRaises(domain.DomainError):
                foundation.save_claim(
                    db,
                    self.owner,
                    message,
                    left["id"],
                    "未经核对的步骤",
                    {},
                    "document",
                    "product",
                    source.id,
                    "网上没有这段原话",
                )

    def test_visual_inference_retains_its_actual_source_without_becoming_verified_knowledge(self):
        with self.sessions() as db:
            observed=SourceRecord(owner_id=self.owner,origin="video_frame_sample",title="夹子局部画面（模拟）",
                url="https://www.bilibili.com/video/BV1pa4y1B7f8/",content='{"frames":[]}',pages=[])
            foreign=SourceRecord(owner_id=self.friend,title="朋友私有资料",url="https://example.invalid/source",content="private")
            db.add_all([observed,foreign]);db.commit()
            def save(source_id):
                return foundation.save_claim(db,self.owner,"synthetic-user-message","item_demo_lamp",
                    "画面中的夹子可能用金属手柄作连接，具体扣法尚不清楚。",
                    {"kind":"case","unknowns":["没有看到完整连接动作"]},"inference","item",source_id)
            claim=save(observed.id)
            self.assertEqual(claim["source_id"],observed.id)
            self.assertEqual(claim["basis"],"inference")
            self.assertEqual(claim["status"],"provisional")
            self.assertEqual(save(observed.id)["id"],claim["id"])
            with self.assertRaises(domain.DomainError):
                save(foreign.id)
            with self.assertRaises(domain.DomainError):
                save("not-an-observed-source")

    def test_continuing_task_keeps_actual_feedback_and_prevents_old_plan_overwrite(
        self,
    ):
        with self.sessions() as db:
            task = foundation.save_task(
                db,
                self.owner,
                "rental-plan",
                "用已有物品布置窗边阅读角",
                ["item_demo_lamp", "item_demo_stone"],
                {"wall": "不能打孔", "memorial": "石头不能粘"},
                {"trial": "先用桌上灯和窗帘试低成本布置"},
            )
            result = foundation.task_feedback(
                db,
                self.owner,
                "actual-user-result",
                task["id"],
                "手机支架五分钟后滑倒，窗帘柔光很好",
                "partial",
                task["version"],
            )
            self.assertEqual(result["feedback"][0]["outcome"], "partial")
            with self.assertRaises(domain.DomainError):
                foundation.save_task(
                    db,
                    self.owner,
                    "stale-other-chat",
                    task["goal"],
                    task["item_ids"],
                    {},
                    {},
                    task["id"],
                    task["version"],
                )
            with self.assertRaises(domain.DomainError):
                foundation.save_task(
                    db,
                    self.owner,
                    "not-yet-tested",
                    task["goal"],
                    task["item_ids"],
                    {},
                    {},
                    task["id"],
                    result["version"],
                    "completed",
                )
            revised = foundation.save_task(
                db,
                self.owner,
                "next-chat",
                task["goal"],
                ["item_demo_lamp"],
                result["constraints"],
                {"trial": "不再支撑手机，手持拍静物"},
                task["id"],
                result["version"],
                "ready",
            )
            self.assertTrue(revised["feedback"])
            self.assertNotIn("item_demo_stone", revised["item_ids"])

    def test_reme_index_respects_forgetting_and_revoked_shared_item(self):
        async def exercise():
            with self.sessions() as db:
                memory = domain.remember(
                    db,
                    self.owner,
                    "外婆送我的向日葵画，不要在上面贴胶带",
                    "conversation-meaning",
                )
                domain.share_item(db, self.owner, "item_demo_sunflower", self.friend)
            retrieval = Retrieval(self.settings, self.sessions)
            try:
                found = await retrieval.search(self.owner, "向日葵", ["memory"])
                self.assertTrue(any(r["id"] == memory["id"] for r in found["results"]))
                shared = await retrieval.search(self.friend, "向日葵", ["item"])
                self.assertTrue(shared["results"])
                self.assertEqual(shared["results"][0]["data"]["description"], "")
                with self.sessions() as db:
                    domain.remove_memory(db, self.owner, memory["id"])
                    domain.share_item(
                        db, self.owner, "item_demo_sunflower", self.friend, revoke=True
                    )
                forgotten = await retrieval.search(self.owner, "向日葵", ["memory"])
                revoked = await retrieval.search(self.friend, "向日葵", ["item"])
                self.assertFalse(forgotten["results"])
                self.assertFalse(revoked["results"])
            finally:
                await retrieval.close()

        asyncio.run(exercise())

    def test_current_condition_uses_user_evidence_and_invalidates_prior_context(self):
        with self.sessions() as db:
            message = self.message(db, "台灯借给室友了，这周末先别安排它。")
            before = domain.item_view(
                db, self.owner, domain.accessible_item(db, self.owner, "item_demo_lamp")
            )
            changed = foundation.update_condition(
                db,
                self.owner,
                message,
                "item_demo_lamp",
                {"availability": "lent_out"},
                "台灯借给室友了",
                before["version"],
            )
            self.assertEqual(changed["state"]["availability"], "lent_out")
            self.assertEqual(
                changed["state"]["latest_user_report"]["source_message_id"], message
            )
            with self.assertRaises(domain.DomainError):
                foundation.update_condition(
                    db,
                    self.owner,
                    message,
                    "item_demo_lamp",
                    {"availability": "home"},
                    "已经归还",
                    changed["version"],
                )

    def test_final_result_commits_feedback_and_plan_atomically(self):
        from wujian.turns import TurnResult, commit_continuation

        with self.sessions() as db:
            task = foundation.save_task(
                db,
                self.owner,
                "first-plan",
                "窗边拍静物",
                ["item_demo_lamp"],
                {"wall": "不打孔"},
                {"trial": "手持手机试拍"},
            )
            payload = {
                "answer": "保留窗帘光，改为手持拍摄。",
                "learning": {"knowledge_updates":[],"memory_updates":[]},
                "story_refs": [],
                "continuation": {
                    "goal": task["goal"],
                    "item_ids": ["item_demo_lamp"],
                    "constraints": {"phone": "不再支起来"},
                    "plan": {"trial": "手持手机从上方向下取景"},
                    "task_id": task["id"],
                    "expected_version": task["version"],
                    "feedback_quote": "支架五分钟就滑倒了",
                    "outcome": "partial",
                },
            }
            result = TurnResult.model_validate(payload)
            saved = commit_continuation(
                db,
                self.owner,
                "current-result",
                result,
                "支架五分钟就滑倒了，不要再把手机支起来。",
            )
            self.assertEqual(saved["id"], task["id"])
            self.assertEqual(saved["feedback"][0]["source_quote"], "支架五分钟就滑倒了")
            # A later stale conversation cannot overwrite this task.
            with self.assertRaises(domain.DomainError):
                commit_continuation(
                    db,
                    self.owner,
                    "current-result",
                    result,
                    "支架五分钟就滑倒了，不要再把手机支起来。",
                )
            payload["continuation"].update(
                expected_version=saved["version"],
                item_ids=["not-an-owned-item"],
                feedback_quote="现在改拍静物",
            )
            with self.assertRaises(domain.DomainError):
                commit_continuation(
                    db,
                    self.owner,
                    "next-result",
                    TurnResult.model_validate(payload),
                    "现在改拍静物。",
                )
            db.expire_all()
            self.assertEqual(
                len(
                    db.get(
                        TaskRecord,
                        task["id"],
                    ).feedback
                ),
                1,
            )

    def test_unresolved_and_nonstandard_identities_do_not_become_a_shared_model(self):
        with self.sessions() as db:
            unknown = domain.create_item(
                db,
                self.owner,
                ItemCreate(
                    name="旧耳机",
                    product=ProductSpec(commercial_name="有线耳机，型号待查"),
                ),
            )
            stone = domain.create_item(
                db,
                self.owner,
                ItemCreate(
                    name="海边的石头",
                    kind="nonstandard_object",
                    product=ProductSpec(commercial_name="带白纹的灰石子"),
                ),
            )
            self.assertIsNone(unknown["product_id"])
            self.assertIsNone(stone["product_id"])
            self.assertEqual(
                unknown["product"]["commercial_name"], "有线耳机，型号待查"
            )
            self.assertEqual(
                stone["identity_notes"]["commercial_name"], "带白纹的灰石子"
            )
            self.assertFalse(stone["product"])

    def test_rea_binding_stays_with_authorized_controller_after_gift(self):
        from wujian.api_models import GiftCreate
        from wujian.devices import bind_target, owned_target

        with self.sessions() as db:
            target = bind_target(
                db,
                self.owner,
                "item_demo_sunflower",
                "browser_cdp",
                "http://127.0.0.1:9222",
            )
            domain.share_item(db, self.owner, "item_demo_sunflower", self.friend)
            with self.assertRaises(domain.DomainError):
                owned_target(db, self.friend, target["id"])
            gift = domain.create_gift(
                db,
                self.owner,
                GiftCreate(
                    item_id="item_demo_sunflower",
                    recipient_id=self.friend,
                    message="你的新伙伴",
                ),
            )
            domain.accept_gift(db, self.friend, gift["id"])
            with self.assertRaises(domain.DomainError):
                owned_target(db, self.owner, target["id"])
            with self.assertRaises(domain.DomainError):
                owned_target(db, self.friend, target["id"])

    def test_previous_proposal_is_searchable_without_becoming_a_user_fact(self):
        async def exercise():
            with self.sessions() as db:
                conversation = Conversation(user_id=self.owner)
                db.add(conversation)
                db.flush()
                question = ChatMessage(
                    conversation_id=conversation.id,
                    role="user",
                    text="想试一下窗边阅读角的光影。",
                    run_id="fictional-plan-exchange",
                )
                db.add(question)
                db.flush()
                db.add(
                    ChatMessage(
                        conversation_id=conversation.id,
                        role="assistant",
                        text="先用窗帘调节光线，在桌面放明信片，手持拍一张试试。",
                        run_id="fictional-plan-exchange",
                    )
                )
                db.commit()
                identity = question.id
            retrieval = Retrieval(self.settings, self.sessions)
            try:
                found = await retrieval.search(self.owner, "窗边", ["conversation"])
                self.assertEqual(
                    found["results"][0]["data"]["user_message_id"], identity
                )
                self.assertTrue(
                    found["results"][0]["data"][
                        "assistant_advice_is_not_observed_success"
                    ]
                )
                with self.sessions() as db:
                    memory = domain.remember(db, self.owner, "我想试窗边光影", identity)
                    domain.remove_memory(db, self.owner, memory["id"])
                self.assertFalse(
                    (await retrieval.search(self.owner, "窗边", ["conversation"]))[
                        "results"
                    ]
                )
            finally:
                await retrieval.close()

        asyncio.run(exercise())


class MigrationTests(unittest.TestCase):
    def test_known_legacy_database_keeps_item_identity_profiles_and_user_memories(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + (Path(directory) / "legacy.sqlite3").as_posix()
            engine = create_engine(url)
            config = Config(str(ROOT / "alembic.ini"))
            spec = {
                "brand": "Sony 索尼",
                "model": "WH-CH720N",
                "market": "CN",
                "edition": "大陆版",
            }
            with engine.connect() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "0001")
                connection.execute(
                    text(
                        "INSERT INTO users VALUES ('owner','lin','小林','test-local-hash')"
                    )
                )
                connection.execute(
                    text(
                        "INSERT INTO items(id,owner_id,name,kind,product,state,archived,version,created_at) VALUES ('headphones','owner','耳机','standard_product',:spec,'{}',0,3,'2026-11-01')"
                    ),
                    {"spec": json.dumps(spec, ensure_ascii=False)},
                )
                connection.execute(
                    text(
                        "INSERT INTO item_profiles VALUES ('owner','headphones','毕业礼物','{}')"
                    )
                )
                connection.execute(
                    text(
                        "INSERT INTO memories VALUES ('rental','owner',NULL,'租房不能打孔','user_report','chat-original',1,'2026-11-01')"
                    )
                )
                # Simulate the pre-migration app, which had no Alembic version table.
                connection.execute(text("DROP TABLE alembic_version"))
                connection.commit()
            engine.dispose()
            migrated, sessions = make_database(Settings(database_url=url))
            with sessions() as db:
                item = domain.item_view(
                    db, "owner", domain.accessible_item(db, "owner", "headphones")
                )
                self.assertEqual(item["product"], spec)
                self.assertEqual(item["description"], "毕业礼物")
                self.assertEqual(item["version"], 3)
                self.assertEqual(
                    domain.recall(db, "owner")[0]["content"], "租房不能打孔"
                )
            self.assertNotIn(
                "product", {c["name"] for c in inspect(migrated).get_columns("items")}
            )
            with migrated.connect() as connection:
                self.assertEqual(
                    connection.execute(
                        text("SELECT version_num FROM alembic_version")
                    ).scalar(),
                    "0008",
                )
                self.assertFalse(
                    connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                )
            migrated.dispose()
            backups = list((Path(directory) / "backups").glob("before-unversioned-to-0008-*.sqlite3"))
            self.assertEqual(len(backups), 1)
            import sqlite3
            from contextlib import closing
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(backup.execute("SELECT version FROM items WHERE id='headphones'").fetchone()[0], 3)
                self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_0005_migration_preserves_story_use_and_completed_reminders(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + (Path(directory) / "prior.sqlite3").as_posix()
            engine = create_engine(url)
            config = Config(str(ROOT / "alembic.ini"))
            with engine.connect() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "0005")
                connection.execute(text("INSERT INTO users VALUES ('owner','lin','小林','test-local-hash')"))
                connection.execute(text("INSERT INTO experiences(id,creator_id,title,text,item_ids,item_labels,photo_ids,occurred_on,provenance,created_at) VALUES ('story','owner','旧故事','原文','[]','{}','[]','2026-01-01','{}','2026-01-01')"))
                connection.execute(text("INSERT INTO reminders(id,creator_id,assignee_id,title,due_at,completed) VALUES ('care','owner','owner','处理完的事','2026-01-01',1)"))
                connection.commit()
            engine.dispose()
            migrated, sessions = make_database(Settings(database_url=url))
            with migrated.connect() as connection:
                self.assertEqual(connection.execute(text("SELECT allow_ai,version,text FROM experiences WHERE id='story'")).one(), (1,1,'原文'))
                self.assertEqual(connection.execute(text("SELECT completed,status FROM reminders WHERE id='care'")).one(), (1,'completed'))
                self.assertFalse(connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall())
            migrated.dispose()
            self.assertEqual(len(list((Path(directory) / 'backups').glob('before-0005-to-0008-*.sqlite3'))), 1)


if __name__ == "__main__":
    unittest.main()
