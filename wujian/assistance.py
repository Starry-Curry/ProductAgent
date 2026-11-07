"""Current-object boundaries shared by chat, tools and final-result validation.

These are business checks around the existing AgentScope loop, not another agent
or a second task store. Unknown identity stays unknown.
"""
import re

from sqlalchemy import select

from . import domain
from .database import Asset, ChatMessage, Conversation, ItemRecord, TaskRecord


def wants_steps(text):
    # A cheap explicit-intent hint; the main Agent can also select teaching for
    # paraphrases through TurnResult.assistance_mode, without a classifier call.
    if re.search(r'不要.{0,8}(分步|一步步|步骤)|不用.{0,6}(带|教)|只想了解', text):
        return False
    return bool(re.search(r'一步[一步]*|分步骤?|逐步|带我.{0,8}(做|用|操作)|教我.{0,8}(用|操作)', text))


def research_requested(text):
    return not no_search(text) and bool(re.search(r'搜索|联网|查.{0,8}(资料|说明书|手册)|核对.{0,20}(型号|资料)', text))


def no_search(text):
    return bool(re.search(r'(?:不要|不用|别|不必).{0,4}(?:搜索?|联网|查(?:资料|说明书|网页))', text))


def negative_step_feedback(text):
    return bool(re.search(r'没找到|找不到|没看懂|看不懂|没反应|没有反应|没变化|没有变化|(?:不要|别|先不)跳',text))


def bind_task(db, user_id, item_ids, entry, *, detach=False):
    entry = dict(entry or {})
    identity = entry.get('task_id')
    if not identity:
        return entry
    from .interactions import task_access
    task, _ = task_access(db, user_id, identity)
    if item_ids and not set(item_ids).issubset(task.item_ids):
        if detach:
            entry['task_id'] = None
        else:
            raise domain.DomainError('这项任务与当前物品不一致，请从当前物品开始或明确切换任务。', 409)
    return entry


def resolve_focus(db, user_id, text, item_ids):
    """Only unambiguous explicit object mentions replace a previous focus."""
    if item_ids and re.search(r'相比|对比|区别|比较|和.{0,25}(比|一样)|与.{0,25}(比|一样)', text):
        return item_ids
    matches = []
    for item in domain.list_items(db, user_id):
        aliases = [item['name'], item['product'].get('model', '')]
        for alias in aliases:
            position = text.casefold().find(alias.casefold()) if len(alias)>=3 else -1
            if position < 0:
                continue
            prefix = text[max(0,position-12):position]
            if re.search(r'不是|并非|不要|不用|别用|别拿|不再|不是在问',prefix):
                continue
            matches.append(item['id'])
            break
    if len(matches) == 1 and matches[0] not in item_ids:
        return matches
    return item_ids


def item_photos(db, user_id, item_ids, limit=3):
    """Reuse public item photos and THIS user's item-scoped photo reports only."""
    selected, covers = [], []
    for identity in item_ids:
        item = domain.accessible_item(db, user_id, identity)
        if item.photo_id:
            asset = db.get(Asset, item.photo_id)
            # Item access grants its cover photo, not the owner's other assets.
            if asset and asset.media_type.startswith('image/'):
                covers.append(asset)
    reports = db.execute(select(ChatMessage, Conversation).join(
        Conversation, Conversation.id == ChatMessage.conversation_id).where(
            Conversation.user_id == user_id, ChatMessage.role == 'user', ChatMessage.photo_ids != [])
        .order_by(ChatMessage.created_at.desc()).limit(40)).all()
    for message, conversation in reports:
        if len(message.item_ids) != 1 or message.item_ids[0] not in item_ids:
            continue
        for identity in reversed(message.photo_ids):
            asset = db.get(Asset, identity)
            if asset and asset.owner_id == user_id and asset.media_type.startswith('image/'):
                selected.append(asset)
    return list({asset.id: asset for asset in [*selected, *covers]}.values())[:limit]


def related_tasks(db, user_id, item_ids):
    if not item_ids:
        return []  # Other goals remain available through explicit search_world.
    return [task for task in db.scalars(select(TaskRecord).where(
        TaskRecord.user_id == user_id,
        TaskRecord.status.notin_(['completed', 'cancelled']))
        .order_by(TaskRecord.updated_at.desc()))
        if set(item_ids).issubset(task.item_ids)][:4]


def check_turn_scope(db, user_id, message, result):
    conversation = domain.require(db.get(Conversation, message.conversation_id))
    focused = set(conversation.item_ids)
    bind_task(db, user_id, conversation.item_ids, conversation.entry_context)
    plan = result.continuation
    if plan and focused and plan.plan.get('kind') == 'guidance':
        targets = set(plan.item_ids) | {e['item_id'] for e in plan.plan.get('entries', []) if e.get('item_id')}
        if targets != focused:
            raise ValueError('教学必须绑定当前物品；不能把其他物品的任务接到本轮。请修正item_ids和每一步的item_id。')
    if plan and plan.task_id:
        task = domain.require(db.get(TaskRecord, plan.task_id))
        if focused and plan.plan.get('kind') == 'guidance' and set(task.item_ids) != focused:
            raise ValueError('原任务处理的是另一件物品，请为当前目标创建任务。')
    if result.target_item_ids and focused and set(result.target_item_ids) != focused:
        raise ValueError('回答的target_item_ids与当前物品不一致。')
    if len(focused) != 1 or conversation.entry_context.get('intent') not in {'general', 'guidance'}:
        return
    current = domain.accessible_item(db, user_id, next(iter(focused)))
    current_text = current.name + str(current.product) + message.text
    # Catch explicit foreign model/type leakage even when continuation is null.
    # This is an additional lexical check, not a claim to prove arbitrary prose.
    for other in domain.list_items(db, user_id):
        if other['id'] in focused:
            continue
        labels = [other['product'].get('model', '')]
        labels += re.findall(r'[\u4e00-\u9fff]{2,5}(?:机|音箱|台灯|水壶|打印机)', other['name'])
        labels += [token.removeprefix('我的') for token in re.findall(r'[\u4e00-\u9fff]+', other['name'])
                   if 2 <= len(token.removeprefix('我的')) <= 6]
        for label in labels:
            if len(label) >= 2 and label.casefold() in result.answer.casefold() and label.casefold() not in current_text.casefold():
                raise ValueError('回答出现了另一件物品的型号或名称，请只回应当前物品，或先明确核对切换对象。')


