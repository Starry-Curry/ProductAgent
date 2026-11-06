"""Read public document content, including metadata lost by plain HTML stripping.

This is not a video downloader or a browser/login client. Only text actually in
the downloaded response is extracted; embedded JavaScript is never executed.
"""
import json
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, UnicodeDammit
from .source_howto import extract_howto, is_howto


MAX_CONTENT = 300000


def public_image_candidates(data, url, limit=6):
    """Small, source-bound image hints; no download or image interpretation."""
    soup = BeautifulSoup(data, "html.parser")
    candidates, seen = [], set()
    title = soup.title.get_text(" ", strip=True) if soup.title else ""

    def add(value, alt="", origin="html_image"):
        if not isinstance(value, str):
            return
        target = urljoin(url, value.strip())
        parsed = urlsplit(target)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return
        if parsed.path.lower().endswith((".svg", ".gif", ".ico")) or target in seen:
            return
        seen.add(target)
        priority = 0 if origin == "page_image_metadata" else 1 if origin in {"product_jsonld", "howto_jsonld"} else 2 if isinstance(alt, str) and len(alt) > 2 and alt in title else 3
        candidates.append({"url": target, "alt": _text(alt, 300), "origin": origin, "_priority": priority})

    for node in soup.select('meta[property="og:image"],meta[name="twitter:image"]')[:4]:
        add(node.get("content"), "页面声明的代表图片（未观察）", "page_image_metadata")

    def visit(value, depth=0):
        if depth > 6 or len(candidates) >= 12:
            return
        if isinstance(value, list):
            for child in value[:30]:
                visit(child, depth + 1)
        elif isinstance(value, dict):
            if is_howto(value):
                for entry in extract_howto(value, url)[2]:
                    add(entry["url"], entry["alt"], entry["origin"])
            kind = value.get("@type")
            if kind == "Product" or (isinstance(kind, list) and "Product" in kind):
                images = value.get("image", [])
                for entry in (images if isinstance(images, list) else [images])[:6]:
                    if isinstance(entry, dict):
                        add(entry.get("url") or entry.get("contentUrl"), entry.get("caption") or value.get("name", ""), "product_jsonld")
                    else:
                        add(entry, value.get("name", ""), "product_jsonld")
            for key in ("@graph", "mainEntity"):
                visit(value.get(key), depth + 1)

    for script in soup.select('script[type="application/ld+json"]')[:20]:
        try:
            visit(json.loads((script.string or "")[:2000000]))
        except (ValueError, RecursionError):
            continue
    for node in soup.select('[itemprop="image"],main img,article img')[:80]:
        if node.find_parent(["aside", "nav", "header", "footer"]):
            continue
        if any(re.search(r"recommend|related|(?:^|[-_])(?:header|footer|promotion)(?:[-_]|$)", " ".join(parent.get("class", [])), re.I)
               for parent in [node, *list(node.parents)[:4]] if getattr(parent, "attrs", None)):
            continue
        add(node.get("src") or node.get("data-src") or node.get("content"), node.get("alt", ""))
    return [{key: value for key, value in candidate.items() if key != "_priority"}
            for candidate in sorted(candidates, key=lambda candidate: candidate["_priority"])[:limit]]


def _text(value, limit=16000):
    return value[:limit] if isinstance(value, str) else ""


def _preserve_preformatted(soup):
    # Syntax highlighters wrap flags/names in inline spans. Joining every text
    # node with a newline would turn one command into several invalid commands.
    for node in soup.select("pre"):
        for line_break in node.select("br"):
            line_break.replace_with("\n")
        node.replace_with("\n" + node.get_text("", strip=False) + "\n")


def _embedded_state(soup, name):
    for script in soup.find_all("script"):
        raw = script.string or ""
        if len(raw) > 2000000:
            continue
        match = re.search(r"(?:window\.)?" + re.escape(name) + r"\s*=\s*", raw)
        if match:
            try:
                value, _ = json.JSONDecoder().raw_decode(raw[match.end():].lstrip())
                return value if isinstance(value, dict) else {}
            except (ValueError, RecursionError):
                # Some sites emit JavaScript (e.g. undefined), not JSON. Do not
                # eval it or pretend we successfully read the missing fields.
                continue
    return {}


