"""Small typed expressions over the existing personal profile and evidence.

These are not another memory store. The owner controls growth, the shared
profile stores it, and current_avatar checks source availability on every read.
"""
import hashlib
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

GrowthDimension = Literal["pace", "humor", "support", "relationship"]


def growth_trait_id(dimension: str, context: str) -> str:
    """Same dimension/situation updates one trait; a new situation stays separate."""
    normalized_context = " ".join(unicodedata.normalize("NFKC", context).casefold().split())
    digest = hashlib.sha256(normalized_context.encode("utf-8")).hexdigest()[:16]
    return f"{dimension}-{digest}"


def renewed_growth_trait_id(identity: str, lineages: set[tuple[str, str]]) -> str:
    """A new source may renew a stopped context without replacing its old raw trait.

    The suffix identifies original sources, never the model's wording. It is
    stable when the same sources arrive in a different order.
    """
    encoded = "\n".join(f"{kind}:{source_id}" for kind, source_id in sorted(lineages))
    return f"{identity}-{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:12]}"


class GrowthEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: str | None = None
    quote: str = Field(default="", max_length=4000)
    experience_id: str | None = None
    version: int | None = Field(default=None, ge=1)
    lineage_id: str | None = Field(default=None, max_length=160,
        description="Original source identity stamped by the authoritative writer, never supplied by the model",
        json_schema_extra={"readOnly": True})

    @model_validator(mode="after")
    def original_source(self):
        if bool(self.message_id) == bool(self.experience_id):
            raise ValueError("成长依据必须且只能指向一条用户消息或一篇回忆")
        if self.message_id and not self.quote.strip():
            raise ValueError("聊天依据需要保留用户原话")
        if self.experience_id and self.version is None:
            raise ValueError("回忆依据需要保留当时版本")
        return self


class GrowthTraitProposal(BaseModel):
    """The Agent proposes behavior, while the writer stamps actual evidence IDs."""
    model_config = ConfigDict(extra="forbid")
    dimension: GrowthDimension
    behavior: str = Field(min_length=1, max_length=600,
        description="A specific way to speak or respond, grounded in the user's words. Preserve their explicitly chosen personality. Never diagnose the user or invent shared events.")
    context: str = Field(min_length=1, max_length=500,
        description="When this expression applies; reuse an existing trait's exact context when refining the same situation. A temporary mood is not a lasting personality trait.")
    source_quote: str = Field(default="", max_length=4000,
        description="Exact CURRENT user words supporting the preference or shared expression, not your proposed options or other people's feelings")
    experience_ids: list[str] = Field(default_factory=list, max_length=6,
        description="Actually read, AI-permitted wall entries linked to this object. Received stories keep their author and are not the receiver's own experience.")

    @model_validator(mode="after")
    def has_source(self):
        if not self.source_quote.strip() and not self.experience_ids:
            raise ValueError("相处特点需要用户原话或获准回忆作为依据")
        if not self.behavior.strip() or not self.context.strip():
            raise ValueError("相处特点需要具体表达方式和适用情境")
        return self


class GrowthTrait(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    dimension: GrowthDimension
    behavior: str = Field(min_length=1, max_length=600)
    context: str = Field(min_length=1, max_length=500)
    evidence: list[GrowthEvidence] = Field(min_length=1, max_length=12)


class GrowthStoppedTrait(BaseModel):
    """A local expression control, with no private story or evidence identities."""
    model_config = ConfigDict(extra="forbid")
    dimension: GrowthDimension
    behavior: str = Field(min_length=1, max_length=600)
    context: str = Field(min_length=1, max_length=500)
