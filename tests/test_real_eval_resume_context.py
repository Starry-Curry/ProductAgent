"""A repair probe must preserve the application route it is repairing."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from scripts.real_creative_eval import resumed_context
from wujian.database import Base, Conversation, User


class RealEvalResumeContextTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine)
        with self.sessions() as db:
            db.add(User(id="owner", username="synthetic", display_name="synthetic", password_hash="unused"))
            db.add(Conversation(id="creative", user_id="owner", title="synthetic",
                                item_ids=["one", "two"],
                                entry_context={"intent": "creative", "task_id": "current-task"}))
            db.add(Conversation(id="persona", user_id="owner", title="synthetic",
                                item_ids=["companion"], entry_context={"intent": "persona"}))
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def test_creative_task_and_multiple_focused_objects_survive_cli_case_default(self):
        entry, focused = resumed_context(self.sessions, "creative")
        self.assertEqual(entry, {"intent": "creative", "task_id": "current-task"})
        self.assertEqual(focused, ["one", "two"])
        entry["intent"], focused[:] = "general", []
        self.assertEqual(resumed_context(self.sessions, "creative"),
                         ({"intent": "creative", "task_id": "current-task"}, ["one", "two"]))

    def test_persona_is_not_silently_replaced_by_general(self):
        self.assertEqual(resumed_context(self.sessions, "persona"),
                         ({"intent": "persona"}, ["companion"]))

    def test_missing_conversation_fails_instead_of_probing_another_entry(self):
        with self.assertRaisesRegex(RuntimeError, "conversation is missing"):
            resumed_context(self.sessions, "not-real")


if __name__ == "__main__":
    unittest.main()
