"""Shared business operations used by both HTTP routes and agent tools."""
import hashlib
import json
import secrets

from pwdlib import PasswordHash
from sqlalchemy import delete, or_, select, text, update

from .api_models import (
    ExperienceCreate,
    GiftCreate,
    ItemChange,
    ItemCreate,
    ProductSpec,
)
from .config import ROOT
from .database import (
    Asset,
    ChatMessage,
    Conversation,
    ExperienceRecord,
    ExperienceShare,
    Friendship,
    Gift,
    Grant,
    HouseholdItem,
    HouseholdMember,
    ItemRecord,
    Memory,
    ProductRecord,
    Profile,
    Run,
    User,
    now,
    uid,
)

PASSWORDS = PasswordHash.recommended()


class DomainError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message, self.status = message, status
        super().__init__(message)


def user_view(user):
    return {"id": user.id, "username": user.username, "display_name": user.display_name}


def require(row, message="没有找到或无权访问", status=404):
    if row is None:
        raise DomainError(message, status)
    return row


def invalidate_context(db, user_ids, stop_running=False, except_run_id=None):
    for conversation in db.scalars(select(Conversation).where(Conversation.user_id.in_(list(user_ids)))):
        conversation.agent_state = None
        conversation.context_revision += 1
        conversation.reset_after = now()
    if stop_running:
        for run in db.scalars(select(Run).where(Run.user_id.in_(list(user_ids)), Run.status.in_(["queued", "running"]))):
            if run.id != except_run_id:
                run.status, run.error, run.updated_at = "interrupted", "相关信息已更新，请基于最新状态继续。", now()


def friends(db, user_id):
    relations = db.scalars(select(Friendship).where(or_(Friendship.sender_id == user_id, Friendship.recipient_id == user_id))).all()
    result = []
    for relation in relations:
        other = relation.recipient_id if relation.sender_id == user_id else relation.sender_id
        result.append({**user_view(db.get(User, other)), "accepted": relation.accepted,
                       "incoming": relation.recipient_id == user_id,
                       "sender_id": relation.sender_id})
    return result


def are_friends(db, left, right):
    return any(row["id"] == right and row["accepted"] for row in friends(db, left))


def accessible_item(db, user_id, item_id, write=False):
    item = require(db.get(ItemRecord, item_id))
    if item.owner_id == user_id:
        return item
    if not write and db.get(Grant, (item_id, user_id)) is not None:
        return item
    if not write and household_access(db, user_id, item_id):
        return item
    raise DomainError("没有找到或无权访问这件物品", 404)


def household_access(db, user_id, item_id):
    return db.scalar(select(HouseholdItem.item_id).join(
        HouseholdMember, HouseholdMember.household_id == HouseholdItem.household_id
    ).where(HouseholdItem.item_id == item_id, HouseholdMember.user_id == user_id,
            HouseholdMember.status == "active")) is not None


def item_readers(db, item_id):
    owner = require(db.get(ItemRecord, item_id)).owner_id
    return list({owner, *db.scalars(select(Grant.user_id).where(Grant.item_id == item_id)),
                 *db.scalars(select(HouseholdMember.user_id).join(HouseholdItem,
                     HouseholdItem.household_id == HouseholdMember.household_id).where(
                     HouseholdItem.item_id == item_id, HouseholdMember.status == "active"))})


def item_view(db, user_id, item):
    accessible_item(db, user_id, item.id)
    profile = db.get(Profile, (user_id, item.id))
    from .memory_lifecycle import current_avatar
    avatar = current_avatar(db,user_id,item.id,profile.avatar) if profile else {}
    return {"id": item.id, "owner_id": item.owner_id, "name": item.name, "kind": item.kind,
            "product": item.product, "product_id":item.product_id, "identity_notes":item.identity_notes,
            "state": item.state, "photo_id": item.photo_id,
            "version": item.version, "archived": item.archived,
            "access": "owner" if item.owner_id == user_id else "shared",
            "description": profile.description if profile else "",
            "avatar": {"enabled": bool(profile and avatar.get("enabled",
                bool(avatar.get("personality")))), **avatar} if profile else {}}


