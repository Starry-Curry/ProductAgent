"""Bounded product research using the SAME search, source store and receipts."""
import re
from urllib.parse import urlsplit

from sqlalchemy import select

from . import domain
from .database import SourceRecord
from .knowledge import source_excerpt
from .assistance import source_applies, identity_in_source, item_photos


def queries_for(item, topic):
    product = item.product
    model = product.get('model', '').strip()
    brand = product.get('brand', '').strip()
    # Normalize separators only for discovery, never for permanent identity.
    spaced = re.sub(r'[_-]+', ' ', model)
    name = product.get('commercial_name') or (item.name if not model else '')
    queries = [f'{brand} {model} {name} {topic} 官方 说明书'.strip()]
    if model:
        queries.append(f'{brand} {spaced} {topic} 使用指南'.strip())
    if model and (item.state.get('identity_evidence') or {}).get('provisional'):
        # A nameplate code can span several commercial generations. Resolve
        # that identity before biasing the search toward a generic how-to.
        queries.insert(0,f'{brand} "{model}" 铭牌 商业名称 版本')
    return list(dict.fromkeys(queries))[:2]


async def research_item(sessions, user_id, item_id, topic, *, search, fetch, receipt):
    with sessions() as db:
        item = domain.accessible_item(db, user_id, item_id)
        if not item.product.get('model') and not item.state.get('identity_evidence') and item_photos(db,user_id,[item_id],limit=1):
            return {'status':'identity_required','item_id':item_id,
                'next':'已提供实拍，先核读并单独完成update_item_identity，收到成功结果后再查资料；不要并发这两个有依赖的调用。看不清型号时保留空值，以visual_inference记录暂定认识，不能猜型号。'}
        queries = queries_for(item, topic[:160])
        saved = [source for source in db.scalars(select(SourceRecord).where(
            SourceRecord.owner_id == user_id, SourceRecord.item_id == item_id)
            .order_by(SourceRecord.fetched_at.desc())) if source_applies(db, source, [item_id])]
        product_urls = item.product.get('source_urls', [])
        retained = [{**source_excerpt(source, topic[:80]),'model_mentioned':identity_in_source(item,source)} for source in saved[:2]]
    outcomes, candidates, documents = [], [], list(retained)
    searches=[]
    for document in retained:
        receipt('read_source', document)
    # A retained source can be reused. The main Agent checks whether its
    # contents answer the new topic; search/fetch remain separately available.
    if retained and (not item.product.get('model') or any(doc['model_mentioned'] for doc in retained)):
        return {'status':'retained_sources','documents':documents,'queries':[],
                'applicability':'型号、版本、操作前提仍需按引文核对；资料存在不证明当前操作适用。'}
    for query in ([] if product_urls else queries):
        result = await search(query)
        receipt('search_public_web', result)
        searches.append({key:result[key] for key in ['query','results','search_summary'] if key in result})
        outcomes.append({'stage':'search','query':query,'available':result.get('available',True),
            'reason':result.get('reason'),'count':len(result.get('results',[]))})
        candidates.extend(row['url'] for row in result.get('results',[]) if row.get('url'))
        if candidates or result.get('reason') in {'budget_exhausted','user_opted_out'}:
            break
    candidates = list(dict.fromkeys([*product_urls, *candidates]))
    # Keep search order. Repeated hosts often indicate a content farm, not
    # authority; neither a PDF extension nor a popular host proves relevance.
    positions={url:index for index,url in enumerate(candidates)}
    normalized_model = re.sub(r'[^\w]', '', item.product.get('model','')).casefold()
    def rank(url):
        parts = urlsplit(url)
        path = parts.path.casefold()
        model_match = bool(normalized_model and normalized_model in re.sub(r'[^\w]', '', path))
        document = '.pdf' in path or any(word in path for word in ['manual','support','guide','download'])
        return (0 if url in product_urls else 1,
                positions[url] - (2 if model_match else 0) - (1 if document else 0))
    candidates.sort(key=rank)
    saved_urls={source.url for source in saved}
    for url in candidates[:3]:
        if url in saved_urls:
            continue
        result = await fetch(url, item_id)
        receipt('fetch_document', result)
        outcomes.append({'stage':'read','url':url,'available':result.get('available',True),
            'reason':result.get('reason'),'source_id':result.get('source_id')})
        if result.get('source_id'):
            with sessions() as db:
                source=db.get(SourceRecord,result['source_id'])
                result={**result,'model_mentioned':bool(source and identity_in_source(item,source))}
            documents.append(result)
        if (documents and (not item.product.get('model') or any(doc.get('model_mentioned') for doc in documents) or len(documents)>=2)
                or result.get('reason') in {'budget_exhausted','user_opted_out'}):
            break
    identity_matched=any(doc.get('model_mentioned') for doc in documents)
    if item.product.get('model') and documents and not identity_matched:
        documents=[{**doc,'text':doc.get('text','')[:1000]} for doc in documents]
    return {'status':('read_candidates' if identity_matched or not item.product.get('model') else 'identity_not_matched') if documents else 'source_unavailable' if candidates else 'search_unavailable' if any(not row['available'] for row in outcomes) else 'search_empty',
        'documents':documents, 'outcomes':outcomes, 'searches':searches,'candidate_urls':candidates[:12],
        'next':'原文未匹配型号时从未读候选另取资料，或先观察实物，不生成具体操作。身份核对资料只用于辨型号/版本；原文未讲当前使用动作时，再用已核对商业名与当前目标搜索使用指南，不能把拆解动作当成日常教程。',
        'applicability':'候选原文不是已验证教程。核对品牌、型号、商业版本、当前状态和所引段落；全文不匹配时继续核对，不套相近机型。'}