def _structured_metadata(soup, url):
    lines, links = [], []
    seen = set()
    video_meta_descriptions = []
    host = (urlsplit(url).hostname or "").lower()
    is_bilibili = (host == "bilibili.com" or host.endswith(".bilibili.com")) and urlsplit(url).path.startswith("/video/")

    def add(label, value):
        value = _text(value)
        if value and (label, value) not in seen:
            seen.add((label, value))
            lines.append(f"{label}: {value}")

    for node in soup.select("meta[property],meta[name]"):
        key = node.get("property") or node.get("name")
        # Bilibili's SEO description concatenates the current description,
        # engagement counters and OTHER recommended videos. Those titles are
        # not evidence about this video/model. Canonical JSON-LD/videoData
        # descriptions below preserve the actual uploader text.
        if is_bilibili and key in {"description", "og:description"}:
            video_meta_descriptions.append(node.get("content", ""))
            continue
        if key in {"description", "og:title", "og:description", "og:type", "og:site_name",
                   "article:published_time", "author", "duration"}:
            add(key, node.get("content"))

    def jsonld(value, depth=0):
        if depth > 8:
            return
        if isinstance(value, list):
            for child in value[:80]:
                jsonld(child, depth + 1)
        elif isinstance(value, dict):
            if is_howto(value):
                howto_lines, howto_links, _ = extract_howto(value, url)
                lines.extend(howto_lines)
                links.extend(howto_links)
            for key in ("headline", "name", "description", "articleBody", "uploadDate", "datePublished", "duration"):
                add("JSON-LD " + key, value.get(key))
            kind = value.get("@type")
            if kind == "Question" or (isinstance(kind, list) and "Question" in kind):
                answers = value.get("acceptedAnswer", [])
                for answer in (answers if isinstance(answers, list) else [answers])[:20]:
                    if isinstance(answer, dict) and isinstance(answer.get("text"), str):
                        fragment = BeautifulSoup(answer["text"][:16000], "html.parser")
                        for node in fragment.select("script,style,noscript"):
                            node.decompose()
                        _preserve_preformatted(fragment)
                        add("JSON-LD 回答", fragment.get_text("\n", strip=True))
            for key in ("@graph", "hasPart", "mainEntity", "video"):
                jsonld(value.get(key), depth + 1)

    for script in soup.select('script[type="application/ld+json"]')[:20]:
        try:
            jsonld(json.loads((script.string or "")[:2000000]))
        except (ValueError, RecursionError):
            pass

    if is_bilibili:
        state = _embedded_state(soup, "__INITIAL_STATE__")
        video = state.get("videoData") or {}
        if isinstance(video, dict):
            for key in ("title", "desc", "bvid"):
                add("B站公开视频 " + key, video.get(key))
            for page in (video.get("pages") or [])[:100]:
                if not isinstance(page, dict):
                    continue
                part = _text(page.get("part"), 500)
                number = page.get("page")
                if isinstance(number, int) and number > 0:
                    add("分P标题（不是字幕）", f"P{number}: {part}")
                    links.append({"title": f"P{number}: {part}", "url": url.split("?")[0] + f"?p={number}"})
        if not any(line.startswith(("JSON-LD description:", "B站公开视频 desc:")) for line in lines):
            # Some older public pages expose only meta text. Retain that
            # description, excluding known SEO counters/recommendation suffixes.
            for description in video_meta_descriptions:
                if isinstance(description, str):
                    description = re.split(r"[,，]?\s*(?:相关视频[:：]|视频播放量)", description, maxsplit=1)[0].strip(" ,，")
                    if description and description != "-":
                        add("公开页面meta简介（非字幕）", description)
                        break
        if lines:
            add("读取范围", "仅取得公开网页文字、描述或分P信息；没有观看视频、识别画面或读取未返回的字幕。")
    elif host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com"):
        state = _embedded_state(soup, "__INITIAL_STATE__")
        note_data = state.get("note", {})
        note_map = note_data.get("noteDetailMap", {}) if isinstance(note_data, dict) else {}
        if isinstance(note_map, dict):
            for record in list(note_map.values())[:5]:
                note = record.get("note", {}) if isinstance(record, dict) else {}
                if isinstance(note, dict):
                    add("小红书公开笔记标题", note.get("title"))
                    add("小红书公开笔记文字", note.get("desc"))
        if lines:
            add("读取范围", "只读取本次公开响应包含的笔记文字或元描述；没有登录、读取评论或观看图片与视频。")
    return lines, links


