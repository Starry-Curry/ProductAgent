from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(Input):
    username: str = Field(pattern=r"^[a-zA-Z0-9_]{3,32}$")
    display_name: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=8, max_length=128)


class Login(Input):
    username: str
    password: str


class UserView(BaseModel):
    id: str
    username: str
    display_name: str


class AvatarSpec(Input):
    nickname: str = Field(default="", max_length=80)
    personality: str = Field(default="", max_length=2000)
    color: str = Field(default="#d49c62", pattern=r"^#[0-9a-fA-F]{6}$")


class ProductSpec(Input):
    brand: str = ""
    commercial_name: str = ""
    model: str = ""
    market: str = "CN"
    edition: str = ""
    firmware_version: str | None = None
    source_urls: list[str] = Field(default_factory=list, max_length=20)


class AvatarView(AvatarSpec):
    gift_from: str = ""
    gift_message: str = ""
    growth_note: str = ""
    growth_source: str = ""
    growth_evidence: list[dict] = Field(default_factory=list)


class ItemCreate(Input):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["standard_product", "nonstandard_object"] = "standard_product"
    product: ProductSpec = Field(default_factory=ProductSpec)
    description: str = Field(default="", max_length=8000)
    avatar: AvatarSpec = Field(default_factory=AvatarSpec)
    photo_id: str | None = None


class ItemChange(ItemCreate):
    expected_version: int = Field(ge=1)
    state: dict = Field(default_factory=dict)


class ItemView(ItemCreate):
    kind: Literal["standard_product", "nonstandard_object"]
    product: ProductSpec
    description: str
    photo_id: str | None
    id: str
    owner_id: str
    state: dict
    version: int
    access: Literal["owner", "shared"]
    archived: bool
    avatar: AvatarView
    product_id: str | None = None
    identity_notes: dict = Field(default_factory=dict)


class ExperienceCreate(Input):
    title: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=20000)
    item_ids: list[str] = Field(default_factory=list, max_length=30)
    photo_ids: list[str] = Field(default_factory=list, max_length=8)
    occurred_on: date = Field(default_factory=date.today)


class TaskSave(Input):
    goal: str = Field(min_length=1,max_length=4000)
    item_ids: list[str] = Field(default_factory=list,max_length=50)
    constraints: dict = Field(default_factory=dict)
    plan: dict = Field(default_factory=dict)
    task_id: str | None = None
    expected_version: int | None = None
    status: Literal['exploring','ready','in_progress','completed','cancelled'] = 'exploring'


class TaskFeedback(Input):
    text: str = Field(min_length=1,max_length=4000)
    outcome: Literal['success','failure','partial','preference','unknown']
    expected_version: int = Field(ge=1)


class TaskView(BaseModel):
    id: str
    goal: str
    item_ids: list[str]
    constraints: dict
    plan: dict
    status: str
    feedback: list[dict]
    version: int
    updated_at: str


class DeviceBind(Input):
    kind: Literal['browser_cdp','javascript_artifact']
    address: str = Field(min_length=1,max_length=4000)


class DeviceProposal(Input):
    request: dict


class DeviceTargetView(BaseModel):
    id: str
    item_id: str
    kind: str
    address: str
    created_at: str


class DeviceStatusView(BaseModel):
    bridge_connected: bool
    tool_count: int
    targets: list[DeviceTargetView]
    device_effect_verified: bool
    error: str


class ExperienceView(ExperienceCreate):
    item_ids: list[str]
    photo_ids: list[str]
    occurred_on: date
    id: str
    creator_id: str
    item_labels: dict[str, str]
    origin_id: str | None
    provenance: dict = Field(default_factory=dict)


class ChatRequest(Input):
    text: str = Field(default="", max_length=20000)
    conversation_id: str | None = None
    item_ids: list[str] = Field(default_factory=list, max_length=30)
    photo_ids: list[str] = Field(default_factory=list, max_length=4)


class ChatMessageView(BaseModel):
    id: str
    role: str
    text: str
    run_id: str | None
    photo_ids: list[str]
    created_at: str


class ConversationView(BaseModel):
    id: str
    title: str
    item_ids: list[str]
    updated_at: str


class RunView(BaseModel):
    id: str
    conversation_id: str
    status: str
    text: str
    events: list[dict]
    error: str
    usage: dict


class GiftCreate(Input):
    item_id: str
    recipient_id: str
    message: str = Field(default="", max_length=3000)
    experience_ids: list[str] = Field(default_factory=list, max_length=20)
    avatar: AvatarSpec = Field(default_factory=AvatarSpec)


class ReminderCreate(Input):
    title: str = Field(min_length=1, max_length=160)
    due_at: str = Field(min_length=10, max_length=50)
    assignee_id: str | None = None
    item_id: str | None = None


class FriendRequest(Input):
    username: str


class ShareRequest(Input):
    user_id: str


class FriendView(UserView):
    accepted: bool
    incoming: bool
    sender_id: str


class GiftSnapshot(BaseModel):
    name: str
    product: dict
    message: str
    avatar: AvatarSpec
    experiences: list[ExperienceView]
    sender_name: str
    public_source_ids: list[str] = Field(default_factory=list)


class GiftView(BaseModel):
    id: str
    sender: UserView
    recipient: UserView
    item_id: str
    snapshot: GiftSnapshot
    status: str
    created_at: str


class ReminderView(BaseModel):
    id: str
    creator_id: str
    assignee_id: str
    item_id: str | None
    title: str
    due_at: str
    completed: bool


class MemoryView(BaseModel):
    id: str
    item_id: str | None
    content: str
    basis: str
    source_message_id: str
    updated_at: str
    supersedes_id: str | None = None
    expires_at: str | None = None
    attributes: dict = Field(default_factory=dict)


class HealthView(BaseModel):
    status: str
    model_configured: bool
    model: str
    demo_mode: bool
    device_connected: bool

