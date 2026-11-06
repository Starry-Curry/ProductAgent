"""ReMe hybrid retrieval over disposable projections of authorized domain data.

SQL remains authoritative. No second memory writer, dream job, background agent,
or copied conversation archive. ReMe owns embeddings, BM25 and rank fusion.
"""

import asyncio
import hashlib
import json
import logging

from sqlalchemy import select

from . import domain
from .database import (
    ChatMessage,
    Conversation,
    KnowledgeClaim,
    Memory,
    Run,
    SourceRecord,
    TaskRecord,
    now,
)

logger = logging.getLogger(__name__)


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
            add("item", row["id"], row)
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
            if plan.get('guidance',{}).get('lesson'):
                progress=dict(plan['guidance']);lesson=progress['lesson']
                progress['lesson']={key:lesson[key] for key in ['id','revision','phase','inputs']}
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
            select(SourceRecord).where(SourceRecord.owner_id == user_id)
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
        retired_sources, retired_ids, legacy_cutoff = set(), set(), ''
        for memory in db.scalars(select(Memory).where(Memory.user_id == user_id, Memory.active.is_(False))):
            retired_ids.add(memory.id)
            legacy_cutoff = max(legacy_cutoff,(memory.attributes or {}).get('retired_at',''))
            retired_sources.update([memory.source_message_id, *(memory.attributes or {}).get("source_message_ids", [])])
        for conversation in db.scalars(
            select(Conversation).where(Conversation.user_id == user_id)
        ):
            messages = db.scalars(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation.id)
                .order_by(ChatMessage.created_at)
            ).all()
            if any(message.id in retired_sources for message in messages):
                continue  # do not resurface superseded/forgotten source conversations
            question = None
            for message in messages:
                if message.role == "user":
                    question = message
                elif (
                    question
                    and message.role == "assistant"
                    and message.run_id == question.run_id
                ):
                    run = db.get(Run,message.run_id) if message.run_id else None
                    provenance = [event for event in run.events if event.get('type')=='memory_context'] if run else []
                    used_memories = {identity for event in provenance for identity in event.get('memory_ids',[])}
                    if used_memories & retired_ids or (not provenance and question.created_at < legacy_cutoff):
                        question = None
                        continue
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
                        },
                    )
                    question = None
    return documents


class Retrieval:
    def __init__(self, settings, sessions):
        self.settings, self.sessions = settings, sessions
        self.apps, self.locks, self.hashes = {}, {}, {}
        self.local=None
        if settings.local_embedding_dir:
            from .local_embedding import LocalEmbedding
            self.local=LocalEmbedding(settings.local_embedding_dir,settings.local_ai_device,settings.local_ai_required)

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
                    "embedding_store": "default" if self.settings.api_key and not self.local else "",
                    "keyword_index": "default",
                    "file_graph": "default",
                }
            },
        }
        if self.settings.api_key and not self.local:
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
            [user_id, self.settings.embedding_model, self.settings.base_url, 512,str(self.local.folder) if self.local else '']
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
            hits=response.metadata.get('results',[]);local_receipt=None;local_error=None
            if self.local:
                # ReMe still owns keyword retrieval; local embeddings add semantic
                # candidates, with reciprocal-rank fusion and the SAME SQL visibility.
                allowed={path:doc for path,doc in documents.items() if not kinds or doc['kind'] in kinds}
                preferred=[hit['path'] for hit in hits if hit['path'] in allowed]
                candidates=list(dict.fromkeys([*preferred,*allowed]))[:250]
                def semantic_text(doc):
                    data=doc['data'];keys=['name','goal','content','summary','text','user_text','assistant_text','title','excerpt','description']
                    text=' '.join(str(data[key]) for key in keys if data.get(key))
                    return text or doc['text']
                try:
                    ranked,scores,local_receipt=await asyncio.to_thread(self.local.rank,query,{path:semantic_text(allowed[path]) for path in candidates})
                    fusion={path:1/(60+i+1) for i,path in enumerate(ranked)}
                    for i,hit in enumerate(hits):fusion[hit['path']]=fusion.get(hit['path'],0)+1/(60+i+1)
                    hits=[{'path':path,'scores':{'rrf':fusion[path],'local_cosine':scores.get(path)}} for path in sorted(fusion,key=fusion.get,reverse=True)]
                except Exception as error:
                    if self.local.required:raise
                    local_error=type(error).__name__+': '+str(error)[:240]
            # Rehydrate and check current visibility/content after awaiting external calls.
            current = authorized_documents(self.sessions, user_id)
            results = []
            for hit in hits:
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
                'local_ai':local_receipt,'local_ai_error':local_error,
                "mode": "keyword_plus_openvino" if local_receipt else "hybrid"
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
