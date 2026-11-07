"""Optional public Bili discovery using yt-dlp's fresh anonymous session.

Search metadata only. No account cookies, model calls, media downloads or new
fact store. The Agent's existing source reader decides what to read afterwards.
"""
import asyncio
import io
import itertools
import json
import os
import re
import threading
import uuid
from html import unescape
from urllib.parse import urlsplit

from .domain import DomainError
from .knowledge import download_public

SEARCH_BODY_LIMIT = 1024 * 1024
SEARCH_TIMEOUT_SECONDS = 15


def _sdk_types():
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.extractor.bilibili import BiliBiliSearchIE
        from yt_dlp.networking.common import Request, Response
    except ImportError:
        raise DomainError("B站公开搜索需要现有可选video组件中的yt-dlp", 503) from None
    return YoutubeDL, BiliBiliSearchIE, Request, Response


class _Quiet:
    def debug(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


class _PageLimitReached(Exception):
    """Stop a lazy SDK iterator without another search-page HTTP request."""


def _text(value, limit):
    if not isinstance(value, str):
        return ""
    return re.sub(r"<[^>]+>", "", unescape(value)).strip()[:limit]


def _search_sync(query, limit, cancel_event):
    YoutubeDL, BiliBiliSearchIE, Request, Response = _sdk_types()
    calls, raw_rows = 0, []
    page_bound_reached = False

    class PinnedSearch(YoutubeDL):
        def build_request_director(self, *args, **kwargs):
            raise DomainError("社区搜索备用网络已禁用", 502)

        def urlopen(self, request):
            nonlocal calls, raw_rows
            if cancel_event.is_set():
                raise asyncio.CancelledError()
            if isinstance(request, str):
                request = Request(request)
            if not isinstance(request, Request):
                raise DomainError("社区搜索请求类型无效", 422)
            parsed = urlsplit(request.url)
            if (request.method != "GET" or request.data is not None or parsed.scheme != "https"
                    or parsed.hostname != "api.bilibili.com"
                    or parsed.path != "/x/web-interface/search/type"):
                raise DomainError("社区搜索仅允许指定公开搜索GET", 422)
            if calls >= 1:
                raise _PageLimitReached()
            cookies = self.cookiejar.get_cookies_for_url(request.url)
            if len(cookies) != 1 or cookies[0].name != "buvid3" or cookies[0].domain != ".bilibili.com":
                raise DomainError("社区搜索只允许本次新建的匿名会话标识", 422)
            value = cookies[0].value
            try:
                if not value.endswith("infoc") or uuid.UUID(value[:-5]).version != 4:
                    raise ValueError()
            except (ValueError, AttributeError):
                raise DomainError("社区搜索匿名标识不是本次预期的随机UUID", 422) from None
            calls += 1
            # Never accept headers from the Agent/extractor. This one identifier
            # came from the fresh empty SDK jar, not a cookie file or browser.
            headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/",
                       "Cookie": self.cookiejar.get_cookie_header(request.url)}
            final, content_type, body = asyncio.run(asyncio.wait_for(download_public(
                request.url, max_bytes=SEARCH_BODY_LIMIT, headers=headers, same_origin=True,
                cancel_event=cancel_event),
                timeout=SEARCH_TIMEOUT_SECONDS))
            if len(body) > SEARCH_BODY_LIMIT:
                raise DomainError("社区搜索响应超过1MiB上限", 422)
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError):
                raise DomainError("社区搜索未取得可读JSON；没有尝试登录或验证码", 502) from None
            if not isinstance(payload, dict) or payload.get("code") != 0:
                raise DomainError("B站公开搜索受限或未完成；没有尝试认证或替代签名", 502)
            data = payload.get("data")
            if not isinstance(data, dict) or not isinstance(data.get("result"), list):
                raise DomainError("B站搜索响应缺少真实结果列表", 502)
            raw_rows = data["result"]
            # HTTPX already decoded the body. Do not forward Content-Encoding,
            # Set-Cookie or other origin headers into the SDK a second time.
            return Response(io.BytesIO(body), final,
                            {"Content-Type": content_type, "Content-Length": str(len(body))})

    try:
        with PinnedSearch({"quiet": True, "logger": _Quiet(), "cachedir": False,
                "skip_download": True, "extract_flat": True, "extractor_retries": 0,
                "retries": 0, "proxy": "", "cookiefile": None, "cookiesfrombrowser": None},
                auto_init=False) as downloader:
            if list(downloader.cookiejar):
                raise DomainError("社区搜索拒绝读取已有CookieJar", 422)
            downloader.add_info_extractor(BiliBiliSearchIE())
            info = downloader.extract_info(f"bilisearch{limit}:{query}", download=False,
                                           process=False, ie_key="BiliBiliSearch")
            entries = []
            try:
                for entry in itertools.islice(info.get("entries", []), limit):
                    entries.append(entry)
            except _PageLimitReached:
                page_bound_reached = True
    except DomainError:
        raise
    except Exception:
        # SDK errors can include request URLs/session details; don't echo them.
        raise DomainError("B站公开搜索未完成；未借用账号、代理或绕过访问限制", 502) from None

    selected_ids = {str(entry.get("id")) for entry in entries if isinstance(entry, dict)}
    results, seen = [], set()
    for row in raw_rows:
        if not isinstance(row, dict) or str(row.get("aid")) not in selected_ids:
            continue
        bvid = row.get("bvid")
        if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid) or bvid in seen:
            continue
        seen.add(bvid)
        result = {"url": f"https://www.bilibili.com/video/{bvid}/", "bvid": bvid,
                  "platform": "bilibili", "content_level": "search_metadata_not_video_observation"}
        for source_key, target_key, max_chars in [("title", "title", 300), ("author", "author", 120),
                                                  ("description", "description", 350)]:
            text = _text(row.get(source_key), max_chars)
            if text:
                result[target_key] = text
        results.append(result)
        if len(results) >= limit:
            break
    return {"provider": "bilibili_public_anonymous_search", "query": query, "results": results,
            "evidence_kind": "search_result_not_full_document", "search_pages_read": calls,
            "search_page_limit_reached": page_bound_reached,
            "additional_results_not_read": len(raw_rows) > len(entries),
            "reading_note": "仅取得B站公开搜索标题、作者或简介；未读视频页面、未观看视频。需用现有来源工具继续取得原文或有界画面。"}


