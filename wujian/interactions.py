"""Shared interaction operations over the existing business records.

This module supplies page projections and explicit UI actions. It does not run a
model, store a second context/memory, or duplicate item/task/experience records.
"""
from urllib.parse import urlsplit

from sqlalchemy import delete, or_, select, update

from . import domain, foundation
from .api_models import AvatarSpec, ItemChange, Preferences, TaskEntry
from .database import (
    ChatMessage, Conversation, ExperienceRecord, ExperienceShare, Gift, Household, HouseholdItem,
    HouseholdMember, ItemRecord, Reminder, SourceRecord, TaskParticipant, TaskRecord,
    User, Wish, now, uid,
)
from .retrieval import task_view


def preferences(user):
    return Preferences.model_validate(user.preferences or {}).model_dump()


def set_preferences(db, user, payload):
    user.preferences = payload.model_dump()
    db.commit()
    return preferences(user)


def member(db, user_id, household_id, owner=False):
    house = domain.require(db.get(Household, household_id))
    membership = db.get(HouseholdMember, (household_id, user_id))
    if not membership or membership.status != "active" or (owner and house.creator_id != user_id):
        raise domain.DomainError("没有找到或无权管理这个家庭", 404)
    return house


def households(db, user_id):
    result = []
    for membership in db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == user_id)):
        house = db.get(Household, membership.household_id)
        rows = db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == house.id)).all()
        if membership.status != "active":
            rows = [row for row in rows if row.user_id in {user_id, house.creator_id}]
        result.append({"id": house.id, "name": house.name, "creator_id": house.creator_id,
            "membership": membership.status,
            "members": [{**domain.user_view(db.get(User, row.user_id)), "status": row.status, "role": row.role} for row in rows],
            "item_ids": list(db.scalars(select(HouseholdItem.item_id).where(HouseholdItem.household_id == house.id))) if membership.status == "active" else []})
    return result


def create_household(db, user_id, name):
    if not name.strip():
        raise domain.DomainError("请为这个家起个名字")
    house = Household(id=uid(), name=name.strip(), creator_id=user_id)
    db.add(house)
    db.flush()
    db.add(HouseholdMember(household_id=house.id, user_id=user_id, role="owner", status="active"))
    db.commit()
    return next(row for row in households(db, user_id) if row["id"] == house.id)


def invite_household(db, user_id, household_id, other_id):
    member(db, user_id, household_id, owner=True)
    if other_id == user_id or not domain.are_friends(db, user_id, other_id):
        raise domain.DomainError("请先与对方建立好友关系")
    row = db.get(HouseholdMember, (household_id, other_id))
    if row is None:
        db.add(HouseholdMember(household_id=household_id, user_id=other_id, status="invited", role="member"))
    db.commit()
    return {"status": row.status if row else "invited"}


def accept_household(db, user_id, household_id):
    row = domain.require(db.get(HouseholdMember, (household_id, user_id)))
    row.status = "active"
    domain.invalidate_context(db, [user_id])
    db.commit()
    return {"status": "active"}


def remove_member(db, user_id, household_id, other_id):
    house = member(db, user_id, household_id)
    if house.creator_id == other_id:
        raise domain.DomainError("家庭创建者暂不能退出，请先处理共同物品与成员")
    if other_id != user_id and house.creator_id != user_id:
        raise domain.DomainError("只有家庭创建者能移除其他成员", 403)
    row = domain.require(db.get(HouseholdMember, (household_id, other_id)))
    db.delete(row)
    domain.invalidate_context(db, [other_id], stop_running=True)
    db.commit()
    return {"status": "removed"}


