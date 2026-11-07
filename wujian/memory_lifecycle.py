"""Bounded retirement of personal understanding, without deleting authored history.

This is source/literal suppression, not a claim of arbitrary semantic erasure.
SQL remains authoritative and an unrelated exchange in the same thread survives.
"""
from dataclasses import dataclass
import unicodedata

from sqlalchemy import select

from .database import ChatMessage, Conversation, ExperienceRecord, Memory, Profile, now


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
    from .database import Run
    retired={row.id for row in rows if not row.active}
    if retired:
        affected=[run.id for run in db.scalars(select(Run).where(Run.user_id==user_id))
            if any(event.get('type')=='memory_context' and retired.intersection(event.get('memory_ids',[])) for event in run.events)]
        if affected:source_ids.update(db.scalars(select(ChatMessage.id).where(ChatMessage.run_id.in_(affected))))
    return HistoryPolicy(frozenset(source_ids), tuple(sorted(literals.items())))


def scoped_history_policy(db, user_id):
    """Lazy reuse within one projection, never stored on a Session/across calls.

    The caller creates a fresh loader for each list/read. No Memory scan occurs
    unless message evidence needs it, and subsequent reads observe corrections
    or forgetting even when they use the same SQLAlchemy Session.
    """
    policy = None

    def load():
        nonlocal policy
        if policy is None:
            policy = history_policy(db, user_id)
        return policy

    return load


def growth_evidence_valid(db, user_id, item_id, anchors, history=None):
    """Check a derived expression against its current original permissions.

    This checks evidence identity and availability, not whether a model's
    interpretation is entailed by a quote. The main Agent must keep that
    interpretation narrow; retained history is not a psychological diagnosis.
    """
    if not isinstance(anchors, list) or not anchors:
        return False
    for anchor in anchors:
        if not isinstance(anchor, dict):
            return False
        if anchor.get("message_id"):
            message=db.get(ChatMessage,anchor["message_id"])
            conversation=db.get(Conversation,message.conversation_id) if message else None
            history = history() if callable(history) else history or history_policy(db,user_id)
            quote=anchor.get("quote","")
            valid = bool(message and message.role=="user" and conversation
                and conversation.user_id==user_id and isinstance(quote, str)
                and (not quote or quote in message.text)
                and not history.blocks(message.id,message.text))
        elif anchor.get("experience_id"):
            story=db.get(ExperienceRecord,anchor["experience_id"])
            valid = bool(story and story.creator_id==user_id and story.allow_ai
                and item_id in story.item_ids
                and story.version==anchor.get("version",1))
        else:
            valid=False
        if not valid:
            return False
    return True


def experience_lineage_id(db, experience_id):
    """Resolve an original story root while the received copy still exists."""
    identity, visited = experience_id, set()
    while identity not in visited:
        visited.add(identity)
        story = db.get(ExperienceRecord, identity)
        if not story or not story.origin_id:
            return identity
        identity = story.origin_id
    # Business writers do not create cycles. A malformed historical cycle gets
    # the same identity regardless of the starting copy.
    return min(visited)


def stamp_growth_evidence(db, anchor):
    """Stamp SQL source lineage after the writer validates ownership/permission.

    A received story's root survives later deletion of that received copy.
    The Agent's GrowthTraitProposal has no way to supply this field.
    """
    from .persona_models import GrowthEvidence
    value = GrowthEvidence.model_validate(anchor).model_dump(exclude_none=True)
    value["lineage_id"] = (value["message_id"] if value.get("message_id")
        else experience_lineage_id(db, value["experience_id"]))
    return value


def growth_source_lineages(db, anchors):
    """Original record identities, independent of quote/context/version wording.

    All quotes in one user message share a lineage. A wall entry keeps its
    lineage across edits and received copies trace their origin IDs. This is
    deliberately source-level suppression, not semantic erasure of arbitrary
    retellings or separately authored records about the same event.
    """
    lineages = set()
    for anchor in anchors:
        if anchor.get("message_id"):
            lineages.add(("message", anchor.get("lineage_id") or anchor["message_id"]))
        elif anchor.get("experience_id"):
            lineages.add(("experience", anchor.get("lineage_id")
                or experience_lineage_id(db, anchor["experience_id"])))
    return lineages


def persona_stopped_sources(db, user_id, item_id):
    """Source identities stopped for this one companion, with no SQL changes."""
    profile = db.get(Profile, (user_id, item_id)) if item_id else None
    if not profile:
        return set()
    return {(kind, identity) for _, kind, identity in dismissed_growth_lineages(db, profile.avatar or {})}


def memory_source_lineages(db, memory):
    anchors = []
    if memory.get("source_message_id"):
        anchors.append({"message_id": memory["source_message_id"]})
    attributes = memory.get("attributes") or {}
    anchors.extend(anchor for anchor in attributes.get("evidence", []) if isinstance(anchor, dict))
    return growth_source_lineages(db, anchors)


def filter_persona_memories(db, user_id, item_id, rows):
    """Hide same-source understanding only in this companion's current context.

    An entire Memory supported by a stopped source is hidden, including when
    it also has newer evidence. This deliberately errs conservatively: multiple
    preferences from one long message can be hidden together for this persona.
    Other companions/global recall and the authoritative records are unchanged.
    """
    stopped = persona_stopped_sources(db, user_id, item_id)
    if not stopped:
        return list(rows)
    return [row for row in rows if not stopped.intersection(memory_source_lineages(db, row))]


