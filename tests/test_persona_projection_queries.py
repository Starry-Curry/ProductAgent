"""Count actual SQL reads for a short-lived persona list projection.

Synthetic handmade objects/reports and a real temporary SQLite database; no
network, fee-bearing model, user media, shared database or persistent cache.
"""
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import event

from wujian import domain, foundation, interactions
from wujian.api_models import AvatarSpec, ExperienceChange, ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, Profile, make_database
from wujian.persona_models import growth_trait_id


class PersonaProjectionQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name), api_key="")
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.user = "person_demo_owner"
        with self.sessions() as db:
            domain.seed_demo(db)
            self.items = [domain.create_item(db, self.user, ItemCreate(
                name=f"模拟手作纪念物{index}", kind="nonstandard_object",
                avatar=AvatarSpec(enabled=True))) for index in range(10)]
            self.report = self.message(db, "我累了的时候，先听我讲就好。")

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def message(self, db, text):
        conversation = Conversation(user_id=self.user)
        db.add(conversation)
        db.flush()
        message = ChatMessage(conversation_id=conversation.id, role="user", text=text)
        db.add(message)
        db.commit()
        return message

    def traits(self, db, *, evidence=None, selected=None):
        trait = {"id": growth_trait_id("support", "累的时候"), "dimension": "support",
            "behavior": "先听，不主动安排任务", "context": "累的时候",
            "evidence": evidence or [{"message_id": self.report.id, "quote": self.report.text}]}
        for item in selected or self.items:
            profile = db.get(Profile, (self.user, item["id"]))
            profile.avatar = {**profile.avatar, "growth_traits": [trait]}
        db.commit()

    def counted(self, operation):
        statements = []
        def collect(connection, cursor, statement, parameters, context, executemany):
            sql = statement.lstrip().lower()
            if sql.startswith("select") and "from memories" in sql:
                statements.append(statement)
        event.listen(self.engine, "before_cursor_execute", collect)
        try:
            result = operation()
        finally:
            event.remove(self.engine, "before_cursor_execute", collect)
        return result, len(statements)

    def visible_traits(self, values):
        return {row["id"]: row["avatar"].get("growth_traits", []) for row in values
                if row["id"] in {item["id"] for item in self.items}}

    def test_same_ten_item_output_uses_one_scan_instead_of_ten_independent_reads(self):
        with self.sessions() as db:
            _, empty_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(empty_reads, 0)
            self.traits(db)
            independent, old_shape_reads = self.counted(lambda: [domain.item_view(
                db, self.user, domain.accessible_item(db, self.user, item["id"])) for item in self.items])
            shared, list_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(old_shape_reads, 10)
            self.assertEqual(list_reads, 1)
            self.assertEqual(self.visible_traits(independent), self.visible_traits(shared))

    def test_forget_is_visible_in_next_list_using_the_same_database_session(self):
        with self.sessions() as db:
            self.traits(db)
            memory = foundation.revise_memory(db, self.user, self.report.id,
                "累的时候先听再建议", attributes={"source_quote": self.report.text,
                                             "context": "累的时候", "kind": "preference"})
            initial, initial_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(initial_reads, 1)
            self.assertTrue(all(self.visible_traits(initial).values()))
            domain.remove_memory(db, self.user, memory["id"])
            current, refreshed_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(refreshed_reads, 1)
            self.assertTrue(all(not traits for traits in self.visible_traits(current).values()))
            self.assertFalse(db.get(Memory, memory["id"]).active)

    def test_correction_is_not_hidden_by_a_previous_list_projection(self):
        with self.sessions() as db:
            self.traits(db)
            original = foundation.revise_memory(db, self.user, self.report.id,
                "累的时候先听再建议", attributes={"source_quote": self.report.text,
                                             "context": "累的时候", "kind": "preference"})
            before, _ = self.counted(lambda: domain.list_items(db, self.user))
            self.assertTrue(all(self.visible_traits(before).values()))
            correction = self.message(db, "我换个说法，累的时候也可以先给我一个简单办法。")
            foundation.revise_memory(db, self.user, correction.id,
                "累的时候也可以先给一个简单办法", supersedes_id=original["id"],
                attributes={"source_quote": correction.text, "context": "累的时候", "kind": "preference"})
            self.traits(db, evidence=[{"message_id": correction.id, "quote": correction.text}],
                        selected=[self.items[0]])
            after, reads = self.counted(lambda: domain.list_items(db, self.user))
            current = self.visible_traits(after)
            self.assertEqual(reads, 1)
            self.assertEqual(current[self.items[0]["id"]][0]["evidence"][0]["message_id"], correction.id)
            self.assertTrue(all(not current[item["id"]] for item in self.items[1:]))

    def test_story_permission_stays_current_without_a_memory_scan(self):
        with self.sessions() as db:
            story = domain.create_experience(db, self.user, ExperienceCreate(
                title="一起度过的夜晚", text="模拟经历：那晚只想安静坐着。",
                item_ids=[item["id"] for item in self.items], allow_ai=True))
            self.traits(db, evidence=[{"experience_id": story["id"], "version": story["version"]}])
            initial, initial_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(initial_reads, 0)
            self.assertTrue(all(self.visible_traits(initial).values()))
            interactions.change_experience(db, self.user, story["id"], ExperienceChange(
                title=story["title"], text=story["text"], item_ids=story["item_ids"],
                allow_ai=False, expected_version=story["version"]))
            current, current_reads = self.counted(lambda: domain.list_items(db, self.user))
            self.assertEqual(current_reads, 0)
            self.assertTrue(all(not traits for traits in self.visible_traits(current).values()))


if __name__ == "__main__":
    unittest.main()
