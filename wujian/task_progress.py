"""Apply entry-specific user reports, independently of an Agent's proposal.

This validates attribution and referential integrity, not the physical truth of
a report or the semantic correctness of the model's interpretation.
"""
from copy import deepcopy

from . import domain
from .evidence import locate_quote

STATES = {"completed": "ready", "not_done": "pending", "not_found": "not_found", "unchanged": "unchanged"}


def apply_entry_reports(proposed, previous, reports, current_question, *, db, user_id):
    if proposed.get("schema") != "interaction/1":
        if reports:
            raise domain.DomainError("逐项进度报告只能对应已有interaction/1条目")
        return proposed, []
    from .preparation_plan import validate_preparation
    preparation_reports = validate_preparation(proposed, previous, current_question)
    old = {entry["id"]: entry for entry in previous.get("entries", [])} if previous.get("schema") == "interaction/1" else {}
    report_by_id, evidence = {}, []
    for report in reports:
        if report.entry_id in report_by_id:
            raise domain.DomainError("同一条目本轮只能有一份进度报告")
        if report.entry_id not in old:
            raise domain.DomainError("进度报告必须对应已存在的条目；新增提案必须pending，不能替用户报告完成")
        quote = locate_quote(current_question, report.source_quote)
        if quote is None:
            raise domain.DomainError("条目进度必须引用本轮用户实际原话，不能引用旧消息或改写")
        report_by_id[report.entry_id] = report
        evidence.append({"entry_id": report.entry_id, "state": STATES[report.action_result],
                         "source_quote": quote, "entry_title": old[report.entry_id]["title"]})
    result = deepcopy(proposed)
    present = set()
    for entry in result["entries"]:
        identity = entry["id"]
        present.add(identity)
        original, report = old.get(identity), report_by_id.get(identity)
        if original is None:
            if entry["state"] != "pending":
                raise domain.DomainError("新增提案条目必须从pending开始；一般feedback_quote不能证明条目已完成")
            # Assignment and attribution are explicit UI actions, not proposal data.
            entry["assignee_id"] = None
            entry["updated_by"] = None
            continue
        old_state = original.get("state", "pending")
        revised_resource = identity in preparation_reports and any(
            entry.get(key) != original.get(key) for key in ("title", "group", "item_id"))
        revised_note = identity in preparation_reports and entry.get("note", "") != original.get("note", "") and not report
        if revised_note and entry["state"] != "pending":
            raise domain.DomainError("准备说明已修改但没有新的逐项完成报告，state需pending重新核对；不能把旧数量或旧条件的完成进度沿用")
        if revised_resource and report:
            raise domain.DomainError("资源更改后需重新核对准备进度，不能同时把旧动作的完成报告迁移过来")
        if entry["state"] != old_state and not ((revised_resource or revised_note) and entry["state"] == "pending") and (report is None or entry["state"] != STATES[report.action_result]):
            raise domain.DomainError("改变已有条目进度需要progress_reports逐项引用本轮用户报告；一般feedback_quote不能解锁整个清单")
        if (report or old_state != "pending") and not revised_resource:
            for key in ("title", "group", "item_id"):
                if entry.get(key) != original.get(key):
                    raise domain.DomainError("不能把已有进度移到改名或换物品的新动作；请保留原条目，另建pending提案")
        if report:
            entry["state"] = STATES[report.action_result]
        for key in ("note", "assignee_id", "updated_by"):
            if key == "note" and identity in preparation_reports:
                continue
            entry[key] = original.get(key, "" if key == "note" else None)
        if report:
            entry["updated_by"] = user_id
    # Do not erase an explicit UI/user report when the model abbreviates a plan.
    for identity, original in old.items():
        if identity not in present and (original.get("state", "pending") != "pending" or identity in report_by_id):
            entry = deepcopy(original)
            if report := report_by_id.get(identity):
                entry["state"] = STATES[report.action_result]
                entry["updated_by"] = user_id
            result["entries"].append(entry)
    from .interactions import validate_entry_ready
    for entry in result["entries"]:
        if entry["state"] == "ready":
            validate_entry_ready(db, user_id, entry)
    return result, evidence
