"""AgentScope's native final result contract, shared by chat and durable goals."""

import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from . import domain, foundation
from .database import ChatMessage, TaskRecord
from .evidence import locate_quote
from .learning import Learning, apply_learning


class ContinuingPlan(BaseModel):
    goal: str = Field(description="The substantive goal being proposed or continued")
    item_ids: list[str] = Field(
        description="Actual accessible resource IDs; never substitute names or invented resources"
    )
    constraints: dict = Field(
        description="Current user requirements and conditions, including temporary exclusions"
    )
    plan: dict = Field(
        description="Proposed actions/alternatives, why they can work, minimum trial and unknown conditions; a proposal is not executed success"
    )
    task_id: str | None = Field(
        description="Matching existing task ID; null only for a genuinely new goal"
    )
    expected_version: int | None = Field(
        description="Version from the current task record; null for a new task"
    )
    status: Literal["exploring", "ready", "in_progress", "completed", "cancelled"] = (
        "ready"
    )
    feedback_quote: str = Field(
        default="",
        description="Exact CURRENT user words reporting actual results or changed preferences; empty if none",
    )
    outcome: Literal["success", "failure", "partial", "preference", "unknown"] = (
        "unknown"
    )


class TurnResult(BaseModel):
    # Evidence and the actual proposal precede prose in the native schema.
    # Same fields, same transaction; no extra generation or reviewer.
    learning: Learning
    source_refs: list[str] = Field(default_factory=list, max_length=8,
        description="Retained source IDs actually read for this answer, not search-result URLs or invented IDs. The application renders checked citations with their real reading depth.")
    source_limitations: str = Field(default="", max_length=1200,
        description="If sources were read but none supports the proposed claim, briefly explain that reading limitation to the user instead of implying verified external cases. Empty when unnecessary.")
    story_refs: list[str] = Field(
        default_factory=list,
        description="IDs of authorized memory-wall records to quote with their original author. Use when the person asks about an existing story. Discuss present feelings in answer; the application renders the actual story, so do not retell or invent past scenes there. Empty for no story request.",
        max_length=5,
    )
    continuation: ContinuingPlan | None = Field(
        description="Retain any proposed creative options as well as substantive plans/continuing tasks, including inspiration the user has not selected yet. Use interaction/1 kind=idea entries for alternatives. Null only for no proposal (simple questions, acknowledgements, story-only recording and companionship). Keep actual user requirements separate from proposed mechanisms."
    )
    answer: str = Field(
        min_length=1,
        description="Final natural-language answer for the person; use item names here, internal IDs only in structured fields",
    )


def referenced_sources(result):
    """Normalize already supplied references, never invent supporting evidence."""
    return list(dict.fromkeys([*result.source_refs,
        *(change.source_id for change in result.learning.knowledge_updates
          if change.basis in {"document", "inference"} and change.source_id),
        *re.findall(r"\[([a-f0-9]{32})\]",result.answer)]))[:8]


def commit_continuation(db, user_id, message_id, result, current_question, commit=True):
    plan = result.continuation
    if plan is None:
        return None
    if plan.feedback_quote:
        quote=locate_quote(current_question,plan.feedback_quote)
        if quote is None:
            raise domain.DomainError("任务反馈未对应当前用户实际原话，不能改写或拼接")
        plan.feedback_quote=quote
    # One transaction and one domain write path. No second model, writer or classifier.
    with db.begin_nested():
        task_id, version = plan.task_id, plan.expected_version
        if task_id:
            current = domain.require(db.get(TaskRecord, task_id))
            if current.user_id != user_id:
                raise domain.DomainError("没有找到这项任务", 404)
            if current.version != version:
                raise domain.DomainError("任务已更新，请重新读取后继续", 409)
        if task_id is None:
            created = foundation.save_task(
                db,
                user_id,
                message_id,
                plan.goal,
                plan.item_ids,
                plan.constraints,
                plan.plan,
                status="exploring" if plan.feedback_quote else plan.status,
                commit=False,
            )
            task_id, version = created["id"], created["version"]
            if not plan.feedback_quote:
                saved = created
        if plan.feedback_quote:
            feedback = foundation.task_feedback(
                db,
                user_id,
                message_id,
                task_id,
                plan.feedback_quote,
                plan.outcome,
                version,
                source_quote=plan.feedback_quote,
                commit=False,
            )
            version = feedback["version"]
        if plan.task_id is not None or plan.feedback_quote:
            saved = foundation.save_task(
                db,
                user_id,
                message_id,
                plan.goal,
                plan.item_ids,
                plan.constraints,
                plan.plan,
                task_id,
                version,
                plan.status,
                commit=False,
            )
    db.commit() if commit else db.flush()
    return saved


