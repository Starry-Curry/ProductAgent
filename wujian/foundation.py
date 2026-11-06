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


def normalize_expiry(expires_at):
    """One expiry contract for native model repair and authoritative writes."""
    if not expires_at:
        return None
    try:
        parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        expiry = parsed.astimezone(timezone.utc).isoformat()
        if expiry <= now():
            raise ValueError()
        return expiry
    except ValueError:
        raise domain.DomainError("临时条件需要带时区且尚未过期的ISO时间；按当前日期填写有效期限，或无需长期保留时不新增理解")


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
    expiry = normalize_expiry(expires_at)
    # remember uses this same session; keep correction and replacement atomic.
    if item_id:
        domain.accessible_item(db, user_id, item_id)
    content = content.strip()
    if not content or len(content) > 2000:
        raise domain.DomainError("理解内容应为1至2000字")
    import hashlib

    import json
    attributes = attributes or {}
    # Same words in different situations or roles are different understanding.
    scope = {"kind": attributes.get("kind", ""), "context": attributes.get("context", "").strip()}
    identity = hashlib.sha256(json.dumps([user_id, item_id, content, scope],
        ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    row = db.get(Memory, identity)
    if row is None:
        # Reuse already persisted IDs only when their actual scope matches.
        # No migration/deletion of old history is necessary for this JSON data.
        legacy = db.get(Memory, hashlib.sha256(f"{user_id}\0{item_id}\0{content}".encode()).hexdigest())
        if legacy and {"kind": (legacy.attributes or {}).get("kind", ""),
                       "context": (legacy.attributes or {}).get("context", "").strip()} == scope:
            row, identity = legacy, legacy.id
    if row and not row.active:
        reason = (row.attributes or {}).get("retirement", {}).get("reason")
        if reason == "superseded" and previous is not None:
            # Explicit new evidence may return to a former preference. Keep
            # its old version retired and avoid A->B->A reference cycles.
            identity = hashlib.sha256(f"{identity}\0{message_id}\0{supersedes_id}".encode()).hexdigest()
            row = db.get(Memory, identity)
        else:
            return {"status": "previously_removed", "id": identity}
    from .memory_lifecycle import with_evidence
    evidence_attributes = with_evidence(attributes, message_id, row)
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
            attributes=evidence_attributes,
        )
        db.add(row)
    elif attributes:
        row.attributes = evidence_attributes
        row.source_message_id = message_id
        row.basis = basis
        row.expires_at = expiry
        row.updated_at = now()
    if previous and previous.id != identity:
        from .memory_lifecycle import retirement_attributes
        previous_attributes = retirement_attributes(previous, "superseded", message_id)
        changed = db.execute(
            update(Memory)
            .where(
                Memory.id == previous.id,
                Memory.user_id == user_id,
                Memory.active.is_(True),
            )
            .values(active=False, attributes=previous_attributes)
        )
        if changed.rowcount != 1:
            raise domain.DomainError("旧理解已被更新，请重新读取当前理解", 409)
        domain.invalidate_context(db, [user_id])
    db.commit() if commit else db.flush()
    return domain.memory_view(row)


def validate_plan(plan):
    """The same plan contract is checked by model repair and business writes."""
    if plan.get("schema") != "interaction/1":
        return plan
    from .api_models import TaskEntry
    from pydantic import ValidationError
    if plan.get("kind") not in {"checklist", "guidance", "idea"} or not isinstance(plan.get("entries"), list) or len(plan["entries"]) > 60:
        raise domain.DomainError("请使用有效的事项类型与不超过60项的清单")
    entries, errors = [], []
    for index, entry in enumerate(plan["entries"]):
        try:
            entries.append(TaskEntry.model_validate(entry).model_dump())
        except ValidationError as error:
            for detail in error.errors(include_input=False, include_url=False):
                errors.append(f"entries[{index}].{'.'.join(map(str,detail['loc']))}: {detail['msg']}")
    if errors:
        raise domain.DomainError("事项条目需要修正：\n" + "\n".join(errors[:12]))
    if len({entry["id"] for entry in entries}) != len(entries):
        raise domain.DomainError("清单条目编号必须唯一")
    return {**plan, "entries": entries}


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
    plan = validate_plan(plan)
    # Give the native Agent a repairable field error instead of making it
    # regenerate the whole proposal while guessing which opaque ID was wrong.
    # The same current permission check still runs for every supplied reference.
    references = [(f"item_ids[{index}]", identity) for index, identity in enumerate(item_ids)]
    if plan.get("schema") == "interaction/1":
        references.extend((f"plan.entries[{index}].item_id", entry["item_id"])
                          for index, entry in enumerate(plan["entries"]) if entry["item_id"])
    invalid = []
    checked = {}
    for path, identity in references:
        if identity not in checked:
            try:
                domain.accessible_item(db, user_id, identity)
                checked[identity] = True
            except domain.DomainError:
                checked[identity] = False
        if not checked[identity]:
            invalid.append(f"{path}={identity!r}：当前没有找到或无权使用")
    if invalid:
        available = [{"item_id": row["id"], "name": row["name"]}
                     for row in domain.list_items(db, user_id)[:40]]
        raise domain.DomainError("请修正物品引用，不要改写或猜测ID：\n" + "\n".join(invalid[:12])
                                 + "\n当前获准物品引用：" + str(available))
    if plan.get("schema") == "interaction/1":
        item_ids = list(dict.fromkeys([*item_ids, *(entry["item_id"] for entry in plan["entries"] if entry["item_id"])]))
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


def normalize_claim_evidence(db, user_id, basis, scope, source_id, source_quote):
    """A derived observation cannot grant the authority of an authored document.

    Keep the interpretation and its source, bounded to an instance hypothesis.
    This is determined by the retained source kind, not by an LLM declaration.
    """
    if basis in {"document", "inference"} and source_id:
        source = domain.require(db.get(SourceRecord, source_id))
        if source.owner_id != user_id:
            raise domain.DomainError("请使用自己已获取的资料", 404)
        if source.origin == "video_frame_sample":
            return "inference", "item", ""
    return basis, scope, source_quote


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
    basis, scope, source_quote = normalize_claim_evidence(db, user_id, basis, scope, source_id, source_quote)
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
    elif source_id:
        # An interpretation of a real image/sample is still provisional, but
        # must keep the observation it was based on. Do not strip its source
        # merely because the model's explanation is not a verbatim document.
        source = domain.require(db.get(SourceRecord, source_id))
        if source.owner_id != user_id:
            raise domain.DomainError("请使用自己已获取的推测参考资料", 404)
    retained_source_id = source_id if basis in {"document", "inference"} else None
    if retained_source_id:
        evidence_source = db.get(SourceRecord, retained_source_id)
        if evidence_source and evidence_source.origin == "video_frame_sample":
            conditions = {**conditions, "identity_match": "unverified", "evidence_kind": "timestamped_still_images",
                          "reading_scope": "sampled_video_frames_not_full_video"}
            conditions.pop("source_lines", None)
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
            KnowledgeClaim.source_id == retained_source_id,
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
        source_id=retained_source_id,
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
        domain.item_readers(db, item_id),
        stop_running=True,
        except_run_id=message.run_id,
    )
    db.commit()
    db.refresh(item)
    return domain.item_view(db, user_id, item)
