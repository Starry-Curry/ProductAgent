"""Reviewable actions over existing tasks and canonical business writers.

A pending action is a private task, never an executed reminder or gift. A
server signature binds its reviewed payload; confirmation rechecks permission
and commits the business result and task receipt in the same transaction.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from . import domain, foundation, interactions
from .api_models import AvatarSpec, GiftCreate, ReminderCreate
from .database import ChatMessage, Conversation, ExperienceRecord, Profile, Reminder, TaskRecord, now


class ActionDecision(BaseModel):
    expected_version: int = Field(ge=1)


class ActionView(BaseModel):
    task_id: str
    version: int
    kind: str
    status: str
    title: str
    details: list[str]
    result_id: str | None = None


def _signer(settings):
    return URLSafeSerializer(settings.session_secret, salt="wujian-reviewed-action-v1")


def _claims(user_id, row, action):
    return {"user_id": user_id, "task_id": row.id, "message_id": row.source_message_id,
            "title": row.goal, **{key: action.get(key) for key in
                ("kind", "payload", "guards", "details", "status", "result_id", "origin_message_id")}}


def _reminder_payload(db, user_id, payload):
    assignee = payload.assignee_id or user_id
    if payload.household_id:
        interactions.member(db, user_id, payload.household_id)
        interactions.member(db, assignee, payload.household_id)
        from .database import HouseholdItem
        if payload.item_id and db.get(HouseholdItem, (payload.household_id, payload.item_id)) is None:
            raise domain.DomainError("这件物品尚未加入家庭共同用品")
    elif assignee != user_id and not domain.are_friends(db, user_id, assignee):
        raise domain.DomainError("请选择已接受关系的家人或朋友")
    if payload.item_id:
        domain.accessible_item(db, user_id, payload.item_id)
        domain.accessible_item(db, assignee, payload.item_id)
    try:
        due = datetime.fromisoformat(payload.due_at.replace("Z", "+00:00"))
    except ValueError:
        raise domain.DomainError("请使用明确的提醒日期和时间") from None
    if due.tzinfo is None:
        due = due.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
    return {**payload.model_dump(), "assignee_id": assignee, "due_at": due.isoformat()}


def create_reminder(db, user_id, payload, *, commit=True):
    values = _reminder_payload(db, user_id, payload)
    row = Reminder(**values, creator_id=user_id)
    db.add(row)
    db.commit() if commit else db.flush()
    return {"id": row.id}


def _gift_payload(db, user_id, payload):
    item = domain.accessible_item(db, user_id, payload.item_id, write=True)
    if item.archived or not domain.are_friends(db, user_id, payload.recipient_id):
        raise domain.DomainError("请选择自己的可用物品和已接受的好友")
    for identity in payload.experience_ids:
        story = domain.require(db.get(ExperienceRecord, identity))
        if story.creator_id != user_id or item.id not in story.item_ids:
            raise domain.DomainError("只能附上自己明确选择且与物品关联的故事")
    return payload.model_dump()


def _guards(db, user_id, kind, payload):
    item_id = payload.get("item_id")
    item = domain.accessible_item(db, user_id, item_id) if item_id else None
    return {"item_version": item.version if item else None,
            "story_versions": {identity: domain.require(db.get(ExperienceRecord, identity)).version
                for identity in payload.get("experience_ids", [])} if kind == "gift" else {}}


def preview(db, user_id, task_id, settings):
    row, access = interactions.task_access(db, user_id, task_id)
    if access != "owner":
        raise domain.DomainError("只有发起者能确认这项操作", 404)
    action = (row.plan or {}).get("pending_action")
    if not action:
        raise domain.DomainError("这项事情不是待确认的操作", 404)
    try:
        claims = _signer(settings).loads(action["signature"])
    except (BadSignature, KeyError, TypeError):
        raise domain.DomainError("操作草稿已变化，请让管家重新整理", 409) from None
    if claims != _claims(user_id,row,action):
        raise domain.DomainError("操作草稿与待确认内容不一致", 409)
    return ActionView(task_id=row.id, version=row.version, kind=action["kind"],
        status=action.get("status", "pending"), title=row.goal, details=action["details"],
        result_id=action.get("result_id"))


def propose(db, user_id, message_id, kind, payload, settings):
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    message = domain.require(db.get(ChatMessage, message_id))
    conversation = domain.require(db.get(Conversation, message.conversation_id))
    if message.role != "user" or conversation.user_id != user_id:
        raise domain.DomainError("操作草稿需对应当前用户的实际请求", 403)
    if kind == "reminder":
        values = _reminder_payload(db, user_id, ReminderCreate.model_validate(payload))
        from .database import User
        person = domain.require(db.get(User, values["assignee_id"]))
        title = "提醒" + person.display_name + "：" + values["title"]
        details = ["接收人：" + person.display_name, "内容：" + values["title"],
                   "时间：" + datetime.fromisoformat(values["due_at"]).astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M") + "（北京时间）"]
    elif kind == "gift":
        values = _gift_payload(db, user_id, GiftCreate.model_validate(payload))
        from .database import User
        person = domain.require(db.get(User, values["recipient_id"]))
        item = domain.accessible_item(db, user_id, values["item_id"], write=True)
        title = "把" + item.name + "送给" + person.display_name
        details = ["接收人：" + person.display_name, "物品：" + item.name,
            "心意：" + (values["message"] or "暂未填写留言"),
            "选送故事：" + ("、".join(domain.require(db.get(ExperienceRecord, identity)).title for identity in values["experience_ids"]) or "无"),
            "物品分身：" + ((values["avatar"].get("nickname") or item.name) if values["avatar"].get("enabled") else "未附带分身"),
            "赠礼分身性格：" + (values["avatar"].get("personality") or "未另行设置；不附带原主人的私人成长记忆"),
            "故事彩蛋：" + str(len(values.get("surprises", []))) + "段",
            "确认后发出数字赠礼，实物交付另行约定。"]
    else:
        raise domain.DomainError("暂不支持这类操作")
    if values.get("item_id") and kind == "reminder":
        details.append("物品：" + domain.accessible_item(db, user_id, values["item_id"]).name)
    existing = next((row for row in db.scalars(select(TaskRecord).where(TaskRecord.user_id == user_id,
        TaskRecord.source_message_id == message_id)) if (row.plan or {}).get("pending_action", {}).get("kind") == kind), None)
    if existing and existing.plan["pending_action"].get("status") != "pending":
        return preview(db, user_id, existing.id, settings)
    guards = _guards(db, user_id, kind, values)
    action = {"kind": kind, "payload": values, "guards": guards, "status": "pending", "details": details,
              "origin_message_id":message_id}
    plan = {"schema": "interaction/1", "kind": "checklist", "entries": [], "pending_action": action}
    task = foundation.save_task(db, user_id, message_id, title,
        [values["item_id"]] if values.get("item_id") else [], {}, plan,
        task_id=existing.id if existing else None, expected_version=existing.version if existing else None,
        status="ready", commit=False)
    row = domain.require(db.get(TaskRecord, task["id"]))
    action = {**action, "signature": _signer(settings).dumps(_claims(user_id,row,action))}
    row.plan = {**plan, "pending_action": action}
    db.commit()
    return preview(db, user_id, row.id, settings)


def decide(db, user_id, task_id, settings, expected_version, *, cancel=False):
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    row = domain.require(db.scalar(select(TaskRecord).where(TaskRecord.id == task_id).with_for_update()))
    view = preview(db, user_id, task_id, settings)
    if view.status != "pending":
        return view
    if row.version != expected_version:
        raise domain.DomainError("待确认内容已变化，请核对最新草稿", 409)
    action = dict(row.plan["pending_action"])
    if cancel:
        action["status"], row.status = "cancelled", "cancelled"
    else:
        if action["guards"] != _guards(db, user_id, action["kind"], action["payload"]):
            raise domain.DomainError("关联物品或故事已变化，请让管家重新整理后确认", 409)
        if action["kind"] == "reminder":
            result = create_reminder(db,user_id,ReminderCreate.model_validate(action["payload"]),commit=False)
        else:
            result = domain.create_gift(db,user_id,GiftCreate.model_validate(action["payload"]),commit=False)
        action.update(status="confirmed", result_id=result["id"])
        row.status = "completed"
    action = {**action,"signature":_signer(settings).dumps(_claims(user_id,row,action))}
    row.plan, row.version, row.updated_at = {**row.plan,"pending_action":action}, row.version + 1, now()
    db.commit()
    return preview(db,user_id,task_id,settings)


def register_routes(app, current_user, db_session, settings):
    from fastapi import Depends

    @app.get("/api/tasks/{task_id}/action", response_model=ActionView, tags=["Butler actions"])
    def get_action(task_id: str, user=Depends(current_user), db=Depends(db_session)):
        return preview(db,user.id,task_id,settings)

    @app.post("/api/tasks/{task_id}/action/confirm", response_model=ActionView, tags=["Butler actions"])
    def confirm_action(task_id: str, payload: ActionDecision, user=Depends(current_user), db=Depends(db_session)):
        return decide(db,user.id,task_id,settings,payload.expected_version)

    @app.post("/api/tasks/{task_id}/action/cancel", response_model=ActionView, tags=["Butler actions"])
    def cancel_action(task_id: str, payload: ActionDecision, user=Depends(current_user), db=Depends(db_session)):
        return decide(db,user.id,task_id,settings,payload.expected_version,cancel=True)
