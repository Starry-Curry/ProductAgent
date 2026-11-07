"""Bailian search with observable search calls, plus bounded source reading."""
import asyncio
import base64
import io
import ipaddress
import socket
import os
from urllib.request import getproxies
from urllib.parse import urljoin, urlsplit
from threading import RLock

import httpx
import httpcore
from bs4 import BeautifulSoup
from openai import AsyncOpenAI
import pypdfium2 as pdfium
from sqlalchemy import select

from .database import Asset, SourceRecord, uid
from .domain import DomainError, accessible_item

# PDFium is also used by the original-page viewer. Its native API must not be
# entered concurrently by parsing/rendering workers, even for different files.
_PDF_LOCK=RLock()


def public_transport():
    """Honor the operator's configured transport, still CONNECT to pinned IPs.

    A proxy is infrastructure configuration, never a model/tool parameter.
    URL/DNS validation, TLS SNI and per-redirect pinning remain mandatory.
    """
    proxy = os.getenv('WUJIAN_RESEARCH_PROXY') or getproxies().get('https')
    if proxy and urlsplit(proxy).scheme not in {'http', 'https'}:
        raise DomainError('资料代理需使用已配置的 HTTP/HTTPS 网络通道', 502)
    if proxy:
        from .source_transport import PinnedProxyTransport
        return PinnedProxyTransport(proxy)
    return httpx.AsyncHTTPTransport(retries=1, limits=httpx.Limits(max_keepalive_connections=0))


async def search_web(settings, query: str):
    async with AsyncOpenAI(api_key=settings.api_key, base_url=settings.base_url,
                           timeout=35, max_retries=0) as client:
        response = await client.responses.create(
            model=settings.model,
            input="搜索以下公开资料，给出来源；只概述搜索发现，不把搜索摘要当成已读取的说明书：\n" + query[:1200],
            tools=[{"type": "web_search"}], max_output_tokens=1000,
            extra_body={"enable_thinking": False},
            store=False,
        )
    output = response.model_dump(mode="json").get("output", [])
    calls = [block for block in output if block.get("type") == "web_search_call" and block.get("status") == "completed"]
    if not calls:
        raise DomainError("搜索服务未返回可验证的搜索调用记录，不能把模型生成的链接当作搜索结果", 502)
    urls, texts = [], []
    for call in calls:
        urls.extend(source.get("url") for source in call.get("action", {}).get("sources", []) if source.get("url"))
    for block in output:
        if block.get("type") != "message":
            continue
        for part in block.get("content", []):
            if part.get("type") == "output_text":
                texts.append(part.get("text", ""))
                urls.extend(annotation.get("url") for annotation in part.get("annotations", []) if annotation.get("url"))
    return {"provider": "bailian_responses_web_search", "query": query,
            "results": [{"url": url} for url in list(dict.fromkeys(urls))[:15]],
            "search_summary": "\n".join(texts)[:9000], "evidence_kind": "search_result_not_full_document"}