def list_items(db, user_id, query="", include_archived=False):
    granted = select(Grant.item_id).where(Grant.user_id == user_id)
    family = select(HouseholdItem.item_id).join(HouseholdMember,
        HouseholdMember.household_id == HouseholdItem.household_id).where(
        HouseholdMember.user_id == user_id, HouseholdMember.status == "active")
    statement = select(ItemRecord).where(or_(ItemRecord.owner_id == user_id,
        ItemRecord.id.in_(granted), ItemRecord.id.in_(family)))
    if not include_archived:
        statement = statement.where(ItemRecord.archived.is_(False))
    rows = db.scalars(statement.order_by(ItemRecord.created_at)).all()
    views = [item_view(db, user_id, row) for row in rows]
    if query:
        query = query.casefold()
        views = [row for row in views if query in json.dumps(row, ensure_ascii=False).casefold()]
    return views


def own_asset(db, user_id, asset_id):
    asset = require(db.get(Asset, asset_id))
    if asset.owner_id != user_id:
        raise DomainError("无权使用这份文件", 404)
    return asset


def product_record(db, spec, kind="standard_product"):
    if kind != "standard_product" or not spec.get('brand','').strip() or not spec.get('model','').strip():
        return None
    from .identity import product_identity
    identity, identity_spec = product_identity(spec)
    row = db.get(ProductRecord, identity)
    if row is None:
        row = ProductRecord(id=identity, spec=identity_spec)
        db.add(row)
        db.flush()
    return identity


def create_item(db, user_id, payload: ItemCreate):
    if payload.photo_id:
        own_asset(db, user_id, payload.photo_id)
    spec=payload.product.model_dump()
    product_id=product_record(db,spec,payload.kind)
    item = ItemRecord(id=uid(), owner_id=user_id, name=payload.name, kind=payload.kind,
                      product_id=product_id,identity_notes=spec,photo_id=payload.photo_id,state=payload.state)
    db.add(item)
    db.flush()
    db.add(Profile(user_id=user_id, item_id=item.id, description=payload.description, avatar=payload.avatar.model_dump()))
    db.commit()
    return item_view(db, user_id, item)


def change_item(db, user_id, item_id, payload: ItemChange, *, origin_run_id=None):
    accessible_item(db, user_id, item_id, write=True)
    if payload.photo_id:
        own_asset(db, user_id, payload.photo_id)
    spec=payload.product.model_dump()
    product_id=product_record(db,spec,payload.kind)
    updated = db.execute(update(ItemRecord).where(ItemRecord.id == item_id, ItemRecord.owner_id == user_id,
                        ItemRecord.version == payload.expected_version).values(
                            name=payload.name, kind=payload.kind, product_id=product_id,
                            identity_notes=spec,
                            state=payload.state, photo_id=payload.photo_id, version=ItemRecord.version + 1))
    if updated.rowcount != 1:
        raise DomainError("物品已发生变化，请刷新后再保存", 409)
    profile = db.get(Profile, (user_id, item_id))
    if profile is None:
        profile = Profile(user_id=user_id, item_id=item_id)
        db.add(profile)
    profile.description = payload.description
    profile.avatar = {**(profile.avatar or {}), **payload.avatar.model_dump()}
    affected = item_readers(db, item_id)
    invalidate_context(db, affected, stop_running=True, except_run_id=origin_run_id)
    db.commit()
    db.expire_all()
    return item_view(db, user_id, db.get(ItemRecord, item_id))


def experience_view(row):
    return {key: getattr(row, key) for key in ("id", "creator_id", "title", "text", "item_ids", "item_labels", "photo_ids", "occurred_on", "origin_id", "provenance", "version", "allow_ai")}