def filter_persona_retrieval(db, user_id, item_id, result):
    """Apply the same local context rule after authorized ReMe rehydration.

    Original stories remain explicitly readable. Historical conversation hits
    from the same stopped message are also omitted here, to avoid immediately
    retrieving the old expression through a second contextual route.
    """
    stopped = persona_stopped_sources(db, user_id, item_id)
    if not stopped:
        return result
    hits = []
    for hit in result.get("results", []):
        data = hit.get("data") or {}
        if hit.get("kind") == "memory" and stopped.intersection(memory_source_lineages(db, data)):
            continue
        if hit.get("kind") == "conversation" and ("message", data.get("user_message_id")) in stopped:
            continue
        hits.append(hit)
    return {**result, "results": hits}


def dismissed_growth_lineages(db, avatar):
    """Read tombstones from raw stored traits, never the filtered UI projection."""
    from pydantic import ValidationError
    from .persona_models import GrowthTrait

    dismissed = set(avatar.get("growth_dismissed_ids", []))
    blocked = set()
    for raw in avatar.get("growth_traits", []):
        try:
            trait = GrowthTrait.model_validate(raw).model_dump(exclude_none=True)
        except (ValidationError, TypeError):
            continue
        if trait["id"] in dismissed:
            blocked.update((trait["dimension"], kind, identity)
                for kind, identity in growth_source_lineages(db, trait["evidence"]))
    return blocked


def growth_trait_blocked(db, avatar, trait):
    """A synonym cannot revive stopped evidence in the same expression dimension."""
    if trait["id"] in avatar.get("growth_dismissed_ids", []):
        return True
    return bool(dismissed_growth_lineages(db, avatar).intersection(
        (trait["dimension"], kind, identity)
        for kind, identity in growth_source_lineages(db, trait["evidence"])))


def prepare_growth_trait(db, avatar, trait):
    """Validate a writer proposal against raw stops and preserve their provenance.

    Any stopped source in a candidate blocks the whole candidate: adding one
    fresh anchor cannot launder a withdrawn source. A new user message alone
    can independently renew the preference after normal permission checks.
    The writer must keep old raw stopped traits when it merges this result.
    """
    from .persona_models import GrowthTrait, renewed_growth_trait_id

    value = GrowthTrait.model_validate(trait).model_dump(exclude_none=True)
    lineages = growth_source_lineages(db, value["evidence"])
    blocked = dismissed_growth_lineages(db, avatar)
    if blocked.intersection((value["dimension"], kind, identity) for kind, identity in lineages):
        raise ValueError("用户已停止沿用该来源在这个维度形成的特点；不能改写情境或补入新依据重新加入")
    if value["id"] in avatar.get("growth_dismissed_ids", []):
        value["id"] = renewed_growth_trait_id(value["id"], lineages)
    if growth_trait_blocked(db, avatar, value):
        raise ValueError("用户已停止沿用这个特点，请遵循当前有效设置")
    return value


def stopped_growth_traits(db, user_id, item_id, avatar, history=None):
    """Explain only still-permitted local stops, without quotes/source IDs.

    If global forgetting or a withdrawn story invalidates the source, even a
    negative control must not bring its private content back to the model.
    The raw source tombstone still rejects resurrection on the write side.
    """
    from pydantic import ValidationError
    from .persona_models import GrowthStoppedTrait, GrowthTrait

    dismissed = set(avatar.get("growth_dismissed_ids", []))
    result, seen = [], set()
    for raw in avatar.get("growth_traits", []):
        try:
            trait = GrowthTrait.model_validate(raw).model_dump(exclude_none=True)
        except (ValidationError, TypeError):
            continue
        if trait["id"] not in dismissed or not growth_evidence_valid(
                db, user_id, item_id, trait["evidence"], history):
            continue
        key = (trait["dimension"], trait["behavior"], trait["context"])
        if key not in seen:
            result.append(GrowthStoppedTrait(dimension=trait["dimension"],
                behavior=trait["behavior"], context=trait["context"]).model_dump())
            seen.add(key)
    return result


def current_avatar(db, user_id, item_id, avatar, *, history=None):
    """Project individually grounded expressions from the same SQL profile.

    Explicit appearance/personality survive disabling growth and withdrawing
    evidence. Removed expressions remain in SQL history, never in current
    Agent/card/retrieval projections. No second persona memory is written.
    """
    value = dict(avatar or {})
    if value.get("gift_memories"):
        refs = value["gift_memories"]
        stories = {row.id: row for row in db.scalars(select(ExperienceRecord).where(
            ExperienceRecord.id.in_([entry.get("experience_id") for entry in refs]),
            ExperienceRecord.creator_id == user_id)) if row.origin_id and item_id in row.item_ids}
        value["gift_memories"] = [{**entry, "chat_allowed": stories[entry["experience_id"]].allow_ai}
            for entry in refs if entry.get("experience_id") in stories]
    enabled = value.get("growth_enabled", True)
    history = history or scoped_history_policy(db, user_id)
    value["growth_stopped_traits"] = stopped_growth_traits(db, user_id, item_id, value, history)
    structured_growth = bool(value.get("growth_traits") or value.get("growth_dismissed_ids"))
    if structured_growth or not enabled or (value.get("growth_note") and not growth_evidence_valid(
            db, user_id, item_id, value.get("growth_evidence", []), history)):
        for key in ("growth_note","growth_source","growth_evidence"):
            value.pop(key,None)
    traits = value.get("growth_traits", [])
    if traits:
        from pydantic import ValidationError
        from .persona_models import GrowthTrait
        # One withdrawn memory removes only its dependent expression, rather
        # than discarding unrelated ways of relating to this same object.
        current = []
        for raw in traits:
            try:
                trait = GrowthTrait.model_validate(raw).model_dump(exclude_none=True)
            except (ValidationError, TypeError):
                continue
            if (enabled and not growth_trait_blocked(db, value, trait)
                    and growth_evidence_valid(db, user_id, item_id, trait["evidence"], history)):
                current.append(trait)
        value["growth_traits"] = current
    return value
