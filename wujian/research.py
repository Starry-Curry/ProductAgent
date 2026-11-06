"""Bounded product research using the SAME search, source store and receipts."""
import re
from collections import Counter
from urllib.parse import urlsplit

from sqlalchemy import select

from . import domain, foundation
from .database import SourceRecord
from .knowledge import source_excerpt
from .assistance import source_applies


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
    return list(dict.fromkeys(queries))[:2]


async def research_item(sessions, user_id, item_id, topic, *, search, fetch, receipt):
    with sessions() as db:
        item = domain.accessible_item(db, user_id, item_id)
        queries = queries_for(item, topic[:160])
        saved = [source for source in db.scalars(select(SourceRecord).where(
            SourceRecord.owner_id == user_id, SourceRecord.item_id == item_id)
            .order_by(SourceRecord.fetched_at.desc())) if source_applies(db, source, [item_id])]
        product_urls = item.product.get('source_urls', [])
        retained = [source_excerpt(source, topic[:80]) for source in saved[:2]]
    outcomes, candidates, documents = [], [], list(retained)
    for document in retained:
        receipt('read_source', document)
    # A retained source can be reused. The main Agent checks whether its
    # contents answer the new topic; search/fetch remain separately available.
    if retained:
        return {'status':'retained_sources','documents':documents,'queries':[],
                'applicability':'型号、版本、操作前提仍需按引文核对；资料存在不证明当前操作适用。'}
    for query in queries:
        result = await search(query)
        receipt('search_public_web', result)
        outcomes.append({'stage':'search','query':query,'available':result.get('available',True),
            'reason':result.get('reason'),'count':len(result.get('results',[]))})
        candidates.extend(row['url'] for row in result.get('results',[]) if row.get('url'))
        if candidates or result.get('reason') in {'budget_exhausted','user_opted_out'}:
            break
    candidates = list(dict.fromkeys([*product_urls, *candidates]))
    # Preserve search relevance instead of blindly promoting every PDF (a real
    # run picked a car manual over a speaker guide). Repeated publisher hosts,
    # exact model paths and support documents are discovery hints, not proof.
    hosts = Counter(urlsplit(url).hostname for url in candidates)
    normalized_model = re.sub(r'[^\w]', '', item.product.get('model','')).casefold()
    def rank(url):
        parts = urlsplit(url)
        path = parts.path.casefold()
        model_match = bool(normalized_model and normalized_model in re.sub(r'[^\w]', '', path))
        document = '.pdf' in path or any(word in path for word in ['manual','support','guide','download'])
        return (0 if url in product_urls else 1 if hosts[parts.hostname]>=2 else 2,
                0 if model_match else 1, 0 if document else 1)
    candidates.sort(key=rank)
    for url in candidates[:3]:
        result = await fetch(url, item_id)
        receipt('fetch_document', result)
        outcomes.append({'stage':'read','url':url,'available':result.get('available',True),
            'reason':result.get('reason'),'source_id':result.get('source_id')})
        if result.get('source_id'):
            documents.append(result)
        if documents or result.get('reason') in {'budget_exhausted','user_opted_out'}:
            break
    return {'status':'read_candidates' if documents else 'source_unavailable' if candidates else 'search_unavailable' if any(not row['available'] for row in outcomes) else 'search_empty',
        'documents':documents, 'outcomes':outcomes, 'candidate_urls':candidates[:12],
        'applicability':'候选原文不是已验证教程。核对品牌、型号、商业版本、当前状态和所引段落；全文不匹配时继续核对，不套相近机型。'}
