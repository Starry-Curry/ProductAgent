"""Current household access to the canonical authored wall record.

Sharing a physical item never shares its author's private recollections. The
explicit household scope below is checked again whenever content is read;
neither retrieval projections nor old story/photo references grant access.
"""
from dataclasses import dataclass, field

from sqlalchemy import select

from .database import ExperienceShare, HouseholdItem, HouseholdMember


@dataclass
class ExperienceReadScope:
    """Current SQL audience, reused only within one read operation.

    Do not retain this across requests or a write: membership, item withdrawal
    and individual sharing must be reloaded for the next operation.
    """
    actor_id: str
    members: dict[str, set[str]] = field(default_factory=dict)
    items: dict[str, set[str]] = field(default_factory=dict)
    shared_ids: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, db, actor_id, *, for_ai=False):
        scope = cls(actor_id)
        families = select(HouseholdMember.household_id).where(
            HouseholdMember.user_id == actor_id, HouseholdMember.status == "active")
        for household_id, user_id in db.execute(select(
                HouseholdMember.household_id, HouseholdMember.user_id).where(
                    HouseholdMember.household_id.in_(families), HouseholdMember.status == "active")):
            scope.members.setdefault(household_id, set()).add(user_id)
        if scope.members:
            for household_id, item_id in db.execute(select(
                    HouseholdItem.household_id, HouseholdItem.item_id).where(
                        HouseholdItem.household_id.in_(scope.members))):
                scope.items.setdefault(household_id, set()).add(item_id)
        if not for_ai:
            scope.shared_ids = set(db.scalars(select(ExperienceShare.experience_id).where(
                ExperienceShare.user_id == actor_id)))
        return scope


def active_members(db, household_id):
    if not household_id:
        return set()
    return set(db.scalars(select(HouseholdMember.user_id).where(
        HouseholdMember.household_id == household_id,
        HouseholdMember.status == "active")))


def household_item_ids(db, household_id):
    return set(db.scalars(select(HouseholdItem.item_id).where(
        HouseholdItem.household_id == household_id)))


def family_experience_visible(db, actor_id, row, *, scope=None):
    household_id = row.household_id
    if not household_id:
        return False
    if scope is not None and scope.actor_id != actor_id:
        raise ValueError("Experience audience belongs to a different reader")
    members = scope.members.get(household_id, set()) if scope is not None else active_members(db, household_id)
    linked = set(row.item_ids or [])
    return bool(actor_id in members and row.creator_id in members and linked
                and linked.issubset(scope.items.get(household_id, set()) if scope is not None
                                    else household_item_ids(db, household_id)))


def can_read_experience(db, actor_id, row, for_ai=False, *, scope=None):
    if row is None or (for_ai and not row.allow_ai):
        return False
    if scope is not None and scope.actor_id != actor_id:
        raise ValueError("Experience audience belongs to a different reader")
    if row.creator_id == actor_id or family_experience_visible(db, actor_id, row, scope=scope):
        return True
    return not for_ai and (row.id in scope.shared_ids if scope is not None
                          else db.get(ExperienceShare, (row.id, actor_id)) is not None)


def validate_family_scope(db, actor_id, household_id, item_ids):
    """Validate an explicit publish/edit, without turning item access into consent."""
    if household_id is None:
        return
    from .domain import DomainError
    if actor_id not in active_members(db, household_id):
        raise DomainError("只有这个家庭的正式成员能留下家庭回忆", 404)
    if not item_ids or not set(item_ids).issubset(household_item_ids(db, household_id)):
        raise DomainError("家庭回忆至少关联一件本家庭物品，不能夹带私人物品或其他家庭物品")


def experience_readers(db, row):
    """Potential readers to invalidate on edits, including former visible scope."""
    return {row.creator_id, *active_members(db, row.household_id),
            *db.scalars(select(ExperienceShare.user_id).where(
                ExperienceShare.experience_id == row.id))}
