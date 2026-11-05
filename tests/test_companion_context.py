"""Focused companionship reuses canonical facts without unrelated story priming."""
import tempfile
import unittest
from pathlib import Path

from wujian import domain
from wujian.agent_runtime import personal_context
from wujian.api_models import ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import make_database


class CompanionContextTests(unittest.TestCase):
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
