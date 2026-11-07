"""Bailian search with observable search calls, plus bounded source reading."""
import asyncio
import base64
import io
import math
import re
import threading
import unicodedata
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from openai import AsyncOpenAI
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import object_session

from .database import Asset, SourceRecord, uid
from .domain import DomainError, accessible_item
from .source_content import JAVASCRIPT_TYPES, metadata_only_content, parse_public_text, public_image_candidates
from .public_network import resolve_public_url
from .source_access import readable_source

# PDFium forbids concurrent calls even for different documents. Keep its
# native lifetime under one lock; other I/O and model work remain concurrent.
_PDF_RENDER_LOCK = threading.Lock()


async def search_web(settings, query: str):
    async with AsyncOpenAI(api_key=settings.api_key, base_url=settings.base_url,
                           timeout=60, max_retries=1) as client:
        response = await client.responses.create(
            model=settings.model,
            input="查找相关原始网页。只列出网页标题与链接，不生成操作步骤、效果保证或综合结论：\n" + query[:1200],
            tools=[{"type": "web_search"}], max_output_tokens=700,
            extra_body={"enable_thinking": False},
            store=False,
        )
    output = response.model_dump(mode="json").get("output", [])
    calls = [block for block in output if block.get("type") == "web_search_call" and block.get("status") == "completed"]
    if not calls:
        raise DomainError("搜索服务未返回可验证的搜索调用记录，不能把模型生成的链接当作搜索结果", 502)
    results = {}
    def add(source):
        url=source.get("url")
        if isinstance(url,str) and url:
            previous=results.get(url,{"url":url})
            results[url]={**{key:source[key] if key=='url' else source[key][:1200] for key in ("url","title","snippet","description")
                if isinstance(source.get(key),str) and source[key]},**previous}
    for call in calls:
        for source in call.get("action", {}).get("sources", []):
            add(source)
    observed_source_urls=list(results)
    completed_source_urls=set(observed_source_urls)
    recommended=[]
    for block in output:
        if block.get("type") != "message":
            continue
        for part in block.get("content", []):
            if part.get("type") == "output_text":
                for annotation in part.get("annotations", []):
                    add(annotation)
                # The provider sometimes returns only URLs in search_call,
                # with its recommendation labels in ordinary output_text.
                # Keep that ordering as discovery data ONLY for URLs already
                # observed in completed search calls. Never promote free text
                # to a page title, snippet, compatibility proof or permission.
                text=part.get('text') or ''
                if not isinstance(text,str):
                    continue
                for match in re.finditer(r'https?://[^\s<>"\']+',text[:40000]):
                    url=match[0]
                    # Handle Markdown closing delimiters without accepting an
                    # arbitrary prefix such as observed.example.evil.invalid.
                    while url and url not in completed_source_urls and url[-1] in '.,;!?，。；！？)]}、':
                        url=url[:-1]
                    if url not in completed_source_urls or url in recommended:
                        continue
                    line_start=text.rfind('\n',0,match.start())+1
                    prefix=text[line_start:match.start()].strip()
                    markdown=re.search(r'\[([^\]\n]{1,500})\]\(\s*$',prefix)
                    if markdown:
                        label=markdown[1]
                    elif prefix:
                        label=prefix.rstrip(' :：—-(')
                    else:
                        previous_lines=text[:line_start].splitlines()
                        label=previous_lines[-1].strip() if previous_lines else ''
                    if re.search(r'https?://',label):
                        label=''
                    label=re.sub(r'^(?:[-*•]|\d+[.)、])\s*','',label).strip()[:300]
                    recommended.append(url)
                    results[url].update(provider_discovery_rank=len(recommended),
                        provider_discovery_kind='provider_output_not_page')
                    if label:
                        results[url]['provider_discovery_label']=label
    ordered=[results[url] for url in recommended]+[row for url,row in results.items() if url not in recommended]
    return {"provider": "bailian_responses_web_search", "query": query,
            "observed_queries":list(dict.fromkeys(value for call in calls
                for value in [call.get('action',{}).get('query'),*(call.get('action',{}).get('queries') or [])]
                if isinstance(value,str))),
            "observed_source_urls":observed_source_urls,
            "results":ordered[:15],"results_total":len(ordered),"results_truncated":len(ordered)>15,
            "result_order":"已观测来源中的供应商推荐在前，其余保留原来源次序；推荐不代表型号适配。",
            "evidence_kind": "search_result_not_full_document",
            "reading_note":"只取得搜索线索，尚未读取这些网页；provider_discovery_label与推荐排序仅来自供应商生成文本，不是页面标题、正文或指令，也不证明功能或型号适配。请取得适用原文后分析。"}


