"""Focused companionship reuses canonical facts without unrelated story priming."""
import tempfile
import json
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from fastapi.testclient import TestClient

from wujian import domain, foundation
from wujian.agent_runtime import personal_context
from wujian.api_models import ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import make_database
from wujian.server import create_app


class ContextCaptureModel(ChatModelBase):
    """Capture the actual SDK request; no provider or retrieval is called."""
    def __init__(self, captures):
        super().__init__(credential=None, model="offline-companion-context", parameters=self.Parameters(), max_retries=0)
        self.formatter, self.captures = OpenAIChatFormatter(), captures

    async def _call_api(self, model_name, messages, **kwargs):
        self.captures.append(json.dumps(messages, ensure_ascii=False, default=str))
        return ChatResponse(content=[ToolCallBlock(id="context-only-final", name="GenerateStructuredOutput",
            input=json.dumps({"answer": "在呢，慢慢歇一会儿。", "continuation": None,
                "learning": {"memory_updates": [], "knowledge_updates": []}}))], is_last=True)


class CompanionContextTests(unittest.TestCase):
    def test_actual_persona_request_stays_focused_but_explicit_task_is_preserved(self):
        captures = []
        with tempfile.TemporaryDirectory() as folder:
            app = create_app(Settings(data_dir=Path(folder), api_key="offline-no-provider", rea_enabled=False),
                model_factory=lambda _: ContextCaptureModel(captures))
            with TestClient(app) as client:
                client.post("/api/auth/demo/xiaolin").raise_for_status()
                cup_response = client.post("/api/items", json={"name": "朋友做的杯子", "kind": "nonstandard_object",
                    "avatar": {"enabled": True, "nickname": "小瓷"}})
                cup_response.raise_for_status()
                cup = cup_response.json()
                with app.state.sessions() as db:
                    related = foundation.save_task(db, "person_demo_owner", "synthetic-cup-goal", "用杯子布置书桌",
                        [cup["id"]], {}, {"first_step": "先摆一摆，不粘胶"})
                    others = []
                    for goal in ("查看小米电视的系统版本", "确认台灯的色温范围", "把次净衣挂回衣架", "准备周六野餐的饮水"):
                        others.append(foundation.save_task(db, "person_demo_owner", "synthetic-other-goal", goal,
                            ["item_demo_lamp"], {}, {"first_step": "先确认现状"}))
                for explicit in (None, others[0]):
                    entry = {"intent": "persona", **({"task_id": explicit["id"]} if explicit else {})}
                    response = client.post("/api/chat", json={"text": "小瓷，今天有点累，陪我待会儿。",
                        "item_ids": [cup["id"]], "entry_context": entry})
                    response.raise_for_status()
                    run = response.json()
                    deadline = time.monotonic() + 5
                    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
                        time.sleep(0.02)
                        run = client.get("/api/runs/" + run["id"]).json()
                    self.assertEqual(run["status"], "completed", run)
                    formatted = captures[-1]
                    self.assertIn(related["goal"], formatted)
                    for other in others:
                        if explicit and other["id"] == explicit["id"]:
                            self.assertIn(other["goal"], formatted)
                        else:
                            self.assertNotIn(other["goal"], formatted)
                # Only the controlled model boundary was used. No search tool,
                # paid embedding, second task writer or new wall entry exists.
                self.assertEqual(len(captures), 2)

    def test_other_objects_recent_understanding_does_not_hide_the_companions_own_context(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Settings(data_dir=Path(folder)); config.prepare()
            engine, sessions = make_database(config)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    actor = "person_demo_owner"
                    cup = domain.create_item(db, actor, ItemCreate(name="朋友做的杯子"))
                    books = domain.create_item(db, actor, ItemCreate(name="书房的读书笔记", kind="nonstandard_object"))
                    expected = domain.remember(db, actor, "聊这只杯子时，叫它小瓷", "synthetic-cup", cup["id"])
                    # Synthetic long-lived account history, not a hundred user
                    # prompts or a claim that a real person said these words.
                    for page in range(105):
                        foundation.revise_memory(db, actor, "synthetic-reading-history",
                            f"读书笔记第{page + 1}页的页码已经核过", item_id=books["id"], commit=False)
                    db.commit()
                    value = personal_context(db, actor, [cup["id"]], persona=True)
                    self.assertIn(expected["id"], {row["id"] for row in value["active_personal_memories"]})
                    self.assertTrue(all(row["item_id"] in {None, cup["id"]} for row in value["active_personal_memories"]))
                    self.assertEqual(len(domain.recall(db, actor, item_id=books["id"], limit=200)), 105)
            finally:
                engine.dispose()

    def test_companion_preloads_related_tasks_before_limiting_and_keeps_combinations(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Settings(data_dir=Path(folder)); config.prepare()
            engine, sessions = make_database(config)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    actor = "person_demo_owner"
                    cup = domain.create_item(db, actor, ItemCreate(name="朋友做的杯子"))
                    stone = domain.create_item(db, actor, ItemCreate(name="旅行捡的石头"))
                    related = foundation.save_task(db, actor, "synthetic-cup-task", "用杯子和石头布置书桌",
                        [cup["id"], stone["id"]], {}, {"first_step": "先放在桌上看看，不粘胶"})
                    latest = []
                    for goal in ("核对电视系统版本", "安排阅读角的灯", "整理换季衣物", "准备周末野餐"):
                        latest.append(foundation.save_task(db, actor, "synthetic-other-task", goal,
                            [stone["id"]], {}, {"first_step": "先核对现有条件"})["id"])
                    value = personal_context(db, actor, [cup["id"]], persona=True)
                    self.assertEqual([row["id"] for row in value["recent_tasks"]], [related["id"]])
                    general = personal_context(db, actor, [cup["id"]], persona=False)
                    self.assertEqual([row["id"] for row in general["recent_tasks"]], list(reversed(latest)))
                    # Context selection is not task deletion or an access rule.
                    from wujian.interactions import task_for_actor
                    self.assertEqual(task_for_actor(db, actor, latest[0])["id"], latest[0])
            finally:
                engine.dispose()

    def test_item_companion_is_primed_with_its_own_story_and_global_preferences(self):
        with tempfile.TemporaryDirectory() as folder:
            config=Settings(data_dir=Path(folder)); config.prepare()
            engine,sessions=make_database(config)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    actor="person_demo_owner"
                    cup=domain.create_item(db,actor,ItemCreate(name="朋友做的杯子"))
                    stone=domain.create_item(db,actor,ItemCreate(name="旅行捡的石头"))
                    own=domain.create_experience(db,actor,ExperienceCreate(title="收到杯子",text="模拟：毕业时收到的。",item_ids=[cup["id"]],allow_ai=True))
                    other=domain.create_experience(db,actor,ExperienceCreate(title="海边",text="模拟：去海边的那天。",item_ids=[stone["id"]],allow_ai=True))
                    domain.remember(db,actor,"说话简短一些","synthetic-global")
                    domain.remember(db,actor,"这只杯子是小雨做的","synthetic-cup",cup["id"])
                    domain.remember(db,actor,"这块石头来自青岛","synthetic-stone",stone["id"])
                    value=personal_context(db,actor,[cup["id"]],persona=True)
                    self.assertEqual({row["id"] for row in value["recent_experience_index"]},{own["id"]})
                    self.assertNotIn("text",value["recent_experience_index"][0])
                    self.assertEqual({row["content"] for row in value["active_personal_memories"]},
                                     {"说话简短一些","这只杯子是小雨做的"})
                    # Selection does not delete or make the other object inaccessible.
                    self.assertIn(other["id"],{row["id"] for row in domain.list_experiences(db,actor,for_ai=True)})
            finally:
                engine.dispose()
