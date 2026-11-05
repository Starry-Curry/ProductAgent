"""Evidence-grounded updates emitted by the main Agent's native final contract."""

import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from . import domain, foundation
from .database import ChatMessage, Conversation, Memory, SourceRecord
from .evidence import locate_quote


class Applicability(BaseModel):
    requirements: list[str] = Field(
        description="Conditions required for this capability or procedure to work"
    )
    limits: list[str] = Field(
        description="Known limits or prohibited uses; not a generic safety checklist"
    )
    unknowns: list[str] = Field(
        description="Material conditions not established by evidence"
    )


class KnowledgeUpdate(BaseModel):
    item_id: str
    kind: Literal["capability", "boundary", "procedure", "observation", "case"]
    content: str = Field(min_length=1, max_length=4000)
    conditions: Applicability
    basis: Literal["document", "user_report", "inference"]
    scope: Literal["product", "item"]
    source_id: str | None = None
    source_quote: str = Field(
        default="",
        description="Verbatim retained document or CURRENT user words, never a search summary",
    )
    source_line_start: int | None = Field(
        default=None,
        ge=1,
        description="Prefer original numbered source lines over retyping quotes",
    )
    source_line_end: int | None = Field(
        default=None,
        ge=1,
        description="Inclusive end line, at most 40 lines; program retains the actual original text",
    )
    source_model: str = Field(
        default="",
        description="Exact model actually found in document text/title; empty for a generic case or unknown",
    )
    supersedes_id: str | None = None


class MemoryUpdate(BaseModel):
    operation: Literal["add", "replace", "forget"]
    memory_id: str | None = None
    content: str = Field(default="", max_length=2000)
    item_id: str | None = None
    kind: Literal[
        "preference",
        "constraint",
        "ability",
        "relationship",
        "meaning",
        "goal",
        "event",
    ]
    context: str = Field(
        description="The situation this understanding applies to, avoiding an unconditional personality label"
    )
    basis: Literal["user_report", "inference"] = "user_report"
    source_quote: str = Field(
        min_length=1,
        description="CURRENT user words supporting this change; never received stories or assistant guesses",
    )
    expires_at: str | None = None

    @model_validator(mode="after")
    def require_new_understanding(self):
        if self.operation != "forget" and not self.content.strip():
            raise ValueError(
                "新增或替换理解时content必须写明保留的认识，不能只填写source_quote"
            )
        return self


class Learning(BaseModel):
    knowledge_updates: list[KnowledgeUpdate] = Field(
        max_length=12,
        description="New reusable capabilities, boundaries, procedures or cases learned this turn. Include useful evidence from documents actually read; empty when nothing was learned. A hypothesis stays inference.",
    )
    memory_updates: list[MemoryUpdate] = Field(
        max_length=12,
        description="Quiet changes to understanding THIS user. Compare with existing understanding before add/replace; do not save every message or infer permanent traits from temporary feelings. Empty when unnecessary.",
    )


def normalized_model(value):
    return re.sub(r"[^\w]", "", value).casefold()