def _support_json_articles(soup, url):
    """Read Xiaomi's public support PageData, not arbitrary script fields.

    The support page returns FAQ HTML inside a strictly JSON main_body value,
    while the surrounding $GLOBAL_PAGE assignment is JavaScript. Decode only
    PageData's JSON object and visit its explicit article containers.
    """
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if not (host == "mi.com" or host.endswith(".mi.com")) or not parsed.path.startswith("/service/"):
        return [], []
    articles, links = [], []

    def visit(value, depth=0):
        if depth > 8 or len(articles) >= 100:
            return
        if isinstance(value, list):
            for child in value[:100]:
                visit(child, depth + 1)
        elif isinstance(value, dict):
            name, content = value.get("name"), value.get("content")
            if isinstance(name, str) and isinstance(content, str) and content.strip():
                fragment = BeautifulSoup(content[:100000], "html.parser")
                for node in fragment.select("script,style,noscript"):
                    node.decompose()
                _preserve_preformatted(fragment)
                text = fragment.get_text("\n", strip=True)
                if text:
                    articles.append(f"{_text(name, 500)}\n{text}")
                    for node in fragment.select("a[href],img[src]")[:30]:
                        target = urljoin(url, node.get("href") or node.get("src") or "")
                        if urlsplit(target).scheme in {"http", "https"}:
                            links.append({"title": node.get("alt") or node.get_text(" ", strip=True) or f"原文配图：{name[:100]}", "url": target})
            for key in ("section", "body"):
                visit(value.get(key), depth + 1)

    for script in soup.find_all("script")[:100]:
        raw = script.string or ""
        if len(raw) > 2000000 or "$GLOBAL_PAGE" not in raw:
            continue
        match = re.search(r"\bPageData\s*:\s*", raw)
        if not match:
            continue
        try:
            state, _ = json.JSONDecoder().raw_decode(raw[match.end():].lstrip())
        except (ValueError, RecursionError):
            continue
        if isinstance(state, dict):
            visit(state.get("main_body"))
    return articles, links


