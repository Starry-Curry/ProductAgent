from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
    text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    sessionmaker,
)


def uid():
    return uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(Text)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)


class ProductRecord(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    spec: Mapped[dict] = mapped_column(JSON)


class ItemRecord(Base):
    __tablename__ = "items"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, default="standard_product")
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    catalog: Mapped[ProductRecord | None] = relationship(lazy="joined")
    identity_notes: Mapped[dict] = mapped_column(JSON, default=dict)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    photo_id: Mapped[str | None] = mapped_column(String, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String, default=now)

    @property
    def product(self):
        if self.catalog:
            return dict(self.identity_notes or self.catalog.spec)
        return dict(self.identity_notes or {}) if self.kind=='standard_product' else {}


class Profile(Base):
    __tablename__ = "item_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), primary_key=True)
    description: Mapped[str] = mapped_column(Text, default="")
    avatar: Mapped[dict] = mapped_column(JSON, default=dict)


class Grant(Base):
    __tablename__ = "item_grants"
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    path: Mapped[str] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String)
    original_name: Mapped[str] = mapped_column(String)


class ExperienceRecord(Base):
    __tablename__ = "experiences"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    item_labels: Mapped[dict] = mapped_column(JSON, default=dict)
    photo_ids: Mapped[list] = mapped_column(JSON, default=list)
    occurred_on: Mapped[str | None] = mapped_column(String, nullable=True)
    origin_id: Mapped[str | None] = mapped_column(String, nullable=True)
    provenance: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)
    version: Mapped[int] = mapped_column(Integer, default=1)
    allow_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    household_id: Mapped[str | None] = mapped_column(ForeignKey("households.id"), nullable=True, index=True)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    basis: Mapped[str] = mapped_column(String, default="user_report")
    source_message_id: Mapped[str] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[str] = mapped_column(String, default=now)
    supersedes_id: Mapped[str | None] = mapped_column(ForeignKey("memories.id"), nullable=True)
    expires_at: Mapped[str | None] = mapped_column(String, nullable=True)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)


class KnowledgeClaim(Base):
    __tablename__ = "knowledge_claims"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    conditions: Mapped[dict] = mapped_column(JSON, default=dict)
    basis: Mapped[str] = mapped_column(String)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("sources.id"), nullable=True)
    source_quote: Mapped[str] = mapped_column(Text, default="")
    source_message_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="provisional")
    created_at: Mapped[str] = mapped_column(String, default=now)


class TaskRecord(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    goal: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="exploring")
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    constraints: Mapped[dict] = mapped_column(JSON, default=dict)
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    feedback: Mapped[list] = mapped_column(JSON, default=list)
    source_message_id: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class DeviceTarget(Base):
    __tablename__ = "device_targets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
    kind: Mapped[str] = mapped_column(String)
    address: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, default=now)


class DeviceObservation(Base):
    __tablename__ = "device_observations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    target_id: Mapped[str] = mapped_column(ForeignKey("device_targets.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    tool: Mapped[str] = mapped_column(String)
    arguments: Mapped[dict] = mapped_column(JSON)
    evidence: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class SourceRecord(Base):
    __tablename__ = "sources"
    origin: Mapped[str] = mapped_column(String, default="legacy")
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    pages: Mapped[list] = mapped_column(JSON, default=list)
    asset_id: Mapped[str | None] = mapped_column(String, nullable=True)
    fetched_at: Mapped[str] = mapped_column(String, default=now)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String, default="新的对话")
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    agent_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    context_revision: Mapped[int] = mapped_column(Integer, default=0)
    reset_after: Mapped[str] = mapped_column(String, default="")
    updated_at: Mapped[str] = mapped_column(String, default=now)
    entry_context: Mapped[dict] = mapped_column(JSON, default=dict)


class ChatMessage(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    photo_ids: Mapped[list] = mapped_column(JSON, default=list)
    item_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    recorded_experiences: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    created_at: Mapped[str] = mapped_column(String, default=now)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String, default="queued")
    text: Mapped[str] = mapped_column(Text, default="")
    events: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str] = mapped_column(Text, default="")
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


Index("one_active_run_per_conversation", Run.conversation_id, unique=True,
      sqlite_where=text("status IN ('queued','running')"),
      postgresql_where=text("status IN ('queued','running')"))


class Friendship(Base):
    __tablename__ = "friendships"
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)


class Gift(Base):
    __tablename__ = "gifts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
    snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[str] = mapped_column(String, default=now)


class Reminder(Base):
    __tablename__ = "reminders"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    title: Mapped[str] = mapped_column(String)
    due_at: Mapped[str] = mapped_column(String)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String, default="pending")
    version: Mapped[int] = mapped_column(Integer, default=1)
    feedback: Mapped[list] = mapped_column(JSON, default=list)
    household_id: Mapped[str | None] = mapped_column(ForeignKey("households.id"), nullable=True)


class Household(Base):
    __tablename__ = "households"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str] = mapped_column(String, default=now)


class HouseholdMember(Base):
    __tablename__ = "household_members"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String, default="invited")
    role: Mapped[str] = mapped_column(String, default="member")


class HouseholdItem(Base):
    __tablename__ = "household_items"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), primary_key=True)
    shared_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class Wish(Base):
    __tablename__ = "wishes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String)
    note: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, default="")
    visible_to_friends: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String, default=now)


class TaskParticipant(Base):
    __tablename__ = "task_participants"
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String, default="invited")


class ExperienceShare(Base):
    __tablename__ = "experience_shares"
    experience_id: Mapped[str] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)


def make_database(settings):
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {})
    if settings.database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=10000")
    from .migrate import upgrade_database
    upgrade_database(engine)
    return engine, sessionmaker(engine, expire_on_commit=False)