def validate_learning(db, user_id, message_id, learning):
    if not learning.knowledge_updates and not learning.memory_updates:
        return
    message = domain.require(db.get(ChatMessage, message_id))
    conversation = domain.require(db.get(Conversation, message.conversation_id))
    if message.role != "user" or conversation.user_id != user_id:
        raise domain.DomainError("理解更新必须来自当前用户")
    for change in learning.memory_updates:
        if change.source_quote not in message.text:
            raise domain.DomainError("个人理解的source_quote未对应当前用户原话")
        if change.operation in {"replace", "forget"}:
            old = domain.require(db.get(Memory, change.memory_id or ""))
            if old.user_id != user_id:
                raise domain.DomainError("没有找到这条理解", 404)
            if not old.active:
                raise domain.DomainError("旧理解已被替换或遗忘，请重新读取", 409)
        if change.item_id:
            domain.accessible_item(db, user_id, change.item_id)
    for change in learning.knowledge_updates:
        item = domain.accessible_item(db, user_id, change.item_id)
        if change.basis == "document":
            source = domain.require(db.get(SourceRecord, change.source_id or ""))
            if source.owner_id != user_id:
                raise domain.DomainError("资料不可用", 404)
            if (
                change.source_line_start is not None
                or change.source_line_end is not None
            ):
                start, end = change.source_line_start, change.source_line_end
                lines = source.content.splitlines()
                if (
                    start is None
                    or end is None
                    or end < start
                    or end > len(lines)
                    or end - start >= 40
                ):
                    raise domain.DomainError(
                        "请使用该source实际返回的连续行号范围，最多40行"
                    )
                change.source_quote = "\n".join(lines[start - 1 : end])
            quote = locate_quote(source.content, change.source_quote)
            if quote is None or len(quote.strip()) < 8:
                raise domain.DomainError(
                    f"source_quote未匹配实际原文，请重新read_source({source.id})选择连续原句；不能把摘要、改写或省略号当作原文"
                )
            change.source_quote = quote
            expected = normalized_model(item.product.get("model", ""))
            if (
                not change.source_model
                and expected
                and expected in normalized_model(source.title + " " + source.content)
            ):
                change.source_model = item.product["model"]
            if change.scope == "product" and not (
                expected
                and normalized_model(change.source_model) == expected
                and expected in normalized_model(source.title + " " + source.content)
            ):
                raise domain.DomainError(
                    "型号共性需要原文中的匹配source_model；通用案例按item参考保留"
                )
            if source.item_id and source.item_id != item.id:
                original = domain.accessible_item(db, user_id, source.item_id)
                if not item.product_id or original.product_id != item.product_id:
                    raise domain.DomainError("资料绑定到另一型号")
        if change.basis == "user_report" and (
            change.scope == "product"
            or not change.source_quote
            or change.source_quote not in message.text
        ):
            raise domain.DomainError("用户报告必须保留当前原话并仅用于具体实例")


def apply_learning(db, user_id, message_id, learning):
    validate_learning(db, user_id, message_id, learning)
    if not learning.knowledge_updates and not learning.memory_updates:
        return {"knowledge": [], "memories": []}
    message = domain.require(db.get(ChatMessage, message_id))
    conversation = domain.require(db.get(Conversation, message.conversation_id))
    if message.role != "user" or conversation.user_id != user_id:
        raise domain.DomainError("理解更新必须来自当前用户的实际任务")
    saved = {"knowledge": [], "memories": []}
    for change in learning.memory_updates:
        if change.source_quote not in message.text:
            raise domain.DomainError("个人理解未对应当前用户原话")
        if change.operation in {"replace", "forget"}:
            old = domain.require(db.get(Memory, change.memory_id or ""))
            if old.user_id != user_id:
                raise domain.DomainError("没有找到这条理解", 404)
            if change.operation == "forget":
                old.active = False
                domain.invalidate_context(db, [user_id])
                saved["memories"].append({"id": old.id, "status": "forgotten"})
                continue
        row = foundation.revise_memory(
            db,
            user_id,
            message_id,
            change.content,
            change.item_id,
            change.basis,
            change.memory_id if change.operation == "replace" else None,
            change.expires_at,
            commit=False,
            attributes={
                "kind": change.kind,
                "context": change.context,
                "source_quote": change.source_quote,
            },
        )
        saved["memories"].append(row)
    for change in learning.knowledge_updates:
        item = domain.accessible_item(db, user_id, change.item_id)
        conditions = {**change.conditions.model_dump(), "kind": change.kind}
        if change.source_line_start:
            conditions["source_lines"] = {
                "start": change.source_line_start,
                "end": change.source_line_end,
            }
        if change.basis == "document":
            source = domain.require(db.get(SourceRecord, change.source_id or ""))
            expected = normalized_model(item.product.get("model", ""))
            matched = bool(
                expected
                and normalized_model(change.source_model) == expected
                and expected in normalized_model(source.title + " " + source.content)
            )
            if change.scope == "product" and not matched:
                raise domain.DomainError(
                    "型号知识需要原文中实际出现的匹配型号；通用案例请保留为实例参考或假设"
                )
            conditions["identity_match"] = (
                "model_text_matched" if matched else "generic_reference"
            )
        else:
            conditions["identity_match"] = (
                "user_report" if change.basis == "user_report" else "unverified"
            )
        if change.basis == "user_report" and change.scope == "product":
            raise domain.DomainError("一次个人报告不能直接成为同型号所有物品的共性")
        saved["knowledge"].append(
            foundation.save_claim(
                db,
                user_id,
                message_id,
                change.item_id,
                change.content,
                conditions,
                change.basis,
                change.scope,
                change.source_id,
                change.source_quote,
                change.supersedes_id,
                commit=False,
            )
        )
    db.flush()
    return saved
