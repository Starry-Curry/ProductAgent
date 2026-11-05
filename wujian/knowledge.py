"""Bailian search with observable search calls, plus bounded source reading."""
import asyncio
import base64
import io
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from openai import AsyncOpenAI
from pypdf import PdfReader
from sqlalchemy import select

from .database import Asset, SourceRecord, uid
from .domain import DomainError, accessible_item
from .source_content import parse_public_text, public_image_candidates
from .public_network import resolve_public_url
from .source_access import readable_source


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
        if url:
            previous=results.get(url,{"url":url})
            results[url]={**previous,**{key:source[key] for key in ("url","title") if source.get(key)}}
    for call in calls:
        for source in call.get("action", {}).get("sources", []):
            add(source)
    for block in output:
        if block.get("type") != "message":
            continue
        for part in block.get("content", []):
            if part.get("type") == "output_text":
                for annotation in part.get("annotations", []):
                    add(annotation)
    return {"provider": "bailian_responses_web_search", "query": query,
            "observed_queries": [call.get("action",{}).get("query") for call in calls
                                 if isinstance(call.get("action",{}).get("query"),str)],
            "results": list(results.values())[:15],
            "evidence_kind": "search_result_not_full_document",
            "reading_note":"只取得搜索线索，尚未读取这些网页；请取得适用原文后分析。"}


async def validate_public_url(url):
    return await resolve_public_url(url)


async def download_public(url, *, max_bytes=12 * 1024 * 1024, headers=None):
    # Public-source reads must not silently inherit an unrelated machine proxy.
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False,
                                 limits=httpx.Limits(max_keepalive_connections=0),
                                 headers={"User-Agent": "WujianResearch/0.1"}) as client:
        for _ in range(5):
            original, addresses = await validate_public_url(url)
            # Pin the checked address: there is no second system DNS lookup,
            # while Host and TLS verification still use the original domain.
            pinned = original.copy_with(host=addresses[0])
            client.cookies.clear()
            async with client.stream("GET", pinned, headers={**(headers or {}),"Host": original.netloc.decode("ascii")},
                                     extensions={"sni_hostname": original.raw_host.decode("ascii")}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    url = urljoin(str(original), response.headers.get("location", ""))
                    continue
                if response.status_code in {401, 403, 412, 429}:
                    raise DomainError(f"公开资料读取受限（HTTP {response.status_code}）；未登录或绕过限制，请换公开来源", 502)
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise DomainError(f"资料超过当前单文件{max_bytes // (1024 * 1024)}MB限制")
                return str(original), response.headers.get("content-type", ""), bytes(data)
    raise DomainError("资料重定向过多", 502)


def parse_document(data, content_type, url):
    if data.startswith(b"%PDF") or "application/pdf" in content_type:
        reader = PdfReader(io.BytesIO(data))
        pages = [{"page": index + 1, "text": (page.extract_text() or "")[:16000]} for index, page in enumerate(reader.pages[:160])]
        return "\n\n".join(f"[第{page['page']}页]\n{page['text']}" for page in pages), pages, [], "application/pdf", "PDF资料"
    content, links, media_type, title = parse_public_text(data, content_type, url)
    return content, [], links, media_type, title


async def fetch_source(settings, sessions, user_id, url, item_id=None, refresh=False, *, excerpt_chars=12000):
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
            if asset and asset.media_type != "application/pdf":
                path = Path(asset.path)
                if path.is_file():
                    _, _, links, _, _ = parse_document(path.read_bytes(), asset.media_type, existing.url)
                    result["links"] = links
            return result
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
        return {**source_excerpt(source, max_chars=excerpt_chars), "links": links,
                "images": source_images(source, asset)}


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


def source_excerpt(source, query="", page=None, *, max_chars=12000):
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
    numbered = '\n'.join(f'{first_line+i}: {line}' for i,line in enumerate(text[:max_chars].splitlines()))
    return {"source_id": source.id, "title": source.title, "url": source.url,
            "fetched_at": source.fetched_at, "text": numbered, "page": page,
            "line_numbered":True,"first_line":first_line,
            "page_count": len(source.pages), "original_asset_id": source.asset_id,
            "truncated": len(text) > max_chars, "evidence_kind": "retrieved_document",
            "query_matched": query.casefold() in source.content.casefold() if query else None,
            "content_level": source_content_level(source)}


def source_content_level(source):
    """Evidence granularity, not a claim that the source's advice is correct."""
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