async def validate_public_url(url, all_addresses=False):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise DomainError("只支持公开的 HTTP 或 HTTPS 资料地址")
    if parsed.port not in (None, 80, 443):
        raise DomainError("不支持此资料端口")
    try:
        addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, parsed.port or 443)
    except OSError as error:
        raise DomainError("资料域名无法解析", 502) from error
    resolved = list(dict.fromkeys(address[4][0] for address in addresses))
    if not resolved:
        raise DomainError('资料域名没有可用地址',502)
    if any(not ipaddress.ip_address(address).is_global for address in resolved):
        # Some local VPNs return RFC 2544 / RFC 5180 benchmark addresses (Fake-IP).
        # Do not whitelist them or trust the proxy's eventual destination. Resolve
        # the public hostname independently, then pin the verified IP + TLS SNI.
        benchmark = lambda address: ipaddress.ip_address(address) in ipaddress.ip_network('198.18.0.0/15') or ipaddress.ip_address(address) in ipaddress.ip_network('2001:2::/48')
        try:
            ipaddress.ip_address(parsed.hostname)
            literal = True
        except ValueError:
            literal = False
        if literal or not all(benchmark(address) for address in resolved):
            raise DomainError("资料读取不能访问本机或内网地址")
        resolved = []
        last_error = None
        async with httpx.AsyncClient(timeout=7,trust_env=False,transport=public_transport()) as resolver:
            for endpoint in ['https://dns.alidns.com/resolve', 'https://cloudflare-dns.com/dns-query']:
                try:
                    async with asyncio.timeout(8):
                        response = await resolver.get(endpoint,
                            params={'name':parsed.hostname,'type':'A'},headers={'Accept':'application/dns-json'})
                        response.raise_for_status()
                        resolved = [row['data'] for row in response.json().get('Answer',[]) if row.get('type') in {1,28}]
                    break
                except (httpx.HTTPError, httpcore.NetworkError, httpcore.TimeoutException, TimeoutError) as error:
                    last_error = error
        if not resolved and last_error:
            raise DomainError('独立公网解析未完成；这不是没有资料，请稍后接续或换公开来源。',502) from last_error
        if not resolved or any(not ipaddress.ip_address(address).is_global for address in resolved):
            raise DomainError('公开解析没有可用公网地址，资料读取已停止',502)
    ordered = sorted(resolved, key=lambda address: ':' in address)
    return ordered[:3] if all_addresses else ordered[0]


async def download_public(url):
    async with httpx.AsyncClient(timeout=httpx.Timeout(16,connect=6), follow_redirects=False, trust_env=False,
            transport=public_transport(),headers={"User-Agent": "WujianResearch/0.1"}) as client:
        for _ in range(5):
            addresses = await validate_public_url(url, all_addresses=True)
            if isinstance(addresses,str):addresses=[addresses]
            original = httpx.URL(url)
            headers={'Host':original.netloc.decode()}
            # Public manual CDN requires its publisher's normal hotlink Referer.
            # Keep verified DNS, IP pinning and TLS SNI; no proxy/private bypass.
            if original.host=='video.loklik.cn':headers['Referer']='https://www.loklik.cn/'
            for index,address in enumerate(addresses):
                pinned = original.copy_with(host=address)
                try:
                    async with client.stream("GET", pinned,headers=headers,
                            extensions={'sni_hostname':original.host}) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            url = urljoin(url, response.headers.get("location", ""))
                            break
                        response.raise_for_status()
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 12 * 1024 * 1024:
                                raise DomainError("资料超过当前单文件12MB限制")
                        return str(original), response.headers.get("content-type", ""), bytes(data)
                except (httpx.NetworkError,httpx.TimeoutException,httpcore.NetworkError,httpcore.TimeoutException):
                    if index == len(addresses)-1:raise
    raise DomainError("资料重定向过多", 502)