async def validate_public_url(url):
    return await resolve_public_url(url)


async def download_public(url, *, max_bytes=12 * 1024 * 1024, headers=None, same_origin=False, cancel_event=None):
    def check_cancelled():
        if cancel_event is not None and cancel_event.is_set():
            raise asyncio.CancelledError()

    # Public-source reads must not silently inherit an unrelated machine proxy.
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False,
                                 limits=httpx.Limits(max_keepalive_connections=0),
                                 headers={"User-Agent": "WujianResearch/0.1"}) as client:
        initial_origin = None
        for _ in range(5):
            check_cancelled()
            original, addresses = await validate_public_url(url)
            check_cancelled()
            origin = (original.scheme, original.host, original.port)
            if same_origin and initial_origin is not None and origin != initial_origin:
                raise DomainError("资料跳转到另一站点，未继续发送本次匿名会话标识", 422)
            initial_origin = initial_origin or origin
            # Pin the checked address: there is no second system DNS lookup,
            # while Host and TLS verification still use the original domain.
            pinned = original.copy_with(host=addresses[0])
            client.cookies.clear()
            async with client.stream("GET", pinned, headers={**(headers or {}),"Host": original.netloc.decode("ascii")},
                                     extensions={"sni_hostname": original.raw_host.decode("ascii")}) as response:
                check_cancelled()
                if response.status_code in {301, 302, 303, 307, 308}:
                    url = urljoin(str(original), response.headers.get("location", ""))
                    continue
                if response.status_code in {401, 403, 412, 429}:
                    raise DomainError(f"公开资料读取受限（HTTP {response.status_code}）；未登录或绕过限制，请换公开来源", 502)
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as error:
                    # Keep the actual public-document HTTP failure observable
                    # without leaking a pinned-IP URL or an untrusted body.
                    raise DomainError(f"公开资料读取失败（HTTP {response.status_code}）；尚未取得正文，请检查公开地址或换来源", 502) from error
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    check_cancelled()
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise DomainError(f"资料超过当前单文件{max_bytes // (1024 * 1024)}MB限制")
                check_cancelled()
                return str(original), response.headers.get("content-type", ""), bytes(data)
    raise DomainError("资料重定向过多", 502)


def parse_document(data, content_type, url):
    if data.startswith(b"%PDF") or "application/pdf" in content_type:
        reader = PdfReader(io.BytesIO(data))
        pages = [{"page": index + 1, "text": (page.extract_text() or "")[:16000]} for index, page in enumerate(reader.pages[:160])]
        return "\n\n".join(f"[第{page['page']}页]\n{page['text']}" for page in pages), pages, [], "application/pdf", "PDF资料"
    content, links, media_type, title = parse_public_text(data, content_type, url)
    return content, [], links, media_type, title


def _link_page(links, *, link_limit=12, link_offset=0, link_query=""):
    """Page the reader's existing extracted navigation, never source facts."""
    if isinstance(link_limit, bool) or not isinstance(link_limit, int) or not 1 <= link_limit <= 100:
        raise DomainError("link_limit须为1到100的整数")
    if isinstance(link_offset, bool) or not isinstance(link_offset, int) or link_offset < 0:
        raise DomainError("link_offset须为非负整数")
    if not isinstance(link_query, str) or len(link_query) > 200:
        raise DomainError("链接查询须为不超过200字的文字")
    query=link_query.strip().casefold()
    matches=[row for row in links if not query or query in
             (row.get("title", "")+" "+row.get("url", "")).casefold()]
    page=matches[link_offset:link_offset+link_limit]
    next_offset=link_offset+len(page)
    return {"links":page, "links_total":len(matches),
            "links_inventory_total":len(links), "links_offset":link_offset,
            "links_query":link_query.strip(), "links_truncated":next_offset<len(matches),
            "links_next_offset":next_offset if next_offset<len(matches) else None,
            "navigation_scope":"当前解析器提取的导航链接；不是链接目标正文，也不保证穷尽原网页。",
            **({"declared_resources":[row for row in links if row.get('kind')=='declared_script_resource'][:12],
                "resource_scope":"页面明确声明的公开脚本URL；可仅读原文寻找数据入口，不执行脚本，不自动请求其中接口。"}
               if any(row.get('kind')=='declared_script_resource' for row in links) else {})}


