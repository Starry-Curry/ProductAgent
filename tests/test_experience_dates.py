"""Real SQLite date/backup journeys; people and ownership are explicitly fictional.

No model, public network, device, primary var directory or private data is used.
An event's unknown date must stay different from the date it was recorded.
"""

import json
import sqlite3
import tempfile
import unittest
from contextlib import ExitStack, closing
from datetime import date
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, create_engine, inspect, text

from wujian import domain, interactions
from wujian.api_models import ExperienceChange, ExperienceCreate, GiftCreate, ItemCreate
from wujian.config import ROOT, Settings
from wujian.database import ExperienceRecord, ExperienceShare, Gift, make_database
from wujian.retrieval import authorized_documents


class ExperienceDateMigrationTests(unittest.TestCase):
    def test_0006_upgrade_preserves_story_date_share_gift_and_verified_backup(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as resources:
            settings = Settings(data_dir=Path(directory))
            settings.prepare()
            old_engine = create_engine(settings.database_url)
            resources.callback(old_engine.dispose)
            config = Config(str(ROOT / "alembic.ini"))
            config.set_main_option("script_location", str(ROOT / "migrations"))
            head = ScriptDirectory.from_config(config).get_current_head()
            with old_engine.connect() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "0006")
                connection.commit()
                # Build a genuine historical row against reflected 0006 tables.
                # Current ORM writers contain columns that did not exist then.
                tables = MetaData()
                tables.reflect(bind=connection)
                for user_id in ["person_demo_owner", "person_demo_friend"]:
                    connection.execute(tables.tables["users"].insert().values(
                        id=user_id, username=user_id, display_name=user_id,
                        password_hash="offline-historical-fixture"))
                item = {"id":"historical-cup", "name":"小雨送的手工杯"}
                connection.execute(tables.tables["items"].insert().values(
                    id=item["id"], owner_id="person_demo_owner", name=item["name"],
                    kind="nonstandard_object", product_id=None, identity_notes={}, state={},
                    photo_id=None, archived=False, version=1, created_at="2026-11-01"))
                story = {"id":"historical-story"}
                original_story = {"id":story["id"], "creator_id":"person_demo_owner",
                    "title":"毕业那天", "text":"毕业前，小雨把亲手做的杯子递给我。",
                    "item_ids":[item["id"]], "item_labels":{item["id"]:item["name"]},
                    "photo_ids":[], "occurred_on":"2025-06-18", "origin_id":None,
                    "provenance":{"kind":"authored_record", "author_id":"person_demo_owner"},
                    "version":1, "allow_ai":False}
                connection.execute(tables.tables["experiences"].insert().values(
                    **original_story, created_at="2026-11-01"))
                connection.execute(tables.tables["experience_shares"].insert().values(
                    experience_id=story["id"], user_id="person_demo_friend"))
                original_snapshot = {"name":item["name"], "product":{},
                    "message":"把这段故事也交给你。", "avatar":{},
                    "experiences":[dict(original_story)], "sender_name":"小林"}
                gift = {"id":"historical-gift"}
                connection.execute(tables.tables["gifts"].insert().values(id=gift["id"],
                    sender_id="person_demo_owner", recipient_id="person_demo_friend",
                    item_id=item["id"], snapshot=original_snapshot, status="pending", created_at="2026-11-01"))
                connection.commit()
                original_story["household_id"] = None
            old_engine.dispose()

            engine, sessions = make_database(settings)
            resources.callback(engine.dispose)
            try:
                with engine.connect() as connection:
                    self.assertEqual(connection.execute(text("SELECT version_num FROM alembic_version")).scalar(), head)
                    self.assertEqual(connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall(), [])
                    date_column = next(row for row in inspect(connection).get_columns("experiences") if row["name"] == "occurred_on")
                    self.assertTrue(date_column["nullable"])
                with sessions() as db:
                    self.assertEqual(domain.experience_view(db.get(ExperienceRecord, story["id"])), original_story)
                    self.assertIsNotNone(db.get(ExperienceShare, (story["id"], "person_demo_friend")))
                    self.assertEqual(db.get(Gift, gift["id"]).snapshot, original_snapshot)
                    shared = next(row for row in domain.list_experiences(db, "person_demo_friend") if row["id"] == story["id"])
                    self.assertEqual(shared["occurred_on"], "2025-06-18")
                    self.assertEqual(shared["text"], original_story["text"])
            finally:
                engine.dispose()

            backups = list((Path(directory) / "backups").glob(f"before-0006-to-{head}-*.sqlite3"))
            self.assertEqual(len(backups), 1)
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(backup.execute("SELECT version_num FROM alembic_version").fetchone()[0], "0006")
                self.assertEqual(backup.execute("SELECT occurred_on,text FROM experiences WHERE id=?", (story["id"],)).fetchone(),
                    ("2025-06-18", original_story["text"]))
                self.assertEqual(backup.execute("SELECT count(*) FROM experience_shares WHERE experience_id=?", (story["id"],)).fetchone()[0], 1)
                self.assertEqual(backup.execute("PRAGMA foreign_key_check").fetchall(), [])
            reopened, _ = make_database(settings)
            resources.callback(reopened.dispose)
            reopened.dispose()
            self.assertEqual(len(list((Path(directory) / "backups").glob(f"before-0006-to-{head}-*.sqlite3"))), 1)


