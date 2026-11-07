"""AgentScope's native final result contract, shared by chat and durable goals."""

import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from . import domain, foundation
from .api_models import TaskEntry
from .database import ChatMessage, Conversation, ItemRecord, Profile, TaskRecord
from .evidence import locate_quote
from .learning import Learning, apply_learning


def _plan_schema(schema):
    """Expose the shared entry contract without replacing legacy dict plans."""
    from .preparation_plan import PreparationReport
    entry_schema = TaskEntry.model_json_schema()
    definitions = entry_schema.pop('$defs', {})
    def inline(value):
        if isinstance(value,list):return [inline(part) for part in value]
        if not isinstance(value,dict):return value
        if '$ref' in value and value['$ref'].startswith('#/$defs/'):
            return inline({**definitions[value['$ref'].split('/')[-1]],**{key:part for key,part in value.items() if key!='$ref'}})
        return {key:inline(part) for key,part in value.items()}
    entry_schema = inline(entry_schema)
    entry_schema["properties"]["group"]["description"] = (
        "owned/buy/borrow/confirm are resource preparation categories; "
        "step is an action or inspection instruction, including viewing a version number."
    )
    entry_schema["properties"]["state"]["description"] = (
        "Retain current persisted state. New entries start pending. "
        "For a step, ready means the user reported its action completed; "
        "a proposed/available instruction or reaching an earlier menu is still pending. "
        "Use progress_reports for a specific existing entry's actual result."
    )
    schema["properties"] = {
        "schema": {"const": "interaction/1"},
        "kind": {"enum": ["checklist", "guidance", "idea"],
            "description": "Presentation of the whole plan; idea is not an entry group."},
        "entries": {"type": "array", "maxItems": 60,
            "description": "New proposals start pending. Keep existing reported states unless the current user supplies actual feedback. Entry ready means reported preparation/action progress, not merely that an idea is available.",
            "items": entry_schema},
        "preparation_reports": {"type": "array", "maxItems": 60,
            "description": "For CHECKLIST only: exact current user evidence for each resource correction (title/group/item_id/note), newly confirmed purchase, or owned resource without inventory ID. Each entry is {entry_id,source_quote}. Unknown inventory is confirm, never buy by default. Reuse ALL existing entry IDs; do not replace them with new IDs. A changed title/group/item_id resets that existing entry to pending, keeping assignment. These reports cannot mark work done. Empty for guidance/idea and if no current correction.",
            "items": PreparationReport.model_json_schema()},
    }


