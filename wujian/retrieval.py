"""ReMe hybrid retrieval over disposable projections of authorized domain data.

SQL remains authoritative. No second memory writer, dream job, background agent,
or copied conversation archive. ReMe owns embeddings, BM25 and rank fusion.
"""

import asyncio
import hashlib
import json
import logging
from collections import defaultdict

from sqlalchemy import select

from . import domain
from .database import (
    ChatMessage,
    Conversation,
    ExperienceRecord,
    KnowledgeClaim,
    Memory,
    Run,
    SourceRecord,
    TaskRecord,
    now,
)

logger = logging.getLogger(__name__)


def record_write_receipts(message, record_uses):
    """Project linked, still-existing own records without granting body access.

    record_uses is an owner-filtered SQL mapping of record ID to AI permission.
    Both restored chat and the disposable search index use this same receipt.
    """
    return [{"experience_id": identity, "reference_kind": "record_write_receipt",
        "ai_reference_allowed": bool(record_uses[identity])}
        for identity in dict.fromkeys((message.recorded_experiences or {}).values())
        if identity in record_uses]


def task_view(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "goal",
            "status",
            "item_ids",
            "constraints",
            "plan",
            "feedback",
            "version",
            "updated_at",
        )
    }


def claim_view(row):
    result = {
        key: getattr(row, key)
        for key in (
            "id",
            "product_id",
            "item_id",
            "content",
            "conditions",
            "basis",
            "source_id",
            "source_quote",
            "source_message_id",
            "status",
        )
    }
    result["source_quote"] = row.source_quote[:2000]
    result["source_quote_truncated"] = len(row.source_quote) > 2000
    return result


def authorized_documents(sessions, user_id):
    documents = {}

    def add(kind, identity, value):
        text = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        documents[f"{kind}/{identity}"] = {
            "kind": kind,
            "id": identity,
            "data": value,
            "text": text,
            "hash": hashlib.sha256(text.encode()).hexdigest(),
        }

    with sessions() as db:
        for row in domain.list_items(db, user_id):
            add("item", row["id"], domain.agent_item_view(row))
            if row["access"] == "shared":
                from .foundation import known_claims

                for claim in known_claims(db, user_id, row["id"]):
                    add("knowledge", claim["id"], claim)
        for row in db.scalars(
            select(Memory).where(Memory.user_id == user_id, Memory.active.is_(True))
        ):
            if not row.expires_at or row.expires_at > now():
                add("memory", row.id, domain.memory_view(row))
        for row in domain.list_experiences(db, user_id, for_ai=True):
            add("experience", row["id"], row)
        for row in db.scalars(select(TaskRecord).where(TaskRecord.user_id == user_id)):
            value=task_view(row)
            plan={key:part for key,part in value['plan'].items() if key!='visualizations'}
            if isinstance(plan.get('guidance'),dict):
                progress={key:part for key,part in plan['guidance'].items() if key!='pictures'}
                if progress.get('lesson'):
                    lesson=progress['lesson']
                    progress['lesson']={key:lesson[key] for key in ['id','revision','phase','inputs'] if key in lesson}
                plan['guidance']=progress
            add("task", row.id, {**value,'plan':plan})
        for row in db.scalars(
            select(KnowledgeClaim).where(
                KnowledgeClaim.owner_id == user_id,
                KnowledgeClaim.status != "superseded",
            )
        ):
            add("knowledge", row.id, claim_view(row))
        for row in db.scalars(
            select(SourceRecord).where(SourceRecord.owner_id == user_id,
                                       SourceRecord.origin != "curated_reference_retired")
        ):
            add(
                "source",
                row.id,
                {
                    "id": row.id,
                    "item_id": row.item_id,
                    "title": row.title,
                    "url": row.url,
                    "excerpt": row.content[:1200],
                },
            )
        # Exchanges already exist in SQL. Index them without turning model advice
        # into user facts or depending on an optional model memory/task tool call.
        from .memory_lifecycle import history_policy
        history = history_policy(db, user_id)
        # A conversation can point back to a wall record it created without
        # copying private wall text or treating the write as AI-read consent.
        record_uses = dict(db.execute(select(ExperienceRecord.id, ExperienceRecord.allow_ai)
            .where(ExperienceRecord.creator_id == user_id)).all())
        terminal_runs = dict(db.execute(select(Run.id, Run.status).where(
            Run.user_id == user_id, Run.status.in_(("failed", "interrupted"))
        )).all())
        # One current-user message read per fresh projection, rather than one
        # query per conversation. This is request-local data, never a cache;
        # search still rebuilds authorization after its external await.
        messages_by_conversation = defaultdict(list)
        for message in db.scalars(select(ChatMessage).join(
            Conversation, ChatMessage.conversation_id == Conversation.id
        ).where(Conversation.user_id == user_id).order_by(
            ChatMessage.conversation_id, ChatMessage.created_at
        )):
            messages_by_conversation[message.conversation_id].append(message)
        for conversation in db.scalars(
            select(Conversation).where(Conversation.user_id == user_id)
        ):
            messages = messages_by_conversation.pop(conversation.id, [])
            question = None
            answered = set()
            for message in messages:
                if message.role == "user":
                    question = message
                elif (
                    question
                    and message.role == "assistant"
                    and message.run_id == question.run_id
                ):
                    answered.add(question.id)
                    if history.blocks(question.id, question.text, message.text):
                        question = None
                        continue
                    receipts = record_write_receipts(question, record_uses)
                    add(
                        "conversation",
                        question.id,
                        {
                            "conversation_id": conversation.id,
                            "user_message_id": question.id,
                            "user_text": question.text,
                            "assistant_text": message.text,
                            "created_at": question.created_at,
                            "evidence_kind": "historical_exchange",
                            "assistant_advice_is_not_observed_success": True,
                            "assistant_text_is_generated_not_user_life_evidence": True,
                            **({"record_receipts":receipts} if receipts else {}),
                        },
                    )
                    question = None
            # A failed generation must not erase what the user actually said.
            # Keep this as unanswered history, never as an assistant answer or
            # evidence that an action succeeded. SQL remains the only writer.
            for message in messages:
                if (message.role != "user" or message.id in answered
                    or message.run_id not in terminal_runs
                    or history.blocks(message.id, message.text)):
                    continue
                receipts = record_write_receipts(message, record_uses)
                add("conversation", message.id, {
                    "conversation_id": conversation.id,
                    "user_message_id": message.id,
                    "user_text": message.text,
                    "assistant_text": "",
                    "created_at": message.created_at,
                    "run_status": terminal_runs[message.run_id],
                    "evidence_kind": "historical_unanswered_user_message",
                    **({"record_receipts": receipts} if receipts else {}),
                })
    return documents