def _retained_links(source, asset):
    if (not asset or asset.id != source.asset_id or asset.owner_id != source.owner_id
            or source.origin != "public_web"):
        raise DomainError("原始导航文件不可用",404)
    if asset.media_type == "application/pdf":
        # PDF text/pages retain their existing semantics; this reader does not
        # claim to extract annotation links from the PDF itself.
        return []
    path=Path(asset.path)
    if not path.is_file():
        raise DomainError("原始导航文件不可用",404)
    _,_,links,_,_=parse_document(path.read_bytes(),asset.media_type,source.url)
    return links


def source_navigation(db, user_id, source_id, *, link_limit=12, link_offset=0, link_query=""):
    """Reopen retained navigation with present permission; no network/refetch."""
    source=readable_source(db,user_id,source_id)
    _link_page([],link_limit=link_limit,link_offset=link_offset,link_query=link_query)
    asset=db.get(Asset,source.asset_id) if source.asset_id else None
    return {"source_id":source.id, "url":source.url,
            "evidence_kind":"retained_source_navigation_not_target_documents",
            **_link_page(_retained_links(source,asset),link_limit=link_limit,
                         link_offset=link_offset,link_query=link_query)}


async def fetch_source(settings, sessions, user_id, url, item_id=None, refresh=False, *, excerpt_chars=12000,
                       link_limit=12, link_offset=0, link_query=""):
    # Validate before network or writes, even for a cached source.
    _link_page([],link_limit=link_limit,link_offset=link_offset,link_query=link_query)
    with sessions() as db:
        if item_id:
            accessible_item(db, user_id, item_id)
        existing = db.scalar(select(SourceRecord).where(SourceRecord.owner_id == user_id, SourceRecord.url == url,
            SourceRecord.item_id == item_id, SourceRecord.origin == "public_web").order_by(SourceRecord.fetched_at.desc()))
        if existing and not refresh:
            result = source_excerpt(existing, max_chars=excerpt_chars)
            # Reopening a cached index must retain its navigation affordance.
            # The immutable original response is already saved, no new fetch.
            asset = db.get(Asset, existing.asset_id) if existing.asset_id else None
            result["images"] = source_images(existing, asset)
            try:
                result.update(_link_page(_retained_links(existing,asset),link_limit=link_limit,
                    link_offset=link_offset,link_query=link_query))
            except DomainError as error:
                # Navigation availability must not erase already retained
                # source text or pretend an unreadable inventory is empty.
                result.update(links=[],links_total=None,links_inventory_total=None,
                              links_truncated=False,links_next_offset=None,
                              navigation_error=error.message)
            return result
    final_url, content_type, data = await download_public(url)
    content, pages, links, media_type, title = await asyncio.to_thread(parse_document, data, content_type, final_url)
    if not content.strip() and not pages and not links:
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
        return {**source_excerpt(source, max_chars=excerpt_chars),
                **_link_page(links,link_limit=link_limit,link_offset=link_offset,link_query=link_query),
                "images": source_images(source, asset)}