class ContinuingPlan(BaseModel):
    goal: str = Field(description="The user's actual goal; do not replace it with an unchosen mechanism such as uninstalling, buying or resetting")
    item_ids: list[str] = Field(
        description="Actual accessible resource IDs; never substitute names or invented resources"
    )
    constraints: dict = Field(
        description="For a new task, user requirements/conditions including exclusions. For an existing task, a PATCH: omitted keys remain unchanged, reuse exact current keys for the same concept. Null explicitly removes a key. Changing/removing an existing value requires feedback_quote from the CURRENT user; new facts/conditions can be added. Keep proposals in plan, not user constraints."
    )
    plan: dict = Field(
        description="Proposed actions/alternatives, why they can work, minimum trial and unknown conditions; a proposal is not executed success",
        json_schema_extra=_plan_schema,
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
    progress_reports: list["EntryProgressReport"] = Field(
        default_factory=list, max_length=60,
        description="Only CURRENT user reports about specific EXISTING task entries. Empty for proposals/questions/menu navigation that has not completed the entry. Each quote must directly report that entry's action/result, not merely an earlier prerequisite. New entries always start pending. General feedback_quote does not change entry progress.",
    )
    outcome: Literal["success", "failure", "partial", "preference", "unknown"] = (
        "unknown"
    )


class EntryProgressReport(BaseModel):
    entry_id: str = Field(min_length=1, max_length=80,
        description="ID of the existing entry whose exact action the current user reports, not a new proposed step")
    action_result: Literal["completed", "not_done", "not_found", "unchanged"] = Field(
        description="Report of what happened, not readiness of an instruction. completed means that exact entry action/preparation was actually completed, not merely an earlier prerequisite. not_done corrects/reopens a previous completion."
    )
    source_quote: str = Field(min_length=1, max_length=4000,
        description="Exact current user words directly attesting this entry's result. Opening Settings does not attest reading its version number. If only part of a compound action was done, leave it pending and describe the partial observation in constraints.")


ContinuingPlan.model_rebuild()


from .lessons import LessonAction


class TurnResult(BaseModel):
    lesson_action: LessonAction | None = None
    # Evidence and the actual proposal precede prose in the native schema.
    # Same fields, same transaction; no extra generation or reviewer.
    learning: Learning = Field(default_factory=Learning)
    assistance_mode: Literal["answer", "research", "teach"] = "answer"
    target_item_ids: list[str] = Field(default_factory=list)
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
        default=None,
        description="Retain useful creative alternatives as kind=idea. For kind=guidance retain the current observable action and its completion criterion, not a speculative list of unchosen future changes. Continue the same task with current user constraints. Null for simple questions, acknowledgements, story-only recording and companionship."
    )
    answer: str = Field(
        min_length=1,
        description="Complete natural conversational answer. Adapt detail, explanation and questions to the current difficulty. Do not impose fixed headings, model announcements or closing phrases. Names here, internal IDs only in structured fields; actual progress and evidence remain accurate.",
    )


def referenced_sources(result):
    """Normalize already supplied references, never invent supporting evidence."""
    return list(dict.fromkeys([*result.source_refs,
        *(change.source_id for change in result.learning.knowledge_updates
          if change.basis in {"document", "inference"} and change.source_id),
        *(evidence['source_id'] for entry in
          (result.continuation.plan.get('entries',[]) if result.continuation else [])
          for evidence in (entry.get('guidance') or {}).get('evidence',[])),
        *re.findall(r"\[([a-f0-9]{32})\]",result.answer)]))[:8]


def constraint_patch(previous, incoming, feedback_quote):
    """An Agent's abbreviated continuation must not erase prior conditions.

    UI full-edit semantics are unchanged. Null is an explicit deletion, and
    actual user feedback is necessary (not a semantic proof) for revisions.
    Keep the incoming patch intact: the native preview is rolled back and the
    same result is later committed, so consuming deletion tombstones is wrong.
    """
    merged = dict(previous)
    for key, value in incoming.items():
        if key in previous and value != previous[key] and not feedback_quote:
            raise domain.DomainError("修改或移除已有任务条件需要本轮用户反馈；遗漏的条件会保留，请复用原条件名称")
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def validate_reply(db,user_id,message,result):
    """Free conversation may use any applicable original actually read this run.

    A question about a second feature must not require adding a fake task step
    just to cite it. Operative plan entries still have their own local quotes.
    """
    if result.story_refs:return
    import json
    from .guidance import validate_specific_advice,validate_parameters
    from .database import Run
    from .assistance import source_applies,identity_in_source
    from .source_access import readable_source
    conversation=domain.require(db.get(Conversation,message.conversation_id))
    active=db.get(TaskRecord,conversation.entry_context.get('task_id')) if conversation.entry_context.get('task_id') else None
    entries=(result.continuation.plan if result.continuation else active.plan if active else {}).get('entries',[])
    identities=result.continuation.item_ids if result.continuation else conversation.item_ids or (active.item_ids if active else [])
    items=[domain.accessible_item(db,user_id,identity) for identity in identities]
    # The business write normalized line citations already; validate prose
    # against those quotes, without mutating the SDK's reusable proposal.
    if active and result.continuation:
        normalized={entry['id']:entry for entry in active.plan.get('entries',[])}
        entries=[normalized.get(entry['id'],entry) for entry in entries]
    known=[message.text]
    for item in items:
        known.append(json.dumps({'product':item.product,'description':domain.item_view(db,user_id,item)['description']},ensure_ascii=False))
        known.extend(claim['content']+' '+claim.get('source_quote','') for claim in foundation.known_claims(db,user_id,item.id) if claim.get('basis')=='document')
    run=db.get(Run,message.run_id) if message.run_id else None
    source_ids=list(dict.fromkeys(event.get('source_id') for event in run.events if event.get('type')=='research_source' and event.get('source_id'))) if run and run.user_id==user_id and run.conversation_id==conversation.id else []
    source_ids=list(dict.fromkeys([*source_ids,*result.source_refs]))
    for source_id in source_ids[-6:]:
        try:source=readable_source(db,user_id,source_id)
        except domain.DomainError:continue
        if (source_applies(db,source,identities) and items
                and any(not item.product.get('model') or identity_in_source(item,source) for item in items)):
            known.append(source.content[:12000])
    validate_specific_advice(result.answer,entries,' '.join(known),allow_visual=bool(message.photo_ids))
    if result.continuation and result.continuation.plan.get('kind')=='guidance' and any((entry.get('guidance') or {}).get('evidence') for entry in entries):
        validate_parameters(result.answer,[*entries,{'guidance':{'evidence':[{'quote':message.text}]}}])