def household_item(db, user_id, household_id, item_id, shared):
    member(db, user_id, household_id)
    domain.accessible_item(db, user_id, item_id, write=True)
    row = db.get(HouseholdItem, (household_id, item_id))
    if shared and row is None:
        db.add(HouseholdItem(household_id=household_id, item_id=item_id, shared_by=user_id))
    elif not shared and row:
        db.delete(row)
    affected = list(db.scalars(select(HouseholdMember.user_id).where(HouseholdMember.household_id == household_id)))
    domain.invalidate_context(db, affected, stop_running=not shared)
    db.commit()
    return {"status": "shared" if shared else "removed"}


def update_presentation(db, user_id, item_id, payload):
    item = domain.accessible_item(db, user_id, item_id, write=True)
    view = domain.item_view(db, user_id, item)
    presentation = payload.model_dump(exclude={"expected_version"})
    state = {**item.state, "presentation": presentation,
             "availability": "unavailable" if payload.attention in {"paused", "lost", "lent"} else "available",
             "location": payload.location, "reported_at": now()}
    return domain.change_item(db, user_id, item_id, ItemChange(
        name=item.name, kind=item.kind, product=view["product"], description=view["description"],
        photo_id=item.photo_id, avatar=AvatarSpec(**{key: value for key, value in view["avatar"].items() if key in AvatarSpec.model_fields}),
        state=state, expected_version=payload.expected_version))


def change_experience(db, user_id, identity, payload):
    row = domain.require(db.get(ExperienceRecord, identity))
    if row.creator_id != user_id:
        raise domain.DomainError("没有找到这段回忆", 404)
    if row.origin_id and (payload.text != row.text or payload.title != row.title):
        raise domain.DomainError("收到的原故事保留作者原文，可以另记属于你的新经历")
    labels = {}
    for item_id in dict.fromkeys(payload.item_ids):
        try:
            labels[item_id] = domain.accessible_item(db, user_id, item_id).name
        except domain.DomainError:
            if item_id not in row.item_ids:
                raise
            labels[item_id] = row.item_labels.get(item_id, "曾经关联的物品")
    for photo in payload.photo_ids:
        domain.own_asset(db, user_id, photo)
    changed = db.execute(update(ExperienceRecord).where(ExperienceRecord.id == identity,
        ExperienceRecord.creator_id == user_id, ExperienceRecord.version == payload.expected_version).values(
        title=payload.title, text=payload.text, item_ids=list(labels), item_labels=labels,
        photo_ids=payload.photo_ids, occurred_on=payload.occurred_on.isoformat(), allow_ai=payload.allow_ai,
        version=ExperienceRecord.version + 1))
    if changed.rowcount != 1:
        raise domain.DomainError("这段回忆已更新，草稿仍保留，请核对后再保存", 409)
    domain.invalidate_context(db, [user_id], stop_running=True)
    db.commit()
    db.expire_all()
    return domain.experience_view(db.get(ExperienceRecord, identity))


def delete_experience(db, user_id, identity, version):
    row = domain.require(db.get(ExperienceRecord, identity))
    if row.creator_id != user_id:
        raise domain.DomainError("没有找到这段回忆", 404)
    recipients = list(db.scalars(select(ExperienceShare.user_id).where(ExperienceShare.experience_id == identity)))
    changed = db.execute(delete(ExperienceRecord).where(ExperienceRecord.id == identity,
        ExperienceRecord.creator_id == user_id, ExperienceRecord.version == version))
    if changed.rowcount != 1:
        raise domain.DomainError("这段回忆已更新，请重新核对", 409)
    domain.invalidate_context(db, [user_id, *recipients], stop_running=True)
    db.commit()
    return {"status": "deleted", "gift_snapshots_retracted": False}


def share_experience(db, user_id, identity, recipient_id, revoke=False):
    row = domain.require(db.get(ExperienceRecord, identity))
    if row.creator_id != user_id:
        raise domain.DomainError("只能分享自己保留的这段记录", 403)
    if recipient_id == user_id or not domain.are_friends(db, user_id, recipient_id):
        raise domain.DomainError("请选择已接受邀请的好友")
    grant = db.get(ExperienceShare, (identity, recipient_id))
    if revoke and grant:
        db.delete(grant)
    elif not revoke and grant is None:
        db.add(ExperienceShare(experience_id=identity, user_id=recipient_id))
    domain.invalidate_context(db, [recipient_id], stop_running=revoke)
    db.commit()
    return {"status": "revoked" if revoke else "shared"}


