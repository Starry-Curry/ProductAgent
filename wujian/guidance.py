"""Evidence and state semantics for teaching over the existing TaskRecord plan."""
import hashlib
import json
import re
import unicodedata
from decimal import Decimal, InvalidOperation

from . import domain
from .api_models import TaskEntry
from .database import ChatMessage, Conversation, Run, TaskRecord, now, uid
from .evidence import locate_quote
from .source_access import readable_source


def source_applicability(db, user_id, source, item_ids=()):
    """Lexical applicability signals, never semantic compatibility approval.

    Linking a fetched FAQ to an item, or a model appearing in its URL/title,
    does not make that FAQ a verified manual for that model's controls.
    """
    from .learning import model_mentioned
    identities = list(dict.fromkeys([*item_ids,*([source.item_id] if source.item_id else [])]))
    targets = []
    for identity in identities:
        item = domain.accessible_item(db,user_id,identity)
        model = item.product.get('model','')
        present = bool(model and model_mentioned(model,source.content))
        targets.append({'item_id':identity,'model':model,'market':item.product.get('market',''),
            'model_in_source_text':present,
            'status':'model_mentioned_requires_procedure_check' if present else 'model_not_confirmed'})
    return {'targets':targets,'procedure_compatibility_verified':False,
        'note':'型号未在正文出现时，只能作通用参考；具体控件、组合键与松键时序先查适用型号官方手册及面板图。型号出现也不等于本段操作适用。'}


def step_signature(entry):
    details = dict(entry.get('guidance') or {})
    if details.get('basis')=='document': details.pop('basis')
    for key in ['observed_quote','observed_message_id']:
        details.pop(key,None)
    return hashlib.sha256(json.dumps({'title':entry['title'],'item_id':entry.get('item_id'),
        'note':entry.get('note',''),'guidance':details},sort_keys=True,ensure_ascii=False).encode()).hexdigest()


_NUMBER_CHARS = '0-9.零〇一二两三四五六七八九十百千点'
_PARAMETER = re.compile(
    rf'(?<![{_NUMBER_CHARS}])([{_NUMBER_CHARS}]+)\s*'
    r'(秒钟|分钟|小时|秒|摄氏度|°c|伏特|瓦特|千克|公斤|kg|伏|瓦|seconds?|minutes?|hours?|volts?|watts?)(?![a-z])')
_DIGITS = dict(zip('零〇一二两三四五六七八九', [0,0,1,2,2,3,4,5,6,7,8,9]))


def _quantity(number):
    """Normalize common written Chinese numbers, without substring matching."""
    try:
        return Decimal(number)
    except InvalidOperation:
        pass
    integer, separator, fraction = number.partition('点')
    if any(char not in _DIGITS for char in fraction):
        return None
    if not any(char in '十百千' for char in integer):
        if any(char not in _DIGITS for char in integer):
            return None
        digits = ''.join(str(_DIGITS[char]) for char in integer) or '0'
        return Decimal(digits + ('.' + ''.join(str(_DIGITS[char]) for char in fraction) if separator and fraction else ''))
    total, current = 0, 0
    for char in integer:
        if char in _DIGITS:
            current = _DIGITS[char]
        elif char in '十百千':
            total += (current or 1) * {'十':10,'百':100,'千':1000}[char]
            current = 0
        else:
            return None
    decimal = Decimal('0.' + ''.join(str(_DIGITS[char]) for char in fraction)) if fraction else Decimal(0)
    return Decimal(total + current) + decimal


def _parameters(text):
    canonical = {'秒钟':('time',1),'秒':('time',1),'分钟':('time',60),'小时':('time',3600),
        '摄氏度':('celsius',1),'°c':('celsius',1),'伏特':('voltage',1),'伏':('voltage',1),
        '瓦特':('power',1),'瓦':('power',1),'千克':('mass',1),'公斤':('mass',1),'kg':('mass',1)}
    canonical.update({unit:quantity for singular,quantity in [('second',('time',1)),('minute',('time',60)),
        ('hour',('time',3600)),('volt',('voltage',1)),('watt',('power',1))] for unit in [singular,singular+'s']})
    for match in _PARAMETER.finditer(unicodedata.normalize('NFKC',text).casefold()):
        number = _quantity(match[1])
        if number is not None:
            dimension, multiplier = canonical[match[2]]
            yield (dimension,number*multiplier),match[0]