class Retrieval:
    def __init__(self, settings, sessions):
        self.settings, self.sessions = settings, sessions
        self.apps, self.locks, self.hashes = {}, {}, {}

    async def _app(self, user_id):
        if user_id in self.apps:
            return self.apps[user_id]
        from reme import ReMe

        components = {
            "tokenizer": {"default": {"backend": "regex"}},
            "file_graph": {"default": {"backend": "local"}},
            "keyword_index": {"default": {"backend": "bm25", "tokenizer": "default"}},
            "file_store": {
                "default": {
                    "backend": "local",
                    "embedding_store": "default" if self.settings.api_key else "",
                    "keyword_index": "default",
                    "file_graph": "default",
                }
            },
        }
        if self.settings.api_key:
            components.update(
                {
                    "as_embedding": {
                        "default": {
                            "backend": "openai",
                            "model": self.settings.embedding_model,
                            "credential": {
                                "api_key": self.settings.api_key,
                                "base_url": self.settings.base_url,
                            },
                            "parameters": {},
                            "dimensions": 512,
                            "max_retries": 1,
                        }
                    },
                    "embedding_store": {
                        "default": {
                            "backend": "local",
                            "as_embedding": "default",
                            "enable_cache": True,
                            "max_batch_size": 10,
                            "health_check_timeout": 15,
                            "max_retries": 1,
                        }
                    },
                }
            )
        space = json.dumps(
            [user_id, self.settings.embedding_model, self.settings.base_url, 512]
        )
        vault = (
            self.settings.data_dir
            / "retrieval"
            / hashlib.sha256(space.encode()).hexdigest()
        )
        app = ReMe(
            workspace_dir=str(vault),
            enable_logo=False,
            log_to_console=False,
            log_to_file=False,
            service={"backend": "http"},
            components=components,
            jobs={
                "search": {
                    "backend": "base",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "limit": {"type": "integer"},
                            "search_filter": {"type": "object"},
                        },
                    },
                    "steps": [{"backend": "search_step", "expand_links": False}],
                }
            },
        )
        await app.start()
        self.apps[user_id] = app
        self.hashes[user_id] = {}
        return app

    async def search(self, user_id, query, kinds=None, limit=8):
        if not query.strip():
            return {"results": [], "mode": "empty_query"}
        lock = self.locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            documents = authorized_documents(self.sessions, user_id)
            app = await self._app(user_id)
            from reme.enumeration import ComponentEnum
            from reme.schema import FileChunk, FileNode

            store = app.context.components[ComponentEnum.FILE_STORE]["default"]
            old = self.hashes[user_id]
            if not old:
                await store.clear()  # disposable index, never deletes domain data
            removed = set(old) - set(documents)
            if removed:
                await store.delete(list(removed))
            changed = []
            for path, doc in documents.items():
                if old.get(path) == doc["hash"]:
                    continue
                chunk = FileChunk(
                    path=path,
                    text=doc["text"],
                    start_line=1,
                    end_line=1,
                    metadata={"kind": doc["kind"], "entity_id": doc["id"]},
                ).set_hash_id()
                changed.append(
                    (FileNode(path=path, st_mtime=0, chunk_ids=[chunk.id]), [chunk])
                )
            await store.upsert(changed)
            self.hashes[user_id] = {
                path: doc["hash"] for path, doc in documents.items()
            }
            response = await app.run_job(
                "search",
                query=query,
                limit=min(30, max(1, limit)),
                search_filter={"kind": kinds} if kinds else {},
            )
            if not response.success:
                raise RuntimeError("ReMe retrieval did not complete")
            # Rehydrate and check current visibility/content after awaiting external calls.
            current = authorized_documents(self.sessions, user_id)
            results = []
            for hit in response.metadata.get("results", []):
                path = hit["path"]
                doc = current.get(path)
                if (
                    doc
                    and doc["hash"] == documents.get(path, {}).get("hash")
                    and (not kinds or doc["kind"] in kinds)
                ):
                    results.append(
                        {key: doc[key] for key in ("kind", "id", "data")}
                        | {"scores": hit.get("scores", {})}
                    )
            return {
                "results": results[:limit],
                "mode": "hybrid"
                if store.embedding_store and store.embedding_store.is_healthy
                else "keyword_only",
                "counts": response.metadata.get("counts", {}),
                "absence_is_not_proven": True,
            }

    async def close(self):
        for app in self.apps.values():
            await app.close()
            from reme.enumeration import ComponentEnum

            for component in app.context.components.get(
                ComponentEnum.AS_EMBEDDING, {}
            ).values():
                client = getattr(component.model, "client", None)
                if client:
                    await client.close()
        self.apps.clear()