def reminder_visible(db, user_id, reminder):
    if user_id in {reminder.creator_id, reminder.assignee_id}:
        if reminder.item_id:
            try:
                domain.accessible_item(db, user_id, reminder.item_id)
            except domain.DomainError:
                return False
        return True
    if reminder.household_id:
        membership = db.get(HouseholdMember, (reminder.household_id, user_id))
        return bool(membership and membership.status == "active" and
                    (not reminder.item_id or domain.household_access(db, user_id, reminder.item_id)))
    return False


def reminder_view(row):
    return {key: getattr(row, key) for key in ("id", "creator_id", "assignee_id", "item_id", "title",
        "due_at", "completed", "status", "version", "feedback", "household_id")}


def list_reminders(db, user_id):
    return [reminder_view(row) for row in db.scalars(select(Reminder).order_by(Reminder.due_at)) if reminder_visible(db, user_id, row)]


def reminder_feedback(db, user_id, reminder_id, payload):
    row = domain.require(db.get(Reminder, reminder_id))
    if row.assignee_id != user_id or not reminder_visible(db, user_id, row):
        raise domain.DomainError("只有实际接收者能报告阅读、接手和处理结果", 403)
    target = {"read": "read", "accept": "in_progress", "complete": "completed", "reopen": "pending"}[payload.action]
    if row.status == target and row.feedback and row.feedback[-1].get("note") == payload.note:
        return reminder_view(row)
    if payload.action == "read" and row.status in {"in_progress", "completed"}:
        return reminder_view(row)
    changed = db.execute(update(Reminder).where(Reminder.id == reminder_id, Reminder.version == payload.expected_version).values(
        status=target, completed=target == "completed", version=Reminder.version + 1,
        feedback=[*row.feedback, {"action": payload.action, "actor_id": user_id, "note": payload.note, "at": now(), "basis": "user_report"}]))
    if changed.rowcount != 1:
        raise domain.DomainError("这件事已更新，请查看最新进度", 409)
    db.commit()
    db.expire_all()
    return reminder_view(db.get(Reminder, reminder_id))


def task_access(db, user_id, task_id, writing=False):
    row = domain.require(db.get(TaskRecord, task_id))
    access = "owner"
    if row.user_id != user_id:
        participant = db.get(TaskParticipant, (task_id, user_id))
        if not participant or (writing and participant.status != "active"):
            raise domain.DomainError("没有找到或无权处理这项事情", 404)
        access = participant.status
    if access != "owner":
        for identity in row.item_ids:
            domain.accessible_item(db, user_id, identity)
    return row, access


def task_for_actor(db, user_id, task_id):
    row, access = task_access(db, user_id, task_id)
    value = task_view(row)
    if access != "owner":
        # The invited summary never contains the owner's chat, personal constraints or feedback.
        value = {**value, "constraints": {}, "feedback": []}
        if value["plan"].get("guidance"):
            value["plan"] = {**value["plan"], "guidance": {
                key: val for key, val in value["plan"]["guidance"].items() if key != "observations"}}
        if value["plan"].get("entries"):
            value["plan"] = {**value["plan"], "entries": [{**entry, "guidance":
                {**entry["guidance"], "observed_quote": "", "observed_message_id": None}
                if entry.get("guidance") else None} for entry in value["plan"]["entries"]]}
    return value