def parse_document(data, content_type, url):
    if data.startswith(b"%PDF") or "application/pdf" in content_type:
        # Reuse the installed renderer for text too: real vendor manuals with
        # CFF fonts cannot be fully decoded by the old extractor without another
        # optional dependency, producing noisy logs and losing operating text.
        pages=[]
        with _PDF_LOCK:
            document=pdfium.PdfDocument(data)
            try:
                for index in range(min(len(document),160)):
                    page=document[index]
                    try:
                        textpage=page.get_textpage()
                        try: text=textpage.get_text_bounded().replace('\r\n','\n')[:16000]
                        finally:textpage.close()
                    finally:page.close()
                    pages.append({'page':index+1,'text':text})
            finally:document.close()
        return "\n\n".join(f"[第{page['page']}页]\n{page['text']}" for page in pages), pages, [], "application/pdf", "PDF资料"
    soup = BeautifulSoup(data, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else urlsplit(url).hostname
    links = []
    for node in soup.select('iframe[src],embed[src],object[data]'):
        target=urljoin(url,node.get('src') or node.get('data',''))
        if urlsplit(target).scheme in {'http','https'} and ('.pdf' in urlsplit(target).path.casefold() or node.get('type')=='application/pdf'):
            links.append({'title':'嵌入的PDF原文（需读取核验）','url':target})
    for anchor in soup.select("a[href]"):
        target = urljoin(url, anchor.get("href", ""))
        if urlsplit(target).scheme in {"http", "https"}:
            links.append({"title": anchor.get_text(" ", strip=True)[:120], "url": target})
    for node in soup.select("script,style,noscript,nav,footer,header"):
        node.decompose()
    content = "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
    links=list({row['url']:row for row in links}.values())
    return content[:300000], [], links[:100], "text/html", title


async def fetch_source(settings, sessions, user_id, url, item_id=None, refresh=False):
    with sessions() as db:
        if item_id:
            accessible_item(db, user_id, item_id)
        existing = db.scalar(select(SourceRecord).where(SourceRecord.owner_id == user_id, SourceRecord.url == url, SourceRecord.item_id == item_id).order_by(SourceRecord.fetched_at.desc()))
        if existing and not refresh:
            return source_excerpt(existing)
    final_url, content_type, data = await download_public(url)
    content, pages, links, media_type, title = await asyncio.to_thread(parse_document, data, content_type, final_url)
    if not content.strip() and not pages:
        raise DomainError("资料页面没有可读取正文，请选择原始说明书或其他来源", 422)
    asset_id = uid()
    path = settings.data_dir / "assets" / asset_id
    path.write_bytes(data)
    with sessions() as db:
        if item_id:
            accessible_item(db, user_id, item_id)
        asset = Asset(id=asset_id, owner_id=user_id, path=str(path), media_type=media_type, original_name=title[:180])
        source = SourceRecord(owner_id=user_id, item_id=item_id, title=title, url=final_url, origin="public_web",
                              content=content, pages=pages, asset_id=asset_id)
        db.add(asset)
        db.add(source)
        db.commit()
        return {**source_excerpt(source), "links": links}


def source_excerpt(source, query="", page=None):
    text = source.content
    offset = 0
    if page is not None:
        if page < 1 or page > len(source.pages):
            raise DomainError("页码超出范围")
        text = source.pages[page - 1]["text"]
        offset = source.content.find(text)
    elif query:
        position = text.casefold().find(query.casefold())
        if position >= 0:
            offset = max(0, position - 1500)
            offset = text.rfind('\n',0,offset)+1
            text = text[offset:position + 10500]
    first_line = source.content[:max(0,offset)].count('\n')+1
    numbered = '\n'.join(f'{first_line+i}: {line}' for i,line in enumerate(text[:12000].splitlines()))
    return {"source_id": source.id, "title": source.title, "url": source.url,
            "fetched_at": source.fetched_at, "text": numbered, "page": page,
            "line_numbered":True,"first_line":first_line,
            "page_count": len(source.pages), "original_asset_id": source.asset_id,
            "truncated": len(text) > 12000, "evidence_kind": "retrieved_document"}


def render_source_page(settings, source, asset, page):
    with _PDF_LOCK:
        return _render_source_page(settings,source,asset,page)


def _render_source_page(settings, source, asset, page):
    if asset.media_type != "application/pdf":
        raise DomainError("此来源不是PDF")
    document = pdfium.PdfDocument(asset.path)
    try:
        if page < 1 or page > len(document):
            raise DomainError("页码超出范围")
        pdf_page = document[page - 1]
        bitmap = pdf_page.render(scale=1.4)
        image = bitmap.to_pil()
        output = io.BytesIO()
        image.save(output, format="PNG")
        image.close()
        bitmap.close()
        pdf_page.close()
        return base64.b64encode(output.getvalue()).decode()
    finally:
        document.close()
