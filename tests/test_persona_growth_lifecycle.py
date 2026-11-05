"""One copied-personal-understanding journey through real SDK tools and SQL.

Fictional handmade gift and user reports; actual temporary SQLite + ReMe BM25.
No model/network API is configured. Explicit persona settings must survive.
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from wujian import domain, foundation, interactions
from wujian.agent_runtime import make_tools
from wujian.api_models import AvatarSpec, ExperienceChange, ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Profile, make_database
from wujian.retrieval import Retrieval, authorized_documents


class PersonaGrowthLifecycleTests(unittest.TestCase):
    def test_retired_growth_evidence_is_not_reintroduced_as_current_persona(self):
        for mode in ("forget_understanding", "correct_understanding", "disable_story_ai", "delete_story"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                asyncio.run(self.exercise(Path(directory), mode))

    async def exercise(self, directory, mode):
        settings = Settings(data_dir=directory, api_key="", rea_enabled=False)
        settings.prepare()
        engine, sessions = make_database(settings)
        user_id = "person_demo_owner"
        uses_story = mode in {"disable_story_ai", "delete_story"}
        explicit_personality = "话少，偶尔开一个温柔的小玩笑"
        old_growth = "因为那次搬家你很害怕独处，我会一直把你当作害怕独处的人陪伴"
        with sessions() as db:
            domain.seed_demo(db)
            item = domain.create_item(db, user_id, ItemCreate(name="阿禾捏的小陶猫",
                kind="nonstandard_object", avatar=AvatarSpec(enabled=True,
                    nickname="芝麻", personality=explicit_personality)))
            conversation = Conversation(user_id=user_id)
            db.add(conversation)
            db.flush()
            report = ChatMessage(conversation_id=conversation.id, role="user",
                text="你结合那篇搬家回忆，长出一点我们之间的默契吧。" if uses_story
                    else "搬家的那晚我确实害怕一个人，你这只小陶猫陪着我。")
            db.add(report)
            db.commit()
            message_id = report.id
            memory = None if uses_story else foundation.revise_memory(db, user_id, message_id,
                "搬家那晚害怕独处", item_id=item["id"],
                attributes={"kind": "event", "context": "搬家的那晚", "source_quote": report.text})
            story = domain.create_experience(db, user_id, ExperienceCreate(
                title="搬家那晚", text="搬家的那晚我确实害怕一个人，你这只小陶猫陪着我。",
                item_ids=[item["id"]], allow_ai=True)) if uses_story else None

        retrieval = Retrieval(settings, sessions)
        toolkit = make_tools(settings, sessions, user_id, message_id, retrieval=retrieval)
        tools = {tool.name: tool for tool in toolkit.tool_groups[0].tools}
        try:
            growth = await tools["evolve_avatar"](item_id=item["id"], growth_note=old_growth,
                source_quote="" if uses_story else "搬家的那晚我确实害怕一个人",
                experience_ids=[story["id"]] if uses_story else [])
            self.assertEqual(str(growth.state), "success")
            baseline = await tools["read_item"](item_id=item["id"])
            self.assertIn(old_growth, baseline.content[0].text)

            with sessions() as db:
                if mode == "forget_understanding":
                    domain.remove_memory(db, user_id, memory["id"])
                elif mode == "correct_understanding":
                    correction = ChatMessage(conversation_id=conversation.id, role="user",
                        text="只有搬家那晚不太适应，平时我很享受独处，别一直把我当作害怕一个人的人。")
                    db.add(correction)
                    db.commit()
                    foundation.revise_memory(db, user_id, correction.id,
                        "平时享受独处，仅搬家那晚不适应", item_id=item["id"], supersedes_id=memory["id"],
                        attributes={"kind": "event", "context": "搬家的那晚",
                            "source_quote": correction.text})
                elif mode == "disable_story_ai":
                    interactions.change_experience(db, user_id, story["id"], ExperienceChange(
                        title=story["title"], text=story["text"], item_ids=story["item_ids"],
                        allow_ai=False, expected_version=story["version"]))
                else:
                    interactions.delete_experience(db, user_id, story["id"], story["version"])

            # Read through the same SDK tools used by the main Agent, then
            # rebuild/refresh the actual ReMe projection, with no model key.
            current = await tools["read_item"](item_id=item["id"])
            self.assertEqual(str(current.state), "success")
            read_value = json.loads(current.content[0].text)
            projection = authorized_documents(sessions, user_id)["item/" + item["id"]]["data"]
            search = await tools["search_world"](query=old_growth, kinds=["item"])
            self.assertEqual(str(search.state), "success")
            search_value = json.loads(search.content[0].text)
            with sessions() as db:
                explicit = db.get(Profile, (user_id, item["id"])).avatar
                self.assertEqual(explicit["nickname"], "芝麻")
                self.assertEqual(explicit["personality"], explicit_personality)
                self.assertTrue(explicit["enabled"])
            observed = {"read_item": old_growth in json.dumps(read_value, ensure_ascii=False),
                        "item_projection": old_growth in json.dumps(projection, ensure_ascii=False),
                        "search_world": old_growth in json.dumps(search_value, ensure_ascii=False)}
            self.assertFalse(any(observed.values()),
                f"{mode}: retired personal interpretation returned as current avatar: {observed}")
        finally:
            await retrieval.close()
            engine.dispose()
