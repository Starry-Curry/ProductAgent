"""Bounded retirement of personal understanding, without deleting authored history.

This is source/literal suppression, not a claim of arbitrary semantic erasure.
SQL remains authoritative and an unrelated exchange in the same thread survives.
"""
from dataclasses import dataclass
import unicodedata

from sqlalchemy import select

from .database import ChatMessage, Conversation, ExperienceRecord, Memory, now


def normalized(value):
    return "".join(char for char in unicodedata.normalize("NFKC", value).casefold() if char.isalnum())


def retirement_attributes(row, reason, request_message_id=None):
    attributes = dict(row.attributes or {})
    attributes["retirement"] = {"reason": reason, "at": now(), "request_message_id": request_message_id}
    return attributes


def retire(row, reason, request_message_id=None):
    row.attributes, row.active = retirement_attributes(row, reason, request_message_id), False


def with_evidence(attributes, message_id, previous=None):
    """Keep explicit supporting sources when repeated reports update a memory."""
    result = {**((previous.attributes or {}) if previous is not None else {}), **attributes}
    evidence = list((previous.attributes or {}).get("evidence", [])) if previous is not None else []
    if previous is not None:
        evidence.append({"message_id": previous.source_message_id,
                         "quote": (previous.attributes or {}).get("source_quote", "")})
    evidence.append({"message_id": message_id, "quote": attributes.get("source_quote", "")})
    retained = {}
    for item in evidence:
        retained[(item.get("message_id"), item.get("quote", ""))] = item
    result["evidence"] = list(retained.values())
    result.pop("retirement", None)
    return result


@dataclass(frozen=True)
class HistoryPolicy:
    source_ids: frozenset[str]
    literals: tuple[tuple[str, frozenset[str]], ...]

    def blocks(self, message_id, *texts):
        if message_id in self.source_ids:
            return True
        text = "\n".join(normalized(value) for value in texts)
        return any(literal in text and message_id not in corrections for literal, corrections in self.literals)


def history_policy(db, user_id):
    rows = db.scalars(select(Memory).where(Memory.user_id == user_id)).all()
    # Identical content may be valid in a different, still active situation.
    # In that case retire only the original source/quote, not the shared phrase.
    active_content = {normalized(row.content) for row in rows if row.active and (not row.expires_at or row.expires_at > now())}
    source_ids, literals = set(), {}
    for row in rows:
        if row.active:
            continue
        evidence = [*((row.attributes or {}).get("evidence", [])),
                    {"message_id": row.source_message_id, "quote": (row.attributes or {}).get("source_quote", "")}]
        source_ids.update(item["message_id"] for item in evidence if item.get("message_id"))
        content = normalized(row.content)
        corrections = frozenset(current.source_message_id for current in rows
                                if current.active and current.supersedes_id == row.id)
        # A correction may quote the old words to reject them. Exempt only
        # that replacement's evidence from this specific retired literal.
        def add_literal(literal):
            literals[literal] = literals.get(literal, corrections) & corrections
        for item in evidence:
            quote = normalized(item.get("quote", ""))
            if len(quote) >= 4 and not (quote == content and content in active_content):
                add_literal(quote)
        if len(content) >= 4 and content not in active_content:
            add_literal(content)
    return HistoryPolicy(frozenset(source_ids), tuple(sorted(literals.items())))


def current_avatar(db, user_id, item_id, avatar):
    """A derived style note cannot outlive its sources; explicit settings can.

    Keep the historical SQL value for provenance, but use this same projection
    for the item card, Agent reads and disposable retrieval documents.
    """
    value=dict(avatar or {})
    if not value.get("growth_note"):
        return value
    anchors=value.get("growth_evidence",[])
    valid=bool(anchors)
    history=None
    for anchor in anchors:
        if anchor.get("message_id"):
            message=db.get(ChatMessage,anchor["message_id"])
            conversation=db.get(Conversation,message.conversation_id) if message else None
            history=history or history_policy(db,user_id)
            quote=anchor.get("quote","")
            valid = valid and bool(message and message.role=="user" and conversation
                and conversation.user_id==user_id and (not quote or quote in message.text)
                and not history.blocks(message.id,message.text))
        elif anchor.get("experience_id"):
            story=db.get(ExperienceRecord,anchor["experience_id"])
            valid = valid and bool(story and story.creator_id==user_id and story.allow_ai
                and item_id in story.item_ids
                and story.version==anchor.get("version",1))
        else:
            valid=False
        if not valid:
            break
    if not valid:
        for key in ("growth_note","growth_source","growth_evidence"):
            value.pop(key,None)
    return value
