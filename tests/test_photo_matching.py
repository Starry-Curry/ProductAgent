"""Offline contracts/races, not a claim of visual-model accuracy.

Tiny image fixtures only exercise authorized binary transport. Real-photo
quality is evaluated separately against the configured Bailian model.
"""
import tempfile
import io
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from PIL import Image
from sqlalchemy import func, select

from wujian import domain, interactions
from wujian.api_models import ExperienceChange, ExperienceCreate, ItemCreate
from wujian.config import Settings
from wujian.database import Asset, ExperienceRecord, Grant, ItemRecord, Memory, User, make_database
from wujian.photo_matching import PhotoMatchRequest, VisualMatches, _image_block, match_experience_photos, observe_photos
from wujian.server import create_app


class PhotoMatchingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="offline-no-provider")
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        with self.sessions() as db:
            db.add_all([User(id=key, username=key, display_name=key, password_hash="unused")
                        for key in ["alice", "bob"]])
            db.flush()
            for key, owner in [("scene", "alice"), ("reference", "alice"), ("private", "bob")]:
                path = self.settings.data_dir / "assets" / key
                Image.new("RGB", (32, 24), "white").save(path, "JPEG")
                db.add(Asset(id=key, owner_id=owner, path=str(path), media_type="image/jpeg", original_name=key))
            db.commit()
            self.item = domain.create_item(db, "alice", ItemCreate(
                name="有独特蓝色手绘花纹的杯子", kind="nonstandard_object", photo_id="reference"))
            self.other = domain.create_item(db, "bob", ItemCreate(name="别人的私人物品", photo_id="private"))
            self.story = domain.create_experience(db, "alice", ExperienceCreate(
                title="周末", text="今天和朋友一起喝茶。", photo_ids=["scene"]))

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def observation(self, **changes):
        value = {"item_id": self.item["id"], "photo_ids": ["scene"], "verdict": "same_instance",
                 "evidence_kind": "distinctive_detail", "reference_detail": "缺了一角的蓝色手绘三叶花纹",
                 "observed_detail": "相同缺角位置与蓝色三叶花纹", "explanation": "两处可见相同手绘细节。",
                 "ambiguous_with": []}
        return VisualMatches(matches=[value | changes])

    async def call(self, observer=None, **changes):
        return await match_experience_photos(self.settings, self.sessions, changes.pop("user_id", "alice"),
            self.story["id"], PhotoMatchRequest(expected_version=changes.pop("version", 1), **changes),
            observer=observer or AsyncMock(return_value=self.observation()))

    async def test_shared_writer_links_same_record_and_preserves_original_and_ai_scope(self):
        spy = AsyncMock(return_value=self.observation())
        result = await self.call(spy)
        self.assertEqual(result.experience.item_ids, [self.item["id"]])
        self.assertFalse(result.experience.allow_ai)
        self.assertTrue(result.candidates[0].auto_linked)
        self.assertEqual(result.experience.text, self.story["text"])
        self.assertEqual(result.experience.version, 2)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(Memory)), 0)
            self.assertEqual(domain.list_experiences(db, "alice", self.item["id"])[0]["id"], self.story["id"])
            self.assertEqual(domain.list_experiences(db, "bob"), [])
        references = spy.call_args.args[2]
        self.assertEqual([ref["reference_item"] for ref in references], [self.item["id"]])
        self.assertEqual(references[0]["image"].source.media_type, "image/jpeg")
        self.assertTrue(result.experience.provenance["photo_associations"][self.item["id"]])

    async def test_category_match_and_user_disabled_auto_never_write(self):
        for changes, options in [({"evidence_kind": "category_only"}, {}),
                                 ({"verdict": "possible"}, {}),
                                 ({"ambiguous_with": ["unknown"]}, {}), ({}, {"apply_confident": False})]:
            result = await self.call(AsyncMock(return_value=self.observation(**changes)), **options)
            self.assertFalse(result.candidates[0].auto_linked)
            self.assertEqual(result.experience.item_ids, [])
            self.assertEqual(result.experience.version, 1)

    async def test_category_without_reference_photo_cannot_be_automatic(self):
        with self.sessions() as db:
            db.get(ItemRecord, self.item["id"]).photo_id = None
            db.commit()
        result = await self.call()
        self.assertFalse(result.candidates[0].auto_linked)

    async def test_foreign_story_and_received_story_denied_before_model(self):
        spy = AsyncMock()
        with self.assertRaises(domain.DomainError):
            await self.call(spy, user_id="bob")
        with self.sessions() as db:
            db.get(ExperienceRecord, self.story["id"]).origin_id = "gift-original"
            db.commit()
        with self.assertRaises(domain.DomainError):
            await self.call(spy)
        spy.assert_not_awaited()

    async def test_late_result_does_not_overwrite_manual_edit(self):
        async def edit_while_observing(*args):
            with self.sessions() as db:
                interactions.change_experience(db, "alice", self.story["id"], ExperienceChange(
                    title="我已改好", text="以这份为准", item_ids=[], photo_ids=["scene"], expected_version=1))
            return self.observation()
        with self.assertRaises(domain.DomainError) as caught:
            await self.call(edit_while_observing)
        self.assertEqual(caught.exception.status, 409)
        with self.sessions() as db:
            row = db.get(ExperienceRecord, self.story["id"])
            self.assertEqual(row.title, "我已改好")
            self.assertEqual(row.item_ids, [])

    async def test_revoked_item_or_changed_reference_rejects_obsolete_observation(self):
        for change in ["version", "archived"]:
            async def alter(*args):
                with self.sessions() as db:
                    item = db.get(ItemRecord, self.item["id"])
                    if change == "version":
                        item.version += 1
                    else:
                        item.archived = True
                    db.commit()
                return self.observation()
            with self.assertRaises(domain.DomainError) as caught:
                await self.call(alter)
            self.assertEqual(caught.exception.status, 409)

    async def test_revoked_shared_reference_is_not_added(self):
        with self.sessions() as db:
            db.add(Grant(item_id=self.other["id"], user_id="alice"))
            db.commit()
        async def revoke(*args):
            with self.sessions() as db:
                db.delete(db.get(Grant, (self.other["id"], "alice")))
                db.commit()
            return self.observation(item_id=self.other["id"])
        with self.assertRaises(domain.DomainError) as caught:
            await self.call(revoke)
        self.assertEqual(caught.exception.status, 409)

    async def test_new_lookalike_in_separate_sql_transaction_invalidates_full_inventory(self):
        async def add_while_observing(*args):
            with self.sessions() as db:
                domain.create_item(db, "alice", ItemCreate(name="刚录入的同图杯子",
                    kind="nonstandard_object", photo_id="reference"))
            return self.observation()
        with self.assertRaises(domain.DomainError) as caught:
            await self.call(add_while_observing)
        self.assertEqual(caught.exception.status, 409)
        self.assertIn("重新识别", caught.exception.message)
        with self.sessions() as db:
            row = db.get(ExperienceRecord, self.story["id"])
            self.assertEqual(row.version, 1)
            self.assertEqual(row.item_ids, [])
            self.assertNotIn("photo_associations", row.provenance)
            self.assertEqual(len(domain.list_items(db, "alice")), 2)

    async def test_changed_unreturned_reference_invalidates_ambiguity_judgment(self):
        with self.sessions() as db:
            extra = domain.create_item(db, "alice", ItemCreate(name="模型未返回的另一物品",
                kind="nonstandard_object"))
        async def change_other(*args):
            with self.sessions() as db:
                other = db.get(ItemRecord, extra["id"])
                other.photo_id = "reference"
                db.commit()
            return self.observation()
        with self.assertRaises(domain.DomainError) as caught:
            await self.call(change_other)
        self.assertEqual(caught.exception.status, 409)
        with self.sessions() as db:
            self.assertEqual(db.get(ExperienceRecord, self.story["id"]).item_ids, [])

    async def test_hallucinated_identity_or_photo_is_not_returned_or_applied(self):
        for changes in [{"item_id": self.other["id"]}, {"photo_ids": ["private"]}]:
            result = await self.call(AsyncMock(return_value=self.observation(**changes)))
            self.assertEqual(result.candidates, [])
            self.assertEqual(result.experience.item_ids, [])

    async def test_duplicate_domestic_sku_requires_confirmation(self):
        with self.sessions() as db:
            for name in ["我的音箱", "同型号另一台音箱"]:
                item = domain.create_item(db, "alice", ItemCreate(name=name, photo_id="reference",
                    product={"brand": "索尼", "model": "SRS-XB100", "market": "CN"}))
                if name == "我的音箱":
                    target = item["id"]
        result = await self.call(AsyncMock(return_value=self.observation(item_id=target)))
        self.assertFalse(result.candidates[0].auto_linked)
        self.assertEqual(result.experience.item_ids, [])

    async def test_identical_nonstandard_reference_cannot_choose_a_physical_instance(self):
        with self.sessions() as db:
            domain.create_item(db, "alice", ItemCreate(name="另一件同图记录",
                kind="nonstandard_object", photo_id="reference"))
        result = await self.call()
        self.assertFalse(result.candidates[0].auto_linked)
        self.assertEqual(result.experience.item_ids, [])

    async def test_conflicting_model_verdicts_are_not_auto_linked(self):
        observation = self.observation()
        observation.matches.append(self.observation(verdict="possible").matches[0])
        result = await self.call(AsyncMock(return_value=observation))
        self.assertFalse(result.candidates[0].auto_linked)

    async def test_more_than_24_references_can_continue_without_repeating_first_page(self):
        with self.sessions() as db:
            for index in range(24):
                domain.create_item(db, "alice", ItemCreate(name=f"其他纪念物{index}",
                    kind="nonstandard_object", photo_id="reference"))
        observed = []
        async def observe(settings, photos, references):
            observed.append([value["reference_item"] for value in references])
            return VisualMatches(matches=[])
        first = await self.call(observe)
        self.assertEqual(first.remaining_items, 1)
        self.assertEqual(first.examined_items, 24)
        second = await self.call(observe, exclude_item_ids=first.examined_item_ids)
        self.assertEqual(second.remaining_items, 0)
        self.assertEqual(second.examined_items, 1)
        self.assertEqual(len(observed), 2)
        self.assertEqual(set(first.examined_item_ids) & set(second.examined_item_ids), set())
        self.assertEqual(len(set(first.examined_item_ids + second.examined_item_ids)), 25)

    async def test_nine_references_are_observed_together_and_unseen_pages_do_not_auto_link(self):
        with self.sessions() as db:
            for index in range(8):
                domain.create_item(db, "alice", ItemCreate(name=f"无参考照物品{index}", kind="nonstandard_object"))
        spy = AsyncMock(return_value=self.observation())
        result = await self.call(spy, apply_confident=False)
        spy.assert_awaited_once()
        self.assertEqual(len(spy.call_args.args[2]), 9)
        with self.sessions() as db:
            for index in range(16):
                domain.create_item(db, "alice", ItemCreate(name=f"额外物品{index}", kind="nonstandard_object"))
        first = await self.call()
        self.assertEqual(first.remaining_items, 1)
        self.assertFalse(first.candidates[0].auto_linked)
        self.assertEqual(first.experience.item_ids, [])

    async def test_automatic_writer_discards_unlinked_old_evidence(self):
        with self.sessions() as db:
            row = db.get(ExperienceRecord, self.story["id"])
            row.provenance = {**row.provenance, "photo_associations": {
                "old-removed-item": {"photo_ids": ["scene"], "reference_detail": "旧私人细节"}}}
            db.commit()
        result = await self.call()
        self.assertNotIn("old-removed-item", result.experience.provenance["photo_associations"])

    async def test_provider_failure_does_not_undo_saved_story_or_leak_diagnostics(self):
        with self.assertRaises(domain.DomainError) as caught:
            await self.call(AsyncMock(side_effect=RuntimeError("secret-private-base64")))
        self.assertNotIn("secret", caught.exception.message)
        with self.sessions() as db:
            self.assertEqual(db.get(ExperienceRecord, self.story["id"]).text, self.story["text"])

    async def test_observer_sends_actual_reference_and_scene_blocks_through_sdk(self):
        model = SimpleNamespace(generate_structured_output=AsyncMock(
            return_value=SimpleNamespace(content={"matches": []})))
        with self.sessions() as db:
            scene = _image_block(db.get(Asset, "scene"))
            reference = _image_block(db.get(Asset, "reference"))
        await observe_photos(self.settings, [("scene", scene)], [
            {"reference_item": self.item["id"], "name": self.item["name"], "image": reference}], model=model)
        messages = model.generate_structured_output.call_args.args[0]
        blocks = messages[1].content
        self.assertIs(blocks[1], scene)
        self.assertIs(blocks[3], reference)
        self.assertIn("memory_photo", blocks[0].text)
        self.assertIn("reference_item", blocks[2].text)

    async def test_deleted_record_is_not_recreated(self):
        async def remove(*args):
            with self.sessions() as db:
                interactions.delete_experience(db, "alice", self.story["id"], 1)
            return self.observation()
        with self.assertRaises(domain.DomainError):
            await self.call(remove)
        with self.sessions() as db:
            self.assertIsNone(db.get(ExperienceRecord, self.story["id"]))


