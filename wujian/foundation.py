"""Small shared operations for evidence, continuing goals and corrected understanding."""

from datetime import datetime, timezone

from sqlalchemy import or_, select, update

from . import domain
from .database import (
    ChatMessage,
    Grant,
    ItemRecord,
    KnowledgeClaim,
    Memory,
    SourceRecord,
    TaskRecord,
    now,
)
from .evidence import locate_quote
from .retrieval import claim_view, task_view


def plan_signature(goal, item_ids, constraints, plan):
    import hashlib
    import json
    return hashlib.sha256(json.dumps({"goal": goal, "item_ids": sorted(item_ids),
        "constraints": constraints, "plan": plan}, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode()).hexdigest()


def revise_memory(
    db,
    user_id,
    message_id,
    content,
    item_id=None,
    basis="user_report",
    supersedes_id=None,
    expires_at=None,
    commit=True,
    attributes=None,
):
    if basis not in {"user_report", "inference"}:
        raise domain.DomainError("未知的理解依据")
    previous = None
    if supersedes_id:
        previous = domain.require(db.get(Memory, supersedes_id))
        if previous.user_id != user_id:
            raise domain.DomainError("没有找到这条理解", 404)
        if not previous.active:
            raise domain.DomainError("旧理解已被更新，请重新读取当前理解", 409)
    expiry = None
    if expires_at:
        try:
            parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError()
            expiry = parsed.astimezone(timezone.utc).isoformat()
            if expiry <= now():
                raise ValueError()
        except ValueError:
            raise domain.DomainError("临时条件需要带时区且尚未过期的ISO时间")
    # remember uses this same session; keep correction and replacement atomic.
    if item_id:
        domain.accessible_item(db, user_id, item_id)
    content = content.strip()
    if not content or len(content) > 2000:
        raise domain.DomainError("理解内容应为1至2000字")
    import hashlib

    context = str((attributes or {}).get("context", "")).strip().casefold()
    identity_text = f"{user_id}\0{item_id}\0{content}" + (f"\0{context}" if context else "")
    identity = hashlib.sha256(identity_text.encode()).hexdigest()
    row = db.get(Memory, identity)
    if row and not row.active:
        if previous:
            raise domain.DomainError("这份旧理解已被遗忘，请换成你当前明确希望保留的内容", 409)
        return {"status": "previously_removed", "id": identity}
    provenance = list(dict.fromkeys([*((row.attributes or {}).get("source_message_ids", []) if row else []),
        *([row.source_message_id] if row else []), message_id]))
    merged_attributes = {**(row.attributes or {} if row else {}), **(attributes or {}), "source_message_ids": provenance}
    if row is None:
        row = Memory(
            id=identity,
            user_id=user_id,
            item_id=item_id,
            content=content,
            basis=basis,
            source_message_id=message_id,
            supersedes_id=supersedes_id,
            expires_at=expiry,
            attributes=merged_attributes,
        )
        db.add(row)
    else:
        row.attributes = merged_attributes
        row.source_message_id = message_id
        if attributes or expires_at is not None:
            row.basis = basis
            row.expires_at = expiry
        row.updated_at = now()
    if previous and previous.id != identity:
        changed = db.execute(
            update(Memory)
            .where(
                Memory.id == previous.id,
                Memory.user_id == user_id,
                Memory.active.is_(True),
            )
            .values(active=False, attributes={**(previous.attributes or {}), 'retired_at': now()})
        )
        if changed.rowcount != 1:
            raise domain.DomainError("旧理解已被更新，请重新读取当前理解", 409)
        source_message = db.get(ChatMessage, message_id)
        domain.invalidate_context(db, [user_id], stop_running=True,
            except_run_id=source_message.run_id if source_message else None)
    db.commit() if commit else db.flush()
    return domain.memory_view(row)


def save_task(
    db,
    user_id,
    message_id,
    goal,
    item_ids,
    constraints,
    plan,
    task_id=None,
    expected_version=None,
    status="exploring",
    commit=True,
):
    if status not in {"exploring", "ready", "in_progress", "completed", "cancelled"}:
        raise domain.DomainError("未知任务状态")
    if not goal.strip() or len(goal) > 4000:
        raise domain.DomainError("请保留具体任务目标")
    previous_plan = None
    if task_id:
        prior_task = domain.require(db.get(TaskRecord, task_id))
        if prior_task.user_id != user_id:
            raise domain.DomainError("没有找到这项任务", 404)
        previous_plan = prior_task.plan
    if plan.get("schema") == "interaction/1":
        from .api_models import TaskEntry
        from pydantic import ValidationError
        if plan.get("kind") not in {"checklist", "guidance", "idea"} or not isinstance(plan.get("entries"), list) or len(plan["entries"]) > 60:
            raise domain.DomainError("请使用有效的事项类型与不超过60项的清单")
        try:
            entries = [TaskEntry.model_validate(entry).model_dump() for entry in plan["entries"]]
        except ValidationError:
            raise domain.DomainError("事项条目格式已变化，请重新整理")
        if len({entry["id"] for entry in entries}) != len(entries):
            raise domain.DomainError("清单条目编号必须唯一")
        item_ids = list(dict.fromkeys([*item_ids, *(entry["item_id"] for entry in entries if entry["item_id"])]))
        plan = {**plan, "entries": entries}
    from .guidance import validate_plan
    plan = validate_plan(db, user_id, item_ids, plan, message_id, previous_plan)
    for identity in item_ids:
        domain.accessible_item(db, user_id, identity)
    values = {
        "goal": goal,
        "item_ids": list(dict.fromkeys(item_ids)),
        "constraints": constraints,
        "plan": plan,
        "status": status,
        "source_message_id": message_id,
        "updated_at": now(),
    }
    if task_id:
        row = domain.require(db.get(TaskRecord, task_id))
        if row.user_id != user_id:
            raise domain.DomainError("没有找到这项任务", 404)
        if status == "completed" and not any(
            f.get("outcome") == "success" and f.get("plan_signature") ==
            plan_signature(goal, item_ids, constraints, plan) for f in row.feedback
        ):
            raise domain.DomainError("方案还没有成功反馈，不能作为已完成的实际任务")
        changed = db.execute(
            update(TaskRecord)
            .where(
                TaskRecord.id == task_id,
                TaskRecord.user_id == user_id,
                TaskRecord.version == expected_version,
            )
            .values(**values, version=TaskRecord.version + 1)
        )
        if changed.rowcount != 1:
            raise domain.DomainError("任务已更新，请重新读取", 409)
    else:
        if status == "completed":
            raise domain.DomainError("新方案还没有实际结果，不能直接标为完成")
        row = TaskRecord(user_id=user_id, **values)
        db.add(row)
    db.commit() if commit else db.flush()
    db.refresh(row)
    return task_view(row)


def task_feedback(
    db,
    user_id,
    message_id,
    task_id,
    text,
    outcome,
    expected_version,
    source_quote=None,
    commit=True,
):
    row = domain.require(db.get(TaskRecord, task_id))
    if row.user_id != user_id:
        raise domain.DomainError("没有找到这项任务", 404)
    if any(entry.get("source_message_id") == message_id for entry in row.feedback):
        return task_view(row)
    if (
        not text.strip()
        or len(text) > 4000
        or outcome not in {"success", "failure", "partial", "preference", "unknown"}
    ):
        raise domain.DomainError("请保留真实反馈及其结果类别")
    feedback = [
        *row.feedback,
        {
            "text": text,
            "outcome": outcome,
            "source_message_id": message_id,
            "source_quote": source_quote or text,
            "plan_signature": plan_signature(row.goal, row.item_ids, row.constraints, row.plan),
            "created_at": now(),
        },
    ]
    changed = db.execute(
        update(TaskRecord)
        .where(TaskRecord.id == task_id, TaskRecord.version == expected_version)
        .values(feedback=feedback, version=TaskRecord.version + 1, updated_at=now())
    )
    if changed.rowcount != 1:
        raise domain.DomainError("任务已更新，请重新读取", 409)
    db.commit() if commit else db.flush()
    db.refresh(row)
    return task_view(row)


def save_claim(
    db,
    user_id,
    message_id,
    item_id,
    content,
    conditions,
    basis,
    scope,
    source_id=None,
    source_quote="",
    supersedes_id=None,
    commit=True,
):
    item = domain.accessible_item(db, user_id, item_id)
    if basis not in {"document", "user_report", "inference"} or scope not in {
        "product",
        "item",
    }:
        raise domain.DomainError("未知证据依据或适用范围")
    if not content.strip() or len(content) > 4000:
        raise domain.DomainError("知识应为1至4000字")
    if scope == "product" and not item.product_id:
        raise domain.DomainError("尚无可绑定的确切商品身份")
    status = "provisional"
    if basis == "document":
        source = domain.require(db.get(SourceRecord, source_id or ""))
        if source.owner_id != user_id:
            raise domain.DomainError("请使用自己已获取的资料", 404)
        if source.item_id and source.item_id != item_id:
            original = domain.accessible_item(db, user_id, source.item_id)
            if not item.product_id or original.product_id != item.product_id:
                raise domain.DomainError(
                    "资料绑定到另一型号，不能作为当前商品的认识依据"
                )
        # A quote proves provenance, not applicability or semantic correctness.
        source_quote = locate_quote(source.content, source_quote)
        if source_quote is None or len(source_quote.strip()) < 8:
            raise domain.DomainError("请保留来源中可核对的原文，不以摘要冒充证据")
        status = "source_backed"
    elif basis == "user_report":
        message = domain.require(db.get(ChatMessage, message_id))
        from .database import Conversation

        conversation = domain.require(db.get(Conversation, message.conversation_id))
        if (
            conversation.user_id != user_id
            or message.role != "user"
            or not source_quote.strip()
            or source_quote not in message.text
        ):
            raise domain.DomainError("请引用当前用户实际报告的原话")
        status = "user_reported"
    if supersedes_id:
        previous = domain.require(db.get(KnowledgeClaim, supersedes_id))
        if previous.owner_id != user_id:
            raise domain.DomainError("没有找到旧知识", 404)
        previous.status = "superseded"
    existing = db.scalar(
        select(KnowledgeClaim).where(
            KnowledgeClaim.owner_id == user_id,
            KnowledgeClaim.product_id
            == (item.product_id if scope == "product" else None),
            KnowledgeClaim.item_id == (item.id if scope == "item" else None),
            KnowledgeClaim.content == content,
            KnowledgeClaim.source_id == (source_id if basis == "document" else None),
            KnowledgeClaim.basis == basis,
            KnowledgeClaim.status != "superseded",
        )
    )
    if (
        existing
        and existing.conditions == conditions
        and existing.source_quote == source_quote
    ):
        return claim_view(existing)
    row = KnowledgeClaim(
        owner_id=user_id,
        product_id=item.product_id if scope == "product" else None,
        item_id=item.id if scope == "item" else None,
        content=content,
        conditions=conditions,
        basis=basis,
        source_id=source_id if basis == "document" else None,
        source_quote=source_quote,
        source_message_id=message_id,
        status=status,
    )
    db.add(row)
    db.commit() if commit else db.flush()
    return claim_view(row)


def known_claims(db, user_id, item_id):
    item = domain.accessible_item(db, user_id, item_id)
    clauses = [KnowledgeClaim.item_id == item.id]
    if item.product_id:
        clauses.append(KnowledgeClaim.product_id == item.product_id)
    result = [
        claim_view(row)
        for row in db.scalars(
            select(KnowledgeClaim).where(
                KnowledgeClaim.owner_id == user_id,
                KnowledgeClaim.status != "superseded",
                or_(*clauses),
            )
        )
    ]
    if item.owner_id != user_id:
        from .continuity import public_product_sources

        for source, row in public_product_sources(db, item.owner_id, item):
            result.append(
                {
                    **claim_view(row),
                    "content": row.source_quote[:2000],
                    "conditions": {
                        "kind": "source_excerpt",
                        "identity_match": "model_text_matched",
                    },
                }
            )
    return result


def update_condition(
    db, user_id, message_id, item_id, changes, source_quote, expected_version
):
    item = domain.accessible_item(db, user_id, item_id, write=True)
    message = domain.require(db.get(ChatMessage, message_id))
    from .database import Conversation

    conversation = domain.require(db.get(Conversation, message.conversation_id))
    if (
        conversation.user_id != user_id
        or message.role != "user"
        or not source_quote
        or source_quote not in message.text
    ):
        raise domain.DomainError("请使用当前用户报告的实际物品状态")
    state = {
        **item.state,
        **changes,
        "latest_user_report": {
            "source_message_id": message_id,
            "quote": source_quote,
            "observed_at": now(),
        },
    }
    changed = db.execute(
        update(ItemRecord)
        .where(
            ItemRecord.id == item_id,
            ItemRecord.owner_id == user_id,
            ItemRecord.version == expected_version,
        )
        .values(state=state, version=ItemRecord.version + 1)
    )
    if changed.rowcount != 1:
        raise domain.DomainError("物品状态已更新，请重新读取", 409)
    domain.invalidate_context(
        db,
        [user_id, *db.scalars(select(Grant.user_id).where(Grant.item_id == item_id))],
    )
    db.commit()
    db.refresh(item)
    return domain.item_view(db, user_id, item)