def commit_continuation(db, user_id, message_id, result, current_question, commit=True):
    plan = result.continuation
    if plan is None:
        return None
    if plan.feedback_quote:
        quote=locate_quote(current_question,plan.feedback_quote)
        if quote is None:
            quote=current_question[:2400]
            plan.outcome='unknown'
        plan.feedback_quote=quote
    # One transaction and one domain write path. No second model, writer or classifier.
    with db.begin_nested():
        task_id, version = plan.task_id, plan.expected_version
        current = None
        if task_id:
            current = domain.require(db.get(TaskRecord, task_id))
            if current.user_id != user_id:
                raise domain.DomainError("没有找到这项任务", 404)
            if current.version != version:
                raise domain.DomainError("任务已更新，请重新读取后继续", 409)
        constraints = constraint_patch(current.constraints if current else {},
                                       plan.constraints, plan.feedback_quote)
        from .task_progress import apply_entry_reports
        if current and plan.plan.get('kind')=='guidance' and not plan.progress_reports:
            old={entry['id']:entry for entry in current.plan.get('entries',[])}
            for entry in plan.plan.get('entries',[]):
                quote=(entry.get('guidance') or {}).get('observed_quote','')
                if entry['id'] in old and entry.get('state')!=old[entry['id']].get('state') and quote and locate_quote(current_question,quote):
                    action={'ready':'completed','pending':'not_done','not_found':'not_found','unchanged':'unchanged'}.get(entry.get('state'))
                    if action:plan.progress_reports.append(EntryProgressReport(entry_id=entry['id'],action_result=action,source_quote=quote))
        proposed, progress_evidence = apply_entry_reports(
            foundation.validate_plan(plan.plan), current.plan if current else {},
            plan.progress_reports, current_question, db=db, user_id=user_id)
        if plan.status == "completed" and proposed.get("schema") == "interaction/1":
            if current is None:
                raise domain.DomainError("新方案还没有实际结果，不能直接标为完成")
            if not proposed["entries"] or any(entry["state"] != "ready" for entry in proposed["entries"]):
                raise domain.DomainError("仍有未完成条目，不能仅凭总体success反馈将任务标为completed")
        # Keep the parsed proposal immutable: SDK preview rolls back and the
        # same result is committed later. Reports are applied to a fresh plan.
        feedback_quote = plan.feedback_quote or (current_question if progress_evidence else "")
        if task_id is None:
            created = foundation.save_task(
                db,
                user_id,
                message_id,
                plan.goal,
                plan.item_ids,
                constraints,
                proposed,
                status="exploring" if feedback_quote else plan.status,
                commit=False,
            )
            task_id, version = created["id"], created["version"]
            if not feedback_quote:
                saved = created
        if feedback_quote:
            if proposed.get('kind')=='guidance':
                from .database import now
                progress=dict(proposed.get('guidance') or {})
                observations=list((current.plan if current else {}).get('guidance',{}).get('observations',[]))
                if not any(row.get('message_id')==message_id for row in observations):
                    observations.append({'receipt_id':'message-'+message_id,'message_id':message_id,
                        'step_id':(current.plan if current else {}).get('guidance',{}).get('active_step_id'),
                        'outcome':plan.outcome,'text':feedback_quote,'source':'conversation','created_at':now()})
                proposed={**proposed,'guidance':{**progress,'observations':observations,'awaiting_reply':False}}
            if current is not None and plan.status == "completed":
                # A current report can complete the last existing step. Save
                # that exact proposed state before signing its success receipt;
                # signing the old pending plan would reject an honest report.
                prepared = foundation.save_task(db, user_id, message_id, plan.goal,
                    plan.item_ids, constraints, proposed, task_id, version,
                    "in_progress", commit=False)
                version = prepared["version"]
            feedback = foundation.task_feedback(
                db,
                user_id,
                message_id,
                task_id,
                feedback_quote,
                plan.outcome,
                version,
                source_quote=feedback_quote,
                commit=False,
            )
            version = feedback["version"]
            if progress_evidence:
                row = db.get(TaskRecord, task_id)
                row.feedback = [
                    {**entry, "progress_reports": progress_evidence}
                    if entry.get("source_message_id") == message_id else entry
                    for entry in row.feedback]
        if plan.task_id is not None or feedback_quote:
            saved = foundation.save_task(
                db,
                user_id,
                message_id,
                plan.goal,
                plan.item_ids,
                constraints,
                proposed,
                task_id,
                version,
                plan.status,
                commit=False,
            )
    db.commit() if commit else db.flush()
    return saved