def parse_public_text(data, content_type, url):
    """Return (content, links, media_type, title) without network or execution."""
    media_type = content_type.split(";", 1)[0].lower().strip()
    # Public pages often omit a charset. The detector misidentified an actual
    # valid UTF-8 Chinese page as CP775, corrupting its title and evidence.
    # BeautifulSoup still owns BOM/legacy-encoding fallback; prefer UTF-8 when
    # it decodes strictly instead of trusting statistical guessing first.
    decoded = UnicodeDammit(data, known_definite_encodings=["utf-8"],
                            is_html=media_type in {"text/html","application/xhtml+xml"}).unicode_markup or ""
    if not decoded.strip():
        return "", [], media_type or "text/plain", url
    if media_type in {"application/json", "application/ld+json"} or decoded.lstrip().startswith(("{", "[")):
        try:
            value = json.loads(decoded)
        except (ValueError, RecursionError):
            value = None
        if value is not None:
            # Bilibili's public subtitle resource is JSON, not HTML. It remains
            # a distinct original source with its own timing and URL.
            body = value.get("body") if isinstance(value, dict) else None
            if isinstance(body, list) and body and all(isinstance(line, dict) and "content" in line for line in body[:100]):
                lines = ["[公开字幕文本；未观看视频画面]"]
                for line in body[:5000]:
                    if isinstance(line, dict):
                        lines.append(f"[{line.get('from', '?')}–{line.get('to', '?')}秒] {_text(line.get('content'))}")
                return "\n".join(lines)[:MAX_CONTENT], [], "application/json", "公开字幕文本"
            return json.dumps(value, ensure_ascii=False, indent=2)[:MAX_CONTENT], [], "application/json", "JSON资料"
    if media_type.startswith("text/") and media_type not in {"text/html", "text/xml"}:
        # Keep Markdown/code literal: HTML stripping corrupts <target> and
        # shell redirections. Only extract navigation alongside the original.
        links = []
        for title, target in re.findall(r"\[([^\]\n]{1,180})\]\(([^\s)]+)\)", decoded[:MAX_CONTENT]):
            target = urljoin(url, target)
            if urlsplit(target).scheme in {"http", "https"}:
                links.append({"title": title, "url": target})
        return decoded[:MAX_CONTENT], links[:100], media_type, urlsplit(url).path.rsplit("/", 1)[-1] or "文本资料"
    if media_type and media_type not in {"text/html", "application/xhtml+xml", "text/xml", "application/xml"}:
        from .domain import DomainError
        raise DomainError("此资料格式尚不能读取；请选择公开网页、PDF、JSON或文本资料", 422)
    soup = BeautifulSoup(data, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else urlsplit(url).hostname
    if isinstance(title, str) and (title.casefold().startswith(("log in -", "login -", "sign in -"))
                                  or title.strip() in {"安全验证", "访问验证", "验证码", "登录后查看", "登录"}):
        from .domain import DomainError
        raise DomainError("资料返回登录或验证页面，没有取得原文；请换公开来源", 422)
    metadata, links = _structured_metadata(soup, url)
    articles, article_links = _support_json_articles(soup, url)
    links.extend(article_links)
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    is_video = (host == "bilibili.com" or host.endswith(".bilibili.com")) and parsed.path.startswith("/video/")
    # A real video response had 472 chars of relevant text but 5,281 chars of
    # navigation/recommended links. Those are not the uploader's references.
    # Keep canonical parts above and explicit description links, not the feed.
    anchors = soup.select(".basic-desc-info a[href],.desc-info-text a[href],.video-desc a[href]") if is_video else soup.select("a[href]")
    for anchor in anchors:
        if anchor.find_parent(["nav", "aside", "header", "footer"]):
            continue
        target = urljoin(url, anchor.get("href", ""))
        if urlsplit(target).scheme in {"http", "https"}:
            links.append({"title": anchor.get_text(" ", strip=True)[:120], "url": target})
    for node in soup.select("script,style,noscript,nav,footer,header,title"):
        node.decompose()
    _preserve_preformatted(soup)
    body = ("[公开页面内嵌正文 JSON：问题与回答；未执行脚本]\n" + "\n\n".join(articles)) if articles else "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
    if is_video and metadata:
        # Keep the canonical description/parts, not recommendations and account
        # controls from the surrounding DOM. The original response is retained.
        body = "[本次读取标题、公开简介与分P信息；完整原始网页已保存，不包含视频画面观察。]"
    if (host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")) and re.match(r"/(?:explore/|discovery/item/)[^/]+", parsed.path):
        has_note_text = any(line.startswith(("小红书公开笔记文字:", "JSON-LD articleBody:")) for line in metadata)
        gate = any(phrase in body for phrase in ("登录后查看", "扫码登录", "登录查看更多", "登录即可查看"))
        if gate and not has_note_text:
            from .domain import DomainError
            raise DomainError("笔记返回登录提示，没有取得笔记原文；请换公开来源", 422)
    content = ("[公开页面元数据；描述不等于已验证操作]\n" + "\n".join(metadata) + "\n\n" if metadata else "") + body
    unique = {link["url"]: link for link in links}
    return content[:MAX_CONTENT], list(unique.values())[:100], "text/html", title