class PhotoMatchingHTTPTests(unittest.TestCase):
    def test_saved_story_survives_recognition_and_appears_under_item(self):
        with tempfile.TemporaryDirectory() as folder:
            app = create_app(Settings(data_dir=Path(folder), api_key="offline-no-provider", rea_enabled=False))
            try:
                with TestClient(app) as client:
                    client.post("/api/auth/register", json={"username": "photo_contract_user",
                        "password": "local-test-password", "display_name": "照片流程用户"}).raise_for_status()
                    body = io.BytesIO()
                    Image.new("RGB", (32, 24), "white").save(body, "JPEG")
                    uploaded = client.post("/api/assets", files={"file": ("fixture.jpg", body.getvalue(), "image/jpeg")}).json()["id"]
                    item = client.post("/api/items", json={"name": "手作纪念物", "kind": "nonstandard_object",
                                                           "photo_id": uploaded}).json()
                    self.assertEqual(client.post("/api/experiences", json={"title": "空白记录"}).status_code, 422)
                    story = client.post("/api/experiences", json={"title": "一起的下午",
                        "photo_ids": [uploaded], "allow_ai": False}).json()
                    self.assertEqual(story["text"], "")
                    answer = VisualMatches(matches=[{"item_id": item["id"], "photo_ids": [uploaded],
                        "verdict": "same_instance", "evidence_kind": "distinctive_detail",
                        "reference_detail": "单位测试假定的独特手绘图案", "observed_detail": "单位测试对应图案",
                        "explanation": "仅验证路由与共同关联，不作为视觉准确率证据。"}])
                    with patch("wujian.photo_matching.observe_photos", new=AsyncMock(return_value=answer)):
                        response = client.post(f"/api/experiences/{story['id']}/photo-matches",
                            json={"expected_version": 1, "apply_confident": True})
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    self.assertEqual(result["experience"]["id"], story["id"])
                    self.assertFalse(result["experience"]["allow_ai"])
                    linked = client.get("/api/experiences", params={"item_id": item["id"]}).json()
                    self.assertEqual([row["id"] for row in linked], [story["id"]])
                    self.assertEqual(linked[0]["text"], story["text"])
                    with patch("wujian.photo_matching.observe_photos", new=AsyncMock()) as observer:
                        stale = client.post(f"/api/experiences/{story['id']}/photo-matches", json={"expected_version": 1})
                    self.assertEqual(stale.status_code, 409)
                    observer.assert_not_awaited()
            finally:
                app.state.sessions.kw["bind"].dispose()


if __name__ == "__main__":
    unittest.main()