def _manual_attachment_candidates(source, asset):
    """A narrow declared-link rule, not a crawler or compatibility decision."""
    if (not asset or asset.owner_id != source.owner_id or asset.id != source.asset_id
            or asset.media_type != 'text/html' or source_content_level(source) != 'document_text'):
        return None
    from bs4 import BeautifulSoup
    path=Path(asset.path)
    if not path.is_file():
        return None
    soup=BeautifulSoup(path.read_bytes(),'html.parser')
    headings=[node.get_text(' ',strip=True) for node in soup.select('title,h1,h2,h3')
        if not node.find_parent(['nav','footer','header','aside','template','script','noscript'])]
    manual_name=re.compile(r"用户指南|(?:使用|用户|操作|产品)手册|说明书|\b(?:user|owner)(?:['’]s)?\s+(?:manual|guide)\b|\b(?:instructions?|service|installation)\s+manual\b|\boperating\s+instructions\b|\bmanual(?:\.pdf)?\s*(?:$|[|–—-])",re.I)
    if not any(manual_name.search(heading) for heading in headings):
        return None
    declared={row['url']:row for row in _retained_links(source,asset)}
    candidates={}
    download_label=re.compile(r"^(?:(?:立即|点击|马上)?下载(?:\s*(?:PDF|手册|说明书|用户指南))?|download(?:\s+(?:now|pdf|manual|user(?:['’]s)?\s+guide|the\s+manual))?)[.!。！]?$",re.I)
    for node in soup.select('a[href]'):
        if node.find_parent(['nav','footer','header','aside']):
            continue
        try:
            target=urljoin(source.url,node.get('href','').strip())
            parsed=urlsplit(target)
        except ValueError:
            continue
        if (parsed.scheme not in {'https','http'} or not parsed.hostname
                or parsed.username or parsed.password
                or parsed._replace(fragment='').geturl()==urlsplit(source.url)._replace(fragment='').geturl()):
            continue
        label=' '.join(node.get_text(' ',strip=True).split())
        if (parsed.path.casefold().endswith('.pdf') or node.get('type','').split(';',1)[0].strip().casefold()=='application/pdf'
                or node.has_attr('download') or download_label.fullmatch(label)):
            # The parser's retained navigation is bounded. Seeing another
            # eligible DOM link outside that inventory defeats uniqueness;
            # do not turn a truncated inventory into an automatic choice.
            if target not in declared:
                return None
            candidates.setdefault(target,declared[target])
    return list(candidates.values())


def _source_pointer(value):
    return {key:value[key] for key in ('source_id','url','title','original_asset_id','content_level','page_count') if key in value}


