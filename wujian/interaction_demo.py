"""Explicitly synthetic reference-layout data, isolated to the two demo identities."""
from . import domain, foundation
from .database import Household, HouseholdItem, HouseholdMember, ItemRecord, Profile, Reminder, TaskParticipant, Wish, now


def ensure_demo_workspace(db):
    # A focused real-object profile may contain only its own user/item. Seed
    # the fictional family workspace only when its complete base is present.
    from .database import User,ItemRecord
    if not db.get(User,'person_demo_friend') or not db.get(ItemRecord,'item_demo_lamp'):
        return
    owner, friend, house_id = "person_demo_owner", "person_demo_friend", "household_demo_home"
    from .database import User
    if not db.get(User,owner) or not db.get(User,friend):
        return  # A single-object teaching profile is not a synthetic family.
    if db.get(Household, house_id):
        return
    db.add(Household(id=house_id, name="小林的家（体验）", creator_id=owner))
    db.flush()
    db.add_all([HouseholdMember(household_id=house_id, user_id=owner, status="active", role="owner"),
                HouseholdMember(household_id=house_id, user_id=friend, status="active", role="member")])
    samples = [
        ("rice", "电饭煲", "厨房", "normal"), ("thermos", "保温壶", "厨房", "paused"),
        ("washer", "阳台的洗衣机", "阳台", "needs_check"), ("mat", "野餐垫", "储物间", "normal"),
        ("bags", "垃圾袋", "厨房", "needs_restock"),
    ]
    for key, name, location, attention in samples:
        identity = "item_demo_" + key
        db.add(ItemRecord(id=identity, owner_id=owner, name=name, kind="standard_product",
            identity_notes={"brand": "", "model": "", "market": "CN"}, state={
                "data_origin": "development_simulation", "availability": "unavailable" if attention == "paused" else "available",
                "presentation": {"location": location, "attention": attention, "note": "家人正在处理，先暂停使用。" if key == "thermos" else "", "cherished": False}}))
        db.flush()
        db.add(Profile(user_id=owner, item_id=identity, description="", avatar={"enabled": False}))
        db.add(HouseholdItem(household_id=house_id, item_id=identity, shared_by=owner))
    for identity, location in [("item_demo_lamp", "书房"), ("item_demo_printer", "书房")]:
        item = db.get(ItemRecord, identity)
        if item:
            item.state = {**item.state, "presentation": {"location": location, "attention": "normal"}}
            db.add(HouseholdItem(household_id=house_id, item_id=identity, shared_by=owner))
    db.add(Reminder(id="reminder_demo_thermos", creator_id=owner, assignee_id=friend,
        item_id="item_demo_thermos", household_id=house_id, title="检查保温壶，处理前先别使用", due_at=now(),
        status="in_progress", feedback=[{"actor_id": friend, "action": "accept", "note": "体验档案中的合成接手报告", "at": now(), "basis": "development_simulation"}]))
    db.add(Wish(id="wish_demo_lamp", user_id=friend, title="床头阅读灯", note="睡前看书时，想留一盏舒服的灯。", url="", visible_to_friends=True))
    db.commit()
    plan = {"schema": "interaction/1", "kind": "checklist", "entries": [
        {"id": "mat", "title": "野餐垫", "item_id": "item_demo_mat", "group": "owned", "state": "ready", "note": "体验报告：已放进包里", "assignee_id": owner, "updated_by": owner},
        {"id": "meal", "title": "餐盒与餐具", "group": "confirm", "state": "pending", "note": "尚未确认，不能假设已经拥有"},
        {"id": "water", "title": "饮用水", "group": "buy", "state": "pending", "note": "待准备，不计入持有物品"},
    ]}
    task = foundation.save_task(db, owner, "synthetic_interaction_demo", "周六野餐准备", ["item_demo_mat"],
        {"people": 4, "excluded_item_ids": ["item_demo_thermos"], "data_origin": "development_simulation"}, plan, status="in_progress")
    db.add(TaskParticipant(task_id=task["id"], user_id=friend, status="invited"))
    foundation.save_task(db, owner, "synthetic_interaction_demo", "洗衣机排水问题", ["item_demo_washer"],
        {"data_origin": "development_simulation", "instructions_not_verified": True},
        {"schema": "interaction/1", "kind": "guidance", "entries": [
            {"id": "identity", "title": "核对具体型号", "group": "step", "state": "pending", "note": "先查看铭牌；当前没有已确认的型号或操作资料。"},
            {"id": "manual", "title": "查阅适用的说明书", "group": "step", "state": "pending", "note": "取得真实资料后再给具体操作，不预置排水维修答案。"},
            {"id": "result", "title": "记录现象与已做检查", "group": "step", "state": "pending", "note": "保留你的实际报告，必要时整理售后说明。"},
        ]})
    db.commit()
