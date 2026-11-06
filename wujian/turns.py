"""AgentScope's native final result contract, shared by chat and durable goals."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator, field_validator, ConfigDict

from . import domain, foundation
from .database import ChatMessage, TaskRecord, Conversation
from .evidence import locate_quote
from .learning import Learning, apply_learning, validate_learning
from .api_models import TaskEntry
from .lessons import LessonAction


class GuidanceProgress(BaseModel):
    model_config = ConfigDict(extra='allow')
    active_step_id: str | None = None
    overview: list[str] = Field(default_factory=list, max_length=8, description='首次教学的简短路线标题；待核验部分只是阶段目标，不是已验证操作。')
    research_pending: bool = False


class InteractionPlan(BaseModel):
    """Expose actual step fields to the SDK, rather than an opaque plan object."""
    model_config = ConfigDict(extra='allow')
    schema_version: Literal['interaction/1'] = Field(default='interaction/1',alias='schema')
    kind: Literal['guidance','checklist','idea']
    entries: list[TaskEntry] = Field(default_factory=list,max_length=60)
    guidance: GuidanceProgress = Field(default_factory=GuidanceProgress)


class ContinuingPlan(BaseModel):
    goal: str = Field(description="The substantive goal being proposed or continued")
    item_ids: list[str] = Field(
        description="Actual accessible resource IDs; never substitute names or invented resources"
    )
    constraints: dict = Field(
        description="Current user requirements and conditions, including temporary exclusions"
    )
    plan: InteractionPlan | dict = Field(union_mode='left_to_right',
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

    @field_validator('plan',mode='after')
    @classmethod
    def keep_shared_dict(cls,value):
        return value.model_dump(by_alias=True,exclude_unset=True) if isinstance(value,InteractionPlan) else value


class TurnResult(BaseModel):
    assistance_mode: Literal['answer', 'research', 'teach'] = Field(default='answer', description='按当前自然语言意图选择；用户要求带做或需要持续操作时teach，查证资料时research。')
    target_item_ids: list[str] = Field(default_factory=list, description='本轮实际回答的获准物品ID，与当前聚焦物一致；没有识别清楚时留空并核对。')
    answer: str = Field(
        min_length=1,
        description="Final natural-language answer for the person; use item names here, internal IDs only in structured fields",
    )
    continuation: ContinuingPlan | None = Field(default=None,
        description="A substantive proposal or continuing task with latest feedback. Null for simple questions, acknowledgements, story-only recording and companionship. Keep actual user requirements separate from proposed mechanisms."
    )
    learning: Learning = Field(default_factory=lambda:Learning(knowledge_updates=[],memory_updates=[]))
    lesson_action: LessonAction | None = Field(default=None,description='只用于当前已建立的逐步教学。明确实际完成才confirm，当前疑问不推进。不要同时重建continuation。')
    story_refs: list[str] = Field(
        default_factory=list,
        description="IDs of authorized memory-wall records to quote with their original author. Use when the person asks about an existing story. Discuss present feelings in answer; the application renders the actual story, so do not retell or invent past scenes there. Empty for no story request.",
        max_length=5,
    )


def commit_continuation(db, user_id, message_id, result, current_question, commit=True):
    from .assistance import check_turn_scope
    plan = result.continuation
    if plan is None:
        return None
    message = db.get(ChatMessage, message_id)
    if message:
        check_turn_scope(db, user_id, message, result)
    elif plan.plan.get('kind') == 'guidance':
        raise domain.DomainError('教学必须关联当前用户的真实对话。')
    if plan.feedback_quote and plan.feedback_quote not in current_question:
        raise domain.DomainError("任务反馈未对应当前用户原话")
    # One transaction and one domain write path. No second model, writer or classifier.
    with db.begin_nested():
        task_id, version = plan.task_id, plan.expected_version
        if task_id:
            current = domain.require(db.get(TaskRecord, task_id))
            if current.user_id != user_id:
                raise domain.DomainError("没有找到这项任务", 404)
            if current.plan.get('guidance',{}).get('lesson'):
                raise domain.DomainError('已审核教学不能经普通continuation整表重写；请保留回答并从原教学入口继续',409)
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
            from .database import now
            current = db.get(TaskRecord,task_id)
            if current.plan.get('kind')=='guidance' and plan.plan.get('kind')=='guidance':
                progress={**current.plan.get('guidance',{}),**plan.plan.get('guidance',{})}
                observations=list(current.plan.get('guidance',{}).get('observations',[]))
                if not any(row.get('message_id')==message_id for row in observations):
                    observations.append({'receipt_id':'message-'+message_id,'message_id':message_id,
                        'step_id':current.plan.get('guidance',{}).get('active_step_id'),
                        'outcome':plan.outcome,'text':plan.feedback_quote,'source':'conversation','created_at':now()})
                progress['observations']=observations
                plan.plan={**plan.plan,'guidance':progress}
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
        controlled_answer=None
        if result.lesson_action:
            from .lessons import apply_action
            controlled,controlled_answer=apply_action(db,user_id,message_id,result.lesson_action)
            if result.lesson_action.kind=='explain':controlled_answer=None
            from .retrieval import task_view
            task=task_view(controlled)
        else:
            task = commit_continuation(db, user_id, message_id, result, current_question, commit=False)
        if task and task['plan'].get('kind') == 'guidance':
            message = domain.require(db.get(ChatMessage, message_id))
            conversation = db.get(Conversation, message.conversation_id)
            conversation.entry_context = {**conversation.entry_context, 'intent':'guidance', 'task_id':task['id']}
            if not conversation.item_ids:
                conversation.item_ids = task['item_ids']
        if task is None:
            # A short answer may omit plan changes. Keep the actual statement
            # on the active task anyway; recording it does not infer success.
            message=domain.require(db.get(ChatMessage,message_id))
            conversation=db.get(Conversation,message.conversation_id)
            identity=conversation.entry_context.get('task_id')
            active=db.get(TaskRecord,identity) if identity else None
            if active and active.user_id==user_id and active.plan.get('kind')=='guidance' and active.status not in {'completed','cancelled'}:
                from .database import now
                progress=dict(active.plan.get('guidance') or {})
                observations=list(progress.get('observations',[]))
                if not any(row.get('message_id')==message_id for row in observations):
                    observations.append({'receipt_id':'message-'+message_id,'message_id':message_id,
                        'step_id':progress.get('active_step_id'),'outcome':'unknown','text':message.text,
                        'source':'conversation','created_at':now()})
                    task=foundation.save_task(db,user_id,message_id,active.goal,active.item_ids,active.constraints,
                        {**active.plan,'guidance':{**progress,'observations':observations}},active.id,active.version,active.status,commit=False)
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
    # The current answer is the main Agent's response to THIS message. Replacing
    # it with the active step hides negative feedback and repeats yesterday's text.
    answer=controlled_answer or result.answer
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
                from .assistance import check_turn_scope, check_teaching_request, check_research_request
                check_turn_scope(db, user_id, message, self)
                check_teaching_request(db, message, self)
                check_research_request(db, user_id, message)
                active=db.get(TaskRecord,conversation.entry_context.get('task_id')) if conversation.entry_context.get('task_id') else None
                if result_action:=self.lesson_action:
                    if self.continuation:raise ValueError('逐步教学用lesson_action，不同时重写整张continuation')
                    from .lessons import validate_action
                    try:validate_action(db,user_id,message_id,result_action)
                    except domain.DomainError as error:raise ValueError(error.message) from error
                if active and active.plan.get('guidance',{}).get('lesson') and self.continuation:
                    raise ValueError('当前是已核验的逐步教学；请解释当前一步，明确实际完成时用lesson_action，不删除或跳过原步骤')
                if self.continuation and self.continuation.task_id:
                    target=db.get(TaskRecord,self.continuation.task_id)
                    if target and target.user_id==user_id and target.plan.get('guidance',{}).get('lesson'):
                        # Other conversations may discuss it, but cannot replace
                        # its controller metadata or reviewed presentation assets.
                        self.continuation=None
                from .guidance import validate_specific_advice
                entries=self.continuation.plan.get('entries',[]) if self.continuation else []
                known=[message.text]
                for identity in (self.continuation.item_ids if self.continuation else conversation.item_ids):
                    item=domain.accessible_item(db,user_id,identity)
                    import json
                    known.append(json.dumps({'product':item.product,'description':domain.item_view(db,user_id,item)['description']},ensure_ascii=False))
                    known.extend(claim['content']+' '+claim.get('source_quote','') for claim in foundation.known_claims(db,user_id,identity) if claim.get('basis')=='document')
                known.extend(e['quote'] for entry in entries for e in (entry.get('guidance') or {}).get('evidence',[]) if e.get('quote'))
                try:validate_specific_advice(self.answer,entries,' '.join(known),allow_visual=bool(message.photo_ids))
                except domain.DomainError as error:raise ValueError(error.message) from error
                if conversation.entry_context.get('intent') == 'guidance' and self.continuation is not None:
                    teaching = self.continuation.plan
                    if teaching.get('schema') != 'interaction/1' or teaching.get('kind') != 'guidance' or not teaching.get('entries') or any(not entry.get('guidance') for entry in teaching.get('entries',[])):
                        raise ValueError('可继续的教学请用 interaction/1 guidance，guidance放在每项entries内；普通简短回答也可以continuation=null，不必为了表格拖延回答')
                if self.continuation:
                    plan = self.continuation
                    if conversation.entry_context.get('task_id') and plan.task_id is None:
                        active=domain.require(db.get(TaskRecord,conversation.entry_context['task_id']))
                        if active.user_id != user_id: raise domain.DomainError('没有找到这项任务',404)
                        plan.task_id,plan.expected_version=active.id,active.version
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
                    if previous and plan.plan.get('kind')=='guidance' and previous.plan.get('kind')=='guidance':
                        # The Agent may send only changed/current steps; SQL keeps
                        # the historical steps instead of making it recopy them.
                        merged={entry['id']:entry for entry in previous.plan.get('entries',[])}
                        merged.update({entry['id']:entry for entry in plan.plan.get('entries',[])})
                        plan.plan={**previous.plan,**plan.plan,'entries':list(merged.values())}
                    try:
                        plan.plan = validate_plan(db, user_id, plan.item_ids, plan.plan, message_id,
                            previous.plan if previous else None)
                        if plan.plan.get('kind')=='guidance' and any((entry.get('guidance') or {}).get('evidence') for entry in plan.plan['entries']):
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