async def fetch_manual_source(settings, sessions, user_id, url, item_id=None, refresh=False, **kwargs):
    """Read at most ONE explicit attachment of an unambiguous manual landing.

    Both reads use the existing source writer and public pinned downloader.
    A title/link never proves model compatibility;
    a non-PDF target does not recursively become another attachment landing.
    """
    landing=await fetch_source(settings,sessions,user_id,url,item_id,refresh,**kwargs)
    with sessions() as db:
        source=readable_source(db,user_id,landing['source_id'])
        asset=db.get(Asset,source.asset_id) if source.asset_id else None
        if asset and asset.media_type=='application/pdf':
            if asset.owner_id != source.owner_id or not Path(asset.path).is_file():
                raise DomainError('PDF原件不可用，请重新读取',409)
            return {**landing,'manual_resolution':{'status':'already_pdf','pdf_obtained':True,'automatic_attachment_reads':0}}
        candidates=_manual_attachment_candidates(source,asset)
        original_asset_id=source.asset_id
    if candidates is None:
        return {**landing,'manual_resolution':{'status':'not_applicable','pdf_obtained':False,'automatic_attachment_reads':0}}
    if len(candidates)!=1:
        return {**landing,'manual_resolution':{'status':'ambiguous' if candidates else 'no_candidate',
            'candidate_count':len(candidates),'candidates':candidates,'pdf_obtained':False,'automatic_attachment_reads':0}}
    declared_url=candidates[0]['url']
    resolution={'declared_url':declared_url,'candidate_count':1,'automatic_attachment_reads':1,'pdf_obtained':False}
    pointer=_source_pointer(landing)
    failure=None
    document=None
    try:
        document=await fetch_source(settings,sessions,user_id,declared_url,item_id,refresh,**kwargs)
    except Exception as error:
        failure=error
    with sessions() as db:
        # A read chain cannot keep using a source whose grant/original changed
        # while the attachment was being fetched.
        current=readable_source(db,user_id,landing['source_id'])
        if current.asset_id != original_asset_id:
            raise DomainError('下载入口原件已更新，请重新读取',409)
        retained=db.get(Asset,current.asset_id)
        if (not retained or retained.id != original_asset_id or retained.owner_id != current.owner_id
                or not Path(retained.path).is_file()):
            raise DomainError('下载入口原件不可用或归属已变，请重新读取',409)
        if item_id:
            accessible_item(db,user_id,item_id)
        if failure is not None:
            reason=failure.message if isinstance(failure,DomainError) else f'附件读取未完成（{type(failure).__name__}）'
            return {**landing,'manual_resolution':{**resolution,'status':'unavailable','reason':reason},
                'reading_note':'仅保留下载入口；附件读取未完成，尚未取得PDF手册。'}
        attachment=readable_source(db,user_id,document['source_id'])
        actual_asset=db.get(Asset,attachment.asset_id) if attachment.asset_id else None
        is_pdf=bool(actual_asset and actual_asset.owner_id==attachment.owner_id and actual_asset.media_type=='application/pdf')
    chain=[{**pointer,'role':'manual_download_landing'},
        {**_source_pointer(document),'role':'retrieved_pdf' if is_pdf else 'non_pdf_attachment','declared_url':declared_url}]
    if not is_pdf:
        return {**landing,'attachment_source':_source_pointer(document),'document_read_chain':chain,
            'manual_resolution':{**resolution,'status':'not_pdf'},
            'reading_note':'已读取唯一声明的附件，但返回内容不是PDF；保留下载入口，未当作已读手册，也未继续追踪其他链接。'}
    return {**document,'landing_source':pointer,'document_read_chain':chain,
        'manual_resolution':{**resolution,'status':'retrieved_pdf','pdf_obtained':True,'compatibility_verified':False},
        'reading_note':'已沿手册下载入口唯一明确链接取得实际PDF；入口和附件均已保留。此读取链不证明型号、地区、章节或操作适用，仍需核对原文。'}


def source_images(source, asset):
    """Image hints from an already authorized source's immutable HTML asset.

    Caller must use readable_source before passing a source here. Hints do not
    download pictures and are not observations of the user's physical object.
    """
    if source.origin != "public_web" or not asset or asset.media_type != "text/html":
        return []
    path = Path(asset.path)
    if not path.is_file():
        return []
    return public_image_candidates(path.read_bytes(), source.url)


async def fetch_source_image(settings, sessions, user_id, source_id, image_url):
    """Read one actual image declared by an authorized public HTML source.

    Returns a validated raster image for the main multimodal model. No second
    vision-model call or device observation is performed here.
    """
    with sessions() as db:
        source = readable_source(db, user_id, source_id)
        asset = db.get(Asset, source.asset_id) if source.asset_id else None
        candidates = source_images(source, asset)
        candidate = next((row for row in candidates if row["url"] == image_url), None)
        if not candidate:
            raise DomainError("图片不在这份获准原始网页的图片线索中；不能读取任意链接", 403)
        source_url = source.url
    final_url, _, data = await download_public(image_url, max_bytes=4 * 1024 * 1024)
    if len(data) > 4 * 1024 * 1024:
        raise DomainError("图片超过4MB限制", 422)
    media_type, width, height = await asyncio.to_thread(validate_source_image, data)
    with sessions() as db:
        # A grant may have been revoked while the public download was running.
        readable_source(db, user_id, source_id)
        image_asset_id = uid()
        path = settings.data_dir / "assets" / image_asset_id
        path.write_bytes(data)
        db.add(Asset(id=image_asset_id, owner_id=user_id, path=str(path), media_type=media_type,
                     original_name=f"source-image-{source_id}"))
        db.commit()
    return {"source_id": source_id, "source_url": source_url, "image_url": final_url,
            "declared_image_url": image_url, "asset_id": image_asset_id,
            "media_type": media_type, "width": width, "height": height,
            "alt": candidate["alt"], "base64": base64.b64encode(data).decode("ascii"),
            "evidence_kind": "source_image_for_model_observation",
            "limitations": "原始公开来源配图；不是用户当前实物、额定能力或实测结果的证明。文字标签与模型看图解释须分别表达。"}


