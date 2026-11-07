"""Offline provenance/permission checks; synthetic rows are not real tutorials."""
import copy
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from scripts.import_creative_catalog import import_catalog, read_catalog, render_entry, SCHEMA, RETIRED_ORIGIN
from wujian.config import Settings
from wujian.database import Base, ItemRecord, KnowledgeClaim, SourceRecord, User
from wujian.domain import DomainError
from wujian.knowledge import source_excerpt
from wujian.retrieval import authorized_documents, Retrieval
from wujian.source_access import readable_source


def synthetic_catalog():
    return {"schema": SCHEMA, "authorship": "codex_editorial_not_original_author", "references": {
        "original": {"original_source_id": "synthetic-public-source", "url": "https://www.bilibili.com/video/BV1test00000/",
            "title": "Synthetic title, no real video", "content_sha256": hashlib.sha256(b"synthetic metadata only").hexdigest(),
            "evidence_level": "metadata_only", "reading_scope": "synthetic metadata; no video observed"}},
        "entries": [{"key": "synthetic-side-light", "title": "测试用的侧光提案", "category": "摄影测试", "scene": "合成测试场景",
            "resources": ["测试台灯", "测试相机"], "mechanism": "合成机制说明；不是实际观测", "first_step": "测试时只核对文本与权限",
            "observe": "此样本不声称任何物理效果", "unknowns": ["未实机试验"], "source_basis": "仅合成元数据，动作由编者提出",
            "reference_keys": ["original"], "tags": ["侧光", "合成测试"], "physical_validation": False,
            "evidence_level": "metadata_direction_editorial_proposal"}]}


class CreativeCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "catalog.json"
        self.catalog = synthetic_catalog()
        self.write()
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.db.add_all([User(id=key, username=key, display_name=key, password_hash="unused") for key in ("owner", "other")])
        self.db.flush()
        ref = self.catalog["references"]["original"]
        self.db.add(SourceRecord(id=ref["original_source_id"], owner_id="owner", origin="public_web", title=ref["title"],
                                 url=ref["url"], content="synthetic metadata only", pages=[]))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def write(self):
        self.path.write_text(json.dumps(self.catalog, ensure_ascii=False), encoding="utf-8")

    def count(self, model):
        return self.db.scalar(select(func.count()).select_from(model))

    def test_dry_run_and_idempotent_apply_keep_original_and_do_not_invent_facts(self):
        before = self.count(SourceRecord)
        report = import_catalog(self.db, "owner", self.path)
        self.assertEqual((report["new_sources"], self.count(SourceRecord)), (1, before))
        first = import_catalog(self.db, "owner", self.path, apply=True)
        second = import_catalog(self.db, "owner", self.path, apply=True)
        self.assertEqual(first["source_ids"], second["source_ids"])
        self.assertEqual((second["new_sources"], second["reused_sources"]), (0, 1))
        self.assertEqual(self.count(SourceRecord), before + 1)
        self.assertEqual(self.db.get(SourceRecord, "synthetic-public-source").content, "synthetic metadata only")
        self.assertEqual((self.count(ItemRecord), self.count(KnowledgeClaim)), (0, 0))

    def test_another_users_sources_cannot_be_referenced_or_granted_by_import(self):
        with self.assertRaises(DomainError):
            import_catalog(self.db, "other", self.path, apply=True)
        self.assertEqual(self.count(SourceRecord), 1)
        self.assertEqual([doc for doc in authorized_documents(self.sessions, "other").values() if doc["kind"] == "source"], [])

    def test_curated_source_is_searchable_but_explicitly_editorial_even_at_video_url(self):
        result = import_catalog(self.db, "owner", self.path, apply=True)
        identity = result["source_ids"]["synthetic-side-light"]
        row = self.db.get(SourceRecord, identity)
        excerpt = source_excerpt(row)
        self.assertEqual(excerpt["evidence_kind"], "curated_reference")
        self.assertEqual(excerpt["content_level"], "editorial_reference_not_original_steps_or_physical_validation")
        self.assertFalse(excerpt["evidence_scope"]["physical_validation"])
        self.assertFalse(excerpt["evidence_scope"]["original_author_steps_claimed"])
        self.assertIn("不是原作者步骤", excerpt["text"])
        docs = authorized_documents(self.sessions, "owner")
        self.assertIn("测试用的侧光提案", docs["source/" + identity]["text"])

    def test_original_content_url_and_title_are_all_checked_before_writes(self):
        ref = self.catalog["references"]["original"]
        for field, value in (("content_sha256", "0" * 64), ("url", "https://example.org/changed"), ("title", "different title")):
            original = ref[field]
            ref[field] = value
            self.write()
            with self.assertRaisesRegex(ValueError, "identity/content"):
                import_catalog(self.db, "owner", self.path, apply=True)
            self.assertEqual(self.count(SourceRecord), 1)
            ref[field] = original

    def test_metadata_cannot_be_upgraded_to_document_or_physical_success(self):
        entry = self.catalog["entries"][0]
        entry["evidence_level"] = "primary_document_mechanism_editorial_application"
        self.write()
        with self.assertRaisesRegex(ValueError, "Metadata"):
            read_catalog(self.path)
        self.catalog["references"]["original"]["evidence_level"] = "primary_document_text"
        self.write()
        with self.assertRaisesRegex(ValueError, "Video page metadata"):
            import_catalog(self.db, "owner", self.path, apply=True)
        entry["physical_validation"] = True
        self.write()
        with self.assertRaisesRegex(ValueError, "physical validation"):
            read_catalog(self.path)

    def test_title_changes_cannot_disguise_duplicate_mechanism(self):
        duplicate = copy.deepcopy(self.catalog["entries"][0])
        duplicate.update(key="another-title", title="换了标题的同一提案")
        self.catalog["entries"].append(duplicate)
        self.write()
        with self.assertRaisesRegex(ValueError, "Duplicate mechanism"):
            read_catalog(self.path)

    def test_immutable_key_conflict_does_not_overwrite_existing_reference(self):
        first = import_catalog(self.db, "owner", self.path, apply=True)
        identity = first["source_ids"]["synthetic-side-light"]
        old = self.db.get(SourceRecord, identity).content
        self.catalog["entries"][0]["first_step"] = "这是经过修改但尚未批准的新内容"
        self.write()
        with self.assertRaisesRegex(ValueError, "immutable catalog key"):
            import_catalog(self.db, "owner", self.path, apply=True)
        self.assertEqual(self.db.get(SourceRecord, identity).content, old)
        self.assertEqual(self.count(SourceRecord), 2)

    def test_reviewed_retirement_preserves_old_body_and_purges_existing_reme_projection(self):
        extra = copy.deepcopy(self.catalog["entries"][0])
        extra.update(key="remaining-reference", title="保留的不同测试提案", mechanism="另一种合成测试机制", first_step="只用于保留一条活跃测试提案")
        self.catalog["entries"].append(extra)
        self.write()
        first = import_catalog(self.db, "owner", self.path, apply=True)
        identity = first["source_ids"]["synthetic-side-light"]
        old_text = self.db.get(SourceRecord, identity).content
        settings = Settings(data_dir=Path(self.temp.name) / "retrieval-test", api_key="", demo_mode=False, rea_enabled=False)
        settings.data_dir.mkdir()
        retrieval = Retrieval(settings, self.sessions)

        async def journey():
            try:
                before = await retrieval.search("owner", "侧光", kinds=["source"])
                self.assertIn(identity, [hit["id"] for hit in before["results"]])
                self.catalog["entries"] = [extra]
                self.catalog["retired_entries"] = [{"key": "synthetic-side-light", "reason": "独立审查撤回合成测试条目",
                    "expected_content_sha256": hashlib.sha256(old_text.encode()).hexdigest()}]
                self.write()
                dry = import_catalog(self.db, "owner", self.path)
                self.assertEqual(dry["retirements"]["new"], [identity])
                self.assertEqual(self.db.get(SourceRecord, identity).origin, "curated_reference")
                applied = import_catalog(self.db, "owner", self.path, apply=True)
                again = import_catalog(self.db, "owner", self.path, apply=True)
                self.assertEqual(applied["retirements"]["new"], [identity])
                self.assertEqual(again["retirements"]["already_retired"], [identity])
                self.assertEqual(again["retirements"]["new"], [])
                self.assertEqual(self.db.get(SourceRecord, identity).origin, RETIRED_ORIGIN)
                self.assertEqual(self.db.get(SourceRecord, identity).content, old_text)
                self.assertEqual(self.count(SourceRecord), 3)
                read = source_excerpt(readable_source(self.db, "owner", identity))
                self.assertEqual(read["evidence_kind"], "retired_curated_reference")
                self.assertTrue(read["evidence_scope"]["retired_do_not_use_for_new_recommendations"])
                self.assertNotIn("source/" + identity, authorized_documents(self.sessions, "owner"))
                after = await retrieval.search("owner", "侧光", kinds=["source"])
                self.assertNotIn(identity, [hit["id"] for hit in after["results"]])
                self.assertNotIn("source/" + identity, retrieval.hashes["owner"])
            finally:
                await retrieval.close()
        asyncio.run(journey())

    def test_retirement_cannot_hide_an_unreviewed_changed_source(self):
        first = import_catalog(self.db, "owner", self.path, apply=True)
        identity = first["source_ids"]["synthetic-side-light"]
        extra = copy.deepcopy(self.catalog["entries"][0])
        extra.update(key="remaining-reference", mechanism="不同的合成机制", first_step="另一条合成提案的开始动作")
        self.catalog["entries"] = [extra]
        self.catalog["retired_entries"] = [{"key": "synthetic-side-light", "reason": "错误正文摘要不允许撤回", "expected_content_sha256": "0" * 64}]
        self.write()
        with self.assertRaisesRegex(ValueError, "Retirement does not match"):
            import_catalog(self.db, "owner", self.path, apply=True)
        self.assertEqual(self.db.get(SourceRecord, identity).origin, "curated_reference")
        self.catalog["retired_entries"] = [{"key": "absent-key", "reason": "测试未导入过的条目", "expected_content_sha256": "0" * 64}]
        self.write()
        report = import_catalog(self.db, "owner", self.path, apply=True)
        self.assertEqual(report["retirements"]["not_previously_imported"], ["absent-key"])
        self.assertEqual(self.db.get(SourceRecord, identity).origin, "curated_reference")

    def test_real_fixture_is_broad_and_keeps_actions_unknowns_in_existing_search_excerpt(self):
        path = Path(__file__).resolve().parents[1] / "fixtures/inspiration/catalog.json"
        catalog, _ = read_catalog(path)
        self.assertGreaterEqual(len(catalog["entries"]), 100)
        self.assertGreaterEqual(len({entry["category"] for entry in catalog["entries"]}), 10)
        self.assertGreaterEqual(sum(entry["evidence_level"] == "primary_document_mechanism_editorial_application"
                                    for entry in catalog["entries"]), 30)
        for entry in catalog["entries"]:
            content = render_entry(entry, catalog["references"])
            self.assertIn("未知与边界：", content[:1200], entry["key"])
            self.assertIn("第一步（编者待试方案）：", content[:1200], entry["key"])
            self.assertIn("原始资料 [", content[:1200], entry["key"])


if __name__ == "__main__":
    unittest.main()
