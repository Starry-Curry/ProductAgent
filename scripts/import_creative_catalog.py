"""Validate/import editor-authored inspiration references into existing SQL sources.

The catalog is reviewed public reference material, not user memory, an item
capability assertion, a video transcript, or a physical success record. Import
requires the exact original sources already owned by the target user. The CLI
is dry-run by default and backs up the existing SQLite database before --apply.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from wujian import domain
from wujian.config import Settings
from wujian.database import SourceRecord, User
from wujian.source_access import readable_source

SCHEMA = "wujian-creative-reference/1"
EVIDENCE_LEVELS = {
    "metadata_direction_editorial_proposal",
    "primary_document_mechanism_editorial_application",
}
ORIGIN = "curated_reference"
RETIRED_ORIGIN = "curated_reference_retired"
DISCLAIMER = "[Codex编者整理灵感参考；不是原作者步骤、用户经历或实物成功记录]"


def _text(value, label, *, minimum=1, maximum=2000):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise ValueError(f"Invalid {label}")
    return value.strip()


def _strings(value, label, *, minimum=1, maximum=20):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError(f"Invalid {label} list")
    for part in value:
        _text(part, label)
    if len(set(value)) != len(value):
        raise ValueError(f"Duplicate {label}")


def read_catalog(path):
    body = Path(path).read_bytes()
    catalog = json.loads(body)
    if catalog.get("schema") != SCHEMA:
        raise ValueError("Unsupported creative catalog schema")
    if catalog.get("authorship") != "codex_editorial_not_original_author":
        raise ValueError("Catalog authorship must be explicit")
    refs, entries = catalog.get("references"), catalog.get("entries")
    if not isinstance(refs, dict) or not refs or not isinstance(entries, list) or not 1 <= len(entries) <= 300:
        raise ValueError("Expected bounded references and entries")
    for key, ref in refs.items():
        _text(key, "reference key")
        _text(ref.get("original_source_id"), "original_source_id", maximum=100)
        _text(ref.get("title"), "reference title", maximum=1000)
        _text(ref.get("reading_scope"), "reading_scope")
        if ref.get("evidence_level") not in {"metadata_only", "primary_document_text"}:
            raise ValueError("Invalid original reference evidence level")
        if not re.fullmatch(r"[a-f0-9]{64}", ref.get("content_sha256", "")):
            raise ValueError("Expected original source content SHA256")
        parsed = urlsplit(ref.get("url", ""))
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Expected public HTTPS reference")
    keys, signatures = set(), set()
    for entry in entries:
        key = _text(entry.get("key"), "entry key", maximum=100)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", key) or key in keys:
            raise ValueError("Invalid/duplicate entry key")
        keys.add(key)
        for field in ("title", "category", "scene", "mechanism", "first_step", "observe", "source_basis"):
            _text(entry.get(field), field, minimum=2)
        for field in ("resources", "unknowns", "tags", "reference_keys"):
            _strings(entry.get(field), field)
        if entry.get("evidence_level") not in EVIDENCE_LEVELS:
            raise ValueError("Invalid editorial evidence level")
        if entry.get("physical_validation") is not False:
            raise ValueError("Catalog cannot assert physical validation")
        if any(key not in refs for key in entry["reference_keys"]):
            raise ValueError("Missing original reference")
        levels = {refs[key]["evidence_level"] for key in entry["reference_keys"]}
        if (entry["evidence_level"] == "primary_document_mechanism_editorial_application"
                and "primary_document_text" not in levels):
            raise ValueError("Metadata cannot be promoted to primary-document mechanism evidence")
        signature = tuple(re.sub(r"\s", "", entry[field]).casefold()
                          for field in ("mechanism", "first_step"))
        if signature in signatures:
            raise ValueError("Duplicate mechanism and first step")
        signatures.add(signature)
    retired_keys = set()
    for retired in catalog.get("retired_entries", []):
        key = _text(retired.get("key"), "retired key", maximum=100)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", key) or key in keys or key in retired_keys:
            raise ValueError("Invalid/duplicate active or retired key")
        retired_keys.add(key)
        _text(retired.get("reason"), "retirement reason", minimum=2)
        if not re.fullmatch(r"[a-f0-9]{64}", retired.get("expected_content_sha256", "")):
            raise ValueError("Retirement requires the reviewed old content SHA256")
    return catalog, hashlib.sha256(body).hexdigest()


def render_entry(entry, references):
    """Keep the actual mechanism/resources within existing 1200-char search excerpts."""
    lines = [DISCLAIMER, f"玩法：{entry['title']}；场景：{entry['scene']}",
             "资源条件：" + "；".join(entry["resources"]),
             "机制（编者解释）：" + entry["mechanism"],
             "第一步（编者待试方案）：" + entry["first_step"],
             "先观察：" + entry["observe"],
             "未知与边界：" + "；".join(entry["unknowns"]),
             "证据等级：" + entry["evidence_level"],
             "来源支持范围：" + entry["source_basis"],
             "检索词：" + " / ".join(entry["tags"])]
    for key in entry["reference_keys"]:
        ref = references[key]
        lines.append(f"原始资料 [{ref['original_source_id']}] {ref['title']} {ref['url']}；"
                     f"实际读取：{ref['reading_scope']}；content_sha256={ref['content_sha256']}")
    lines.append("本条编者档案：" + entry["key"] + "；" + SCHEMA)
    return "\n".join(lines)


def import_catalog(db, user_id, path, *, apply=False):
    catalog, digest = read_catalog(path)
    domain.require(db.get(User, user_id), "Target user does not exist")
    # Validate every provenance link and every conflict before the first write.
    for ref in catalog["references"].values():
        original = readable_source(db, user_id, ref["original_source_id"])
        if original.owner_id != user_id or original.origin != "public_web":
            raise ValueError("Original references must be target-owned public_web SQL records")
        if (original.url != ref["url"] or original.title != ref["title"]
                or hashlib.sha256(original.content.encode()).hexdigest() != ref["content_sha256"]):
            raise ValueError("Original source identity/content does not match catalog provenance")
        parsed = urlsplit(original.url)
        host = (parsed.hostname or "").lower()
        is_bilibili = host == "bilibili.com" or host.endswith(".bilibili.com")
        if is_bilibili and ref["evidence_level"] != "metadata_only":
            raise ValueError("Video page metadata is not video observation or a primary tutorial")
    pending, reused, ids = [], [], {}
    retire, retired_reused, retired_missing = [], [], []
    for entry in catalog["entries"]:
        identity = uuid5(NAMESPACE_URL, f"{SCHEMA}/{user_id}/{entry['key']}").hex
        content = render_entry(entry, catalog["references"])
        title = "灵感参考｜" + entry["title"]
        url = catalog["references"][entry["reference_keys"][0]]["url"]
        old = db.get(SourceRecord, identity)
        if old:
            if (old.owner_id, old.origin, old.title, old.url, old.content) != (user_id, ORIGIN, title, url, content):
                raise ValueError("Existing immutable catalog key differs; review a new revision/key instead of overwriting")
            reused.append(entry["key"])
        else:
            pending.append(SourceRecord(id=identity, owner_id=user_id, origin=ORIGIN,
                                        item_id=None, title=title, url=url, content=content, pages=[]))
        ids[entry["key"]] = identity
    for row in catalog.get("retired_entries", []):
        identity = uuid5(NAMESPACE_URL, f"{SCHEMA}/{user_id}/{row['key']}").hex
        old = db.get(SourceRecord, identity)
        if not old:
            retired_missing.append(row["key"])
            continue
        if (old.owner_id != user_id or old.origin not in {ORIGIN, RETIRED_ORIGIN}
                or hashlib.sha256(old.content.encode()).hexdigest() != row["expected_content_sha256"]):
            raise ValueError("Retirement does not match the reviewed target-owned editorial source")
        (retired_reused if old.origin == RETIRED_ORIGIN else retire).append(old)
    result = {"apply": apply, "catalog_sha256": digest, "catalog_entries": len(ids),
              "new_sources": len(pending), "reused_sources": len(reused),
              "original_sources_checked": len(catalog["references"]),
              "categories": dict(Counter(e["category"] for e in catalog["entries"])),
              "evidence_levels": dict(Counter(e["evidence_level"] for e in catalog["entries"])),
              "source_ids": ids, "physical_validation": False,
              "retirements": {"new": [row.id for row in retire], "already_retired": [row.id for row in retired_reused],
                              "not_previously_imported": retired_missing}}
    if apply:
        try:
            db.add_all(pending)
            for row in retire:
                # Keep old ID, title, body and original provenance for past
                # conversations, while withdrawing it from new retrieval.
                row.origin = RETIRED_ORIGIN
            db.commit()
        except BaseException:
            db.rollback()
            raise
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "fixtures/inspiration/catalog.json")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    settings = Settings.load()
    data_dir = (args.data_dir or settings.data_dir).resolve()
    database_url = (settings.database_url if not args.data_dir else "") or "sqlite:///" + (data_dir / "wujian.sqlite3").as_posix()
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or not Path(url.database).is_file():
        parser.error("Use an existing local SQLite database; this importer never creates or migrates it")
    read_catalog(args.catalog)
    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            # Full dry-run includes target ownership/hash/conflict checks before backup.
            report = import_catalog(db, args.user_id, args.catalog)
            if args.apply:
                folder = data_dir / "backups"
                folder.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                backup = folder / ("before-creative-catalog-" + stamp + ".sqlite3")
                with sqlite3.connect(url.database) as source, sqlite3.connect(backup) as target:
                    source.backup(target)
                report = import_catalog(db, args.user_id, args.catalog, apply=True)
                report["backup"] = str(backup)
                backup.with_suffix(".receipt.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
