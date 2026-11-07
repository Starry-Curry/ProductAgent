"""Offline permission/race checks; these do not measure image-model quality.

The user and ownership are fictional, using an actual China-market illy Y3.3
as the modeled object. A small fixture isolates transport from paid rendering.
"""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select, update

from wujian import domain
from wujian.avatar_images import generation_endpoint, image_request
from wujian.config import Settings
from wujian.database import Asset, ItemRecord, Profile
from wujian.server import create_app


class AvatarImagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="offline-no-network", rea_enabled=False))
        self.owner = TestClient(self.app).__enter__()
        self.owner.post("/api/auth/demo/xiaolin")
        self.friend = TestClient(self.app)
        self.friend.post("/api/auth/demo/xiaoxia")
        picture = io.BytesIO()
        Image.new("RGB", (32, 32), "red").save(picture, format="PNG")
        self.picture = picture.getvalue()
        self.photo = self.owner.post("/api/assets", files={"file": ("illy.png", self.picture, "image/png")}).json()["id"]
        self.item = self.owner.post("/api/items", json={"name": "书房的红色咖啡机", "photo_id": self.photo,
            "product": {"brand": "illy", "model": "Y3.3", "market": "CN"},
            "avatar": {"enabled": True, "nickname": "小咖"}}).json()
        self.url = f'/api/items/{self.item["id"]}/avatar-image'

    def tearDown(self):
        self.friend.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def test_private_preview_is_not_applied_until_existing_item_writer_saves(self):
        with patch("wujian.avatar_images.generate_avatar_image", new=AsyncMock(return_value=(self.picture, {"model": "offline-fixture"}))):
            response = self.owner.post(self.url, json={"expected_version": 1})
        self.assertEqual(response.status_code, 200, response.text)
        image_id = response.json()["asset_id"]
        unchanged = self.owner.get(f'/api/items/{self.item["id"]}').json()
        self.assertIsNone(unchanged["avatar"]["image_id"])
        self.assertEqual(unchanged["version"], 1)
        self.assertEqual(self.friend.get(f"/api/assets/{image_id}").status_code, 404)
        response = self.owner.put(f'/api/items/{self.item["id"]}', json={
            key: self.item[key] for key in ("name", "kind", "product", "description", "state", "photo_id")
        } | {"expected_version": 1, "avatar": {"enabled": True, "nickname": "小咖", "image_id": image_id}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["avatar"]["image_id"], image_id)
        self.assertEqual(response.json()["photo_id"], self.photo)

    def test_preflight_denies_foreign_item_stale_version_and_missing_photo_without_provider(self):
        with patch("wujian.avatar_images.generate_avatar_image", new_callable=AsyncMock) as model:
            self.assertEqual(self.friend.post(self.url, json={"expected_version": 1}).status_code, 404)
            self.assertEqual(self.owner.post(self.url, json={"expected_version": 2}).status_code, 409)
            plain = self.owner.post("/api/items", json={"name": "朋友做的手工杯子", "kind": "nonstandard_object"}).json()
            self.assertEqual(self.owner.post(f'/api/items/{plain["id"]}/avatar-image', json={"expected_version": 1}).status_code, 400)
            model.assert_not_awaited()

    def test_late_render_does_not_attach_to_changed_item_or_save_orphan_asset(self):
        with self.app.state.sessions() as db:
            before = db.scalar(select(func.count()).select_from(Asset))
        async def changed(*args, **kwargs):
            with self.app.state.sessions() as db:
                db.execute(update(ItemRecord).where(ItemRecord.id == self.item["id"]).values(version=2))
                db.commit()
            return self.picture, {"model": "offline-fixture"}
        with patch("wujian.avatar_images.generate_avatar_image", side_effect=changed):
            response = self.owner.post(self.url, json={"expected_version": 1})
        self.assertEqual(response.status_code, 409, response.text)
        with self.app.state.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Asset)), before)
            self.assertIsNone(db.get(Profile, ("person_demo_owner", self.item["id"])).avatar.get("image_id"))

    def test_render_failure_keeps_original_portrait_and_can_retry(self):
        with patch("wujian.avatar_images.generate_avatar_image", new=AsyncMock(side_effect=domain.DomainError("服务暂时不可用", 502))):
            response = self.owner.post(self.url, json={"expected_version": 1})
        self.assertEqual(response.status_code, 502)
        unchanged = self.owner.get(f'/api/items/{self.item["id"]}').json()
        self.assertEqual(unchanged["avatar"]["nickname"], "小咖")
        self.assertEqual(unchanged["version"], 1)

    def test_region_is_kept_and_only_an_image_is_sent_as_reference(self):
        self.assertEqual(generation_endpoint("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
            "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
        self.assertTrue(generation_endpoint("https://abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1").startswith("https://abc.cn-beijing.maas.aliyuncs.com/"))
        payload = image_request(self.picture, item_name="红色illy Y3.3")
        blocks = payload["input"]["messages"][0]["content"]
        self.assertEqual(len([block for block in blocks if "image" in block]), 1)
        with self.assertRaises(domain.DomainError):
            image_request(b"not a photograph", item_name="杯子")


if __name__ == "__main__":
    unittest.main()