async def search_bilibili(query: str, limit: int = 5, *, requester=None):
    """One public search page, at most five real video metadata results."""
    if not isinstance(query, str) or not query.strip() or len(query.strip()) > 200:
        raise DomainError("社区搜索关键词须为1至200字", 422)
    if any(ord(character) < 32 for character in query):
        raise DomainError("社区搜索关键词不能含控制字符", 422)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 5:
        raise DomainError("社区搜索仅返回1至5条线索", 422)
    provider = os.getenv("WUJIAN_COMMUNITY_PROVIDER", "yt-dlp")
    if provider == "mediacrawler" or requester is not None:
        from .mediacrawler_adapter import request_public
        value = await (requester or request_public)({"operation": "search", "query": query.strip(), "limit": limit})
        results, seen = [], set()
        for row in value.get("items", [])[:limit]:
            bvid = row.get("bvid")
            if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid) or bvid in seen:
                continue
            seen.add(bvid)
            result = {"url": f"https://www.bilibili.com/video/{bvid}/", "bvid": bvid,
                      "platform": "bilibili", "content_level": "search_metadata_not_video_observation"}
            for key, max_chars in (("title", 300), ("author", 120), ("description", 350)):
                text = _text(row.get(key), max_chars)
                if text:
                    result[key] = text
            results.append(result)
        return {"provider": "mediacrawler_public_bilibili_client", "query": query.strip(), "results": results,
                "evidence_kind": "search_result_not_full_document", "search_pages_read": 1,
                "reading_note": "MediaCrawler只读搜索返回元数据；不是已观察视频或学会完整做法。"}
    if provider != "yt-dlp":
        raise DomainError("WUJIAN_COMMUNITY_PROVIDER须为yt-dlp或mediacrawler", 503)
    cancel_event = threading.Event()
    try:
        return await asyncio.to_thread(_search_sync, query.strip(), limit, cancel_event)
    except asyncio.CancelledError:
        # A thread cannot recall an in-flight HTTP request. The shared reader
        # cooperatively stops before another hop or consuming further chunks.
        cancel_event.set()
        raise