class UnknownExperienceDateJourneys(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.owner, self.friend = "person_demo_owner", "person_demo_friend"
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item = domain.create_item(db, self.owner, ItemCreate(
                name="朋友手工做的杯子", kind="nonstandard_object"))

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def create(self, db, **changes):
        return domain.create_experience(db, self.owner, ExperienceCreate(**{
            "title": "毕业时收到的杯子", "text": "具体哪天不记得了，但记得她说以后也要常联系。",
            "item_ids": [self.item["id"]], **changes}))

    def test_omitted_and_explicit_unknown_dates_remain_sql_null(self):
        with self.sessions() as db:
            for changes in ({}, {"occurred_on": None}):
                story = self.create(db, **changes)
                self.assertIsNone(story["occurred_on"])
                self.assertIsNone(db.get(ExperienceRecord, story["id"]).occurred_on)
                self.assertTrue(db.get(ExperienceRecord, story["id"]).created_at)
                visible = next(row for row in domain.list_experiences(db, self.owner) if row["id"] == story["id"])
                self.assertIsNone(visible["occurred_on"])
                self.assertEqual(json.loads(json.dumps(visible, ensure_ascii=False))["occurred_on"], None)

    def test_edit_can_establish_then_clear_date_without_defaulting_to_today(self):
        with self.sessions() as db:
            story = self.create(db)
            known = interactions.change_experience(db, self.owner, story["id"], ExperienceChange(
                title=story["title"], text=story["text"], item_ids=story["item_ids"],
                occurred_on=date(2025, 6, 18), expected_version=story["version"]))
            self.assertEqual(known["occurred_on"], "2025-06-18")
            unknown = interactions.change_experience(db, self.owner, story["id"], ExperienceChange(
                title=known["title"], text=known["text"], item_ids=known["item_ids"],
                occurred_on=None, expected_version=known["version"]))
            self.assertIsNone(unknown["occurred_on"])
            self.assertEqual(unknown["text"], story["text"])

    def test_unknown_date_survives_shared_read_and_received_gift_snapshot(self):
        with self.sessions() as db:
            story = self.create(db)
            interactions.share_experience(db, self.owner, story["id"], self.friend)
            shared = next(row for row in domain.list_experiences(db, self.friend) if row["id"] == story["id"])
            self.assertIsNone(shared["occurred_on"])
            gift = domain.create_gift(db, self.owner, GiftCreate(
                item_id=self.item["id"], recipient_id=self.friend, message="记得这份心意。",
                experience_ids=[story["id"]]))
            self.assertIsNone(gift["snapshot"]["experiences"][0]["occurred_on"])
            domain.accept_gift(db, self.friend, gift["id"])
            received = next(row for row in domain.list_experiences(db, self.friend) if row.get("origin_id") == story["id"])
            self.assertIsNone(received["occurred_on"])
            self.assertEqual(received["provenance"]["author_id"], self.owner)
            self.assertFalse(received["allow_ai"])

    def test_unknown_date_is_preserved_in_ai_projection_only_when_allowed(self):
        with self.sessions() as db:
            private = self.create(db, allow_ai=False)
            permitted = self.create(db, allow_ai=True)
        documents = authorized_documents(self.sessions, self.owner)
        self.assertNotIn("experience/" + private["id"], documents)
        self.assertIsNone(documents["experience/" + permitted["id"]]["data"]["occurred_on"])
