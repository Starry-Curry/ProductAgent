"""Skip unrelated wall projection, while rechecking every actual story reference.

Temporary SQL and the actual structured-result validator/writer; no model or
network. Counting SQL proves work was removed, not hidden by a patched reader.
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import event

from wujian import domain
from wujian.api_models import ExperienceCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ExperienceRecord, make_database
from wujian.turns import commit_result, grounded_turn_schema


class StoryProjectionOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name), api_key="")
        settings.prepare()
        self.engine, self.sessions = make_database(settings)
        self.user = "person_demo_owner"
        with self.sessions() as db:
            domain.seed_demo(db)
            chat = Conversation(user_id=self.user)
            db.add(chat); db.flush()
            message = ChatMessage(conversation_id=chat.id, role="user", text="今天先安静坐一会儿。")
            db.add(message); db.commit()
            self.message = message.id
            self.story = domain.create_experience(db, self.user, ExperienceCreate(
                title="模拟的雨天", text="合成经历：在窗边坐了一会儿。", allow_ai=True))

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def proposal(self, refs=()):
        return {"answer": "在呢，慢慢歇一会儿。", "continuation": None,
                "learning": {"memory_updates": [], "knowledge_updates": []},
                "story_refs": list(refs)}

    def checked(self, refs=()):
        return grounded_turn_schema(self.sessions, self.user, self.message).model_validate(self.proposal(refs))

    def write(self, db, result):
        return commit_result(db, self.user, self.message, result, "今天先安静坐一会儿。")

    def test_empty_refs_skip_wall_reads_in_real_preview_and_commit(self):
        reads = []
        def record(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().lower().startswith("select") and "from experiences" in statement.lower():
                reads.append(statement)
        event.listen(self.engine, "before_cursor_execute", record)
        try:
            with patch("wujian.domain.list_experiences", wraps=domain.list_experiences) as wall:
                result = self.checked()
                with self.sessions() as db:
                    answer = self.write(db, result)["answer"]
                self.assertEqual(wall.call_count, 0)
            self.assertEqual(reads, [])
            self.assertEqual(answer, self.proposal()["answer"])
        finally:
            event.remove(self.engine, "before_cursor_execute", record)

    def test_referenced_story_still_uses_actual_reader_for_preview_and_commit(self):
        with patch("wujian.domain.list_experiences", wraps=domain.list_experiences) as wall:
            result = self.checked([self.story["id"]])
            with self.sessions() as db:
                answer = self.write(db, result)["answer"]
            self.assertEqual(wall.call_count, 2)
        self.assertIn(self.story["text"], answer)
        self.assertIn(self.story["title"], answer)
        self.assertIn("来自小林的记录", answer)

    def test_permission_withdrawal_between_preview_and_commit_still_rejected(self):
        result = self.checked([self.story["id"]])
        with self.sessions() as db:
            db.get(ExperienceRecord, self.story["id"]).allow_ai = False
            db.commit()
            with self.assertRaisesRegex(domain.DomainError, "故事已不可用"):
                self.write(db, result)

    def test_story_deleted_between_preview_and_commit_still_rejected(self):
        result = self.checked([self.story["id"]])
        with self.sessions() as db:
            db.delete(db.get(ExperienceRecord, self.story["id"]))
            db.commit()
            with self.assertRaisesRegex(domain.DomainError, "故事已不可用"):
                self.write(db, result)

    def test_other_users_story_is_not_authorized_by_its_id(self):
        with self.sessions() as db:
            foreign = domain.create_experience(db, "person_demo_friend", ExperienceCreate(
                title="合成私人故事", text="此记录不属于当前用户。", allow_ai=True))
        with self.assertRaisesRegex(domain.DomainError, "故事已不可用"):
            self.checked([foreign["id"]])


if __name__ == "__main__":
    unittest.main()
