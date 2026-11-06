from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    enabled: bool = False
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
    state: dict = Field(default_factory=dict)


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
    allow_ai: bool = False


class ExperienceChange(ExperienceCreate):
    expected_version: int = Field(ge=1)


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
    version: int = 1
    access: Literal["owner", "shared"] = "owner"


class ChatRequest(Input):
    text: str = Field(default="", max_length=20000)
    conversation_id: str | None = None
    item_ids: list[str] = Field(default_factory=list, max_length=30)
    photo_ids: list[str] = Field(default_factory=list, max_length=4)
    entry_context: "EntryContext | None" = None


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
    entry_context: dict = Field(default_factory=dict)


class RunView(BaseModel):
    id: str
    conversation_id: str
    status: str
    text: str
    events: list[dict]
    error: str
    usage: dict


class CreativeRequest(Input):
    item_ids: list[str] = Field(default_factory=list, max_length=12)
    photo_ids: list[str] = Field(default_factory=list, max_length=4)
    goal: str = Field(min_length=1, max_length=8000)
    constraints: str = Field(default="", max_length=2000)


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
    household_id: str | None = None


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
    status: str = "pending"
    version: int = 1
    feedback: list[dict] = Field(default_factory=list)
    household_id: str | None = None


class Preferences(Input):
    companion_name: str = Field(default="阿圆", min_length=1, max_length=20)
    display_mode: Literal["normal", "large"] = "normal"


class EntryContext(Input):
    intent: Literal["general", "guidance", "creative", "planning", "story", "persona"] = "general"
    task_id: str | None = None


class HouseholdCreate(Input):
    name: str = Field(min_length=1, max_length=60)


class HouseholdInvite(Input):
    user_id: str


class HouseholdMemberView(UserView):
    status: Literal["invited", "active"]
    role: Literal["owner", "member"]


class HouseholdView(BaseModel):
    id: str
    name: str
    creator_id: str
    membership: str
    members: list[HouseholdMemberView]
    item_ids: list[str]


class HouseholdItemChange(Input):
    item_id: str
    shared: bool = True


class ItemPresentation(Input):
    expected_version: int = Field(ge=1)
    location: str = Field(default="", max_length=160)
    attention: Literal["normal", "needs_check", "paused", "needs_restock", "lost", "lent"] = "normal"
    note: str = Field(default="", max_length=1600)
    cherished: bool = False


class ReminderFeedback(Input):
    expected_version: int = Field(ge=1)
    action: Literal["read", "accept", "complete", "reopen"]
    note: str = Field(default="", max_length=1200)


class StepEvidence(Input):
    source_id: str
    quote: str = Field(default="", max_length=4000)
    source_line_start: int | None = Field(default=None, ge=1)
    source_line_end: int | None = Field(default=None, ge=1)
    page: int | None = Field(default=None, ge=1)
    source_model: str = Field(default="", max_length=120)


class GuidanceDetails(Input):
    kind: Literal["identify", "observe", "operate", "verify", "contact_support"] = "operate"
    basis: Literal["document", "general", "user_report"] = Field(default="general", description="通用建议用general；已核验型号原文用document；不因没有手册而拒绝初步帮助。")
    instruction: str = Field(min_length=1, max_length=2400)
    success_signal: str = Field(default="", max_length=1000)
    if_not_found: str = Field(default="", max_length=1000)
    if_unchanged: str = Field(default="", max_length=1000)
    caution: str = Field(default="", max_length=1000)
    target_label: str = Field(default="", max_length=160)
    evidence: list[StepEvidence] = Field(default_factory=list, max_length=6)
    observed_quote: str = Field(default="", max_length=2400, description="仅在用户实际做过或报告结果时填写本轮连续原话。计划做的动作不是实际完成。")
    observed_message_id: str | None = None

    @model_validator(mode='after')
    def source_basis(self):
        if self.evidence and self.basis=='general':self.basis='document'
        return self


class TaskEntry(Input):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    item_id: str | None = None
    group: Literal["owned", "buy", "borrow", "confirm", "step"] = "owned"
    note: str = Field(default="", max_length=2000)
    state: Literal["pending", "ready", "not_found", "unchanged"] = Field(default="pending", description="新建议必须pending。用户本轮明确报告做过才可ready；找不到用not_found，做过没变化用unchanged，并在guidance.observed_quote保存当前原话。")
    assignee_id: str | None = None
    updated_by: str | None = None
    guidance: GuidanceDetails | None = None


class GuidanceRequest(Input):
    item_id: str
    question: str = Field(min_length=1, max_length=6000)
    photo_ids: list[str] = Field(default_factory=list, max_length=4)


class GuidanceFeedback(Input):
    expected_version: int = Field(ge=1)
    step_id: str = Field(min_length=1, max_length=80)
    outcome: Literal["done", "not_found", "unchanged"]
    note: str = Field(default="", max_length=1600)
    photo_ids: list[str] = Field(default_factory=list, max_length=4)
    receipt_id: str = Field(min_length=8, max_length=80)


class TaskBoardCreate(Input):
    goal: str = Field(min_length=1, max_length=4000)
    kind: Literal["checklist", "guidance", "idea"] = "checklist"
    item_ids: list[str] = Field(default_factory=list, max_length=50)
    entries: list[TaskEntry] = Field(default_factory=list, max_length=60)
    constraints: dict = Field(default_factory=dict)


class TaskEntryFeedback(Input):
    expected_version: int = Field(ge=1)
    state: Literal["pending", "ready", "not_found", "unchanged"]
    note: str = Field(default="", max_length=2000)


class TaskEntryAssignment(Input):
    expected_version: int = Field(ge=1)
    assignee_id: str | None = None


class TaskBoardView(BaseModel):
    task: TaskView
    kind: Literal["checklist", "guidance", "idea", "legacy"]
    entries: list[TaskEntry]
    completed_count: int
    total_count: int
    conversation_id: str | None
    sources: list[dict] = Field(default_factory=list)
    access: Literal["owner", "invited", "active"] = "owner"
    participants: list[dict] = Field(default_factory=list)


class WishCreate(Input):
    title: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=1600)
    url: str = Field(default="", max_length=2000)
    visible_to_friends: bool = False


class WishView(WishCreate):
    id: str
    user_id: str
    version: int


class FriendSpace(BaseModel):
    person: UserView
    items: list[ItemView]
    wishes: list[WishView]
    experiences: list[ExperienceView] = Field(default_factory=list)


class WorkspaceView(BaseModel):
    preferences: Preferences
    items: list[ItemView]
    experiences: list[ExperienceView]
    households: list[HouseholdView]
    reminders: list[ReminderView]
    tasks: list[TaskView]
    conversations: list[ConversationView]
    friends: list[FriendView]
    gifts: list[GiftView]
    wishes: list[WishView]


class Revision(Input):
    expected_version: int = Field(ge=1)


class MemoryCorrection(Input):
    content: str = Field(min_length=1, max_length=2000)


class GiftDecision(Input):
    action: Literal["decline", "cancel"]


ChatRequest.model_rebuild()


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