def validate_source_image(data):
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as image:
            formats = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
            media = formats.get(image.format)
            if not media or getattr(image, "is_animated", False):
                raise DomainError("只支持静态JPEG、PNG或WebP来源图片", 422)
            width, height = image.size
            if width <= 0 or height <= 0 or width > 8192 or height > 8192 or width * height > 12000000:
                raise DomainError("来源图片超出8192边长或1200万像素限制", 422)
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
        return media, width, height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise DomainError("来源响应不是可验证的完整图片", 422) from error


def _query_terms(text):
    """Small lexical index, preserving words and Chinese character adjacency."""
    text = unicodedata.normalize('NFKC',text).casefold()
    words = re.findall(r'[a-z0-9]+|[\u3400-\u9fff]+',text)
    terms = []
    for word in words:
        if re.fullmatch(r'[\u3400-\u9fff]+',word):
            terms.extend(word[index:index+2] for index in range(max(1,len(word)-1)))
        else:
            if word in {'a','an','the','and','or','of','to','for','in','on','with','using','how','can','my','is'}:
                continue
            # Typography and ordinary English inflection only; no synonym or
            # compatibility inference. Evidence below always stays original.
            if len(word)>5 and word.endswith('ing'):
                word=word[:-3]
            elif len(word)>5 and word.endswith('ed'):
                word=word[:-2]
            elif len(word)>4 and word.endswith('s'):
                word=word[:-1]
            terms.append(word)
    return terms


def _candidate_pages(source, query):
    """Rank retained PDF pages by lexical overlap, not procedural validity."""
    terms = set(_query_terms(query))
    if not terms or not source.pages:
        return []
    rows=[]
    for page in source.pages:
        text=page.get('text','')
        tokens=_query_terms(text)
        matches=terms.intersection(tokens)
        if matches:
            rows.append((page,text,tokens,matches))
    results=[]
    for page,text,tokens,matches in rows:
        score=sum((1+math.log((len(source.pages)+1)/(1+sum(term in row[3] for row in rows))))
            *min(tokens.count(term),3) for term in matches)/math.log(20+len(tokens))
        # A contents page contains chapter words, but is not that chapter.
        initial=' '.join(text.splitlines()[:6]).casefold()
        if re.search(r'\bcontents\b|目录',initial):
            score*=.4
        lines=[line.strip() for line in text.splitlines() if line.strip() and not line.strip().isdigit()]
        position=max((text.casefold().find(term) for term in matches if text.casefold().find(term)>=0),default=0)
        snippet=text[max(0,position-160):position+400]
        results.append({'page':page['page'],'title':' '.join(lines[:2])[:160],
            'matched_terms':sorted(matches),'snippet':snippet,'_score':score,'_coverage':len(matches)})
    results.sort(key=lambda row:(row['_coverage'],row['_score']),reverse=True)
    return [{key:value for key,value in row.items() if not key.startswith('_')} for row in results[:5]]


