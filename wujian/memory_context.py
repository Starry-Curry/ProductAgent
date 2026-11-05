"""Bounded current-user context; ReMe ranks, SQL rehydrates and owns all facts."""
from sqlalchemy import select

from . import domain
from .database import Memory, Run, ChatMessage, now


def active_rows(sessions, user_id):
    with sessions() as db:
        return [domain.memory_view(row) for row in db.scalars(select(Memory).where(
            Memory.user_id == user_id, Memory.active.is_(True)).order_by(Memory.updated_at.desc()))
            if not row.expires_at or row.expires_at > now()]


async def prepare_memories(sessions, retrieval, user_id, question, item_ids):
    rows = active_rows(sessions, user_id)
    candidates = [row for row in rows if not item_ids or row['item_id'] is None or row['item_id'] in item_ids]
    identities = [row['id'] for row in candidates[:8]]
    mode = 'current_records'
    if len(rows) > 8 and retrieval and question.strip():
        try:
            hits = await retrieval.search(user_id, question, ['memory'], limit=8)
            identities = [hit['id'] for hit in hits['results']] + identities[:4]
            mode = hits['mode']
        except Exception:
            mode = 'current_records_retrieval_unavailable'
    # A correction/forget can occur while the embedding request is in flight.
    current = {row['id']: row for row in active_rows(sessions, user_id)}
    selected = [current[identity] for identity in dict.fromkeys(identities) if identity in current][:12]
    selected = [{**row, 'attributes': {key:value for key,value in row['attributes'].items()
                if key != 'source_message_ids'}} for row in selected]
    return {'records':selected,'retrieval_mode':mode,
        'index':[{'id':row['id'],'item_id':row['item_id'],'kind':row['attributes'].get('kind'),
            'context':row['attributes'].get('context',''),'updated_at':row['updated_at'],
            'expires_at':row['expires_at']} for row in current.values()][:60],
        'use': 'Only when relevant to this situation. Context and expiry qualify each record; current user corrections override old preferences. Do not announce or recite memories unnecessarily. Search remaining records when prior context matters.'}


def record_recall(sessions, user_id, message_id, name, value):
    if name not in {'recall_memories','search_world'} or not isinstance(value,dict):
        return
    ids = [row['id'] for row in value.get('memories',[])]
    with sessions() as db:
        for hit in value.get('results',[]):
            if hit['kind']=='memory':
                ids.append(hit['id'])
            elif hit['kind']=='conversation':
                prior_message = db.get(ChatMessage,hit['id'])
                prior = db.get(Run,prior_message.run_id) if prior_message and prior_message.run_id else None
                if prior:
                    ids.extend(identity for event in prior.events if event.get('type')=='memory_context'
                        for identity in event.get('memory_ids',[]))
        message = db.get(ChatMessage,message_id)
        run = db.get(Run,message.run_id) if message else None
        if not run or run.user_id!=user_id or run.status!='running': return
        old = [event for event in run.events if event.get('type')=='memory_context']
        identities = list(dict.fromkeys([*(identity for event in old for identity in event.get('memory_ids',[])),*ids]))
        run.events = [event for event in run.events if event.get('type')!='memory_context'] + [{'type':'memory_context','memory_ids':identities}]
        db.commit()
