"""Read Schema.org HowTo data already present in an original response.

This is extraction, not approval of the instructions. No script execution,
network requests or site-specific browser automation is performed here.
"""
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup


def is_howto(value):
    kind = value.get("@type") if isinstance(value, dict) else None
    return kind == "HowTo" or isinstance(kind, list) and "HowTo" in kind


def extract_howto(value, base_url):
    """Return ordered text, declared links and image hints within small bounds."""
    lines, links, images = [], [], []
    seen_images = set()
    count = 0
    visited = 0

    def clean(raw, limit=2400):
        if not isinstance(raw, str):
            return ""
        fragment = BeautifulSoup(raw[:20000], "html.parser")
        for node in fragment.select("script,style,noscript"):
            node.decompose()
        return fragment.get_text(" ", strip=True)[:limit]

    def public_url(raw):
        if not isinstance(raw, str) or len(raw) > 4000:
            return None
        try:
            target = urljoin(base_url, raw)
            parsed = urlsplit(target)
            return target if parsed.scheme in {"http", "https"} and parsed.hostname and not (parsed.username or parsed.password) else None
        except ValueError:
            return None

    def image(raw, label):
        for entry in (raw if isinstance(raw, list) else [raw])[:4]:
            if isinstance(entry, dict):
                entry = entry.get("contentUrl") or entry.get("url")
            target = public_url(entry)
            if target and target not in seen_images and len(images) < 24:
                seen_images.add(target)
                images.append({"url": target, "alt": label[:300], "origin": "howto_jsonld"})

    def names(raw):
        result = []
        for entry in (raw if isinstance(raw, list) else [raw])[:30]:
            result.append(clean(entry.get("name") or entry.get("text")) if isinstance(entry, dict) else clean(entry))
        return "；".join(name for name in result if name)

    def steps(raw, prefix="", depth=0):
        nonlocal count, visited
        if depth > 6:
            return
        entries = raw if isinstance(raw, list) else [raw]
        for index, entry in enumerate(entries[:40], 1):
            if count >= 40 or visited >= 200:
                return
            visited += 1
            number = f"{prefix}.{index}" if prefix else str(index)
            if isinstance(entry, str):
                text = clean(entry)
                if text:
                    count += 1
                    lines.append(f"HowTo 步骤 {number}: {text}")
            elif isinstance(entry, dict):
                name, text = clean(entry.get("name"), 300), clean(entry.get("text"))
                children = entry.get("step") or entry.get("itemListElement")
                if name or text:
                    count += 1
                    lines.append(f"HowTo 步骤 {number}: {name}" + (f" — {text}" if text else ""))
                target = public_url(entry.get("url") or entry.get("@id"))
                if target and len(links) < 40:
                    links.append({"url": target, "title": f"原文步骤 {number}：{name}"})
                image(entry.get("image"), f"原页面声明的步骤 {number} 配图：{name}（未观察）")
                if children:
                    steps(children, number, depth + 1)

    if not is_howto(value):
        return lines, links, images
    lines.append("[原页面结构化 HowTo；步骤文字和配图指针，不代表已观察配图或已验证适用性]")
    for key, label in (("supply", "所需材料"), ("tool", "所需工具")):
        text = names(value.get(key))
        if text:
            lines.append(f"HowTo {label}: {text}")
    image(value.get("image"), "原页面声明的 HowTo 成品配图（未观察）")
    steps(value.get("step") or value.get("steps") or value.get("itemListElement"))
    if count >= 40 or visited >= 200:
        lines.append("[HowTo 步骤提取达到有界上限；未提取部分保持未知]")
    return lines, links, images
