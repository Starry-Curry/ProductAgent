"""Import explicitly curated public references; dry-run unless --apply.

Uses existing SQL facts and provisional case claims. No network/model call,
new inventory, private-memory import or independent knowledge database.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from wujian import domain, foundation
from wujian.config import Settings
from wujian.database import Asset, ItemRecord, KnowledgeClaim, SourceRecord, User, uid

SCHEMA = "wujian-public-inspiration-bundle/1"


def read_bundle(path):
    path = Path(path).resolve()
    body = path.read_bytes()
    bundle = json.loads(body)
    if bundle.get("schema") != SCHEMA:
        raise ValueError("Unsupported public-inspiration bundle")
    if not 1 <= len(bundle.get("cases", [])) <= 100:
        raise ValueError("Expected 1 to 100 bounded cases")
    sources = {row["key"]: row for row in bundle["sources"]}
    assets = {row["key"]: row for row in bundle["assets"]}
    if len(sources) != len(bundle["sources"]) or len(assets) != len(bundle["assets"]):
        raise ValueError("Duplicate source or asset key")
    if len({case["key"] for case in bundle["cases"]}) != len(bundle["cases"]):
        raise ValueError("Duplicate case key")
    for asset in assets.values():
        file = (path.parent / asset["bundle_path"]).resolve()
        if not file.is_relative_to(path.parent) or not file.is_file():
            raise ValueError("Bundle asset escaped its directory or is missing")
        if (file.stat().st_size != asset["bytes"] or asset["bytes"] > 12 * 1024 * 1024
                or hashlib.sha256(file.read_bytes()).hexdigest() != asset["sha256"]):
            raise ValueError("Bundle asset byte count/hash is invalid")
        if asset["media_type"] not in {"image/png", "video/mp4", "text/html", "application/json", "text/plain"}:
            raise ValueError("Unsupported public-source asset media type")
    for source in sources.values():
        parsed = urlsplit(source["url"])
        if (parsed.scheme != "https" or parsed.hostname != "www.bilibili.com"
                or not parsed.path.startswith("/video/") or parsed.username or parsed.password):
            raise ValueError("Expected a public Bilibili video URL")
        if source["origin"] not in {"public_web", "video_frame_sample"}:
            raise ValueError("Bundle contains a non-public source kind")
        if source.get("asset_key") and source["asset_key"] not in assets:
            raise ValueError("Source asset is missing")
        if source["origin"] == "video_frame_sample":
            manifest = json.loads(source["content"])
            parent = sources.get(source.get("parent_source_key"))
            if not parent or parent["origin"] != "public_web" or parent["url"] != source["url"]:
                raise ValueError("Frame source does not match its original page")
            if source["parent_source_key"] != "source/" + manifest["parent_source_id"]:
                raise ValueError("Frame parent reference is inconsistent")
            if not 1 <= len(manifest["frames"]) <= 4:
                raise ValueError("Frame count exceeds the existing reader contract")
            mapping = source.get("manifest_asset_map", {})
            for identity in [manifest["video_asset_id"], *(f["asset_id"] for f in manifest["frames"])]:
                if mapping.get(identity) not in assets:
                    raise ValueError("Frame/video asset mapping is missing")
    for case in bundle["cases"]:
        original = sources.get(case["original_public_source_key"])
        if original is None or original["origin"] != "public_web":
            raise ValueError("Case original source is missing")
        claim = case.get("claim_candidate")
        if not claim:
            continue
        source = sources.get(claim["source_key"])
        evidence = {row["source_key"] for row in case.get("evidence", [])}
        if (case.get("status") != "observed_reference_not_physical_validation"
                or claim.get("kind") != "case" or claim.get("basis") != "inference"
                or claim.get("scope") != "item" or not source
                or source["origin"] != "video_frame_sample" or claim["source_key"] not in evidence):
            raise ValueError("Only actually sampled, provisional item-case claims may be imported")
        if source["parent_source_key"] != case["original_public_source_key"]:
            raise ValueError("Case author/original page does not match its actual sampled evidence")
    return bundle, hashlib.sha256(body).hexdigest()


def anchor_item(items, case):
    """Match explicit curator hints to existing owned inventory, never create it."""
    match = case.get("anchor_match", {})
    for key in match.get("inventory_keys", []):
        for item in items:
            if (item.state or {}).get("demo_inventory_key") == key:
                return item
    for term in match.get("name_terms", []):
        for item in items:
            names = (item.name, (item.product or {}).get("commercial_name", ""))
            if isinstance(term, str) and term and any(
                    term.casefold() in name.casefold() for name in names if isinstance(name, str)):
                return item
    return None


def import_bundle(db, user_id, bundle_path, asset_dir, *, apply=False):
    bundle_path, asset_dir = Path(bundle_path).resolve(), Path(asset_dir).resolve()
    bundle, digest = read_bundle(bundle_path)
    domain.require(db.get(User, user_id), "Target user does not exist")
    items = db.scalars(select(ItemRecord).where(
        ItemRecord.owner_id == user_id, ItemRecord.archived.is_(False))).all()
    bindings = {case["key"]: anchor_item(items, case) for case in bundle["cases"] if case.get("claim_candidate")}
    report = {"apply": apply, "bundle_sha256": digest, "public_sources": len(bundle["sources"]),
              "lead_only": sum(not case.get("claim_candidate") for case in bundle["cases"]),
              "cases": [{"key": case["key"], "status": "eligible" if bindings.get(case["key"]) else "no_matching_item",
                         "item_id": bindings[case["key"]].id if bindings.get(case["key"]) else None}
                        for case in bundle["cases"] if case.get("claim_candidate")]}
    if not apply:
        return report
    created_files, asset_ids, source_ids = [], {}, {}
    try:
        asset_dir.mkdir(parents=True, exist_ok=True)
        for row in bundle["assets"]:
            marker = "public-inspiration:" + row["sha256"]
            old = db.scalar(select(Asset).where(Asset.owner_id == user_id, Asset.original_name == marker))
            if (old and old.media_type == row["media_type"] and Path(old.path).is_file()
                    and hashlib.sha256(Path(old.path).read_bytes()).hexdigest() == row["sha256"]):
                asset_ids[row["key"]] = old.id
                continue
            identity = uid()
            target = asset_dir / identity
            shutil.copyfile(bundle_path.parent / row["bundle_path"], target)
            created_files.append(target)
            if target.stat().st_size != row["bytes"] or hashlib.sha256(target.read_bytes()).hexdigest() != row["sha256"]:
                raise ValueError("Source asset changed while copying; import rolled back")
            db.add(Asset(id=identity, owner_id=user_id, path=str(target), media_type=row["media_type"], original_name=marker))
            asset_ids[row["key"]] = identity
        for origin in ("public_web", "video_frame_sample"):
            for row in (value for value in bundle["sources"] if value["origin"] == origin):
                content = row["content"]
                if origin == "video_frame_sample":
                    manifest = json.loads(content)
                    manifest["parent_source_id"] = source_ids[row["parent_source_key"]]
                    mapping = row["manifest_asset_map"]
                    manifest["video_asset_id"] = asset_ids[mapping[manifest["video_asset_id"]]]
                    for frame in manifest["frames"]:
                        frame["asset_id"] = asset_ids[mapping[frame["asset_id"]]]
                    manifest["import_origin"] = {"schema": SCHEMA, "bundle_sha256": digest,
                                                 "source_key": row["key"], "acquisition": "curated_public_reference_import"}
                    content = json.dumps(manifest, ensure_ascii=False)
                old = db.scalar(select(SourceRecord).where(SourceRecord.owner_id == user_id,
                    SourceRecord.url == row["url"], SourceRecord.origin == origin, SourceRecord.content == content))
                if old:
                    source_ids[row["key"]] = old.id
                    continue
                source = SourceRecord(id=uid(), owner_id=user_id, item_id=None, origin=origin,
                    title=row["title"], url=row["url"], content=content, pages=row.get("pages", []),
                    asset_id=asset_ids.get(row.get("asset_key")), fetched_at=row["fetched_at"])
                db.add(source)
                source_ids[row["key"]] = source.id
        db.flush()
        own_claims = db.scalars(select(KnowledgeClaim).where(KnowledgeClaim.owner_id == user_id)).all()
        for case in bundle["cases"]:
            claim, item = case.get("claim_candidate"), bindings.get(case["key"])
            if not claim or item is None:
                continue
            provenance = {"schema": SCHEMA, "bundle_sha256": digest, "case_key": case["key"],
                          "acquisition": "curated_public_reference_import_not_user_report"}
            if any((old.conditions or {}).get("import_origin") == provenance for old in own_claims):
                continue
            foundation.save_claim(db, user_id, "public-import:" + digest[:20], item.id,
                claim["content"], {**claim["conditions"], "kind": "case", "import_origin": provenance},
                "inference", "item", source_ids[claim["source_key"]], "", commit=False)
        db.commit()
        report.update(imported_source_ids=source_ids, imported_asset_ids=asset_ids)
        return report
    except BaseException:
        db.rollback()
        for file in created_files:
            file.unlink(missing_ok=True)
        raise


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    settings = Settings.load()
    data_dir = (args.data_dir or settings.data_dir).resolve()
    database_url = settings.database_url if not args.data_dir else ""
    database_url = database_url or "sqlite:///" + (data_dir / "wujian.sqlite3").as_posix()
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or not Path(url.database).is_file():
        parser.error("Use an existing local SQLite database; this importer never creates/rebuilds it")
    read_bundle(args.bundle)  # Validate all input before backup, files or database writes.
    backup = None
    if args.apply:
        backup_dir = data_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = backup_dir / ("before-public-inspiration-" + stamp + ".sqlite3")
        with sqlite3.connect(url.database) as source, sqlite3.connect(backup) as target:
            source.backup(target)
    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            result = import_bundle(db, args.user_id, args.bundle, data_dir / "assets", apply=args.apply)
        if backup:
            result["backup"] = str(backup)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