def validate_parameters(text,entries):
    evidence_text=' '.join(evidence['quote'] for entry in entries
        for evidence in (entry.get('guidance') or {}).get('evidence',[]))
    supported = {quantity for quantity,_ in _parameters(evidence_text)}
    for quantity,label in _parameters(text):
        if quantity not in supported:
            raise domain.DomainError(f'操作参数 {label} 没有在本轮适用引文中出现，请按实际原文修正，不沿用其他型号的数字，也不要编造强制关机/重置分支')


def _control_locations(text):
    """Only explicit nearby side/control statements, never product defaults."""
    text=re.sub(r'\b(left|right)\b',lambda match:'左侧' if match[0].casefold()=='left' else '右侧',text,flags=re.I)
    text=re.sub(r'\bpower\s+(?:button|key)\b','电源',text,flags=re.I)
    text=re.sub(r'\btouch(?:\s+sensor)?(?:\s+control)?\s+panel\b','触摸面板',text,flags=re.I)
    text=re.sub(r'\s+','',text)
    controls=r'电源|开关机|触摸(?:传感器)?(?:控制)?面板|触控(?:面板|板|区)?'
    for sentence in re.split(r'[。！？!?.]',text):
        prior_side=None;offset=0
        for clause in re.split(r'[，,；;]',sentence):
            sides=list(re.finditer(r'([左右])(?:侧|边|面|耳罩|单元)',clause))
            for control in re.finditer(controls,clause):
                if sides:
                    side=min(sides,key=lambda side:abs(side.start()-control.start()))
                    side_info=(side[1],offset+side.start())
                else:side_info=prior_side
                if side_info and abs(offset+control.start()-side_info[1])<=35:
                    yield side_info[0], '电源' if control[0] in {'电源','开关机'} else '触摸面板'
            if sides:prior_side=(sides[-1][1],offset+sides[-1].start())
            offset+=len(clause)+1


