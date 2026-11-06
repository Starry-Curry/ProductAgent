"""Validate literal evidence and stable identity for preparation checklists.

This enforces references and current-user attribution, not the meaning of a
quote or physical possession. The Agent still interprets the user's words;
unknown inventory belongs in confirm, rather than an invented missing fact.
"""
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import domain
from .evidence import locate_quote


class PreparationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_id: str = Field(min_length=1, max_length=80)
    source_quote: str = Field(min_length=1, max_length=4000)


class _PreparationReports(BaseModel):
    reports: list[PreparationReport] = Field(default_factory=list, max_length=60)


def _title_key(value):
    # Deliberately no aliases, synonym expansion, quantity inference or fuzzy
    # matching: a water cup is never mapped to drinking water by this helper.
    value = "".join(character for character in value.casefold() if not character.isspace())
    while value and unicodedata.category(value[0]).startswith("P"):
        value = value[1:]
    while value and unicodedata.category(value[-1]).startswith("P"):
        value = value[:-1]
    return value


def validate_preparation(proposed, previous, current_question):
    """Return IDs with valid current literal quotes, without changing either plan.

    Retained IDs preserve task identity. A quoted structural correction must
    restart pending; completion of an old action cannot migrate to its revision.
    """
    if proposed.get("kind") != "checklist":
        return set()
    try:
        reports = _PreparationReports(reports=proposed.get("preparation_reports", [])).reports
    except ValidationError as error:
        problems = "; ".join(".".join(map(str, item["loc"])) + ": " + item["msg"]
                             for item in error.errors(include_input=False, include_url=False)[:6])
        raise domain.DomainError("preparation_reports需为最多60条{entry_id, source_quote}；" + problems) from None
    entries = proposed.get("entries", [])
    by_id, title_ids = {}, {}
    for entry in entries:
        identity, title = entry["id"], entry["title"]
        if identity in by_id:
            raise domain.DomainError(f"清单ID重复：{identity}。保留原条目ID，只修改同一条目，不要重复新增。")
        by_id[identity] = entry
        key = _title_key(title)
        if not key:
            raise domain.DomainError(f"条目{identity}需要具体名称，不能只有空白或标点。")
        if key in title_ids:
            raise domain.DomainError(f"清单名称重复：{title!r}（{title_ids[key]}与{identity}）。请复用已有ID并合并为一条，不要复制准备进度。")
        title_ids[key] = identity
    old = {entry["id"]: entry for entry in (previous or {}).get("entries", [])}
    missing = [f"{identity}: {entry['title']}" for identity, entry in old.items() if identity not in by_id]
    if missing:
        raise domain.DomainError("已有清单项目不能漏掉或换新ID：" + "; ".join(missing[:12])
                                 + "。请保留这些ID/title并修改原条目；不能删除旧项后新建同名项或自动复制旧进度。")
    supported = set()
    for report in reports:
        if report.entry_id in supported:
            raise domain.DomainError(f"preparation_reports中同一条目只能报告一次：{report.entry_id}")
        if report.entry_id not in by_id:
            raise domain.DomainError(f"preparation_reports引用不存在的条目：{report.entry_id}。请使用本次清单已有entry_id。")
        if locate_quote(current_question, report.source_quote) is None:
            raise domain.DomainError(f"条目{report.entry_id}的source_quote必须引用本轮用户原话，不能使用旧消息、改写或编造。"
                                     "引用应支持本条拥有、确实缺少或修改；未登记不代表没有，不知道时用confirm。")
        supported.add(report.entry_id)
    for identity, entry in by_id.items():
        original = old.get(identity)
        changed = original is not None and any(entry.get(field) != original.get(field)
            for field in ("title", "group", "item_id"))
        if original is not None and entry.get("note", "") != original.get("note", "") and identity not in supported:
            raise domain.DomainError(f"修改清单条目{identity}（{original['title']}）的note不能静默丢弃：请在continuation.plan.preparation_reports加入"
                f'{{"entry_id":"{identity}","source_quote":"本轮用户支持这项修改的实际连续原话"}}，并保留这项新note；'
                "若没有本轮修改依据，请保持原note，不要在回答中声称已更新。未知库存用confirm。")
        if changed:
            if identity not in supported:
                raise domain.DomainError(f"修改已有条目{identity}（{original['title']}）的title/group/item_id，需preparation_reports引用本轮实际修改原话；请复用原ID。")
            if entry.get("state", "pending") != "pending":
                raise domain.DomainError(f"条目{identity}的准备内容已改变，state必须pending；不能把旧动作的完成进度迁移到改名、换分类或换物品的新准备。")
        needs_basis = (original is None or entry.get("group") != original.get("group")) and (
            entry.get("group") == "buy" or (entry.get("group") == "owned" and not entry.get("item_id")))
        if needs_basis and identity not in supported:
            raise domain.DomainError(f"条目{identity}（{entry['title']}）归为{entry.get('group')}需preparation_reports引用本轮用户确认已有或确实缺少的原话。"
                                     "未登记不代表没有；未知用confirm，不能为了通过校验而编造引用。")
    return supported
