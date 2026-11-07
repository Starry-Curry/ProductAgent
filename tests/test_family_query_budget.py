"""Bounded SQL reads for a small household wall, with current audience checks.

People, ownership and events are synthetic; the existing domestic model fixture
anchors the scene. These tests exercise SQLite permissions, not model quality.
"""
import unittest

from sqlalchemy import event

from tests import test_family_memories as family
from wujian import domain, interactions
from wujian.database import ExperienceShare


class FamilyQueryBudget(unittest.TestCase):
    def setUp(self):
        self.scene = family.HouseholdMemoryJourneys()
        self.scene.setUp()
        self.addCleanup(self.scene.doCleanups)
        self.records = [self.scene.record(title=f"一起读书的第{index + 1}天", allow_ai=index % 2 == 0)
                        for index in range(30)]

    def measured(self, **kwargs):
        statements = []

        def capture(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(self.scene.engine, "before_cursor_execute", capture)
        try:
            rows = domain.list_experiences(self.scene.db, "mother", **kwargs)
        finally:
            event.remove(self.scene.engine, "before_cursor_execute", capture)
        return rows, len(statements)

    def test_thirty_family_records_do_not_multiply_permission_queries(self):
        wall, wall_queries = self.measured()
        ai, ai_queries = self.measured(for_ai=True)
        self.assertEqual(len(wall), 30)
        self.assertEqual(len(ai), 15)
        self.assertLessEqual(wall_queries, 5)
        self.assertLessEqual(ai_queries, 4)
        self.assertTrue(all(row["provenance"]["author_id"] == "daughter" for row in wall))

    def test_next_read_rechecks_consent_and_item_withdrawal(self):
        scene = self.scene
        original = self.records[0]
        self.assertIn(original["id"], {row["id"] for row in self.measured(for_ai=True)[0]})
        interactions.change_experience(scene.db, "daughter", original["id"],
                                      scene.change(original, allow_ai=False))
        self.assertNotIn(original["id"], {row["id"] for row in self.measured(for_ai=True)[0]})
        self.assertEqual(len(self.measured()[0]), 30)
        interactions.household_item(scene.db, "daughter", "home", scene.lamp["id"], False)
        self.assertEqual(self.measured()[0], [])
        self.assertEqual(len(domain.list_experiences(scene.db, "daughter")), 30)

    def test_individual_share_keeps_filtered_links_without_profile_queries(self):
        scene = self.scene
        story = scene.record(household_id=None, item_ids=[scene.lamp["id"], scene.private["id"]],
                             allow_ai=True, title="私人物品仍应保持私人")
        scene.db.add(ExperienceShare(experience_id=story["id"], user_id="mother"))
        scene.db.commit()
        wall, queries = self.measured()
        self.assertLessEqual(queries, 5)
        shared = next(row for row in wall if row["id"] == story["id"])
        self.assertEqual(shared["item_ids"], [scene.lamp["id"]])
        self.assertFalse(shared["allow_ai"])
        self.assertNotIn(story["id"], {row["id"] for row in self.measured(for_ai=True)[0]})
        scene.db.delete(scene.db.get(ExperienceShare, (story["id"], "mother")))
        scene.db.commit()
        self.assertNotIn(story["id"], {row["id"] for row in self.measured()[0]})


if __name__ == "__main__":
    unittest.main()