def validate_specific_advice(text,entries,known_text='',allow_visual=False,require_button_evidence=False):
    """General help is allowed; do not invent precise reset timing/connectors."""
    if require_button_evidence and re.search(r'长按|按住|同时按|先松|再松|松开',text) and not any((entry.get('guidance') or {}).get('evidence') for entry in entries):
        raise domain.DomainError('组合按键或松键时序还没有适用原文，先核对状态或资料。')
    known_text+=' '+' '.join(e.get('quote','') for entry in entries for e in (entry.get('guidance') or {}).get('evidence',[]))
    # Permit ordinary translations of these explicit source attributes. This
    # does not infer any gesture or light behavior from a product's category.
    translations={'长按':['press and hold','press & hold','按住'], '同时按':['simultaneously'],
        '复位':['reset'],'恢复出厂':['factory reset'],'蓝色':['blue'],'白色':['white'],
        '红色':['red'],'绿色':['green'],'黄色':['yellow'],'环形灯':['light ring','ring light'],
        '旋钮':['knob','dial'],'触控':['touch','触摸'],'触摸':['touch','触控']}
    normalized=known_text.casefold()
    known_text+=' '+' '.join(word for word,phrases in translations.items()
        if any(re.search(r'(?<![a-z])'+re.escape(phrase)+r'(?![a-z])',normalized) for phrase in phrases))
    known=unicodedata.normalize('NFKC',known_text).casefold()
    locations=set(_control_locations(known_text))
    for sentence in re.split(r'[。！？\n]',text):
        if not re.search(r'哪|是否|是不是|有没有|还是|左右|不确定|吗',sentence) and not (allow_visual and re.search(r'图中|照片|看起来|似乎',sentence)):
            for location in _control_locations(sentence):
                if location not in locations:
                    raise domain.DomainError('当前依据没有核对这个控件的左右位置。不要猜侧别；可按已知文字或图标定位，或读取部件位置资料后再解释，不必复读整套步骤。')
        if re.search(r'短按|按一下.{0,8}(?:电源|开关)|(?:电源|开关).{0,8}按一下',sentence):
            if not any(term in known for term in ['短按','按一下','按一次','press once','briefly press']):
                raise domain.DomainError('当前依据未确认短按操作，不能把按住改成按一下；若只知道操作前提，就先确认状态，不临时编造关机方法。')
        # These are physical claims too, even when no numeric parameter is
        # present. A conditional reset branch is still an operating instruction.
        for gesture in re.findall(r'长按|同时按|恢复出厂|复位',sentence):
            if gesture not in known and not re.search(r'(?:不|别|勿|避免|未经核验不).{0,10}'+gesture,sentence):
                raise domain.DomainError('未核验长按、组合按键或复位依据；先核对当前状态，不编造失败分支。')
        for shape in re.findall(r'环形灯|环状灯|灯环|指示灯[^，；]{0,8}旋转',sentence):
            if shape not in known and not re.search(r'是否|有没有|能否看到',sentence):
                raise domain.DomainError('当前依据未确认这种灯光形态，请让用户报告实际可见现象，不迁移其他外观版本。')
        for color in re.findall(r'(?:蓝|白|红|绿|黄)色',sentence):
            if re.search(r'灯|闪烁',sentence) and color not in known and not re.search(r'什么颜色|是否|有没有',sentence):
                raise domain.DomainError('当前依据没有确认指示灯颜色，不用模型记忆预设蓝灯、白灯或其他版本的状态。')
        if list(_parameters(sentence)) and not re.search(r'(?:你|我|用户)(?:已经|刚才|之前|说|按了|长按了)',sentence):
            supported = {quantity for quantity,_ in _parameters(known_text)}
            supported.update(quantity for entry in entries for evidence in (entry.get('guidance') or {}).get('evidence',[])
                for quantity,_ in _parameters(evidence.get('quote','')))
            if any(quantity not in supported for quantity,_ in _parameters(sentence)):
                raise domain.DomainError('当前动作包含未核验的时长、温度、电气或负载参数，请使用适用原文，不把精确数值标成通用建议。')
        for connector in re.findall(r'USB[-‐‑– ]?C|Type[-‐‑– ]?C|Micro[-‐‑– ]?USB',sentence,re.I):
            normal=lambda value:re.sub(r'[-‐‑–\s]','',value).casefold()
            if normal(connector) not in normal(known) and not re.search(r'如果|假如|若是|若使用',sentence):
                raise domain.DomainError('没有核验这件物品的具体接口类型；请改用原装供电连接等通用描述，不猜测接口。无需为了这点阻止初步回答')
        if re.search(r'如果|假如|若有|若是|如有|若使用|有没有|是否有|能否看到|有无',sentence):continue
        if allow_visual and re.search(r'图中|照片|看起来|似乎',sentence):continue
        for detail in re.findall(r'(?<![A-Za-z])AAA?(?![A-Za-z])|[1-9]\s*号电池|(?<![A-Za-z])CR\d{3,4}(?![A-Za-z])|(?<![A-Za-z])(?:ON|OFF)(?![A-Za-z])',sentence,re.I):
            specification=re.sub(r'\s+','',detail).casefold()
            equivalent={'5号电池':'aa','7号电池':'aaa'}.get(specification,specification)
            if specification not in re.sub(r'\s+','',known) and not re.search(r'(?<![a-z])'+re.escape(equivalent)+r'(?![a-z])',known):
                raise domain.DomainError('尚未核验当前物品的电池规格或开关标识，先核对可见文字，不把型号记忆写成通用步骤。')
        specifics=re.findall(r'触控|触摸|旋钮|底座[^，。；\n]{0,8}(?:电源键|指示灯)',sentence)
        for value in specifics:
            if value not in known_text:
                raise domain.DomainError('当前资料没有确认这种具体控件或指示灯。直接给有用的通用建议，改用可见控件、原先使用方式等描述，或说明条件；无需继续搜齐资料')