def board(db, user_id, task_id):
    row, access = task_access(db, user_id, task_id)
    plan = row.plan or {}
    entries = [TaskEntry.model_validate(entry).model_dump() for entry in plan.get("entries", [])] if plan.get("schema") == "interaction/1" else []
    if access != "owner":
        for entry in entries:
            if entry.get("guidance"):
                entry["guidance"] = {**entry["guidance"], "observed_quote": "", "observed_message_id": None}
    participants = [{**domain.user_view(db.get(User, member.user_id)), "status": member.status}
        for member in db.scalars(select(TaskParticipant).where(TaskParticipant.task_id == task_id))]
    source_message = db.get(ChatMessage, row.source_message_id)
    conversation_id = source_message.conversation_id if source_message and row.user_id == user_id else None
    if conversation_id is None:
        conversation_id = next((conversation.id for conversation in db.scalars(select(Conversation).where(Conversation.user_id == user_id))
            if conversation.entry_context.get("task_id") == task_id), None)
    from .source_access import readable_source
    sources = {}
    for entry in entries:
        details = entry.get("guidance") or {}
        active_source = not plan.get('guidance',{}).get('lesson') or entry['id']==plan['guidance'].get('active_step_id')
        readable = []
        for evidence in details.get("evidence", []):
            try:
                source = readable_source(db, user_id, evidence["source_id"])
                if active_source:
                    sources[source.id] = {"id": source.id, "title": source.title, "url": source.url,
                        "quote": evidence["quote"], "page": evidence.get("page")}
                readable.append(evidence)
            except domain.DomainError:
                pass
        if details:
            entry["guidance"] = {**details, "evidence": readable}
    for item_id in row.item_ids:
        try:
            claims = foundation.known_claims(db, user_id, item_id)
        except domain.DomainError:
            continue
        for claim in claims:
            if claim.get("source_id"):
                try:
                    source = readable_source(db, user_id, claim["source_id"])
                    sources[source.id] = {"id": source.id, "title": source.title, "url": source.url,
                        "quote": claim.get("source_quote", ""), "item_id": item_id}
                except domain.DomainError:
                    pass
    task_value = task_for_actor(db, user_id, task_id)
    if plan.get('guidance',{}).get('lesson') and row.item_ids:
        item=domain.accessible_item(db,user_id,row.item_ids[0])
        original_id=item.state.get('teaching',{}).get('manual_source_id')
        if original_id:
            original=readable_source(db,user_id,original_id)
            from .lessons import step_definition
            step=step_definition(row)
            sources[original.id]={'id':original.id,'title':original.title,
                'url':'/api/assets/'+original.asset_id if original.asset_id else original.url,
                'quote':f"当前操作可核对原始 PDF 第 {step['manual_pdf_page']} 页；上方导览为改写，不是原文。" if step and step.get('manual_pdf_page') else '官方原始 PDF；当前补充核对是一般观察建议，不冒充手册原文。'}
    if task_value['plan'].get('visualizations'):
        from .guidance import step_signature
        signatures={entry['id']:step_signature(entry) for entry in entries}
        task_value['plan']={**task_value['plan'],'visualizations':{
            key:value for key,value in task_value['plan']['visualizations'].items()
            if signatures.get(key)==value.get('step_signature')}}
    return {"task": task_value, "kind": plan.get("kind", "legacy") if plan.get("schema") == "interaction/1" else "legacy",
        "entries": entries, "completed_count": sum(entry["state"] == "ready" for entry in entries),
        "total_count": len(entries), "conversation_id": conversation_id, "sources": list(sources.values()),
        "access": access, "participants": participants}


def resume_task(db, user_id, task_id):
    """One stable per-actor conversation, shared by HTTP, teaching and demos."""
    import hashlib
    from sqlalchemy.exc import IntegrityError
    value = board(db, user_id, task_id)
    entry = {"task_id": task_id, "intent": "guidance" if value["kind"] == "guidance" else "planning"}
    if value["conversation_id"]:
        return {"conversation_id": value["conversation_id"], "entry_context": entry}
    identity = "task_" + hashlib.sha256(f"{user_id}\0{task_id}".encode()).hexdigest()[:40]
    row = db.get(Conversation, identity)
    if row is None:
        row = Conversation(id=identity, user_id=user_id, title=value["task"]["goal"][:35],
            item_ids=value["task"]["item_ids"], entry_context=entry)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = domain.require(db.get(Conversation, identity))
    return {"conversation_id": row.id, "entry_context": entry}


