"""Private wall existence is distinct from AI readability and shared ownership.

Synthetic users/items and real isolated SQL/SDK calls. No paid model/network.
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from wujian import domain
from wujian.agent_runtime import make_tools, personal_context
from wujian.api_models import ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Grant, User, make_database


class WallStorageScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=False)
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.owner, self.friend = "synthetic-wall-owner", "synthetic-wall-friend"
        with self.sessions() as db:
            db.add_all([User(id=self.owner, username="wall_owner", display_name="阿禾", password_hash="unused-local-fixture"),
                        User(id=self.friend, username="wall_friend", display_name="小雨", password_hash="unused-local-fixture")])
            db.commit()
            self.a = domain.create_item(db, self.owner, ItemCreate(name="姐姐送的杯子", kind="nonstandard_object"))["id"]
            self.b = domain.create_item(db, self.owner, ItemCreate(name="旅行带回的石头", kind="nonstandard_object"))["id"]
            self.c = domain.create_item(db, self.friend, ItemCreate(name="朋友共享的桌灯", kind="nonstandard_object"))["id"]
            self.private = domain.create_experience(db, self.owner, ExperienceCreate(
                title="secret-title-a", text="secret-body-a", item_ids=[self.a]))
            domain.create_experience(db, self.owner, ExperienceCreate(
                title="公开给自己聊天的合照", text="模拟记录：同一条关联杯子和石头。", item_ids=[self.a, self.b], allow_ai=True))
            domain.create_experience(db, self.owner, ExperienceCreate(
                title="secret-title-b", text="secret-body-b", item_ids=[self.b]))
            domain.create_experience(db, self.friend, ExperienceCreate(
                title="foreign-secret-title", text="foreign-secret-body", item_ids=[self.c], allow_ai=True))
            # Deliberately granted access to the ITEM, not the friend's story.
            db.add(Grant(item_id=self.c, user_id=self.owner))
            conversation = Conversation(user_id=self.owner, item_ids=[self.a], entry_context={"intent": "persona"})
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="姐姐送的这只杯子有什么回忆？")
            db.add(message)
            db.commit()
            self.message_id = message.id

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def test_focused_counts_distinguish_saved_from_readable_without_private_content(self):
        with self.sessions() as db:
            receipt = domain.wall_storage_view(db, self.owner, [self.a])
        self.assertEqual(receipt["saved_record_count"], 3)
        self.assertEqual(receipt["ai_readable_record_count"], 1)
        self.assertEqual(receipt["focused_items"], {
            "item_ids": [self.a], "saved_record_count": 2, "ai_readable_record_count": 1})
        serialized = json.dumps(receipt)
        for secret in ("secret-title-a", "secret-body-a", "secret-title-b", "secret-body-b", self.private["id"]):
            self.assertNotIn(secret, serialized)

    def test_one_record_linked_to_two_focused_objects_is_not_counted_twice(self):
        with self.sessions() as db:
            receipt = domain.wall_storage_view(db, self.owner, [self.a, self.b, self.a])
        self.assertEqual(receipt["focused_items"]["saved_record_count"], 3)
        self.assertEqual(receipt["focused_items"]["ai_readable_record_count"], 1)
        self.assertEqual(receipt["focused_items"]["item_ids"], sorted([self.a, self.b]))

    def test_shared_item_access_never_counts_its_owners_private_wall(self):
        with self.sessions() as db:
            receipt = domain.wall_storage_view(db, self.owner, [self.c])
            self.assertEqual(receipt["focused_items"]["saved_record_count"], 0)
            self.assertEqual(receipt["focused_items"]["ai_readable_record_count"], 0)
            with self.assertRaises(domain.DomainError):
                domain.wall_storage_view(db, self.friend, [self.a])
        self.assertNotIn("foreign-secret", json.dumps(receipt))

    def test_context_and_sdk_recall_report_the_same_scope_without_closed_story(self):
        with self.sessions() as db:
            context = personal_context(db, self.owner, [self.a], True)
        tools = {tool.name: tool for tool in make_tools(
            self.settings, self.sessions, self.owner, self.message_id).tool_groups[0].tools}
        result = asyncio.run(tools["recall_memories"](item_id=self.a))
        self.assertEqual(str(result.state), "success")
        recalled = json.loads(result.content[0].text)
        self.assertEqual(context["wall_storage"], recalled["wall_storage"])
        self.assertEqual(len(recalled["experiences"]), 1)
        for value in (context, recalled):
            serialized = json.dumps(value)
            self.assertNotIn("secret-title-a", serialized)
            self.assertNotIn("secret-body-a", serialized)
            self.assertNotIn(self.private["id"], serialized)


if __name__ == "__main__":
    unittest.main()
