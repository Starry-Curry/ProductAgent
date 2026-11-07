"""Real ReMe persistent missing-vector startup versus current SQL visibility.

Only AgentScope's external embedding-provider method is stubbed. No production
or ReMe behavior is mocked, and the configured key is an offline placeholder.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agentscope.embedding import EmbeddingResponse
from agentscope.embedding._openai._model import OpenAIEmbeddingModel
from reme.enumeration import ComponentEnum
from reme.utils.jsonl_zst import read_jsonl_zst

from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, User, make_database
from wujian.retrieval import Retrieval, authorized_documents


PRIVATE_TEXT = "备用钥匙放在玄关左边抽屉里"
USER = "offline-startup-user"


class RetrievalStartupAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    async def journey(self, forget):
        with tempfile.TemporaryDirectory() as folder:
            settings = Settings(data_dir=Path(folder), api_key="", rea_enabled=False, demo_mode=False)
            settings.prepare()
            engine, sessions = make_database(settings)
            old = Retrieval(settings, sessions)
            restarted = None
            try:
                with sessions() as db:
                    db.add(User(id=USER, username=USER, display_name="模拟用户",
                        password_hash="unused-offline-fixture", preferences={}))
                    db.flush()
                    db.add(Conversation(id="offline-source-chat", user_id=USER, title="临时记住放在哪里",
                        item_ids=[], entry_context={}))
                    db.flush()
                    db.add(ChatMessage(id="offline-source-message", conversation_id="offline-source-chat",
                        role="user", text="先记着，我把备用钥匙放在玄关左边抽屉里了。"))
                    db.commit()
                    memory = foundation.revise_memory(db, USER, "offline-source-message", PRIVATE_TEXT,
                        attributes={"kind": "event", "context": "物品临时存放位置", "source_quote": PRIVATE_TEXT})
                # Keyword-only operation is a supported product fallback. It
                # naturally persists actual SQL projection text without vectors.
                await old.search(USER, "备用钥匙", kinds=["memory"])
                store = old.apps[USER].context.components[ComponentEnum.FILE_STORE]["default"]
                self.assertTrue(store.file_chunks)
                self.assertTrue(all(chunk.embedding is None for chunk in store.file_chunks.values()))
                chunks_path = store.chunks_path
                await old.close()
                self.assertTrue(chunks_path.is_file())
                persisted = [json.loads(line) for line in read_jsonl_zst(chunks_path)]
                self.assertTrue(any(PRIVATE_TEXT in row["text"] for row in persisted))
                self.assertTrue(all(not row.get("embedding") and not row.get("_embedding_f16_b64") for row in persisted))
                if forget:
                    # Actual business retirement while the old ReMe app is closed.
                    with sessions() as db:
                        domain.remove_memory(db, USER, memory["id"])
                    with sessions() as db:
                        self.assertFalse(db.get(Memory, memory["id"]).active)
                path = "memory/" + memory["id"]
                self.assertEqual(path in authorized_documents(sessions, USER), not forget)
                restarted_settings = Settings(data_dir=Path(folder), api_key="offline-no-provider-network",
                    rea_enabled=False, demo_mode=False)
                restarted_settings.prepare()
                restarted = Retrieval(restarted_settings, sessions)
                calls = []

                async def offline_provider(model, inputs, **kwargs):
                    calls.append({"inputs": list(inputs),
                        "old_persisted_chunks_still_exist": chunks_path.is_file(),
                        "memory_authorized_now": path in authorized_documents(sessions, USER)})
                    dimensions = model.dimensions
                    return EmbeddingResponse(embeddings=[[1.0] + [0.0] * (dimensions - 1) for _ in inputs])

                # This exact SDK method is where a real provider call would be
                # sent. Everything above it (ReMe startup/backfill/cache/search)
                # executes normally. No environment credentials are loaded.
                with patch.object(OpenAIEmbeddingModel, "_call_api", new=offline_provider):
                    try:
                        result = await restarted.search(USER, "我备用钥匙放哪儿了？", kinds=["memory"])
                    finally:
                        await restarted.close()
                private_calls = [call for call in calls if any(PRIVATE_TEXT in text for text in call["inputs"])]
                observed = {"forgotten": forget, "provider_calls": calls,
                    "private_call_count": len(private_calls), "search_result_ids": [row["id"] for row in result["results"]]}
                if forget:
                    self.assertEqual(result["results"], [], observed)
                    self.assertEqual(private_calls, [],
                        "Retired SQL text reached the provider during actual ReMe startup: " + json.dumps(observed, ensure_ascii=False))
                else:
                    self.assertTrue(private_calls, "Authorized missing-vector content was never embedded")
                    self.assertTrue(all(call["memory_authorized_now"] for call in private_calls))
                    self.assertIn(memory["id"], observed["search_result_ids"])
                return observed
            finally:
                await old.close()
                if restarted is not None:
                    await restarted.close()
                engine.dispose()

    async def test_forgotten_sql_memory_is_not_sent_from_old_projection_on_embedding_restart(self):
        await self.journey(forget=True)

    async def test_still_authorized_missing_vector_projection_remains_searchable(self):
        await self.journey(forget=False)