def validate_plan(db, user_id, item_ids, plan, message_id=None, previous=None):
    if plan.get('schema') != 'interaction/1':
        return plan
    if plan.get('kind') != 'guidance' and not any(entry.get('guidance') for entry in plan.get('entries',[])):
        return plan
    entries = [TaskEntry.model_validate(entry).model_dump() for entry in plan.get('entries',[])]
    old_entries = {entry['id']:TaskEntry.model_validate(entry).model_dump()
        for entry in (previous or {}).get('entries',[])}
    current_message = db.get(ChatMessage,message_id) if message_id else None
    if current_message:
        conversation = db.get(Conversation,current_message.conversation_id)
        if not conversation or conversation.user_id != user_id or current_message.role != 'user':
            raise domain.DomainError('教学进度必须对应当前用户的实际报告')
    for entry in entries:
        details = entry.get('guidance')
        if not details:
            continue  # Historical / manually outlined plans remain readable as unverified outlines.
        old = old_entries.get(entry['id'])
        preserved_step = bool(old and step_signature(old)==step_signature(entry))
        preserved_general = bool(preserved_step and details['basis']=='general' and not details['evidence'])
        target_ids = [entry['item_id']] if entry.get('item_id') else item_ids
        targets = [domain.accessible_item(db,user_id,identity) for identity in target_ids]
        if details['kind'] == 'operate' and len(targets)>1 and not entry.get('item_id'):
            raise domain.DomainError('每个具体操作步骤需指明正在处理哪件实物')
        if (not preserved_general and details['kind']=='operate' and any(item.product.get('model') for item in targets) and details['basis']=='general' and not details['evidence']
                and re.search(r'按|拨|旋转|装入|倒入|拆|复位|初始化|对它说|打开蓝牙',details['instruction'])):
            raise domain.DomainError('型号专用操作需要适用原文或实际用户报告；未核验时用observe/identify核对，不把具体控件、按键组合或参数标为general。')
        if details['basis']=='user_report' and not plan.get('guidance',{}).get('lesson') and (not current_message or not details['observed_quote'] or details['observed_quote'] not in current_message.text):
            raise domain.DomainError('user_report需要本轮用户实际原话，提问不是已做操作。')
        source_context=[]
        if not details['evidence'] and details['basis']=='document':
            raise domain.DomainError('标为说明书操作的步骤需要适用原文；通用初步建议可标basis=general，不冒充型号已核验')
        for evidence in details['evidence']:
            try:source = readable_source(db,user_id,evidence['source_id'])
            except domain.DomainError:
                from sqlalchemy import select
                from .database import SourceRecord
                available=[{'source_id':row.id,'title':row.title[:100]} for row in db.scalars(select(SourceRecord).where(SourceRecord.owner_id==user_id,SourceRecord.item_id.in_(target_ids)))]
                raise domain.DomainError('来源引用不存在或无权读取，请使用实际已读ID：'+str(available[:8])) from None
            from .assistance import source_applies
            if not source_applies(db,source,target_ids):
                raise domain.DomainError('这是另一件物品的资料，不能作为当前实物的操作依据')
            source_context.append(source.content[:12000])
            from .knowledge import source_content_level
            if source_content_level(source) == 'public_page_metadata_only_not_document_body':
                raise domain.DomainError('当前来源只有页面元数据，没有操作正文；请沿明确文档链接读取原文，或先给通用观察，不把简介当成已读教程')
            if evidence.get('source_line_start'):
                start = evidence['source_line_start']
                end = evidence.get('source_line_end') or start
                lines = source.content.splitlines()
                if end < start or end > len(lines) or end-start>30:
                    raise domain.DomainError('教学引用的行范围无效，请根据 read_source 的原始行号填写')
                evidence['quote'] = '\n'.join(lines[start-1:end])
            if len(evidence['quote'].strip()) < 8:
                raise domain.DomainError('请为教学步骤保留可核查的原文行或连续引句')
            quote = locate_quote(source.content,evidence['quote'])
            if quote is None:
                numbered='\n'.join(f'{index+1}: {line}' for index,line in enumerate(source.content.splitlines()))
                raise domain.DomainError('教学引用被改写，不能使用。请填 source_line_start/source_line_end，由程序提取原句。来源 '+source.id+' 的原始行：\n'+numbered[:2200])
            evidence['quote'] = quote
            if evidence.get('page') is not None:
                page = next((page for page in source.pages if page.get('page')==evidence['page']),None)
                if not source.pages:
                    evidence['page']=None
                elif not page or locate_quote(page.get('text',''),quote) is None:
                    raise domain.DomainError('教学步骤引用的PDF页码与原文不对应')
            if not preserved_step and (details['basis'] == 'document' or details['evidence']):
                from .learning import model_mentioned, normalized_model
                named = [item.product.get('model','') for item in targets if item.product.get('model')]
                if named and not all(model_mentioned(model,source.content)
                    and normalized_model(evidence.get('source_model') or model)==normalized_model(model) for model in named):
                    raise domain.DomainError('操作资料没有匹配当前准确型号；相近型号只能作参考')
        advice=' '.join([entry['title'],entry.get('note',''),*(details.get(field,'') for field in ['instruction','success_signal','caution','if_not_found','if_unchanged'])])
        if details['basis']=='document' or details['evidence']:
            if not preserved_step:
                validate_parameters(advice,[entry])
                validate_specific_advice(advice,[entry],' '.join(source_context))
        elif not preserved_general:
            validate_specific_advice(advice,[entry],current_message.text if current_message else '',
                require_button_evidence=True)
        if plan.get('kind') != 'guidance':
            # Checklist/idea reports already use task_progress's user-grounded
            # state path; only the interactive guide owns observed_quote.
            continue
        old = old_entries.get(entry['id'])
        same_step = old and step_signature(old)==step_signature(entry)
        old_details = old.get('guidance') or {} if old else {}
        unchanged_report = old and old.get('state') == entry['state'] and details['observed_quote'] == old_details.get('observed_quote','') and details['observed_message_id'] == old_details.get('observed_message_id')
        if same_step and old.get('state') != 'pending' and (not details['observed_quote'] or unchanged_report):
            entry['state'],entry['updated_by'] = old['state'],old.get('updated_by')
            details['observed_quote'] = old_details.get('observed_quote','')
            details['observed_message_id'] = old_details.get('observed_message_id')
        elif entry['state'] != 'pending':
            if not details['observed_quote'] or not current_message or details['observed_quote'] not in current_message.text:
                raise domain.DomainError('不能替用户完成教学步骤；请保留待反馈，或引用当前实际报告')
            details['observed_message_id'] = current_message.id
            entry['updated_by'] = user_id
    if plan.get('kind') != 'guidance':
        # Presentation does not waive evidence, nor does evidence turn an
        # ordinary checklist into the interactive lesson state machine.
        return {**plan,'entries':entries}
    progress = dict(plan.get('guidance') or {})
    prior = (previous or {}).get('guidance') or {}
    observations=list(prior.get('observations',[]))
    # Model advice is not a report. A new conversational observation must point
    # at this user's actual message; old observations always come from SQL.
    for report in progress.get('observations',[]):
        if (current_message and report.get('source')=='conversation' and report.get('message_id')==current_message.id
            and report.get('text') and report['text'] in current_message.text
            and not any(old.get('message_id')==current_message.id for old in observations)):
            observations.append(report)
    progress['observations'] = observations
    pending = next((entry['id'] for entry in entries if entry['state'] != 'ready'),None)
    active = next((entry for entry in entries if entry['id']==progress.get('active_step_id')),None)
    if not active or active['state']=='ready':
        progress['active_step_id'] = pending
    progress['awaiting_reply'] = False
    return {**plan,'entries':entries,'guidance':progress}


