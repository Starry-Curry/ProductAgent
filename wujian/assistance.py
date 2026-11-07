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
    return bool(re.search(r'一步(?:一步|步)|分步骤?|逐步|带我.{0,8}(做|用|操作)|教我.{0,8}(用|操作)', text))


def wants_software(text):
    """An explicit software deliverable, not an inferred tutorial website."""
    return bool(re.search(r'(?:写|编|开发|设计|制作|做|生成|搭建|构建|自定义|来个).{0,35}(?:代码|程序|软件|网页|应用程序|游戏|小工具|工作台|操控台|控制面板|控制台|小作品|界面|面板)|想要?(?:一个|个).{0,20}(?:网页|软件|游戏|小工具|工作台)|\b(?:html|javascript|css|software|code)\b|\b(?:build|create|write|make|customize).{0,40}(?:panel|interface|tool|page|timer|app|game|workbench)',text,re.I))


def operation_help_requested(text):
    """Context hint for ordinary how-to questions; semantic teach also works.

    This is not the teaching permission gate. The main Agent's semantic
    assistance_mode/typed plan can select teaching without any of these words.
    """
    if wants_software(text) or re.search(r'只想了解|只讲原理|不要.{0,6}(?:带做|步骤|操作)|不用.{0,6}(?:带做|步骤|操作)|(?:安排|设计|想个|来个).{0,20}(?:游戏|活动|玩法)|(?:游戏|活动|玩法).{0,12}(?:怎么开始|如何开始)',text):
        return False
    return wants_steps(text) or bool(re.search(
        r'怎么.{0,18}(?:用|连|开|关|调|装|修|设置|操作|开始)|如何.{0,18}(?:用|连|开|关|调|装|修|设置|操作)|'
        r'不会(?:用|操作)|用不了|连不上|开不了|没反应|没有反应|故障|报错|脱机|接下来.{0,8}(?:做|弄|办)|'
        r'帮我.{0,12}(?:调|连|开|装|修|弄)|想.{0,10}(?:连|使用|试用)',text))


def research_requested(text):
    return not no_search(text) and bool(re.search(r'搜索|联网|查.{0,8}(资料|说明书|手册)|核对.{0,20}(型号|资料)', text))


def no_search(text):
    return bool(re.search(r'(?:不要|不用|别|不必).{0,4}(?:搜索?|联网|查(?:资料|说明书|网页))', text))


def negative_step_feedback(text):
    return bool(re.search(r'没找到|找不到|没看懂|看不懂|没反应|没有反应|没变化|没有变化|没连上|没有连上|连不上|未连接|(?:不要|别|先不)跳',text))


def bind_task(db, user_id, item_ids, entry, *, detach=False):
    entry = dict(entry or {})
    identity = entry.get('task_id')
    if not identity:
        return entry
    from .interactions import task_access
    task, _ = task_access(db, user_id, identity)
    if entry.get('intent')=='persona' or task.plan.get('kind')!='guidance':return entry
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
        # Unique real inventory names may contain a possessive or Latin model
        # prefix: “我的耳机”, “LOKLiK AS2 烫印机”, “天猫精灵TG_C1”.
        # Reuse their actual Chinese name fragments, never a fixed product list.
        for fragment in re.findall(r'[\u4e00-\u9fff]{2,}',item['name']):
            short=re.sub(r'^.*?的','',fragment)
            if 2<=len(short)<=6:aliases.append(short)
        for alias in aliases:
            position = text.casefold().find(alias.casefold()) if len(alias)>=2 else -1
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
    practical=conversation.entry_context.get('intent','general') in {'general','guidance'} and operation_help_requested(message.text)
    requested = result.assistance_mode == 'teach' or wants_steps(message.text) or practical
    plan = result.continuation.plan if result.continuation else {}
    targets=conversation.item_ids or result.target_item_ids or (result.continuation.item_ids if result.continuation else [])
    active_guide=bool(active and active.plan.get('kind')=='guidance' and active.status not in {'completed','cancelled'})
    if requested and targets and not active_guide:
        plan = result.continuation.plan if result.continuation else {}
        if (plan.get('schema') != 'interaction/1' or plan.get('kind') != 'guidance'
                or not any(entry.get('guidance',{}).get('instruction') for entry in plan.get('entries',[]))):
            raise ValueError('这是实物使用/排障带做：请在当前对话创建interaction/1、kind=guidance，至少给当前一步填写guidance={kind:identify或observe,instruction:本轮具体核对问题,basis:general,target_label:核对位置}及item_id。缺资料先核对，不等用户说特定口令，也不生成独立网页。只有title/note的文字提纲不能打开3D和相机。')


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
    if len(focused)!=1:
        return None
    requested=wants_steps(question) or negative_step_feedback(question) or context.get('entry_context',{}).get('intent')=='guidance'
    if not requested and not active:
        return None
    item={**focused[0],'id':focused[0].get('id') or focused[0].get('item_id')}
    if active:
        if active['plan'].get('kind')!='guidance' or active['plan'].get('guidance',{}).get('lesson'):
            return None
        # A new observation must not inherit the old action's failure/reset
        # branches through the plan's normal per-entry PATCH merge.
        step_id='verify-current-state-'+str(active['version'])
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