def _mark_displayed_gift_stories(db, user_id, message_id, experiences):
    """The chat display and its progress are one commit, not two Agent actions."""
    from sqlalchemy import select
    message = db.get(ChatMessage, message_id)
    conversation = db.get(Conversation, message.conversation_id) if message else None
    if (not conversation or conversation.user_id != user_id or message.role != "user"
            or conversation.entry_context.get("intent") != "persona" or len(conversation.item_ids) != 1):
        return
    item_id = conversation.item_ids[0]
    item = db.scalar(select(ItemRecord).where(ItemRecord.id == item_id).with_for_update())
    if not item or item.owner_id != user_id or item.archived:
        return
    profile = db.get(Profile, (user_id, item_id))
    if not profile or not profile.avatar.get("enabled"):
        return
    displayed = {row["id"] for row in experiences if row["creator_id"] == user_id
                 and row["origin_id"] and row["allow_ai"] and item_id in row["item_ids"]}
    refs = [dict(entry) for entry in profile.avatar.get("gift_memories", [])]
    changed = False
    for entry in refs:
        if entry.get("experience_id") in displayed and not entry.get("unlocked"):
            entry["unlocked"], changed = True, True
    if changed:
        profile.avatar = {**profile.avatar, "gift_memories": refs}
        item.version += 1


