"""Shared Skill activation through the real runner/SDK; model boundary is offline."""
import asyncio
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path

from agentscope.skill import LocalSkillLoader
from fastapi.testclient import TestClient

from tests.test_agent_plan_contract import ContractModel
from wujian.api_models import TaskEntry
from wujian.config import ROOT, Settings
from wujian.database import TaskRecord
from wujian.lessons import LESSON_SYSTEM
from wujian.server import create_app


class SkillContractModel(ContractModel):
    def __init__(self):
        super().__init__()
        self.captured = []

    async def _call_api(self, model_name, messages, **kwargs):
        self.captured.append(copy.deepcopy(messages))
        return await super()._call_api(model_name, messages, **kwargs)


class GuidanceSkillLoadingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = SkillContractModel()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="offline-no-network", rea_enabled=False),
                              model_factory=lambda _: self.model)
        self.client = TestClient(self.app).__enter__()
        self.client.post("/api/auth/demo/xiaolin")
        self.owner = "person_demo_owner"
        self.item = self.ok(self.client.post("/api/items", json={"name": "离线样本卡片", "kind": "nonstandard_object"}))
        self.skills = {}
        for name in ("product-guidance", "creative-use"):
            self.skills[name] = asyncio.run(LocalSkillLoader(str(ROOT / "agent_skills" / name)).list_skills())[0].markdown

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def final(self, continuation=None):
        return {"answer": "先观察卡片表面是否平整，再决定下一步。", "continuation": continuation,
                "learning": {"knowledge_updates": [], "memory_updates": []}, "source_refs": [], "story_refs": []}

    def entry(self, identity="observe", state="pending"):
        return TaskEntry(id=identity, title="已报告卡片位置" if identity == "reported" else "观察卡片表面", item_id=self.item["id"], group="step",
                         state=state, note="保留用户已经报告的状态").model_dump()

    def task(self, kind, *, lesson=False):
        entries = [self.entry("reported", "ready"), self.entry()]
        plan = {"schema": "interaction/1", "kind": kind, "entries": entries}
        if lesson:
            entries = [self.entry()]
            entries[0]["guidance"] = {"kind": "observe", "basis": "general", "instruction": "先观察卡片表面是否平整。",
                                      "success_signal": "说说看到的表面", "evidence": []}
            plan.update(entries=entries, guidance={"active_step_id": "observe", "observations": [],
                "lesson": {"id": "synthetic-lesson", "phase": "waiting", "inputs": {},
                    "definition": {"steps": [{"id": "observe", "explanation": "先观察再决定动作。"}], "controls": [], "profiles": []}}})
        with self.app.state.sessions() as db:
            row = TaskRecord(user_id=self.owner, source_message_id="offline-fixture", goal="观察同一张卡片",
                             item_ids=[self.item["id"]], constraints={}, plan=plan, status="in_progress")
            db.add(row); db.commit()
            return {"id": row.id, "version": row.version, "goal": row.goal, "plan": copy.deepcopy(row.plan)}

    def run_turn(self, intent, proposals, task=None):
        self.model.proposals, self.model.inputs, self.model.calls = proposals, [], 0
        self.model.captured = []
        context = {"intent": intent, **({"task_id": task["id"]} if task else {})}
        run = self.ok(self.client.post("/api/chat", json={"text": "为什么这一步先观察表面？", "item_ids": [self.item["id"]],
                                                        "entry_context": context}))
        end = time.monotonic() + 9
        while run["status"] in {"queued", "running"} and time.monotonic() < end:
            time.sleep(.02)
            run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "completed", run)
        return run

    def input_text(self, index=0):
        def strings(value):
            if hasattr(value, "model_dump"):
                yield from strings(value.model_dump(mode="json"))
            elif isinstance(value, str):
                yield value
            elif isinstance(value, list):
                for child in value:
                    yield from strings(child)
            elif isinstance(value, dict):
                for child in value.values():
                    yield from strings(child)
        return "\n".join(strings(self.model.captured[index]))

    def loaded(self, run):
        return [event["name"] for event in run["events"] if event["type"] == "skill_loaded"]

    def test_guidance_preloads_one_shared_method_and_beats_old_idea_context(self):
        old = self.task("idea")
        run = self.run_turn("guidance", [self.final()], old)
        self.assertEqual(self.loaded(run), ["product-guidance"])
        self.assertEqual(self.input_text().count(self.skills["product-guidance"]), 1)
        self.assertNotIn(self.skills["creative-use"], self.input_text())
        self.assertFalse("guidance_method" in self.input_text())
        self.assertFalse(any(event.get("name") == "Skill" for event in run["events"]))
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, old["id"]).plan, old["plan"])
        checklist = self.task("checklist")
        explained = self.run_turn("guidance", [self.final()], checklist)
        self.assertEqual(self.loaded(explained), ["product-guidance"])
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, checklist["id"]).plan, checklist["plan"])

    def test_general_selects_real_sdk_skill_and_reads_same_file_method(self):
        run = self.run_turn("general", [{"_tool_name": "Skill", "_arguments": {"skill": "product-guidance"}}, self.final()])
        self.assertEqual(self.loaded(run), [])
        self.assertNotIn(self.skills["product-guidance"], self.input_text(0))
        self.assertTrue(self.skills["product-guidance"] in self.input_text(1))
        self.assertTrue("preparation_reports" in self.skills["product-guidance"])
        self.assertIn("kind=guidance", self.skills["product-guidance"])
        starts = [event for event in run["events"] if event.get("name") == "Skill"]
        self.assertEqual(len(starts), 1)
        self.assertTrue(any(event.get("id") == starts[0]["id"] and event.get("state") == "success" for event in run["events"]))

    def test_lesson_keeps_its_system_and_contract_without_generic_skill_preload(self):
        old = self.task("guidance", lesson=True)
        run = self.run_turn("guidance", [{"answer": "先观察能减少对后续动作的误判。", "lesson_action": None}], old)
        self.assertEqual(self.loaded(run), [])
        self.assertIn(LESSON_SYSTEM, self.input_text())
        self.assertNotIn(self.skills["product-guidance"], self.input_text())
        self.assertNotIn(self.skills["creative-use"], self.input_text())
        self.assertFalse("guidance_method" in self.input_text())
        final_tool = next(tool.get("function", tool) for tool in self.model.tools
                          if tool.get("function", tool).get("name") == "GenerateStructuredOutput")
        self.assertEqual(set(final_tool["parameters"]["properties"]), {"answer", "topic", "lesson_action"})
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, old["id"]).plan["entries"][0]["state"], "pending")

    def test_creative_rules_and_old_checklist_ids_and_progress_remain_intact(self):
        old = self.task("checklist")
        continuation = {"goal": old["goal"], "item_ids": [self.item["id"]], "constraints": {}, "plan": old["plan"],
                        "task_id": old["id"], "expected_version": old["version"], "status": "in_progress"}
        run = self.run_turn("creative", [self.final(continuation)], old)
        self.assertEqual(self.loaded(run), ["creative-use"])
        self.assertIn(self.skills["creative-use"], self.input_text())
        self.assertNotIn(self.skills["product-guidance"], self.input_text())
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, old["id"]).plan, old["plan"])
        idea = self.task("idea")
        resumed = self.run_turn("general", [self.final()], idea)
        self.assertEqual(self.loaded(resumed), ["creative-use"])


if __name__ == "__main__":
    unittest.main()
