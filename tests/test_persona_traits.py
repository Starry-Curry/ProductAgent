"""SQL-backed persona control journeys with fictional Chinese conversations.

No API/model or personal media is used. These checks prove projection and
permission behavior, not the quality of an LLM's interpretation of a story.
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from wujian import domain, foundation, interactions
from wujian.agent_runtime import make_tools, personal_context
from wujian.api_models import AvatarSpec, ExperienceChange, ExperienceCreate, ItemChange, ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Profile, make_database
from wujian.persona_models import GrowthEvidence, GrowthTraitProposal, growth_trait_id
from wujian.memory_lifecycle import filter_persona_memories, filter_persona_retrieval, prepare_growth_trait, stamp_growth_evidence
from wujian.retrieval import Retrieval, authorized_documents


class PersonaTraitsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name), api_key="")
        self.settings = settings
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.user = "person_demo_owner"
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item = domain.create_item(db, self.user, ItemCreate(
                name="朋友织的小企鹅", kind="nonstandard_object",
                avatar=AvatarSpec(enabled=True, nickname="糯米", form="keepsake",
                                  personality="慢半拍，偶尔有点冷幽默")))

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def message(self, db, text, user=None, role="user"):
        conversation = Conversation(user_id=user or self.user,
            item_ids=[self.item["id"]], entry_context={"intent": "persona"})
        db.add(conversation)
        db.flush()
        message = ChatMessage(conversation_id=conversation.id, role=role, text=text)
        db.add(message)
        db.commit()
        return message

    def trait(self, dimension, behavior, context, evidence):
        return {"id": growth_trait_id(dimension, context), "dimension": dimension,
                "behavior": behavior, "context": context, "evidence": evidence}

    def save_traits(self, db, traits, **settings):
        profile = db.get(Profile, (self.user, self.item["id"]))
        profile.avatar = {**profile.avatar, "growth_traits": traits, **settings}
        db.commit()

    def projected(self, db):
        return domain.item_view(db, self.user, domain.accessible_item(
            db, self.user, self.item["id"]))["avatar"]

    def stop_trait(self, db, identity):
        item = domain.item_view(db, self.user, domain.accessible_item(db, self.user, self.item["id"]))
        avatar = AvatarSpec(**{key: value for key, value in item["avatar"].items()
                              if key in AvatarSpec.model_fields})
        avatar.growth_dismissed_ids = [*avatar.growth_dismissed_ids, identity]
        return domain.change_item(db, self.user, item["id"], ItemChange(
            name=item["name"], kind=item["kind"], product=item["product"],
            description=item["description"], photo_id=item["photo_id"], state=item["state"],
            avatar=avatar, expected_version=item["version"]))

    def test_stopped_sources_cannot_return_with_synonymous_context_or_fresh_anchors(self):
        with self.sessions() as db:
            old = self.message(db, "我下班累的时候，先听我说，别急着给安排。")
            fresh = self.message(db, "今天想聊别的。")
            original = self.trait("support", "先听，不主动列安排", "下班疲惫时",
                [{"message_id": old.id, "quote": old.text}])
            alias = self.trait("support", "先陪着听，不急着建议安排", "工作后很累的聊天",
                [{"message_id": old.id, "quote": "先听我说"}])
            self.save_traits(db, [original], growth_dismissed_ids=[original["id"]])
            profile = db.get(Profile, (self.user, self.item["id"]))
            with self.assertRaises(ValueError):
                prepare_growth_trait(db, profile.avatar, alias)
            # A fresh unrelated quote must not wash away the stopped source.
            alias["evidence"].append({"message_id": fresh.id, "quote": fresh.text})
            with self.assertRaises(ValueError):
                prepare_growth_trait(db, profile.avatar, alias)
            self.save_traits(db, [original, alias], growth_dismissed_ids=[original["id"]])
            self.assertEqual(self.projected(db)["growth_traits"], [])

    def test_new_independent_message_can_renew_same_context_without_erasing_stop(self):
        with self.sessions() as db:
            old = self.message(db, "累的时候先听我说就好。")
            renewed = self.message(db, "我又想清楚了，以后下班累的时候还是先听我说吧。")
            original = self.trait("support", "先听", "下班疲惫时",
                [{"message_id": old.id, "quote": old.text}])
            self.save_traits(db, [original], growth_dismissed_ids=[original["id"]])
            proposal = self.trait("support", "先听，再按当下请求回应", "下班疲惫时",
                [{"message_id": renewed.id, "quote": renewed.text}])
            avatar = db.get(Profile, (self.user, self.item["id"])).avatar
            prepared = prepare_growth_trait(db, avatar, proposal)
            self.assertNotEqual(prepared["id"], original["id"])
            self.assertEqual(prepare_growth_trait(db, avatar, proposal), prepared)
            self.save_traits(db, [original, prepared], growth_dismissed_ids=[original["id"]])
            self.assertEqual(self.projected(db)["growth_traits"], [prepared])
            with self.assertRaises(ValueError):
                prepare_growth_trait(db, db.get(Profile, (self.user, self.item["id"])).avatar,
                    {**original, "id": growth_trait_id("support", "另一种累的时候")})

    def test_story_version_or_received_copy_cannot_revive_stopped_dimension(self):
        with self.sessions() as db:
            original = domain.create_experience(db, self.user, ExperienceCreate(
                title="雨天一起坐着", text="模拟故事：那天只想被听见，不想听建议。",
                item_ids=[self.item["id"]], allow_ai=True))
            copy = domain.create_experience(db, self.user, ExperienceCreate(
                title="留下的同一段故事", text=original["text"], item_ids=[self.item["id"]], allow_ai=True))
            from wujian.database import ExperienceRecord
            db.get(ExperienceRecord, copy["id"]).origin_id = original["id"]
            db.commit()
            stopped = self.trait("support", "先听", "回想雨天",
                [{"experience_id": original["id"], "version": original["version"]}])
            self.save_traits(db, [stopped], growth_dismissed_ids=[stopped["id"]])
            avatar = db.get(Profile, (self.user, self.item["id"])).avatar
            for identity, version in ((original["id"], 2), (copy["id"], copy["version"])):
                candidate = self.trait("support", "安静听，不急着建议", "雨天相处的样子",
                    [{"experience_id": identity, "version": version}])
                with self.subTest(identity=identity), self.assertRaises(ValueError):
                    prepare_growth_trait(db, avatar, candidate)
            # Stopping support does not erase another dimension's use of that story.
            relationship = self.trait("relationship", "记得一起度过那个雨天", "说起雨天",
                [{"experience_id": original["id"], "version": original["version"], "quote": ""}])
            self.assertEqual(prepare_growth_trait(db, avatar, relationship), relationship)
            self.save_traits(db, [stopped, relationship], growth_dismissed_ids=[stopped["id"]])
            self.assertEqual(self.projected(db)["growth_traits"], [relationship])

    def test_local_stop_control_does_not_reintroduce_globally_forgotten_content(self):
        with self.sessions() as db:
            message = self.message(db, "搬家那晚我不太适应，只想你安静陪着。")
            memory = foundation.revise_memory(db, self.user, message.id,
                "搬家那晚想要安静陪伴", item_id=self.item["id"],
                attributes={"context": "搬家那晚", "kind": "event", "source_quote": message.text})
            trait = self.trait("support", "那晚不主动给建议，安静陪伴", "谈起搬家那晚",
                [{"message_id": message.id, "quote": message.text}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            controls = self.projected(db)["growth_stopped_traits"]
            self.assertEqual(controls, [{key: trait[key] for key in ("dimension", "behavior", "context")}])
            self.assertNotIn(message.id, json.dumps(controls))
            self.assertNotIn(message.text, json.dumps(controls, ensure_ascii=False))
            domain.remove_memory(db, self.user, memory["id"])
            self.assertEqual(self.projected(db)["growth_stopped_traits"], [])
            profile = db.get(Profile, (self.user, self.item["id"]))
            with self.assertRaises(ValueError):
                prepare_growth_trait(db, profile.avatar,
                    {**trait, "id": growth_trait_id("support", "其他相处的说法")})

    def test_local_stop_does_not_forget_shared_preference_or_change_other_companion(self):
        with self.sessions() as db:
            message = self.message(db, "下班累的时候，我通常想先被听见，别急着给建议。")
            memory = foundation.revise_memory(db, self.user, message.id,
                "下班累时先听再建议", attributes={"context": "下班疲惫", "kind": "preference",
                                                  "source_quote": message.text})
            trait = self.trait("support", "先听再建议", "下班疲惫",
                [{"message_id": message.id, "quote": message.text}])
            other = domain.create_item(db, self.user, ItemCreate(name="海边的石头", kind="nonstandard_object",
                avatar=AvatarSpec(enabled=True, nickname="小石")))
            profile = db.get(Profile, (self.user, other["id"]))
            profile.avatar = {**profile.avatar, "growth_traits": [trait]}
            db.commit()
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            self.assertEqual(self.projected(db)["growth_traits"], [])
            other_view = domain.item_view(db, self.user, domain.accessible_item(db, self.user, other["id"]))
            self.assertEqual(other_view["avatar"]["growth_traits"], [trait])
            self.assertIn(memory["id"], {row["id"] for row in domain.recall(db, self.user)})

    def test_local_story_stop_description_disappears_on_permission_withdrawal(self):
        with self.sessions() as db:
            story = domain.create_experience(db, self.user, ExperienceCreate(
                title="特别的那一天", text="模拟私密回忆：想要一点安静。",
                item_ids=[self.item["id"]], allow_ai=True))
            trait = self.trait("support", "提起特别那天先安静听", "回忆特别的那一天",
                [{"experience_id": story["id"], "version": story["version"]}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            self.assertEqual(len(self.projected(db)["growth_stopped_traits"]), 1)
            interactions.change_experience(db, self.user, story["id"], ExperienceChange(
                title=story["title"], text=story["text"], item_ids=story["item_ids"],
                allow_ai=False, expected_version=story["version"]))
            self.assertEqual(self.projected(db)["growth_stopped_traits"], [])

    def test_persona_memory_projection_checks_current_and_retained_evidence_without_sql_changes(self):
        with self.sessions() as db:
            old = self.message(db, "以后我说下班啦，你先说小鱼干收到，我喜欢这个暗号。")
            current = self.message(db, "我今天想聊点别的。")
            unrelated = foundation.revise_memory(db, self.user, current.id, "今天想随便聊聊",
                attributes={"source_quote": current.text, "context": "今天", "kind": "goal"})
            original = foundation.revise_memory(db, self.user, old.id, "下班问候喜欢小鱼干收到",
                attributes={"source_quote": old.text, "context": "下班问候", "kind": "preference"})
            # A repeated understanding has a current source plus historical
            # evidence. The old source must not disappear from the check.
            repeated = {**original, "id": "repeated-understanding", "source_message_id": current.id,
                "attributes": {"evidence": [{"message_id": old.id, "quote": old.text},
                                              {"message_id": current.id, "quote": current.text}]}}
            trait = self.trait("relationship", "下班时先说小鱼干收到", "下班问候",
                [{"message_id": old.id, "quote": old.text}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            rows = domain.recall(db, self.user)
            filtered = filter_persona_memories(db, self.user, self.item["id"], [*rows, repeated])
            self.assertEqual({row["id"] for row in filtered}, {unrelated["id"]})
            self.assertEqual(filter_persona_memories(db, self.user, None, rows), rows)
            self.assertIn(original["id"], {row["id"] for row in domain.recall(db, self.user)})

    def test_persona_retrieval_projection_hides_same_source_understanding_not_original_story(self):
        with self.sessions() as db:
            old = self.message(db, "下班时叫我小鱼干，我喜欢这个暗号。")
            trait = self.trait("relationship", "下班用小鱼干暗号", "下班时",
                [{"message_id": old.id, "quote": old.text}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            rows = {"mode": "keyword_only", "results": [
                {"kind": "memory", "id": "memory", "data": {"source_message_id": old.id}},
                {"kind": "conversation", "id": old.id, "data": {"user_message_id": old.id}},
                {"kind": "experience", "id": "story", "data": {"title": "下班那天"}},
                {"kind": "item", "id": self.item["id"], "data": {"item_id": self.item["id"]}},
            ]}
            projected = filter_persona_retrieval(db, self.user, self.item["id"], rows)
            self.assertEqual([hit["kind"] for hit in projected["results"]], ["experience", "item"])
            self.assertEqual(len(rows["results"]), 4)

    def test_stamped_story_lineage_survives_deleted_received_copy(self):
        with self.sessions() as db:
            root = domain.create_experience(db, self.user, ExperienceCreate(
                title="原故事", text="模拟：那天一起安静坐着。", item_ids=[self.item["id"]], allow_ai=True))
            copy = domain.create_experience(db, self.user, ExperienceCreate(
                title="收到的原故事副本", text=root["text"], item_ids=[self.item["id"]], allow_ai=True))
            from wujian.database import ExperienceRecord
            db.get(ExperienceRecord, copy["id"]).origin_id = root["id"]
            db.commit()
            anchor = stamp_growth_evidence(db, {"experience_id": copy["id"], "version": copy["version"],
                                                "lineage_id": "not-trusted-input"})
            self.assertEqual(anchor["lineage_id"], root["id"])
            stopped = self.trait("support", "先听", "累时", [anchor])
            self.save_traits(db, [stopped], growth_dismissed_ids=[stopped["id"]])
            interactions.delete_experience(db, self.user, copy["id"], copy["version"])
            new_copy = domain.create_experience(db, self.user, ExperienceCreate(
                title="再次收到同源故事", text=root["text"], item_ids=[self.item["id"]], allow_ai=True))
            db.get(ExperienceRecord, new_copy["id"]).origin_id = root["id"]
            db.commit()
            new_anchor = stamp_growth_evidence(db, {"experience_id": new_copy["id"], "version": new_copy["version"]})
            candidate = self.trait("support", "安静听", "另种累的时候", [new_anchor])
            with self.assertRaises(ValueError):
                prepare_growth_trait(db, db.get(Profile, (self.user, self.item["id"])).avatar, candidate)

    def test_actual_sdk_recall_and_search_keep_local_stopped_preference_out_of_context(self):
        asyncio.run(self.sdk_local_memory_projection())

    async def sdk_local_memory_projection(self):
        with self.sessions() as db:
            old = self.message(db, "以后我说下班啦，你先说小鱼干收到，我喜欢这个暗号。")
            db.add(ChatMessage(conversation_id=old.conversation_id, role="assistant", text="小鱼干收到。"))
            db.commit()
            memory = foundation.revise_memory(db, self.user, old.id, "下班问候喜欢小鱼干收到",
                attributes={"context": "下班问候", "kind": "preference", "source_quote": old.text})
            trait = self.trait("relationship", "下班时先说小鱼干收到", "下班问候",
                [{"message_id": old.id, "quote": old.text}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]])
            current = self.message(db, "下班啦，找找以前那段暗号的事。")
            primed = personal_context(db, self.user, [self.item["id"]], persona=True)
            self.assertNotIn(memory["id"], {row["id"] for row in primed["active_personal_memories"]})
            general = personal_context(db, self.user, [self.item["id"]], persona=False)
            self.assertIn(memory["id"], {row["id"] for row in general["active_personal_memories"]})
        retrieval = Retrieval(self.settings, self.sessions)
        toolkit = make_tools(self.settings, self.sessions, self.user, current.id, retrieval=retrieval)
        tools = {tool.name: tool for tool in toolkit.tool_groups[0].tools}
        try:
            plain = await tools["recall_memories"](item_id=self.item["id"])
            self.assertEqual(str(plain.state), "success", str(plain))
            self.assertEqual(json.loads(plain.content[0].text)["memories"], [])
            for name, kwargs in (("recall_memories", {"query": "小鱼干"}),
                                 ("search_world", {"query": "小鱼干", "kinds": ["memory", "conversation"]})):
                result = await tools[name](**kwargs)
                self.assertEqual(str(result.state), "success", str(result))
                hits = json.loads(result.content[0].text)["results"]
                self.assertTrue(all(hit["kind"] not in {"memory", "conversation"} for hit in hits))
            # The same underlying records still exist in the reusable index
            # for the global companion and other authorized consumers.
            raw = await retrieval.search(self.user, "小鱼干", ["memory", "conversation"])
            self.assertIn(memory["id"], {hit["id"] for hit in raw["results"]})
        finally:
            await retrieval.close()

    def test_actual_sdk_stamps_original_story_lineage_before_received_copy_is_deleted(self):
        asyncio.run(self.sdk_deleted_story_lineage())

    async def sdk_deleted_story_lineage(self):
        from wujian.database import ExperienceRecord
        with self.sessions() as db:
            message = self.message(db, "参考那篇收到的故事，长出一点相处特点。")
            root = domain.create_experience(db, self.user, ExperienceCreate(
                title="原故事", text="模拟：那天一起安静坐着。", item_ids=[self.item["id"]], allow_ai=True))
            copy = domain.create_experience(db, self.user, ExperienceCreate(
                title="收到的副本", text=root["text"], item_ids=[self.item["id"]], allow_ai=True))
            db.get(ExperienceRecord, copy["id"]).origin_id = root["id"]
            db.commit()
        toolkit = make_tools(self.settings, self.sessions, self.user, message.id)
        evolve = next(tool for tool in toolkit.tool_groups[0].tools if tool.name == "evolve_avatar")
        proposal = {"dimension": "support", "behavior": "先安静听", "context": "聊到疲惫的那晚",
                    "source_quote": "", "experience_ids": [copy["id"]]}
        result = await evolve(item_id=self.item["id"], traits=[proposal])
        self.assertEqual(str(result.state), "success", str(result))
        recorded = json.loads(result.content[0].text)["growth_traits"][0]
        self.assertEqual(recorded["evidence"][0]["lineage_id"], root["id"])
        with self.sessions() as db:
            self.stop_trait(db, recorded["id"])
            interactions.delete_experience(db, self.user, copy["id"], copy["version"])
            second = domain.create_experience(db, self.user, ExperienceCreate(
                title="又收到的同源副本", text=root["text"], item_ids=[self.item["id"]], allow_ai=True))
            db.get(ExperienceRecord, second["id"]).origin_id = root["id"]
            db.commit()
        alias = await evolve(item_id=self.item["id"], traits=[
            {**proposal, "context": "下班很累的聊天", "experience_ids": [second["id"]]}])
        self.assertNotEqual(str(alias.state), "success", str(alias))
        with self.sessions() as db:
            self.assertEqual(self.projected(db)["growth_traits"], [])

    def test_actual_sdk_tool_rejects_alias_and_accepts_new_current_preference(self):
        asyncio.run(self.sdk_stop_journey())

    async def sdk_stop_journey(self):
        with self.sessions() as db:
            first = self.message(db, "我下班累的时候，先听我说，别急着给安排。")
        def evolve_for(message):
            toolkit = make_tools(self.settings, self.sessions, self.user, message.id)
            return next(tool for tool in toolkit.tool_groups[0].tools if tool.name == "evolve_avatar")
        proposal = {"dimension": "support", "behavior": "先听，不主动列安排", "context": "下班疲惫时",
                    "source_quote": first.text, "experience_ids": []}
        first_result = await evolve_for(first)(item_id=self.item["id"], traits=[proposal])
        self.assertEqual(str(first_result.state), "success")
        first_value = json.loads(first_result.content[0].text)
        stopped_id = first_value["growth_traits"][0]["id"]
        with self.sessions() as db:
            self.stop_trait(db, stopped_id)
        alias = await evolve_for(first)(item_id=self.item["id"], traits=[
            {**proposal, "context": "工作后很累的聊天", "behavior": "先陪着听，不急着建议安排"}])
        self.assertNotEqual(str(alias.state), "success", str(alias))
        with self.sessions() as db:
            self.assertEqual(self.projected(db)["growth_traits"], [])
            current = self.message(db, "我又想清楚了，之后下班累的时候先听我聊就好。")
        renewed = await evolve_for(current)(item_id=self.item["id"], traits=[
            {**proposal, "source_quote": current.text}])
        self.assertEqual(str(renewed.state), "success", str(renewed))
        with self.sessions() as db:
            profile = db.get(Profile, (self.user, self.item["id"]))
            self.assertIn(stopped_id, profile.avatar["growth_dismissed_ids"])
            self.assertIn(stopped_id, {trait["id"] for trait in profile.avatar["growth_traits"]})
            current_traits = self.projected(db)["growth_traits"]
            self.assertEqual(len(current_traits), 1)
            self.assertNotEqual(current_traits[0]["id"], stopped_id)
            self.assertEqual(current_traits[0]["evidence"][0]["message_id"], current.id)

    def test_actual_sdk_multiple_story_sources_do_not_revive_after_stop_or_edit(self):
        asyncio.run(self.sdk_story_stop_journey())

    async def sdk_story_stop_journey(self):
        with self.sessions() as db:
            message = self.message(db, "你可以参考这两段记录，慢慢长出我们之间的默契。")
            stories = [domain.create_experience(db, self.user, ExperienceCreate(
                title=title, text=text, item_ids=[self.item["id"]], allow_ai=True))
                for title, text in (("那个雨天", "模拟：那天下班很累，和企鹅一起安静坐着。"),
                                    ("搬家第一晚", "模拟：那天只想有个安静的陪伴。"))]
        toolkit = make_tools(self.settings, self.sessions, self.user, message.id)
        evolve = next(tool for tool in toolkit.tool_groups[0].tools if tool.name == "evolve_avatar")
        proposal = {"dimension": "support", "behavior": "累的时候先安静听", "context": "疲惫时一起待着",
                    "source_quote": "", "experience_ids": [story["id"] for story in stories]}
        result = await evolve(item_id=self.item["id"], traits=[proposal])
        self.assertEqual(str(result.state), "success", str(result))
        stopped = json.loads(result.content[0].text)["growth_traits"][0]
        with self.sessions() as db:
            self.stop_trait(db, stopped["id"])
            original = stories[0]
            interactions.change_experience(db, self.user, original["id"], ExperienceChange(
                title=original["title"], text=original["text"] + "只记录那一天。",
                item_ids=original["item_ids"], allow_ai=True, expected_version=original["version"]))
        for story in stories:
            # Reusing a single part of the stopped multi-source interpretation,
            # including the now-edited version, cannot bypass owner control.
            result = await evolve(item_id=self.item["id"], traits=[
                {**proposal, "context": "下班后很累的相处", "experience_ids": [story["id"]]}])
            self.assertNotEqual(str(result.state), "success", str(result))
        other = await evolve(item_id=self.item["id"], traits=[{
            **proposal, "dimension": "relationship", "behavior": "珍惜用户分享的那两个夜晚",
            "context": "提到那两段经历时"}])
        self.assertEqual(str(other.state), "success", str(other))
        with self.sessions() as db:
            visible = self.projected(db)["growth_traits"]
            self.assertEqual([trait["dimension"] for trait in visible], ["relationship"])

    def test_withdrawing_one_understanding_preserves_unrelated_growth(self):
        with self.sessions() as db:
            tired = self.message(db, "以后我累的时候，先听我聊，别急着安排任务。")
            joke = self.message(db, "聊开心的事可以轻轻开个玩笑，我喜欢这样。")
            memory = foundation.revise_memory(db, self.user, tired.id,
                "累的时候先听再建议", item_id=self.item["id"],
                attributes={"context": "疲惫时聊天", "kind": "preference", "source_quote": tired.text})
            support = self.trait("support", "先听，不主动列待办", "疲惫时聊天",
                [{"message_id": tired.id, "quote": tired.text}])
            humor = self.trait("humor", "可以轻轻打趣", "分享开心的事",
                [{"message_id": joke.id, "quote": joke.text}])
            self.save_traits(db, [support, humor])
            self.assertEqual(len(self.projected(db)["growth_traits"]), 2)
            domain.remove_memory(db, self.user, memory["id"])
            current = self.projected(db)
            self.assertEqual([trait["id"] for trait in current["growth_traits"]], [humor["id"]])
            self.assertEqual(current["personality"], "慢半拍，偶尔有点冷幽默")
        projected = authorized_documents(self.sessions, self.user)["item/" + self.item["id"]]["data"]
        self.assertEqual([trait["id"] for trait in projected["avatar"]["growth_traits"]], [humor["id"]])

    def test_growth_can_stop_without_deleting_original_story_or_appearance(self):
        with self.sessions() as db:
            message = self.message(db, "以后叫我阿禾就好。")
            trait = self.trait("relationship", "用阿禾这个称呼", "日常聊天",
                [{"message_id": message.id, "quote": message.text}])
            self.save_traits(db, [trait], growth_enabled=False)
            current = self.projected(db)
            self.assertEqual(current["growth_traits"], [])
            self.assertEqual(current["nickname"], "糯米")
            self.assertEqual(current["form"], "keepsake")
            self.assertEqual(db.get(Profile, (self.user, self.item["id"])).avatar["growth_traits"], [trait])
            self.assertEqual(db.get(ChatMessage, message.id).text, message.text)

    def test_mixed_legacy_summary_cannot_return_when_structured_growth_is_stopped(self):
        with self.sessions() as db:
            message = self.message(db, "我累的时候先听我说吧。")
            trait = self.trait("support", "先听我说", "累的时候",
                [{"message_id": message.id, "quote": message.text}])
            self.save_traits(db, [trait], growth_dismissed_ids=[trait["id"]],
                growth_note="我会一直在累的时候先听你说", growth_source=message.id,
                growth_evidence=trait["evidence"])
            current = self.projected(db)
            self.assertEqual(current["growth_traits"], [])
            self.assertNotIn("growth_note", current)
            self.assertNotIn("growth_source", current)
            self.assertNotIn("growth_evidence", current)

    def test_stop_individual_trait_keeps_same_story_and_other_expression(self):
        with self.sessions() as db:
            message = self.message(db, "我想听短一点，可以偶尔来个小玩笑。")
            evidence = [{"message_id": message.id, "quote": message.text}]
            pace = self.trait("pace", "先说一两句", "日常闲聊", evidence)
            humor = self.trait("humor", "偶尔轻轻打趣", "日常闲聊", evidence)
            self.save_traits(db, [pace, humor], growth_dismissed_ids=[humor["id"]])
            self.assertEqual([trait["id"] for trait in self.projected(db)["growth_traits"]], [pace["id"]])
            self.assertIsNotNone(db.get(ChatMessage, message.id))

    def test_story_permission_version_and_deletion_invalidate_derived_expression(self):
        for operation in ("withdraw", "edit", "delete"):
            with self.subTest(operation=operation), self.sessions() as db:
                story = domain.create_experience(db, self.user, ExperienceCreate(
                    title="搬家后的夜晚", text="模拟：那晚不太适应新房子，这只企鹅陪我坐了一会儿。",
                    item_ids=[self.item["id"]], allow_ai=True))
                trait = self.trait("relationship", "珍惜一起安静待着的时刻", "谈起搬家那晚",
                    [{"experience_id": story["id"], "version": story["version"]}])
                self.save_traits(db, [trait])
                self.assertEqual(len(self.projected(db)["growth_traits"]), 1)
                if operation == "delete":
                    interactions.delete_experience(db, self.user, story["id"], story["version"])
                else:
                    interactions.change_experience(db, self.user, story["id"], ExperienceChange(
                        title=story["title"], text=story["text"] + ("只是那天。" if operation == "edit" else ""),
                        item_ids=story["item_ids"], allow_ai=operation != "withdraw",
                        expected_version=story["version"]))
                self.assertEqual(self.projected(db)["growth_traits"], [])

    def test_untrusted_or_malformed_anchors_never_enter_current_persona(self):
        with self.sessions() as db:
            foreign = self.message(db, "我喜欢被叫小宝。", user="person_demo_friend")
            assistant = self.message(db, "你一定喜欢冷幽默。", role="assistant")
            own = self.message(db, "别突然给我起新外号。")
            evidence_sets = [
                [{"message_id": foreign.id, "quote": foreign.text}],
                [{"message_id": assistant.id, "quote": assistant.text}],
                [{"message_id": own.id, "quote": "我喜欢新外号"}],
                [{"message_id": own.id, "quote": ""}],
                [{"message_id": own.id, "quote": own.text, "experience_id": "forged", "version": 1}],
            ]
            for evidence in evidence_sets:
                with self.subTest(evidence=evidence):
                    self.save_traits(db, [self.trait("relationship", "使用新外号", "聊天时", evidence)])
                    self.assertEqual(self.projected(db)["growth_traits"], [])

    def test_proposals_need_specific_behavior_context_and_actual_source(self):
        for fields in ({"source_quote": ""}, {"source_quote": "原话", "context": " "},
                       {"source_quote": "原话", "behavior": " "}):
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                GrowthTraitProposal(**{"dimension": "support", "behavior": "先听", "context": "累的时候", **fields})
        with self.assertRaises(ValidationError):
            GrowthEvidence(message_id="message", quote="原话", experience_id="story", version=1)
        with self.assertRaises(ValidationError):
            GrowthTraitProposal(dimension="relationship", behavior="用专属暗号", context="下班",
                source_quote="用户原话", lineage_id="model-chosen-source")

    def test_same_situation_has_stable_identity_but_context_and_dimension_matter(self):
        self.assertEqual(growth_trait_id("pace", "  日常  闲聊 "), growth_trait_id("pace", "日常 闲聊"))
        self.assertNotEqual(growth_trait_id("pace", "日常闲聊"), growth_trait_id("pace", "排查设备故障"))
        self.assertNotEqual(growth_trait_id("pace", "日常闲聊"), growth_trait_id("support", "日常闲聊"))
        self.assertNotEqual(growth_trait_id("pace", "早上/晚上"), growth_trait_id("pace", "早上晚上"))


if __name__ == "__main__":
    unittest.main()