def source_excerpt(source, query="", page=None, *, max_chars=12000):
    text = source.content
    offset = 0
    candidates=_candidate_pages(source,query) if query else []
    query_matched=query.casefold() in source.content.casefold() if query else None
    match_type='exact' if query_matched else 'terms' if candidates else 'none' if query else None
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
        elif candidates:
            selected=next(value for value in source.pages if value['page']==candidates[0]['page'])
            text=selected['text']
            offset=source.content.find(text)
            page=selected['page']
    first_line = source.content[:max(0,offset)].count('\n')+1
    numbered = '\n'.join(f'{first_line+i}: {line}' for i,line in enumerate(text[:max_chars].splitlines()))
    level=source_content_level(source)
    metadata_only=level=='public_page_metadata_only_not_document_body'
    return {"source_id": source.id, "title": source.title, "url": source.url,
            "fetched_at": source.fetched_at, "text": numbered, "page": page,
            "line_numbered":True,"first_line":first_line,
            "content_available":bool(source.content.strip()) and not metadata_only,
            "page_count": len(source.pages), "original_asset_id": source.asset_id,
            "truncated": len(text) > max_chars,
            "evidence_kind": "retired_curated_reference" if source.origin == "curated_reference_retired" else "curated_reference" if source.origin == "curated_reference" else "retrieved_page_metadata" if metadata_only else "retrieved_document",
            **({"evidence_scope": {"authorship": "codex_editorial_synthesis",
                "original_author_steps_claimed": False, "physical_validation": False,
                "current_item_compatibility_proven": False,
                "retired_do_not_use_for_new_recommendations": source.origin == "curated_reference_retired"}}
               if source.origin in {"curated_reference", "curated_reference_retired"} else {}),
            "query_matched":query_matched,"query_match_type":match_type,
            **({"candidate_pages":candidates,
                "page_search_scope":"按原文词项匹配的候选页；不是整句命中、型号适用或操作正确性的证明。可用page读取候选原页或查看页图。"} if query else {}),
            **({"metadata_available":True,"reading_note":"只取得页面标题或简介，没有正文，未读取操作步骤；继续沿明确文档或资源链接读取原文。"} if metadata_only else
               {"reading_note":"仅取得页面导航，未读取链接目标正文；继续fetch_document导航URL。"} if not source.content.strip() else {}),
            "content_level":level}


def source_content_level(source):
    """Evidence granularity, not a claim that the source's advice is correct."""
    if not source.content.strip():
        return "navigation_only_not_document_content"
    # MIME comes from the retained original asset, including extensionless
    # script endpoints. Reuse this source's existing authorized SQL session;
    # the URL suffix is only a fallback for legacy sources without an asset.
    session = object_session(source) if getattr(source, '_sa_instance_state', None) is not None else None
    asset = session.get(Asset, source.asset_id) if session is not None and source.asset_id else None
    media_type = (asset.media_type.split(';', 1)[0].strip().lower()
                  if asset is not None and asset.owner_id == source.owner_id else '')
    if media_type in JAVASCRIPT_TYPES or (not media_type and urlsplit(source.url).path.casefold().endswith(('.js','.mjs'))):
        return "public_script_code_not_executed_output"
    if metadata_only_content(source.content):
        return "public_page_metadata_only_not_document_body"
    if source.origin == "curated_reference_retired":
        return "retired_editorial_reference_not_for_new_recommendations"
    if source.origin == "curated_reference":
        return "editorial_reference_not_original_steps_or_physical_validation"
    if source.origin == "video_frame_sample":
        return "sampled_video_frames_not_full_video"
    if source.content.startswith("[公开字幕文本"):
        return "subtitle_text_not_video_observation"
    host = (urlsplit(source.url).hostname or "").lower()
    if (host == "bilibili.com" or host.endswith(".bilibili.com")) and urlsplit(source.url).path.startswith("/video/"):
        return "public_video_page_or_metadata_not_video_observation"
    if host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com"):
        return "public_note_text_or_metadata_not_image_observation"
    return "document_text"


def render_source_page(settings, source, asset, page):
    import pypdfium2 as pdfium
    if asset.media_type != "application/pdf":
        raise DomainError("此来源不是PDF")
    with _PDF_RENDER_LOCK, ExitStack() as cleanup:
        document = pdfium.PdfDocument(asset.path)
        cleanup.callback(document.close)
        if page < 1 or page > len(document):
            raise DomainError("页码超出范围")
        pdf_page = document[page - 1]
        cleanup.callback(pdf_page.close)
        width,height = pdf_page.get_size()
        if not all(math.isfinite(value) and value > 0 for value in (width,height)):
            raise DomainError("此PDF页尺寸无效")
        scale = min(1.4, 2000 / max(width,height))
        bitmap = pdf_page.render(scale=scale)
        cleanup.callback(bitmap.close)
        image = bitmap.to_pil()
        cleanup.callback(image.close)
        output = io.BytesIO()
        image.save(output, format="PNG")
        data = output.getvalue()
        if len(data) > 8 * 1024 * 1024:
            raise DomainError("此页图像超过8MB，请使用文字片段或其它清楚的图示")
        return base64.b64encode(data).decode()