def create_board(db, user_id, payload):
    entries = [entry.model_dump() for entry in payload.entries]
    if len({entry["id"] for entry in entries}) != len(entries):
        raise domain.DomainError("清单项目不能重名编号")
    item_ids = list(dict.fromkeys([*payload.item_ids, *(entry["item_id"] for entry in entries if entry["item_id"])]))
    for entry in entries:
        if entry["assignee_id"] not in {None, user_id}:
            raise domain.DomainError("先邀请并等待对方接手，再给对方分配条目")
        if entry["state"] != "pending":
            raise domain.DomainError("新增项目从待处理开始，实际准备后再记录结果")
    task = foundation.save_task(db, user_id, "explicit_board:" + uid(), payload.goal, item_ids,
        payload.constraints, {"schema": "interaction/1", "kind": payload.kind, "entries": entries})
    return board(db, user_id, task["id"])


def update_entry(db, user_id, task_id, entry_id, payload):
    row, access = task_access(db, user_id, task_id, writing=True)
    if row.plan.get('guidance',{}).get('lesson'):
        raise domain.DomainError('逐步教学请用当前步骤的实际反馈入口，不能用清单接口跳步',409)
    plan = dict(row.plan or {})
    if plan.get("schema") != "interaction/1":
        raise domain.DomainError("这份历史方案尚未整理为清单，请在原话题继续")
    entries = [dict(entry) for entry in plan["entries"]]
    entry = next((entry for entry in entries if entry["id"] == entry_id), None)
    if not entry:
        raise domain.DomainError("清单项目已变化", 404)
    if access != "owner" and entry.get("assignee_id") not in {None, user_id}:
        raise domain.DomainError("请让当前负责人报告这项进度", 403)
    if payload.state == "ready" and entry.get("item_id"):
        item = domain.accessible_item(db, user_id, entry["item_id"])
        if item.archived or item.state.get("availability") == "unavailable" or item.state.get("presentation", {}).get("attention") in {"paused", "lost", "lent"}:
            raise domain.DomainError("这件物品目前不可用，请先调整物品或方案", 409)
    if entry["state"] == payload.state and entry.get("note", "") == payload.note and entry.get("updated_by") == user_id:
        return board(db, user_id, task_id)
    entry.update(state=payload.state, note=payload.note, updated_by=user_id)
    plan["entries"] = entries
    # Ready means the preparation is ready, never that the real-world goal succeeded.
    status = "ready" if entries and all(entry["state"] == "ready" for entry in entries) else "in_progress"
    changed = db.execute(update(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.version == payload.expected_version).values(
        plan=plan, status=status, version=TaskRecord.version + 1, updated_at=now()))
    if changed.rowcount != 1:
        raise domain.DomainError("进度已由另一人更新，请核对最新清单", 409)
    db.commit()
    db.expire_all()
    return board(db, user_id, task_id)


def share_task(db, user_id, task_id, other_id):
    row, access = task_access(db, user_id, task_id)
    if access != "owner" or row.plan.get("schema") != "interaction/1":
        raise domain.DomainError("只能分享自己明确整理的清单", 403)
    if other_id == user_id or not domain.are_friends(db, user_id, other_id):
        raise domain.DomainError("请选择已接受关系的朋友或家人")
    for identity in row.item_ids:
        domain.accessible_item(db, other_id, identity)
    participant = db.get(TaskParticipant, (task_id, other_id))
    if participant is None:
        db.add(TaskParticipant(task_id=task_id, user_id=other_id, status="invited"))
    db.commit()
    return board(db, user_id, task_id)


