"""Independent counterexample: no story display must not unlock a gifted story."""
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from tests import test_gift_story_display as gift_fixtures
from wujian.database import Conversation, ItemRecord, Memory


class OptimizationIndependentReviewTests(unittest.TestCase):
    def test_empty_story_refs_keep_gift_locked_while_real_learning_commits(self):
        fixture = gift_fixtures.GiftStoryDisplayTests(methodName="test_final_story_display_and_progress_are_atomic_attributed_and_idempotent")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with fixture.sessions() as db:
            message = fixture.message(db, text="累的时候，我想先安静听一会儿。")
            version = db.get(ItemRecord, fixture.item["id"]).version
        result = fixture.result(story_refs=[], learning=fixture.valid_learning(message))
        answer = fixture.display(message, result)["answer"]
        fixture.assert_progress(False)
        self.assertNotIn(fixture.story["text"], answer)
        self.assertNotIn("![这段记录的照片]", answer)
        with fixture.sessions() as db:
            self.assertEqual(db.get(ItemRecord, fixture.item["id"]).version, version)
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory).where(
                Memory.user_id == fixture.recipient)), 1)


class RetrievalAwaitIndependentReviewTests(unittest.IsolatedAsyncioTestCase):
    async def test_conversation_transferred_during_reme_search_is_removed_by_second_projection(self):
        from tests import test_retrieval_projection_batch as batch_fixtures
        from wujian.config import Settings
        from wujian.retrieval import Retrieval

        fixture = batch_fixtures.RetrievalProjectionBatchTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        with fixture.sessions() as db:
            conversation, question, _ = fixture.chat(db)
            db.commit()
            conversation_id, question_id = conversation.id, question.id
        retrieval = Retrieval(Settings(data_dir=Path(fixture.temp.name), api_key=""), fixture.sessions)
        try:
            initial = await retrieval.search(fixture.owner, "EOS R5", kinds=["conversation"])
            self.assertIn(question_id, {row["id"] for row in initial["results"]})
            app = retrieval.apps[fixture.owner]
            original = app.run_job

            async def transfer_after_search(*args, **kwargs):
                result = await original(*args, **kwargs)
                with fixture.sessions() as db:
                    db.get(Conversation, conversation_id).user_id = fixture.other
                    db.commit()
                return result

            with patch.object(app, "run_job", new=transfer_after_search):
                result = await retrieval.search(fixture.owner, "EOS R5", kinds=["conversation"])
            self.assertNotIn(question_id, {row["id"] for row in result["results"]})
            self.assertEqual(result["results"], [])
        finally:
            await retrieval.close()


if __name__ == "__main__":
    unittest.main()
