"""HTTP contracts for the shared interaction layer; identity stays server-side."""
from fastapi import Depends
from sqlalchemy import delete, select

from . import domain, foundation, interactions
from .api_models import (
    EntryContext, ExperienceChange, ExperienceView, FriendSpace, GiftDecision, GiftView, HouseholdCreate,
    HouseholdInvite, HouseholdItemChange, HouseholdView, ItemPresentation, ItemView,
    MemoryCorrection, MemoryView, Preferences, ReminderFeedback, ReminderView,
    Revision, ShareRequest, TaskBoardCreate, TaskBoardView, TaskEntryFeedback, TaskEntryAssignment,
    TaskEntryCreate, TaskEntryDetails,
    WishCreate, WishChange, WishView, WorkspaceView,
)
from .database import Conversation, ExperienceRecord, ExperienceShare, Gift, Memory, TaskParticipant, User, Wish, uid


def register_interactions(app, current_user, db_session):
    @app.get("/api/workspace", response_model=WorkspaceView, tags=["Interaction workspace"])
    def workspace(user=Depends(current_user), db=Depends(db_session)):
        return interactions.workspace(db, user.id)

    @app.get("/api/preferences", response_model=Preferences, tags=["Interaction workspace"])
    def preferences(user=Depends(current_user)):
        return interactions.preferences(user)

    @app.put("/api/preferences", response_model=Preferences, tags=["Interaction workspace"])
    def change_preferences(payload: Preferences, user=Depends(current_user), db=Depends(db_session)):
        return interactions.set_preferences(db, db.get(User, user.id), payload)

    @app.get("/api/households", response_model=list[HouseholdView], tags=["Households"])
    def households(user=Depends(current_user), db=Depends(db_session)):
        return interactions.households(db, user.id)

    @app.post("/api/households", response_model=HouseholdView, tags=["Households"])
    def create_household(payload: HouseholdCreate, user=Depends(current_user), db=Depends(db_session)):
        return interactions.create_household(db, user.id, payload.name)

    @app.post("/api/households/{household_id}/invitations", tags=["Households"])
    def invite(household_id: str, payload: HouseholdInvite, user=Depends(current_user), db=Depends(db_session)):
        return interactions.invite_household(db, user.id, household_id, payload.user_id)

    @app.post("/api/households/{household_id}/accept", tags=["Households"])
    def accept(household_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.accept_household(db, user.id, household_id)

    @app.delete("/api/households/{household_id}/members/{member_id}", tags=["Households"])
    def remove_member(household_id: str, member_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.remove_member(db, user.id, household_id, member_id)

    @app.post("/api/households/{household_id}/items", tags=["Households"])
    def household_item(household_id: str, payload: HouseholdItemChange, user=Depends(current_user), db=Depends(db_session)):
        return interactions.household_item(db, user.id, household_id, payload.item_id, payload.shared)

    @app.patch("/api/items/{item_id}/presentation", response_model=ItemView, tags=["Items"])
    def presentation(item_id: str, payload: ItemPresentation, user=Depends(current_user), db=Depends(db_session)):
        return interactions.update_presentation(db, user.id, item_id, payload)

    @app.put("/api/experiences/{experience_id}", response_model=ExperienceView, tags=["Experiences"])
    def edit_experience(experience_id: str, payload: ExperienceChange, user=Depends(current_user), db=Depends(db_session)):
        return interactions.change_experience(db, user.id, experience_id, payload)

    @app.delete("/api/experiences/{experience_id}", tags=["Experiences"])
    def delete_experience(experience_id: str, payload: Revision, user=Depends(current_user), db=Depends(db_session)):
        return interactions.delete_experience(db, user.id, experience_id, payload.expected_version)

    @app.get("/api/experiences/{experience_id}/shares", tags=["Experiences"])
    def experience_shares(experience_id: str, user=Depends(current_user), db=Depends(db_session)):
        row = domain.require(db.get(ExperienceRecord, experience_id))
        if row.creator_id != user.id:
            raise domain.DomainError("只能管理自己的分享范围", 403)
        return [domain.user_view(db.get(User, identity)) for identity in db.scalars(select(ExperienceShare.user_id).where(ExperienceShare.experience_id == experience_id))]

    @app.post("/api/experiences/{experience_id}/shares", tags=["Experiences"])
    def share_experience(experience_id: str, payload: ShareRequest, user=Depends(current_user), db=Depends(db_session)):
        return interactions.share_experience(db, user.id, experience_id, payload.user_id)

    @app.delete("/api/experiences/{experience_id}/shares/{recipient_id}", tags=["Experiences"])
    def revoke_experience(experience_id: str, recipient_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.share_experience(db, user.id, experience_id, recipient_id, revoke=True)

    @app.post("/api/memories/{memory_id}/correction", response_model=MemoryView, tags=["Personal understanding"])
    def correct_memory(memory_id: str, payload: MemoryCorrection, user=Depends(current_user), db=Depends(db_session)):
        previous = domain.require(db.get(Memory, memory_id))
        if previous.user_id != user.id:
            raise domain.DomainError("没有找到这条理解", 404)
        result = foundation.revise_memory(db, user.id, "explicit_correction:" + uid(), payload.content,
            item_id=previous.item_id, supersedes_id=memory_id, attributes={
                **{key:value for key,value in (previous.attributes or {}).items() if key not in {"evidence", "retirement"}},
                "source_quote": payload.content, "source_kind": "explicit_correction", "corrected_from": memory_id})
        if result.get("status") == "previously_removed":
            raise domain.DomainError("这段理解此前已撤回，不能直接作为更正恢复", 409)
        domain.invalidate_context(db, [user.id], stop_running=True)
        db.commit()
        return result

    @app.post("/api/reminders/{reminder_id}/feedback", response_model=ReminderView, tags=["Household care"])
    def reminder_feedback(reminder_id: str, payload: ReminderFeedback, user=Depends(current_user), db=Depends(db_session)):
        return interactions.reminder_feedback(db, user.id, reminder_id, payload)

    @app.post("/api/task-boards", response_model=TaskBoardView, tags=["Continuing tasks"])
    def create_board(payload: TaskBoardCreate, user=Depends(current_user), db=Depends(db_session)):
        return interactions.create_board(db, user.id, payload)

    @app.get("/api/tasks/{task_id}/board", response_model=TaskBoardView, tags=["Continuing tasks"])
    def board(task_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.board(db, user.id, task_id)

    @app.patch("/api/tasks/{task_id}/entries/{entry_id}", response_model=TaskBoardView, tags=["Continuing tasks"])
    def update_entry(task_id: str, entry_id: str, payload: TaskEntryFeedback, user=Depends(current_user), db=Depends(db_session)):
        return interactions.update_entry(db, user.id, task_id, entry_id, payload)

    @app.post("/api/tasks/{task_id}/entries", response_model=TaskBoardView, tags=["Continuing tasks"])
    def add_entry(task_id: str, payload: TaskEntryCreate, user=Depends(current_user), db=Depends(db_session)):
        return interactions.add_entry(db, user.id, task_id, payload)

    @app.patch("/api/tasks/{task_id}/entries/{entry_id}/details", response_model=TaskBoardView, tags=["Continuing tasks"])
    def edit_entry(task_id: str, entry_id: str, payload: TaskEntryDetails, user=Depends(current_user), db=Depends(db_session)):
        return interactions.edit_entry(db, user.id, task_id, entry_id, payload)

    @app.patch("/api/tasks/{task_id}/entries/{entry_id}/assignee", response_model=TaskBoardView, tags=["Continuing tasks"])
    def assign_entry(task_id: str, entry_id: str, payload: TaskEntryAssignment, user=Depends(current_user), db=Depends(db_session)):
        return interactions.assign_entry(db, user.id, task_id, entry_id, payload)

    @app.post("/api/tasks/{task_id}/shares", response_model=TaskBoardView, tags=["Continuing tasks"])
    def share_task(task_id: str, payload: ShareRequest, user=Depends(current_user), db=Depends(db_session)):
        return interactions.share_task(db, user.id, task_id, payload.user_id)

    @app.post("/api/tasks/{task_id}/accept", response_model=TaskBoardView, tags=["Continuing tasks"])
    def accept_task(task_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.accept_task(db, user.id, task_id)

    @app.delete("/api/tasks/{task_id}/shares/{participant_id}", tags=["Continuing tasks"])
    def revoke_task(task_id: str, participant_id: str, user=Depends(current_user), db=Depends(db_session)):
        _, access = interactions.task_access(db, user.id, task_id)
        if access != "owner":
            raise domain.DomainError("只有发起者能调整参与范围", 403)
        db.execute(delete(TaskParticipant).where(TaskParticipant.task_id == task_id, TaskParticipant.user_id == participant_id))
        domain.invalidate_context(db, [participant_id], stop_running=True)
        db.commit()
        return {"status": "revoked"}

    @app.post("/api/tasks/{task_id}/conversation", tags=["Continuing tasks"])
    def resume_task(task_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.resume_task(db,user.id,task_id)

    @app.post("/api/gifts/{gift_id}/decision", response_model=GiftView, tags=["Friends"])
    def gift_decision(gift_id: str, payload: GiftDecision, user=Depends(current_user), db=Depends(db_session)):
        from sqlalchemy import update
        gift = domain.require(db.get(Gift, gift_id))
        expected_actor = gift.recipient_id if payload.action == "decline" else gift.sender_id
        status = "declined" if payload.action == "decline" else "cancelled"
        if expected_actor != user.id:
            raise domain.DomainError("无权处理这份心意", 403)
        if gift.status == status:
            return domain.gift_view(db, gift)
        changed = db.execute(update(Gift).where(Gift.id == gift_id, Gift.status == "pending").values(status=status))
        if changed.rowcount != 1:
            raise domain.DomainError("这份心意的状态已经变化，请重新核对", 409)
        db.commit()
        db.expire_all()
        return domain.gift_view(db, db.get(Gift, gift_id))

    @app.get("/api/friends/{friend_id}/space", response_model=FriendSpace, tags=["Friends"])
    def friend_space(friend_id: str, user=Depends(current_user), db=Depends(db_session)):
        return interactions.friend_space(db, user.id, friend_id)

    @app.get("/api/wishes", response_model=list[WishView], tags=["Friends"])
    def wishes(user=Depends(current_user), db=Depends(db_session)):
        return [interactions.wish_view(row) for row in db.scalars(select(Wish).where(Wish.user_id == user.id))]

    @app.post("/api/wishes", response_model=WishView, tags=["Friends"])
    def create_wish(payload: WishCreate, user=Depends(current_user), db=Depends(db_session)):
        return interactions.create_wish(db, user.id, payload)

    @app.put("/api/wishes/{wish_id}", response_model=WishView, tags=["Friends"])
    def change_wish(wish_id: str, payload: WishChange, user=Depends(current_user), db=Depends(db_session)):
        return interactions.change_wish(db, user.id, wish_id, payload)

    @app.delete("/api/wishes/{wish_id}", tags=["Friends"])
    def delete_wish(wish_id: str, payload: Revision, user=Depends(current_user), db=Depends(db_session)):
        changed = db.execute(delete(Wish).where(Wish.id == wish_id, Wish.user_id == user.id, Wish.version == payload.expected_version))
        if changed.rowcount != 1:
            raise domain.DomainError("心愿已更新或不可访问", 409)
        db.commit()
        return {"status": "deleted"}
