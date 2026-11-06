"""Real SQLite household journeys; ownership and events are synthetic.

Domestic product models anchor the scenario, not a claim about model accuracy.
No model, network, or paid provider is used by these permission/state tests.
"""
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import func, select

from wujian import domain, interactions
from wujian.api_models import ExperienceChange, ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import (
    Asset, Conversation, ExperienceRecord, ExperienceShare, Household,
    HouseholdMember, Run, User, make_database,
)
from wujian.family_memory import can_read_experience


class HouseholdMemoryJourneys(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name), api_key="offline-no-provider")
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.db = self.sessions()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.db.add_all([User(id=key, username=key, display_name=key, password_hash="unused")
                         for key in ["daughter", "mother", "father", "outsider", "invited"]])
        self.db.flush()
        self.db.add_all([Household(id="home", name="一家人", creator_id="daughter"),
                         Household(id="other-home", name="另一个家", creator_id="daughter")])
        self.db.flush()
        for home, users in [("home", ["daughter", "mother", "father"]),
                            ("other-home", ["daughter", "outsider"])]:
            self.db.add_all([HouseholdMember(household_id=home, user_id=key, status="active")
                             for key in users])
        self.db.add(HouseholdMember(household_id="home", user_id="invited", status="invited"))
        for key in ["daughter", "mother", "father", "outsider"]:
            self.db.add(Conversation(id="conversation-" + key, user_id=key, title="家庭用品"))
        self.db.add(Asset(id="photo", owner_id="daughter", path="unused-test-photo", media_type="image/jpeg",
                          original_name="一家人的照片.jpg"))
        self.db.commit()
        self.lamp = domain.create_item(self.db, "daughter", ItemCreate(name="书房台灯", product={
            "brand": "米家", "model": "MJTD01SYL"}))
        self.air = domain.create_item(self.db, "daughter", ItemCreate(name="客厅空气净化器", product={
            "brand": "米家", "model": "AC-M6-SC"}))
        self.private = domain.create_item(self.db, "daughter", ItemCreate(name="朋友的手工杯子", kind="nonstandard_object"))
        for item in [self.lamp, self.air]:
            interactions.household_item(self.db, "daughter", "home", item["id"], True)

    def record(self, *, author="daughter", **changes):
        return domain.create_experience(self.db, author, ExperienceCreate(**{
            "title": "周末在家读书", "text": "妈妈在台灯旁给我们读了一段散文。",
            "item_ids": [self.lamp["id"]], "household_id": "home", **changes}))

    def change(self, story, **changes):
        values = {key: story[key] for key in ["title", "text", "item_ids", "photo_ids", "occurred_on", "allow_ai"]}
        return ExperienceChange(**{**values, "expected_version": story["version"], **changes})

    def ids(self, user, **kw):
        return {row["id"] for row in domain.list_experiences(self.db, user, **kw)}

    def test_item_sharing_never_publishes_private_wall_and_shared_ai_is_explicit(self):
        private = self.record(household_id=None, allow_ai=True)
        public = self.record(photo_ids=["photo"], allow_ai=False)
        self.assertIn(private["id"], self.ids("daughter", for_ai=True))
        self.assertNotIn(private["id"], self.ids("mother"))
        self.assertIn(public["id"], self.ids("mother"))
        self.assertNotIn(public["id"], self.ids("mother", for_ai=True))
        revised = interactions.change_experience(self.db, "daughter", public["id"], self.change(public, allow_ai=True))
        self.assertEqual(revised["household_id"], "home")  # old PUT omits the new field
        self.assertIn(public["id"], self.ids("mother", for_ai=True))
        self.assertEqual(self.ids("outsider"), set())
        self.assertEqual(self.ids("invited"), set())
        shared = next(row for row in domain.list_experiences(self.db, "mother") if row["id"] == public["id"])
        self.assertEqual(shared["photo_ids"], ["photo"])
        self.assertEqual(shared["item_ids"], [self.lamp["id"]])
        self.assertEqual(shared["provenance"]["author_id"], "daughter")

    def test_every_member_appends_own_record_without_editing_someone_else(self):
        daughter = self.record()
        mother = self.record(author="mother", title="妈妈的补记", text="记得下次把灯调暗一点。")
        self.assertEqual(self.ids("father"), {daughter["id"], mother["id"]})
        with self.assertRaises(domain.DomainError) as caught:
            interactions.change_experience(self.db, "mother", daughter["id"], self.change(daughter, text="替别人改掉原文"))
        self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(domain.DomainError):
            interactions.delete_experience(self.db, "father", daughter["id"], 1)
        self.assertEqual(self.db.get(ExperienceRecord, daughter["id"]).text, daughter["text"])
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExperienceRecord)), 2)

    def test_publish_requires_membership_and_only_this_households_items(self):
        for changes in [{"item_ids": []}, {"item_ids": [self.private["id"]]},
                        {"item_ids": [self.lamp["id"], self.private["id"]]},
                        {"household_id": "other-home", "item_ids": [self.lamp["id"]]},
                        {"household_id": "missing"}]:
            with self.subTest(changes=changes), self.assertRaises(domain.DomainError):
                self.record(**changes)
        with self.assertRaises(domain.DomainError):
            self.record(author="outsider")
        with self.assertRaises(domain.DomainError):
            self.record(author="invited")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExperienceRecord)), 0)

    def test_author_withdrawal_resets_old_readers_and_preserves_one_record(self):
        story = self.record(allow_ai=True)
        before = self.db.get(Conversation, "conversation-mother").context_revision
        self.db.add(Run(id="run-mother", conversation_id="conversation-mother", user_id="mother", status="running"))
        self.db.commit()
        withdrawn = interactions.change_experience(self.db, "daughter", story["id"], self.change(story, household_id=None))
        self.assertIsNone(withdrawn["household_id"])
        self.assertNotIn(story["id"], self.ids("mother"))
        self.assertNotIn(story["id"], self.ids("mother", for_ai=True))
        self.assertIn(story["id"], self.ids("daughter"))
        self.assertGreater(self.db.get(Conversation, "conversation-mother").context_revision, before)
        self.assertEqual(self.db.get(Run, "run-mother").status, "interrupted")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExperienceRecord)), 1)
        with self.assertRaises(domain.DomainError) as caught:
            interactions.change_experience(self.db, "daughter", story["id"], self.change(story, household_id="home"))
        self.assertEqual(caught.exception.status, 409)

    def test_moving_explicit_scope_invalidates_both_old_and_new_households(self):
        interactions.household_item(self.db, "daughter", "other-home", self.lamp["id"], True)
        story = self.record(allow_ai=True)
        revisions = {key: self.db.get(Conversation, "conversation-" + key).context_revision
                     for key in ["mother", "outsider"]}
        moved = interactions.change_experience(self.db, "daughter", story["id"],
            self.change(story, household_id="other-home"))
        self.assertEqual(moved["household_id"], "other-home")
        self.assertNotIn(story["id"], self.ids("mother"))
        self.assertIn(story["id"], self.ids("outsider", for_ai=True))
        for key in revisions:
            self.assertGreater(self.db.get(Conversation, "conversation-" + key).context_revision, revisions[key])

    def test_item_removed_hides_whole_family_record_but_keeps_authors_original(self):
        story = self.record(item_ids=[self.lamp["id"], self.air["id"]], allow_ai=True)
        interactions.household_item(self.db, "daughter", "home", self.air["id"], False)
        row = self.db.get(ExperienceRecord, story["id"])
        self.assertFalse(can_read_experience(self.db, "mother", row))
        self.assertFalse(can_read_experience(self.db, "mother", row, for_ai=True))
        self.assertTrue(can_read_experience(self.db, "daughter", row))
        self.assertNotIn(story["id"], self.ids("mother", item_id=self.lamp["id"]))
        # The author can still explicitly withdraw or repair its remaining links.
        revised = interactions.change_experience(self.db, "daughter", story["id"], self.change(story, item_ids=[self.lamp["id"]]))
        self.assertEqual(revised["household_id"], "home")
        self.assertIn(story["id"], self.ids("mother"))

    def test_leaving_member_loses_family_and_withdraws_own_shared_records(self):
        daughter = self.record(allow_ai=True)
        mother = self.record(author="mother", title="妈妈的观察", text="灯放在左边更顺手。", allow_ai=True)
        before = self.db.get(Conversation, "conversation-father").context_revision
        interactions.remove_member(self.db, "daughter", "home", "mother")
        self.assertNotIn(daughter["id"], self.ids("mother"))
        self.assertIn(mother["id"], self.ids("mother"))
        self.assertNotIn(mother["id"], self.ids("father"))
        self.assertFalse(can_read_experience(self.db, "father", self.db.get(ExperienceRecord, mother["id"]), for_ai=True))
        self.assertGreater(self.db.get(Conversation, "conversation-father").context_revision, before)

    def test_friend_share_does_not_grant_ai_and_private_provenance_is_filtered(self):
        story = self.record(allow_ai=True)
        row = self.db.get(ExperienceRecord, story["id"])
        row.provenance = {**row.provenance, "ai_consent": {"quote": "私人许可"},
                          "photo_associations": {self.lamp["id"]: {"reference_photo_id": "secret-ref"}}}
        self.db.add(ExperienceShare(experience_id=row.id, user_id="outsider"))
        self.db.commit()
        for user in ["mother", "outsider"]:
            shared = next(value for value in domain.list_experiences(self.db, user) if value["id"] == row.id)
            self.assertNotIn("ai_consent", shared["provenance"])
            self.assertNotIn("photo_associations", shared["provenance"])
        self.assertFalse(can_read_experience(self.db, "outsider", row, for_ai=True))
        self.assertNotIn(row.id, self.ids("outsider", for_ai=True))

    def test_delete_interrupts_every_previous_reader_and_removes_shared_reference(self):
        story = self.record(allow_ai=True)
        self.db.add(ExperienceShare(experience_id=story["id"], user_id="outsider"))
        for key in ["mother", "father", "outsider"]:
            self.db.add(Run(id="run-" + key, conversation_id="conversation-" + key, user_id=key, status="running"))
        self.db.commit()
        interactions.delete_experience(self.db, "daughter", story["id"], story["version"])
        for key in ["mother", "father", "outsider"]:
            self.assertEqual(self.db.get(Run, "run-" + key).status, "interrupted")
            self.assertNotIn(story["id"], self.ids(key))
        self.assertIsNone(self.db.get(ExperienceRecord, story["id"]))
