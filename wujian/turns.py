"""AgentScope's native final result contract, shared by chat and durable goals."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from . import domain, foundation
from .database import ChatMessage, TaskRecord, Conversation
from .evidence import locate_quote
from .learning import Learning, apply_learning, validate_learning


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
    answer: str = Field(
        min_length=1,
        description="Final natural-language answer for the person; use item names here, internal IDs only in structured fields",
    )
    continuation: ContinuingPlan | None = Field(
        description="A substantive proposal or continuing task with latest feedback. Null for simple questions, acknowledgements, story-only recording and companionship. Keep actual user requirements separate from proposed mechanisms."
    )
    learning: Learning
    story_refs: list[str] = Field(
        description="IDs of authorized memory-wall records to quote with their original author. Use when the person asks about an existing story. Discuss present feelings in answer; the application renders the actual story, so do not retell or invent past scenes there. Empty for no story request.",
        max_length=5,
    )


def commit_continuation(db, user_id, message_id, result, current_question, commit=True):
    plan = result.continuation
    if plan is None:
        return None
    if plan.feedback_quote and plan.feedback_quote not in current_question:
        raise domain.DomainError("任务反馈未对应当前用户原话")
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


def commit_result(db, user_id, message_id, result, current_question):
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
                f"{attribution}《{row['title']}》（{row['occurred_on']}）：\n\n{quote}"
            )
    db.commit()
    answer=result.answer
    message=db.get(ChatMessage,message_id)
    conversation=db.get(Conversation,message.conversation_id) if message else None
    if task and conversation and conversation.entry_context.get('intent')=='guidance':
        from .guidance import render_current_step
        answer=render_current_step(task['plan'],task['status'])
    return {
        "task": task,
        "learned": learned,
        "answer": answer + ("\n\n" + "\n\n".join(stories) if stories else ""),
    }


def grounded_turn_schema(sessions, user_id, message_id):
    """Native SDK validation returns grounding errors to the same Agent to repair."""

    class GroundedTurnResult(TurnResult):
        @model_validator(mode="after")
        def check_evidence(self):
            with sessions() as db:
                validate_learning(db, user_id, message_id, self.learning)
                message = domain.require(db.get(ChatMessage, message_id))
                conversation = db.get(Conversation, message.conversation_id)
                if conversation.entry_context.get('intent','general')=='general':
                    import re
                    timed_action = re.search(r'(?:长按|按住|同时按|持续按)[^\n。]{0,70}\d+(?:[–~-]\d+)?\s*(?:秒|分钟)',self.answer)
                    if timed_action and not (self.continuation and self.continuation.plan.get('kind')=='guidance'):
                        raise ValueError('具体按键时序不能凭常识猜测。需要先确认当前物品准确型号，读适用原文后放在带 evidence 的 guidance 步骤中；型号未知时只帮用户识别，不建议试按组合')
                if conversation.entry_context.get('intent') == 'guidance':
                    if self.continuation is None:
                        raise ValueError('逐步教学需维护可恢复的 continuation；有资料时整理当前一步，资料不足时用 identify/observe 补问，已有任务必须继续原 task_id')
                    teaching = self.continuation.plan
                    if teaching.get('schema') != 'interaction/1' or teaching.get('kind') != 'guidance' or not teaching.get('entries') or any(not entry.get('guidance') for entry in teaching.get('entries',[])):
                        raise ValueError('请使用 interaction/1 guidance 计划；guidance 放在每个 entries 元素里面，各步骤填指令、预期信号、失败分支、target_label 和 evidence；不能放在 plan.guidance[step_id] 或只写在 answer 中')
                if self.continuation:
                    plan = self.continuation
                    for identity in self.continuation.item_ids:
                        domain.accessible_item(db, user_id, identity)
                    message = domain.require(db.get(ChatMessage, message_id))
                    if plan.feedback_quote:
                        quote = locate_quote(message.text, plan.feedback_quote)
                        if quote is None:
                            raise domain.DomainError(
                                "feedback_quote必须是当前用户实际报告的连续原句，不能改写或拼接"
                            )
                        plan.feedback_quote = quote
                    if plan.task_id:
                        task = domain.require(db.get(TaskRecord, plan.task_id))
                        if (
                            task.user_id != user_id
                            or task.version != plan.expected_version
                        ):
                            raise domain.DomainError(
                                "原任务已变化或不可用，请重新read_task后接续"
                            )
                    from .guidance import validate_plan, validate_parameters
                    previous = db.get(TaskRecord, plan.task_id) if plan.task_id else None
                    try:
                        plan.plan = validate_plan(db, user_id, plan.item_ids, plan.plan, message_id,
                            previous.plan if previous else None)
                        if plan.plan.get('kind')=='guidance':
                            validate_parameters(self.answer,plan.plan['entries'])
                            observations=((previous.plan if previous else {}).get('guidance') or {}).get('observations',[])
                            report=next((entry for entry in reversed(observations) if entry.get('message_id')==message_id),None)
                            active_id=(plan.plan.get('guidance') or {}).get('active_step_id')
                            active=next((entry for entry in plan.plan['entries'] if entry['id']==active_id),None)
                            if report and report['outcome'] in {'not_found','unchanged'} and active and (active.get('guidance') or {}).get('kind')=='operate':
                                raise domain.DomainError('本轮负反馈后先用 identify/observe/verify 核对尚未确认的前提或实际状态，不能直接跳到新操作、复位或初始化；等用户实际报告后再继续')
                    except domain.DomainError as error:
                        import logging
                        logging.getLogger(__name__).warning('Teaching validation: %s', error.message)
                        raise ValueError(error.message) from error
                available = {row["id"] for row in domain.list_experiences(db, user_id, for_ai=True)}
                if any(identity not in available for identity in self.story_refs):
                    raise ValueError("story_refs包含不可用的经历，请重新读取")
            return self

    return GroundedTurnResult