def commit_result(db, user_id, message_id, result, current_question, *, commit=True):
    message=domain.require(db.get(ChatMessage,message_id))
    from .assistance import check_turn_scope, check_teaching_request
    try:
        check_turn_scope(db,user_id,message,result)
        check_teaching_request(db,message,result)
    except ValueError as error:
        raise domain.DomainError(str(error)) from None
    with db.begin_nested():
        learned = apply_learning(db, user_id, message_id, result.learning)
        learning_rejections = learned.get("rejected", [])
        controlled_answer=None
        rejected_actions=[]
        if result.lesson_action:
            from .lessons import apply_action
            try:
                with db.begin_nested():
                    controlled,controlled_answer=apply_action(db,user_id,message_id,result.lesson_action)
                if result.lesson_action.kind in {'explain','adapt'}:controlled_answer=None
                elif result.lesson_action.kind=='provide_input' and result.lesson_action.material:
                    from .lessons import input_ready,step_definition
                    step=step_definition(controlled)
                    if not step or not input_ready(controlled.plan['guidance']['lesson'],step.get('requires_input')):
                        controlled_answer=None
                from .retrieval import task_view
                task=task_view(controlled)
            except domain.DomainError as error:
                if error.status!=409:raise
                # An invalid proposed state update cannot destroy a useful answer.
                task=None;controlled_answer=None
                rejected_actions.append({'kind':result.lesson_action.kind,'reason':error.message})
                if result.lesson_action.kind=='confirm':result.answer+='\n\n当前步骤还未推进，我们先核对实际情况再继续。'
        else:
            task = commit_continuation(db, user_id, message_id, result, current_question, commit=False)
        if task and task['plan'].get('kind')=='guidance':
            conversation=db.get(Conversation,message.conversation_id)
            conversation.entry_context={**conversation.entry_context,'intent':'guidance','task_id':task['id']}
            if not conversation.item_ids:conversation.item_ids=task['item_ids']
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
                new_report=not any(row.get('message_id')==message_id for row in observations)
                if new_report:
                    observations.append({'receipt_id':'message-'+message_id,'message_id':message_id,
                        'step_id':progress.get('active_step_id'),'outcome':'unknown','text':message.text,
                        'source':'conversation','created_at':now()})
                if new_report or progress.get('awaiting_reply'):
                    task=foundation.save_task(db,user_id,message_id,active.goal,active.item_ids,active.constraints,
                        {**active.plan,'guidance':{**progress,'observations':observations,'awaiting_reply':False}},active.id,active.version,active.status,commit=False)
        if not result.lesson_action:
            validate_reply(db,user_id,message,result)
        # Empty references cannot display/unlock a story. Avoid projecting the
        # whole wall in both SDK preview and commit; real refs still recheck it.
        experiences = {row["id"]: row for row in domain.list_experiences(db, user_id, for_ai=True)} if result.story_refs else {}
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
                + "".join(f"\n\n![这段记录的照片](/api/assets/{identity})" for identity in row["photo_ids"])
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
            depth = "（已看指定区间抽帧，未观看完整视频或音频）" if level == "sampled_video_frames_not_full_video" else "（仅取得页面标题/简介，未读取正文）" if level == "public_page_metadata_only_not_document_body" else "（已读公开页面文字，未观看视频）" if "not_video_observation" in level else "（已读笔记文字，未核对图片）" if "not_image_observation" in level else ""
            if source.origin in {"curated_reference", "curated_reference_retired"}:
                # The editorial proposal is not hosted at the original URL.
                # Linking its invented title directly to that URL would make a
                # source about a device look like the author's tutorial for our
                # new application. Keep authorship and link role separate.
                original_title, original_url = "原始资料", url
                for original_id in re.findall(r"^原始资料 \[([a-f0-9]{32})\]", source.content, re.MULTILINE)[:8]:
                    try:
                        original = readable_source(db, user_id, original_id)
                    except domain.DomainError:
                        continue
                    if original.origin != "public_web":
                        continue
                    original_title = original.title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("\n", " ")[:160]
                    original_url = original.url.replace("<", "%3C").replace(">", "%3E").replace("\n", "")
                    break
                editorial_title = title.removeprefix("灵感参考｜")
                label = "已撤回的整理灵感" if source.origin == "curated_reference_retired" else "整理的灵感"
                state = "仅供历史回查" if source.origin == "curated_reference_retired" else "待试"
                rendered = (f"{label}《{editorial_title or '编者参考'}》（{state}；"
                            f"原始线索：[{original_title}](<{original_url}>)，原页不等于本玩法教程）")
            else:
                rendered=f"[{title or '原始资料'}](<{url}>){depth}"
            if f"[{identity}]" in result.answer:
                inline[f"[{identity}]"]=rendered
            else:
                citations.append(rendered)
        answer=controlled_answer or result.answer
        for marker,rendered in inline.items():
            answer=answer.replace(marker,rendered)
        if result.story_refs:
            _mark_displayed_gift_stories(db,user_id,message_id,
                [experiences[identity] for identity in dict.fromkeys(result.story_refs)])
    db.commit() if commit else db.flush()
    return {
        "task": task,
        "rejected_actions": rejected_actions,
        "learned": learned,
        "answer": answer + ("\n\n" + "\n\n".join(stories) if stories else "")
            + ("\n\n参考：" + "；".join(citations) if citations else "")
            + ("\n\n" + result.source_limitations if result.source_limitations else "")
            + (f"\n\n补充：已保留核对成功的部分；另有{len(learning_rejections)}条理解未能核对依据，未保存。" if learning_rejections else ""),
    }