def start_feedback(db, user_id, task_id, payload):
    """Atomic actual report + versioned plan + existing Run. A retry returns that Run."""
    from sqlalchemy import update
    from sqlalchemy.exc import IntegrityError
    from . import interactions
    row, access = interactions.task_access(db, user_id, task_id, writing=True)
    if access != 'owner':
        raise domain.DomainError('共同清单可报告进度；由发起者在原话题继续调整教学方案',403)
    progress = dict(row.plan.get('guidance') or {})
    observations = list(progress.get('observations',[]))
    fingerprint = hashlib.sha256(json.dumps(payload.model_dump(exclude={'expected_version','receipt_id'}),
        sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    receipt = next((entry for entry in observations if entry['receipt_id']==payload.receipt_id),None)
    if receipt:
        if receipt['fingerprint'] != fingerprint:
            raise domain.DomainError('同一次反馈不能改成另一份内容，请重新提交',409)
        return domain.require(db.get(Run,receipt['run_id']))
    if row.plan.get('kind') != 'guidance' or row.plan.get('schema') != 'interaction/1':
        raise domain.DomainError('请先与阿圆整理可继续的教学步骤')
    entry = next((entry for entry in row.plan.get('entries',[]) if entry['id']==payload.step_id),None)
    if not entry or not entry.get('guidance'):
        raise domain.DomainError('这一步尚未核对，请先回到对话补充资料',409)
    if entry.get('state')=='ready' or row.status in {'completed','cancelled'}:
        raise domain.DomainError('这一步已确认或任务已结束，请继续处理当前问题',409)
    if progress.get('lesson'):
        from .lessons import step_definition,input_ready
        if progress.get('active_step_id')!=payload.step_id:
            raise domain.DomainError('请先完成当前一步，不能跳步确认',409)
        if progress['lesson']['phase']=='paused':
            raise domain.DomainError('教学已暂停，先恢复再继续',409)
        step=step_definition(row,entry)
        if payload.outcome=='done' and not input_ready(progress['lesson'],step.get('requires_input')):
            raise domain.DomainError('先核对当前步骤需要的材料条件，再确认完成',409)
    for photo_id in payload.photo_ids:
        asset = domain.own_asset(db,user_id,photo_id)
        if not asset.media_type.startswith('image/'):
            raise domain.DomainError('步骤附件需要照片')
    if payload.outcome == 'done' and entry.get('item_id'):
        item = domain.accessible_item(db,user_id,entry['item_id'])
        if item.archived or item.state.get('availability')=='unavailable':
            raise domain.DomainError('这件物品目前不可用，请先在对话中核对状态',409)
    resumed = interactions.resume_task(db,user_id,task_id)
    conversation = db.get(Conversation,resumed['conversation_id'])
    labels = {'done':'我已做了这一步','not_found':'我没找到这一步说的位置或信号','unchanged':'做过了，但没有变化'}
    text = ('这步做好了。' if payload.outcome=='done' else f"{labels[payload.outcome]}：{entry['title']}。") + ('\n'+payload.note if payload.note.strip() else '')
    run_id, message_id = uid(),uid()
    entries = [dict(value) for value in row.plan['entries']]
    current = next(value for value in entries if value['id']==payload.step_id)
    current.update(state='ready' if payload.outcome=='done' else payload.outcome,updated_by=user_id,
        guidance={**current['guidance'],'observed_quote':text,'observed_message_id':message_id})
    observations.append({'receipt_id':payload.receipt_id,'fingerprint':fingerprint,'run_id':run_id,
        'message_id':message_id,'step_id':payload.step_id,'outcome':payload.outcome,
        'text':text,'photo_ids':payload.photo_ids,'created_at':now()})
    progress.update(observations=observations,awaiting_reply=True,active_step_id=payload.step_id)
    changed = db.execute(update(TaskRecord).where(TaskRecord.id==task_id,
        TaskRecord.version==payload.expected_version).values(plan={**row.plan,'entries':entries,'guidance':progress},
        status='in_progress',version=TaskRecord.version+1,updated_at=now()))
    if changed.rowcount != 1:
        db.rollback()
        raise domain.DomainError('步骤已更新，请核对最新进度后再反馈',409)
    conversation.entry_context = resumed['entry_context']
    conversation.item_ids = row.item_ids
    conversation.updated_at = now()
    run = Run(id=run_id,user_id=user_id,conversation_id=conversation.id)
    db.add(run)
    db.add(ChatMessage(id=message_id,conversation_id=conversation.id,role='user',text=text,
        photo_ids=payload.photo_ids,item_ids=list(row.item_ids),run_id=run.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise domain.DomainError('阿圆正在回复，等当前回复结束后再反馈',409)
    return run