def list_experiences(db, user_id, item_id=None, query="", for_ai=False):
    if item_id:
        accessible_item(db, user_id, item_id)
    allowed = ExperienceRecord.creator_id == user_id
    if not for_ai:
        allowed = or_(allowed, ExperienceRecord.id.in_(select(ExperienceShare.experience_id).where(ExperienceShare.user_id == user_id)))
    rows = db.scalars(select(ExperienceRecord).where(allowed)
                      .order_by(ExperienceRecord.occurred_on.desc(), ExperienceRecord.created_at.desc())).all()
    result = []
    accessible = {item["id"] for item in list_items(db, user_id, include_archived=True)}
    for row in rows:
        if (for_ai and not row.allow_ai) or (item_id and item_id not in row.item_ids) or (query and query.casefold() not in (row.title + row.text).casefold()):
            continue
        value = experience_view(row)
        value["access"] = "owner" if row.creator_id == user_id else "shared"
        if value["access"] == "shared":
            value.update(allow_ai=False, item_ids=[identity for identity in row.item_ids if identity in accessible],
                item_labels={identity: label for identity, label in row.item_labels.items() if identity in accessible})
        result.append(value)
    return result


def create_experience(db, user_id, payload: ExperienceCreate, *, source_message_id=None):
    """Create an authored wall record, optionally replay-safe for an Agent call.

    The tool opens a fresh session. Its originating message owns a compact
    exact-payload receipt, committed with the record. It survives deletion of
    the wall entry, without retaining another copy of the wall's text/media.
    Distinct messages or payloads remain distinct intentional recordings.
    """
    source_message, recording_key = None, None
    if source_message_id:
        if db.get_bind().dialect.name == "sqlite":
            db.execute(text("BEGIN IMMEDIATE"))
        source_message = require(db.scalar(select(ChatMessage).where(
            ChatMessage.id == source_message_id).with_for_update()))
        conversation = require(db.get(Conversation, source_message.conversation_id))
        if source_message.role != "user" or conversation.user_id != user_id:
            raise DomainError("回忆记录必须对应当前用户的实际消息", 403)
        identity = payload.model_dump(mode="json")
        identity["item_ids"] = sorted(set(identity["item_ids"]))
        recording_key = hashlib.sha256(json.dumps(identity, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    labels = {item_id: accessible_item(db, user_id, item_id).name for item_id in dict.fromkeys(payload.item_ids)}
    for photo_id in payload.photo_ids:
        own_asset(db, user_id, photo_id)
    if source_message and recording_key in (source_message.recorded_experiences or {}):
        previous = db.get(ExperienceRecord, source_message.recorded_experiences[recording_key])
        if previous is None or previous.creator_id != user_id:
            raise DomainError("这条旧请求已处理，但相应回忆已被删除；不能用旧请求重新生成。", 409)
        # A later edit may have withdrawn AI consent. A replay is not another
        # grant to read the edited text, nor permission to overwrite it.
        return {**experience_view(previous), "status":"already_recorded"} if previous.allow_ai else {
            "id": previous.id, "version": previous.version,
            "status": "already_recorded", "allow_ai": False}
    row = ExperienceRecord(creator_id=user_id, title=payload.title, text=payload.text,
                           item_ids=list(labels), item_labels=labels, photo_ids=payload.photo_ids,
                           occurred_on=payload.occurred_on.isoformat() if payload.occurred_on else None,
                           allow_ai=payload.allow_ai,
                           provenance={"kind":"authored_record","author_id":user_id,
                                       "author_name":db.get(User,user_id).display_name})
    db.add(row)
    if source_message:
        db.flush()
        source_message.recorded_experiences = {
            **(source_message.recorded_experiences or {}), recording_key: row.id}
    db.commit()
    return experience_view(row)


def memory_view(row):
    return {key: getattr(row, key) for key in ("id", "item_id", "content", "basis", "source_message_id", "updated_at", "supersedes_id", "expires_at", "attributes")}


def agent_item_view(value):
    """Expose the physical reference without a confusable model-table key."""
    return {"item_id": value["id"], **{key:field for key,field in value.items() if key not in {"id", "product_id"}}}


def recall(db, user_id, query="", item_id=None, limit=20):
    statement = select(Memory).where(Memory.user_id == user_id, Memory.active.is_(True))
    statement = statement.where(or_(Memory.expires_at.is_(None), Memory.expires_at > now()))
    if item_id:
        accessible_item(db, user_id, item_id)
        statement = statement.where(or_(Memory.item_id == item_id, Memory.item_id.is_(None)))
    if query:
        statement = statement.where(Memory.content.ilike("%" + query.replace("%", "\\%").replace("_", "\\_") + "%", escape="\\"))
    return [memory_view(row) for row in db.scalars(statement.order_by(Memory.updated_at.desc()).limit(limit))]


def remember(db, user_id, content, source_message_id, item_id=None, basis="user_report"):
    from .foundation import revise_memory
    return revise_memory(db,user_id,source_message_id,content,item_id,basis)


def remove_memory(db, user_id, memory_id):
    row = require(db.get(Memory, memory_id))
    if row.user_id != user_id:
        raise DomainError("没有找到这条记忆", 404)
    from .memory_lifecycle import retire
    retire(row, "forgotten")
    invalidate_context(db, [user_id], stop_running=True)
    db.commit()


def share_item(db, user_id, item_id, recipient_id, revoke=False):
    accessible_item(db, user_id, item_id, write=True)
    if recipient_id == user_id or not are_friends(db, user_id, recipient_id):
        raise DomainError("请选择已接受好友关系的家人或朋友")
    existing = db.get(Grant, (item_id, recipient_id))
    if revoke and existing:
        db.delete(existing)
    elif not revoke and existing is None:
        db.add(Grant(item_id=item_id, user_id=recipient_id))
    invalidate_context(db, [recipient_id], stop_running=revoke)
    db.commit()


def gift_view(db, row):
    return {"id": row.id, "sender": user_view(db.get(User, row.sender_id)),
            "recipient": user_view(db.get(User, row.recipient_id)), "item_id": row.item_id,
            "snapshot": row.snapshot, "status": row.status, "created_at": row.created_at}


def create_gift(db, user_id, payload: GiftCreate):
    item = accessible_item(db, user_id, payload.item_id, write=True)
    if item.archived:
        raise DomainError("请先恢复这件物品")
    if not are_friends(db, user_id, payload.recipient_id):
        raise DomainError("请先建立好友关系")
    if db.scalar(select(Gift.id).where(Gift.item_id == item.id, Gift.status == "pending")):
        raise DomainError("这件物品已有待接收的礼物", 409)
    experiences = []
    for identity in dict.fromkeys(payload.experience_ids):
        experience = require(db.get(ExperienceRecord, identity))
        if experience.creator_id != user_id or item.id not in experience.item_ids:
            raise DomainError("只能附上自己创作且与这件物品关联的回忆")
        view = experience_view(experience)
        view["item_ids"], view["item_labels"] = [item.id], {item.id: item.name}
        experiences.append(view)
    snapshot = {"name": item.name, "product": item.product, "message": payload.message,
                "avatar": payload.avatar.model_dump(), "experiences": experiences,
                "sender_name": db.get(User, user_id).display_name}
    from .continuity import public_product_sources
    snapshot['public_source_ids'] = [source.id for source, _ in public_product_sources(db,user_id,item)]
    gift = Gift(sender_id=user_id, recipient_id=payload.recipient_id, item_id=item.id, snapshot=snapshot)
    db.add(gift)
    db.commit()
    return gift_view(db, gift)


def accept_gift(db, user_id, gift_id):
    gift = require(db.get(Gift, gift_id))
    if gift.recipient_id != user_id:
        raise DomainError("没有找到这份礼物", 404)
    if gift.status == "accepted":
        return gift_view(db, gift)
    if gift.status != "pending":
        raise DomainError("礼物状态已变化", 409)
    item = require(db.get(ItemRecord, gift.item_id))
    affected = item_readers(db, item.id)
    # Compare-and-set protects the ownership transition and repeated acceptance.
    changed = db.execute(update(ItemRecord).where(ItemRecord.id == item.id, ItemRecord.owner_id == gift.sender_id)
                         .values(owner_id=user_id, state={}, version=ItemRecord.version + 1, photo_id=None))
    if changed.rowcount != 1:
        raise DomainError("物品归属已变化，请刷新", 409)
    db.execute(delete(Grant).where(Grant.item_id == item.id))
    db.execute(delete(HouseholdItem).where(HouseholdItem.item_id == item.id))
    profile = db.get(Profile, (user_id, item.id))
    if profile is None:
        profile = Profile(user_id=user_id, item_id=item.id)
        db.add(profile)
    profile.description = gift.snapshot["message"]
    profile.avatar = {**gift.snapshot["avatar"], "gift_from": gift.snapshot["sender_name"],
                      "gift_message": gift.snapshot["message"]}
    for experience in gift.snapshot["experiences"]:
        new_photos = []
        for photo_id in experience["photo_ids"]:
            asset = own_asset(db, gift.sender_id, photo_id)
            copied = Asset(id=uid(), owner_id=user_id, path=asset.path, media_type=asset.media_type, original_name=asset.original_name)
            db.add(copied)
            new_photos.append(copied.id)
        db.add(ExperienceRecord(creator_id=user_id, title=experience["title"], text=experience["text"],
                               item_ids=[item.id], item_labels={item.id: gift.snapshot["name"]},
                               photo_ids=new_photos, occurred_on=experience["occurred_on"], origin_id=experience["id"],
                               provenance={**experience.get("provenance",{}),"kind":"received_story",
                                           "author_id":experience.get("provenance",{}).get("author_id",gift.sender_id),
                                           "author_name":experience.get("provenance",{}).get("author_name",gift.snapshot["sender_name"]),
                                           "gift_id":gift.id,"sender_name":gift.snapshot["sender_name"]}))
    gift.status = "accepted"
    from .continuity import copy_public_evidence
    copy_public_evidence(db,gift.sender_id,user_id,item,gift.snapshot.get('public_source_ids',[]))
    invalidate_context(db, [*affected, user_id, gift.sender_id], stop_running=True)
    db.commit()
    return gift_view(db, gift)


def seed_demo(db):
    if db.get(User, "person_demo_owner"):
        return
    catalog = json.loads((ROOT / "fixtures/development/catalog.json").read_text(encoding="utf-8"))
    for person, username in zip(catalog["people"], ["xiaolin", "xiaoxia"]):
        db.add(User(id=person["id"], username=username, display_name=person["display_name"].replace("模拟用户", "").replace("模拟好友", ""),
                    password_hash=PASSWORDS.hash(secrets.token_urlsafe(32))))
    db.flush()
    products = {row["id"]: row for row in catalog["products"]}
    sources = {row["id"]: row["url"] for row in catalog["sources"]}
    for row in catalog["items"]:
        product = products.get(row["product_id"])
        spec = ProductSpec(**{key: product[key] for key in ("brand", "commercial_name", "model", "market", "edition", "firmware_version")},
                           source_urls=[sources[key] for key in product["source_ids"]]).model_dump() if product else {}
        db.add(ItemRecord(id=row["id"], owner_id=row["owner_id"], name=row["name"].split("（")[0], kind=row["kind"], product_id=product_record(db, spec, row["kind"]),
                          state={"data_origin": "development_simulation"}))
    db.flush()
    for row in catalog["items"]:
        db.add(Profile(user_id=row["owner_id"], item_id=row["id"], description=row["personal_description"],
                       avatar={"nickname": row["name"].split("（")[0], "personality": "温和、好奇，珍惜共同经历。", "color": "#d49c62"}))
    for row in catalog["experiences"]:
        db.add(ExperienceRecord(**row, item_labels={item_id: db.get(ItemRecord, item_id).name for item_id in row["item_ids"]}))
    db.add(Friendship(sender_id="person_demo_owner", recipient_id="person_demo_friend", accepted=True))
    db.commit()