def commit_result(db, user_id, message_id, result, current_question, *, commit=True):
    with db.begin_nested():
        learned = apply_learning(db, user_id, message_id, result.learning)
        task = commit_continuation(
            db, user_id, message_id, result, current_question, commit=False
        )
        experiences = {row["id"]: row for row in domain.list_experiences(db, user_id, for_ai=True)}
        stories = []
        for identity in dict.fromkeys(result.story_refs):
            row = experiences.get(identity)
            if row is None:
                raise domain.DomainError("引用的故事已不可用，请重新读取")
            author = row["provenance"].get("author_name")
            attribution = (
                f"来自{author}的记录"
                if author
                else "随礼物收到的记录"
                if row["origin_id"]
                else "你留下的记录"
            )
            quote = "\n".join("> " + line for line in row["text"].splitlines())
            stories.append(
                f"{attribution}《{row['title']}》" + (f"（{row['occurred_on']}）" if row['occurred_on'] else "") + f"：\n\n{quote}"
            )
        from .source_access import readable_source
        from .knowledge import source_content_level
        citations, inline = [], {}
        source_ids = referenced_sources(result)
        for identity in source_ids:
            source = readable_source(db, user_id, identity)
            title = source.title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("\n", " ")[:160]
            url = source.url.replace("<", "%3C").replace(">", "%3E").replace("\n", "")
            level = source_content_level(source)
            depth = "（已看指定区间抽帧，未观看完整视频或音频）" if level == "sampled_video_frames_not_full_video" else "（已读公开页面文字，未观看视频）" if "not_video_observation" in level else "（已读笔记文字，未核对图片）" if "not_image_observation" in level else ""
            rendered=f"[{title or '原始资料'}](<{url}>){depth}"
            if f"[{identity}]" in result.answer:
                inline[f"[{identity}]"]=rendered
            else:
                citations.append(rendered)
        answer=result.answer
        for marker,rendered in inline.items():
            answer=answer.replace(marker,rendered)
    db.commit() if commit else db.flush()
    return {
        "task": task,
        "learned": learned,
        "answer": answer + ("\n\n" + "\n\n".join(stories) if stories else "")
            + ("\n\n参考：" + "；".join(citations) if citations else "")
            + ("\n\n" + result.source_limitations if result.source_limitations else ""),
    }


def grounded_turn_schema(sessions, user_id, message_id, evidence_sources=None):
    """Native SDK validation returns grounding errors to the same Agent to repair."""

    class GroundedTurnResult(TurnResult):
        @model_validator(mode="after")
        def check_evidence(self):
            self.source_refs = referenced_sources(self)
            if evidence_sources and not self.source_refs and not self.source_limitations:
                raise ValueError("本轮已读取资料：请用source_refs列出确实支持回答的原文ID；如果原文不足以支持方案，则用source_limitations诚实说明限制，不能宣称案例已经核实。")
            with sessions() as db:
                message = domain.require(db.get(ChatMessage, message_id))
                # Exercise the same SQL-only business path, then ALWAYS undo
                # it. A second handwritten validator had drifted: invalid
                # expiry/completion passed the SDK and failed too late to
                # repair. Never put network/device/projection writes here.
                checkpoint=db.begin_nested()
                try:
                    commit_result(db,user_id,message_id,self,message.text,commit=False)
                finally:
                    checkpoint.rollback()
            return self

    return GroundedTurnResult
