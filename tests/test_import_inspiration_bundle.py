"""Offline import/permission contracts using explicitly synthetic source bytes.

These checks do not claim the 1-pixel frame or minimal MP4 header is real footage;
actual source/video evidence lives in the separately collected local bundle.
"""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from scripts.import_inspiration_bundle import import_bundle, read_bundle, SCHEMA
from wujian.database import Asset, Base, ItemRecord, KnowledgeClaim, SourceRecord, User
from wujian.domain import DomainError
from wujian.source_video import retained_video_frames

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=")


def fixture(folder):
    folder.mkdir()
    assets = []
    for key, body, media in [("html", b"<html>synthetic public page</html>", "text/html"),
                              ("video", b"\x00\x00\x00\x18ftypmp42synthetic-test-only", "video/mp4"),
                              ("frame", PNG, "image/png")]:
        path = folder / key
        path.write_bytes(body)
        assets.append({"key": key, "bundle_path": key, "media_type": media, "original_name": key,
                       "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
    url = "https://www.bilibili.com/video/BV1MdZpB4EYf/"
    manifest = {"parent_source_id": "old-page", "video_asset_id": "old-video", "source_url": url,
                "frames": [{"at_seconds": 1.5, "asset_id": "old-frame", "width": 1, "height": 1}],
                "observation_limits": {"full_video_observed": False, "audio_observed": False}}
    page = {"key": "source/old-page", "original_source_id": "old-page", "origin": "public_web",
            "title": "Synthetic public title", "url": url, "content": "synthetic original text",
            "pages": [], "asset_key": "html", "fetched_at": "2026-11-06T00:00:00+00:00"}
    sample = {"key": "source/old-sample", "original_source_id": "old-sample", "origin": "video_frame_sample",
              "title": "Synthetic sampled title", "url": url, "content": json.dumps(manifest), "pages": [],
              "asset_key": "video", "parent_source_key": page["key"],
              "manifest_asset_map": {"old-video": "video", "old-frame": "frame"},
              "fetched_at": "2026-11-06T00:00:01+00:00"}
    case = {"key": "case/example", "original_public_source_key": page["key"],
            "status": "observed_reference_not_physical_validation", "anchor_match": {"inventory_keys": ["paper-cups"], "name_terms": ["paper cup"]},
            "evidence": [{"source_key": sample["key"]}], "claim_candidate": {"kind": "case", "basis": "inference", "scope": "item",
            "source_key": sample["key"], "content": "Synthetic provisional cup arrangement interpretation",
            "conditions": {"requirements": ["paper cups"], "unknowns": ["not physically tried"]}}}
    lead = {"key": "case/lead", "original_public_source_key": page["key"], "status": "lead_only",
            "claim_candidate": None, "evidence": []}
    bundle = {"schema": SCHEMA, "sources": [page, sample], "assets": assets, "cases": [case, lead]}
    path = folder / "bundle.json"
    path.write_text(json.dumps(bundle), encoding="utf-8")
    return path


class InspirationImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.path = fixture(self.root / "public-bundle")
        self.asset_dir = self.root / "business-assets"
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.sessions()
        for owner in ("owner-a", "owner-b"):
            self.db.add(User(id=owner, username=owner, display_name=owner, password_hash="unused"))
            self.db.add(ItemRecord(id="item-" + owner, owner_id=owner, name="paper cups",
                                   state={"demo_inventory_key": "paper-cups"}))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temporary.cleanup()

    def counts(self):
        return tuple(self.db.scalar(select(func.count()).select_from(model))
                     for model in (Asset, SourceRecord, KnowledgeClaim, ItemRecord))

    def test_dry_run_leaves_database_and_files_unchanged(self):
        before = self.counts()
        report = import_bundle(self.db, "owner-a", self.path, self.asset_dir)
        self.assertFalse(report["apply"])
        self.assertEqual(report["cases"][0]["item_id"], "item-owner-a")
        self.assertEqual(self.counts(), before)
        self.assertFalse(self.asset_dir.exists())

    def test_curator_hint_can_match_known_product_name_without_renaming_personal_item(self):
        item = self.db.get(ItemRecord, "item-owner-a")
        item.name = "my favourite object"
        item.state = {}
        item.identity_notes = {"commercial_name": "paper cups"}
        self.db.commit()
        report = import_bundle(self.db, "owner-a", self.path, self.asset_dir)
        self.assertEqual(report["cases"][0]["item_id"], item.id)
        self.assertEqual(item.name, "my favourite object")

    def test_apply_remaps_frames_and_is_idempotent_without_touching_others(self):
        report = import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        ids = report["imported_source_ids"]
        sample_id = ids["source/old-sample"]
        self.assertNotEqual(sample_id, "old-sample")
        result = retained_video_frames(self.db, "owner-a", sample_id)
        self.assertEqual(result["manifest"]["parent_source_id"], ids["source/old-page"])
        self.assertNotEqual(result["frames"][0]["asset_id"], "old-frame")
        self.assertEqual(base64.b64decode(result["frames"][0]["base64"]), PNG)
        self.assertEqual(self.db.get(SourceRecord, ids["source/old-page"]).content, "synthetic original text")
        claim = self.db.scalar(select(KnowledgeClaim))
        self.assertEqual((claim.basis, claim.item_id, claim.source_id), ("inference", "item-owner-a", sample_id))
        self.assertEqual(claim.conditions["kind"], "case")
        self.assertTrue(claim.source_message_id.startswith("public-import:"))
        before = self.counts()
        second = import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        self.assertEqual(self.counts(), before)
        self.assertEqual(second["imported_source_ids"], ids)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(KnowledgeClaim)), 1)  # lead was not a tutorial
        with self.assertRaises(DomainError):
            retained_video_frames(self.db, "owner-b", sample_id)
        other = import_bundle(self.db, "owner-b", self.path, self.asset_dir, apply=True)
        self.assertNotEqual(other["imported_source_ids"], ids)
        self.assertEqual(self.db.get(SourceRecord, sample_id).owner_id, "owner-a")

    def test_missing_resource_imports_source_without_inventing_item(self):
        self.db.get(ItemRecord, "item-owner-a").name = "unrelated chair"
        self.db.get(ItemRecord, "item-owner-a").state = {}
        self.db.commit()
        before_items = self.counts()[-1]
        report = import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        self.assertEqual(report["cases"][0]["status"], "no_matching_item")
        self.assertEqual(self.counts(), (3, 2, 0, before_items))

    def test_tampered_asset_and_escaping_path_are_rejected_before_writes(self):
        original = self.path.read_text(encoding="utf-8")
        data = json.loads(original)
        data["assets"][0]["bundle_path"] = "../outside"
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        self.path.write_text(original, encoding="utf-8")
        (self.path.parent / "frame").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "hash"):
            import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        self.assertEqual(self.counts(), (0, 0, 0, 2))
        self.assertFalse(self.asset_dir.exists())

    def test_lead_cannot_be_imported_as_observed_knowledge(self):
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["cases"][0]["status"] = "lead_only"
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "actually sampled"):
            read_bundle(self.path)

    def test_case_author_cannot_be_rebound_to_another_videos_frame(self):
        data = json.loads(self.path.read_text(encoding="utf-8"))
        other = {**data["sources"][0], "key": "source/other-page", "original_source_id": "other-page",
                 "url": "https://www.bilibili.com/video/BV1Z94y1G72e/"}
        data["sources"].append(other)
        data["cases"][0]["original_public_source_key"] = other["key"]
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "does not match"):
            read_bundle(self.path)

    def test_late_claim_failure_rolls_back_new_sources_and_new_files(self):
        with patch("scripts.import_inspiration_bundle.foundation.save_claim", side_effect=RuntimeError("offline failure")):
            with self.assertRaisesRegex(RuntimeError, "offline failure"):
                import_bundle(self.db, "owner-a", self.path, self.asset_dir, apply=True)
        self.assertEqual(self.counts(), (0, 0, 0, 2))
        self.assertEqual(list(self.asset_dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