def assign_entry(db, user_id, task_id, entry_id, payload):
    row, access = task_access(db, user_id, task_id, writing=True)
    if access != "owner" or row.plan.get("schema") != "interaction/1":
        raise domain.DomainError("只有发起者能调整这份清单的分工", 403)
    if payload.assignee_id not in {None, user_id}:
        participant = db.get(TaskParticipant, (task_id, payload.assignee_id))
        if not participant or participant.status != "active":
            raise domain.DomainError("请先等对方接受这件事，再分配条目")
        task_access(db, payload.assignee_id, task_id, writing=True)
    entries = [dict(entry) for entry in row.plan["entries"]]
    entry = next((entry for entry in entries if entry["id"] == entry_id), None)
    if entry is None:
        raise domain.DomainError("没有找到这个条目", 404)
    if entry.get("assignee_id") == payload.assignee_id:
        return board(db, user_id, task_id)
    entry["assignee_id"] = payload.assignee_id
    changed = db.execute(update(TaskRecord).where(TaskRecord.id == task_id,
        TaskRecord.version == payload.expected_version).values(plan={**row.plan, "entries": entries},
        version=TaskRecord.version + 1, updated_at=now()))
    if changed.rowcount != 1:
        raise domain.DomainError("分工已变化，请核对最新清单", 409)
    db.commit()
    db.expire_all()
    return board(db, user_id, task_id)


def accept_task(db, user_id, task_id):
    row, access = task_access(db, user_id, task_id)
    if access != "owner":
        db.get(TaskParticipant, (task_id, user_id)).status = "active"
    db.commit()
    return board(db, user_id, task_id)


def list_tasks(db, user_id):
    participating = select(TaskParticipant.task_id).where(TaskParticipant.user_id == user_id)
    rows = db.scalars(select(TaskRecord).where(or_(TaskRecord.user_id == user_id,
        TaskRecord.id.in_(participating))).order_by(TaskRecord.updated_at.desc()))
    result = []
    for row in rows:
        try:
            result.append(task_for_actor(db, user_id, row.id))
        except domain.DomainError:
            pass
    return result


def wish_view(row):
    return {key: getattr(row, key) for key in ("id", "user_id", "title", "note", "url", "visible_to_friends", "version")}


def create_wish(db, user_id, payload):
    if payload.url:
        parsed = urlsplit(payload.url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise domain.DomainError("商品链接请使用不含登录信息的HTTPS地址")
    row = Wish(user_id=user_id, **payload.model_dump())
    db.add(row)
    db.commit()
    return wish_view(row)


def friend_space(db, user_id, other_id):
    if not domain.are_friends(db, user_id, other_id):
        raise domain.DomainError("没有找到这位好友", 404)
    return {"person": domain.user_view(db.get(User, other_id)),
        "items": [item for item in domain.list_items(db, user_id) if item["owner_id"] == other_id],
        "wishes": [wish_view(row) for row in db.scalars(select(Wish).where(Wish.user_id == other_id, Wish.visible_to_friends.is_(True))) ],
        "experiences": [row for row in domain.list_experiences(db, user_id) if row["creator_id"] == other_id]}


def workspace(db, user_id):
    return {"preferences": preferences(db.get(User, user_id)), "items": domain.list_items(db, user_id),
        "experiences": domain.list_experiences(db, user_id), "households": households(db, user_id),
        "reminders": list_reminders(db, user_id), "tasks": list_tasks(db, user_id),
        "conversations": list(db.scalars(select(Conversation).where(Conversation.user_id == user_id).order_by(Conversation.updated_at.desc()).limit(80))),
        "friends": domain.friends(db, user_id),
        "gifts": [domain.gift_view(db, row) for row in db.scalars(select(Gift).where(or_(Gift.sender_id == user_id, Gift.recipient_id == user_id)).order_by(Gift.created_at.desc()))],
        "wishes": [wish_view(row) for row in db.scalars(select(Wish).where(Wish.user_id == user_id))]}