def grounded_turn_schema(sessions, user_id, message_id, evidence_sources=None, *, deadline_at=None):
    """Native SDK validation returns grounding errors to the same Agent to repair."""

    class GroundedTurnResult(TurnResult):
        @model_validator(mode="after")
        def check_evidence(self):
            self.source_refs = referenced_sources(self)
            if evidence_sources is not None:
                unread = set(self.source_refs) - set(evidence_sources or ())
                if unread:
                    raise ValueError("引用的来源尚未实际读取，请先read_source/fetch_document取得原文或画面，再引用支持当前回答的资料。当前已读ID：" + str(sorted(evidence_sources or ())) + "")
            with sessions() as scope_db:
                scope_message=scope_db.get(ChatMessage,message_id)
                scope_chat=scope_db.get(Conversation,scope_message.conversation_id) if scope_message else None
                observation_only=bool(scope_chat and scope_chat.entry_context.get('intent')=='guidance'
                    and (not self.continuation or all((entry.get('guidance') or {}).get('kind') in {'identify','observe','verify'}
                        for entry in self.continuation.plan.get('entries',[]))))
            if evidence_sources and not self.source_refs and not self.source_limitations and not observation_only:
                raise ValueError("本轮已读取资料：请用source_refs列出确实支持回答的原文ID；如果原文不足以支持方案，则用source_limitations诚实说明限制，不能宣称案例已经核实。")
            with sessions() as db:
                message = domain.require(db.get(ChatMessage, message_id))
                if self.continuation and self.continuation.task_id:
                    target = db.get(TaskRecord,self.continuation.task_id)
                    if target and target.user_id == user_id and (target.plan.get("guidance",{}).get("lesson")
                            or target.plan.get("pending_action") or target.plan.get("schema") == "workbench/1"):
                        self.continuation = None
                # Exercise the same SQL-only business path, then ALWAYS undo
                # it. A second handwritten validator had drifted: invalid
                # expiry/completion passed the SDK and failed too late to
                # repair. Never put network/device/projection writes here.
                checkpoint=db.begin_nested()
                try:
                    commit_result(db,user_id,message_id,self,message.text,commit=False)
                except domain.DomainError as error:
                    if deadline_at is not None:
                        import time
                        remaining=max(0,int(deadline_at-time.monotonic()))
                        raise ValueError(error.message + f"\n本轮还剩约{remaining}秒。优先交付已核实的下一步；无法核实的可选学习不要写成事实，说明范围并保留来源。") from None
                    raise
                finally:
                    checkpoint.rollback()
            return self

    return GroundedTurnResult