def check_teaching_request(db, message, result):
    conversation = db.get(Conversation, message.conversation_id)
    active = db.get(TaskRecord, conversation.entry_context.get('task_id') or '')
    requested = wants_steps(message.text) or result.assistance_mode == 'teach'
    if requested and conversation.item_ids and not active:
        plan = result.continuation.plan if result.continuation else {}
        if plan.get('schema') != 'interaction/1' or plan.get('kind') != 'guidance' or not plan.get('entries'):
            raise ValueError('用户要求逐步带做，请创建interaction/1 guidance任务；资料未齐可以先建立identify/observe准备步骤，不只输出一篇文字。')


def check_research_request(db, user_id, message):
    if not research_requested(message.text) or not message.run_id:
        return
    from .database import Run, SourceRecord
    conversation = db.get(Conversation, message.conversation_id)
    if conversation.entry_context.get('intent', 'general') not in {'general', 'guidance'}:
        return  # Creative research has its own proposal/clarification contract.
    if not conversation.item_ids:
        return  # Identify the object before researching a guessed model.
    run = db.get(Run, message.run_id)
    if run and any(e.get('type') in {'research_search','research_source','research_unavailable'} for e in run.events):
        return
    if db.scalar(select(SourceRecord.id).where(SourceRecord.owner_id==user_id,
            SourceRecord.item_id.in_(conversation.item_ids))):
        return
    raise ValueError('本轮要求查证资料，请先research_product或读取适用原文；尚未调用检索不能声称没有找到资料。')


def source_applies(db, source, item_ids):
    if not source.item_id or not item_ids:
        return True
    source_item = db.get(ItemRecord, source.item_id)
    for identity in item_ids:
        item = db.get(ItemRecord, identity)
        if item and (identity == source.item_id or item.product_id and source_item and item.product_id == source_item.product_id):
            return True
    return False


def identity_in_source(item, source):
    normalize = lambda value: re.sub(r'[^\w]', '', value).casefold()
    text = normalize(source.title+' '+source.content)
    model = normalize(item.product.get('model', ''))
    if model and model in text:
        return True
    alias = normalize(item.product.get('commercial_name', ''))
    evidence = item.state.get('identity_evidence') or {}
    return bool(model and len(alias)>=3 and alias in text
        and evidence.get('basis')=='document_match' and evidence.get('source_id')==source.id
        and not evidence.get('provisional'))


def preparation_turn(context, question):
    """A provider outage can preserve a requested lesson, never invent actions."""
    from .turns import TurnResult
    focused=context.get('focused_items', [])
    active=context.get('active_task')
    if len(focused)!=1 or not (negative_step_feedback(question) if active else wants_steps(question)):
        return None
    item=focused[0]
    if active:
        if active['plan'].get('kind')!='guidance' or active['plan'].get('guidance',{}).get('lesson'):
            return None
        step_id=active['plan'].get('guidance',{}).get('active_step_id') or 'verify-current-state'
        instruction='先停在这一步，不继续操作。请描述你现在看到的位置和能读清的文字或标记；未在画面中看清的位置先保留未知。'
        return TurnResult.model_validate({'assistance_mode':'teach','target_item_ids':[item['id']],
            'answer':instruction,'continuation':{'goal':active['goal'],'item_ids':active['item_ids'],
                'constraints':active['constraints'],'status':'in_progress','task_id':active['id'],
                'expected_version':active['version'],'feedback_quote':question,'outcome':'unknown',
                'plan':{'schema':'interaction/1','kind':'guidance','entries':[{'id':step_id,
                    'title':'核对没有找到的位置','item_id':item['id'],'group':'step','state':'pending',
                    'guidance':{'kind':'observe','basis':'general','instruction':instruction,
                        'target_label':'当前看到的位置','success_signal':'把你实际看到的位置或文字告诉我。'}}],
                    'guidance':{'active_step_id':step_id,'research_pending':True}}}})
    instruction='先看一下这件物品目前的外观和你准备操作的位置，告诉我看到什么；这一轮先不试未经核对的按键或组合。'
    return TurnResult.model_validate({'assistance_mode':'teach','target_item_ids':[item['id']],
        'answer':'资料和操作细节还没有完成核验，先保留这次带做进度。\n\n当前一步：'+instruction,
        'continuation':{'goal':question[:4000], 'item_ids':[item['id']], 'constraints':{},'status':'exploring',
            'task_id':None,'expected_version':None,'plan':{'schema':'interaction/1','kind':'guidance',
                'entries':[{'id':'verify-current-state','title':'核对当前实物状态','item_id':item['id'],'group':'step','state':'pending',
                    'guidance':{'kind':'observe','basis':'general','instruction':instruction,'target_label':item['name'],
                        'success_signal':'把你现在看到或听到的现象告诉我。'}}],
                'guidance':{'active_step_id':'verify-current-state','overview':['核对当前实物状态','继续核验资料后安排具体操作'],
                    'research_pending':True}}}})
