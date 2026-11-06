"""Rebuild a bounded conversation from canonical SQL, never SDK scratch state.

Raw run traces remain available for audit. Thinking, tool bodies and structured
output repair attempts are not conversation history or a second fact store.
"""

import base64
import json
from dataclasses import dataclass
from pathlib import Path

from agentscope.message import AssistantMsg, Base64Source, DataBlock, TextBlock, UserMsg
from agentscope.state import AgentState
from sqlalchemy import select

from . import domain
from .database import ChatMessage, Conversation, ExperienceRecord, Run, User
from .retrieval import record_write_receipts
from .source_access import readable_source


@dataclass
class ConversationContext:
    state: AgentState
    current_input: UserMsg
    source_index: list[dict]


def photo_data_block(asset):
    """Read one retained image within the upload bound; caller checks access."""
    if not asset.media_type.startswith("image/"):
        raise domain.DomainError("这份附件不是照片", 400)
    try:
        with Path(asset.path).open("rb") as stream:
            data = stream.read(10 * 1024 * 1024 + 1)
    except OSError as error:
        raise domain.DomainError("这张已保存的照片目前不可读取", 404) from error
    if len(data) > 10 * 1024 * 1024:
        raise domain.DomainError("照片超过10MB读取上限", 400)
    return DataBlock(source=Base64Source(
        data=base64.b64encode(data).decode(), media_type=asset.media_type))


def read_conversation_photo(db, user_id, conversation_id, photo_id):
    """Reopen a saved attachment in this authorized, non-reset chat only.

    Owning an asset alone is insufficient: a private wall photo or another
    conversation's attachment does not grant this Agent read permission.
    """
    conversation = domain.require(db.get(Conversation, conversation_id))
    if conversation.user_id != user_id:
        raise domain.DomainError("没有找到或无权读取这段对话的照片", 404)
    attachments = db.scalars(select(ChatMessage.photo_ids).where(
        ChatMessage.conversation_id == conversation.id, ChatMessage.role == "user",
        ChatMessage.created_at >= conversation.reset_after,
    ))
    if not any(photo_id in identities for identities in attachments):
        raise domain.DomainError("这张照片不是当前有效对话中的用户附件", 404)
    return photo_data_block(domain.own_asset(db, user_id, photo_id))


def _source_index(db, user_id, conversation, current_message):
    """Pointers to recently read sources; no old body or claimed current access."""
    runs = db.scalars(select(Run).where(
        Run.user_id == user_id, Run.conversation_id == conversation.id,
        Run.status.in_(["completed", "failed", "interrupted"]), Run.created_at >= conversation.reset_after,
        Run.created_at <= current_message.created_at,
    ).order_by(Run.created_at.desc()).limit(8)).all()
    found = {}
    for run in runs:
        names = {event.get("id"): event.get("name") for event in run.events
                 if event.get("type") == "tool_start"}
        for event in reversed(run.events):
            evidence = event.get("evidence") or {}
            if (event.get("type") != "tool_end" or event.get("state") != "success"
                    or not isinstance(evidence, dict)):
                continue
            name = names.get(event.get("id"))
            if name in {"read_source", "fetch_document", "sample_video_frames",
                        "view_source_image", "view_source_page"}:
                reads = [evidence]
            elif name == "search_public_web" and isinstance(evidence.get("original_reads"), list):
                # Only the registered search tool's successful original reads
                # count. Search labels, URLs and unavailable results are clues,
                # not acquired sources, even if they contain source-like IDs.
                reads = [entry for entry in evidence["original_reads"]
                         if isinstance(entry, dict) and entry.get("read_state") == "retrieved"]
            else:
                continue
            for read in reads:
                identity = read.get("source_id")
                if not isinstance(identity, str) or identity in found:
                    continue
                try:
                    source = readable_source(db, user_id, identity)
                except domain.DomainError:
                    continue
                found[identity] = {"source_id": identity, "title": source.title[:240],
                    "url": source.url[:1000], "origin": source.origin,
                    "reference_kind": "previously_read_source_pointer",
                    "acquired_in_run_status": run.status,
                    "reading_scope": str(read.get("reading_scope", read.get("content_level", "")))[:500]}
                if len(found) == 8:
                    return list(found.values())
    return list(found.values())


def build_conversation_context(db, user_id, conversation, current_message):
    """Return history, current input and permission-checked source pointers.

    Keep the last 16 completed SQL messages plus *every* unanswered user input.
    Replay at most two completed-history photos; unanswered/current attachments
    all remain visible (the chat API admits at most four per input). Asset reads
    retain the upload's 10 MiB bound and always check present ownership. A missing
    or revoked attachment is explicit instead of breaking recovery or faking it.
    """
    if (conversation.user_id != user_id or current_message.conversation_id != conversation.id
            or current_message.role != "user"):
        raise domain.DomainError("无权恢复这段对话", 404)
    user = db.get(User, user_id)
    domain.require(user)
    rows = db.scalars(select(ChatMessage).where(
        ChatMessage.conversation_id == conversation.id,
        ChatMessage.created_at >= conversation.reset_after,
        ChatMessage.created_at <= current_message.created_at,
    ).order_by(ChatMessage.created_at)).all()
    # Do not replay later same-timestamp messages or include current twice.
    current_index = next((index for index, row in enumerate(rows) if row.id == current_message.id), None)
    if current_index is None:
        raise domain.DomainError("当前消息不在有效对话上下文中", 409)
    history = rows[:current_index]
    last_answer = next((index for index in range(len(history) - 1, -1, -1)
                        if history[index].role == "assistant"), -1)
    completed = history[max(0, last_answer - 15):last_answer + 1]
    unanswered = [row for row in history[last_answer + 1:] if row.role == "user"]
    retained = completed + unanswered
    receipt_ids = {identity for row in [*retained, current_message] if row.role == "user"
                   for identity in (row.recorded_experiences or {}).values()}
    record_uses = dict(db.execute(select(ExperienceRecord.id, ExperienceRecord.allow_ai).where(
        ExperienceRecord.creator_id == user_id, ExperienceRecord.id.in_(receipt_ids))).all()) if receipt_ids else {}
    recent_photos = {(row.id, identity) for row, identity in
        [(row, identity) for row in completed if row.role == "user" for identity in row.photo_ids][-2:]}
    unanswered_ids = {row.id for row in unanswered}

    def user_message(row, current=False):
        text = row.text or "请看看这张照片，帮助我认识物品。"
        receipts = record_write_receipts(row, record_uses)
        if receipts:
            text += "\nrecord_receipts=" + json.dumps(receipts, ensure_ascii=False, separators=(",", ":"))
        if row.photo_ids:
            text += "\n原始照片引用：" + ",".join(row.photo_ids)
        content = [TextBlock(text=text)]
        for identity in row.photo_ids:
            if not (current or row.id in unanswered_ids or (row.id, identity) in recent_photos):
                continue
            try:
                asset = domain.own_asset(db, user_id, identity)
                content.append(photo_data_block(asset))
            except domain.DomainError:
                content.append(TextBlock(text=f"照片 {identity} 当前不可读取，不能据此描述画面。"))
        return UserMsg(name=user.display_name, content=content)

    state = AgentState(session_id=conversation.id)
    for row in retained:
        if row.role == "user":
            state.context.append(user_message(row))
        elif row.role == "assistant":
            state.context.append(AssistantMsg(name="物间", content=row.text))
    return ConversationContext(state, user_message(current_message, current=True),
                               _source_index(db, user_id, conversation, current_message))
