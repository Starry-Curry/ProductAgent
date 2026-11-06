"""Gift portrait ownership/lifecycle checks, no model or device calls.

People and possession are fictional. The pictured object is an illy Y3.3
available in China; tiny image fixtures isolate media ownership from rendering.
"""
import io
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, Gift, ItemRecord, KnowledgeClaim, Profile, SourceRecord
from wujian.server import create_app


class GiftPortraitTransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=False))
        self.sender = TestClient(self.app).__enter__()
        self.recipient = TestClient(self.app)
        self.third = TestClient(self.app)
        self.sender.post("/api/auth/demo/xiaolin")
        self.recipient.post("/api/auth/demo/xiaoxia")
        self.third.post("/api/auth/register", json={"username": "unrelated", "display_name": "无关用户（模拟）", "password": "offline-only-password"})
        self.portrait = self.upload(self.sender, "red")
        self.physical = self.upload(self.sender, "brown")
        self.item = self.ok(self.sender.post("/api/items", json={"name": "红色illy咖啡机", "photo_id": self.physical,
            "product": {"brand": "illy", "model": "Y3.3", "market": "CN"},
            "avatar": {"enabled": True, "nickname": "小咖", "image_id": self.portrait,
                "personality": "私密：最近在聊自己的工作焦虑", "growth_dismissed_ids": ["private-memory-id"]}}))

    def tearDown(self):
        self.third.close(); self.recipient.close(); self.sender.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def upload(self, client, color):
        image = io.BytesIO(); Image.new("RGB", (32, 32), color).save(image, "PNG")
        return self.ok(client.post("/api/assets", files={"file": ("portrait.png", image.getvalue(), "image/png")}))["id"]

    def send(self, **avatar):
        return self.sender.post("/api/gifts", json={"item_id": self.item["id"], "recipient_id": "person_demo_friend",
            "message": "愿小咖陪你把每个早晨过得轻松一点。", "experience_ids": [],
            "avatar": {"enabled": True, "nickname": "小咖", "image_id": self.portrait, **avatar}})

    def accept(self, gift):
        return self.recipient.post(f'/api/gifts/{gift["id"]}/accept', json={"wake_avatar": True, "allow_story_ai": False})

    def asset_count(self, owner):
        with self.app.state.sessions() as db:
            return db.scalar(select(func.count()).select_from(Asset).where(Asset.owner_id == owner))

    def test_selected_owned_portrait_is_readable_to_parties_only_and_private_personality_stays_out(self):
        self.assertEqual(self.recipient.get(f"/api/assets/{self.portrait}").status_code, 404)
        gift = self.ok(self.send(growth_dismissed_ids=["do-not-copy"], growth_enabled=False))
        avatar = gift["snapshot"]["avatar"]
        self.assertEqual(avatar["image_id"], self.portrait)
        self.assertEqual(avatar["personality"], "")
        self.assertEqual(avatar["growth_dismissed_ids"], [])
        self.assertTrue(avatar["growth_enabled"])
        self.assertEqual(self.recipient.get(f"/api/assets/{self.portrait}").status_code, 200)
        self.assertEqual(self.third.get(f"/api/assets/{self.portrait}").status_code, 404)
        self.assertEqual(self.asset_count("person_demo_friend"), 0)

    def test_foreign_image_and_shared_grant_do_not_grant_gifting_rights(self):
        other_image = self.upload(self.recipient, "blue")
        self.assertEqual(self.send(image_id=other_image).status_code, 404)
        with self.app.state.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Gift)), 0)
        self.ok(self.sender.post(f'/api/items/{self.item["id"]}/shares', json={"user_id": "person_demo_friend"}))
        self.assertEqual(self.recipient.get(f'/api/items/{self.item["id"]}').status_code, 200)
        attempt = self.recipient.post("/api/gifts", json={"item_id": self.item["id"], "recipient_id": "person_demo_owner",
            "message": "不能转赠别人的物品", "avatar": {"enabled": True, "image_id": self.portrait}})
        self.assertEqual(attempt.status_code, 404)

    def test_cancel_and_decline_revoke_preview_and_do_not_transfer(self):
        for action, actor in [("cancel", self.sender), ("decline", self.recipient)]:
            gift = self.ok(self.send())
            before = self.asset_count("person_demo_friend")
            self.ok(actor.post(f'/api/gifts/{gift["id"]}/decision', json={"action": action}))
            self.assertEqual(self.accept(gift).status_code, 409)
            self.assertEqual(self.asset_count("person_demo_friend"), before)
            self.assertEqual(self.recipient.get(f"/api/assets/{self.portrait}").status_code, 404)
            with self.app.state.sessions() as db:
                self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")

    def test_accept_copies_independent_bytes_is_idempotent_and_receiver_controls_changes(self):
        gift = self.ok(self.send())
        self.ok(self.accept(gift))
        received = self.ok(self.recipient.get(f'/api/items/{self.item["id"]}'))
        cloned_id = received["avatar"]["image_id"]
        self.assertNotEqual(cloned_id, self.portrait)
        with self.app.state.sessions() as db:
            original = db.get(Asset, self.portrait); copied = db.get(Asset, cloned_id)
            self.assertEqual(copied.owner_id, "person_demo_friend")
            self.assertNotEqual(copied.path, original.path)
            self.assertEqual(Path(copied.path).read_bytes(), Path(original.path).read_bytes())
            original_path = Path(original.path)
            db.delete(original); db.commit()
        original_path.unlink()
        self.assertEqual(self.recipient.get(f"/api/assets/{cloned_id}").status_code, 200)
        self.assertEqual(self.sender.get(f"/api/assets/{cloned_id}").status_code, 404)
        self.assertEqual(received["avatar"]["personality"], "")
        before = self.asset_count("person_demo_friend")
        self.ok(self.accept(gift))
        again = self.ok(self.recipient.get(f'/api/items/{self.item["id"]}'))
        self.assertEqual(again["avatar"]["image_id"], cloned_id)
        self.assertEqual(self.asset_count("person_demo_friend"), before)
        update = {key: received[key] for key in ("name", "kind", "product", "description", "state", "photo_id")}
        update.update(expected_version=received["version"], avatar={"enabled": True, "nickname": "我的小咖", "image_id": cloned_id})
        self.assertEqual(self.sender.put(f'/api/items/{self.item["id"]}', json=update).status_code, 404)
        edited = self.ok(self.recipient.put(f'/api/items/{self.item["id"]}', json=update))
        self.assertEqual(edited["avatar"]["nickname"], "我的小咖")

    def test_missing_source_before_accept_rolls_back_ownership_and_allows_repair(self):
        gift = self.ok(self.send())
        with self.app.state.sessions() as db:
            path = Path(db.get(Asset, self.portrait).path)
            data = path.read_bytes()
        path.unlink()
        response = self.accept(gift)
        self.assertEqual(response.status_code, 409, response.text)
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")
            self.assertEqual(db.get(Gift, gift["id"]).status, "pending")
        path.write_bytes(data)
        self.ok(self.accept(gift))

    def test_snapshot_grants_only_the_selected_picture(self):
        unselected = self.upload(self.sender, "green")
        self.ok(self.send())
        self.assertEqual(self.recipient.get(f"/api/assets/{unselected}").status_code, 404)
        self.assertEqual(self.recipient.get(f"/api/assets/{self.portrait}").status_code, 200)

    def test_non_image_asset_cannot_be_selected_or_copied(self):
        with self.app.state.sessions() as db:
            db.get(Asset, self.portrait).media_type = "application/pdf"
            db.commit()
        self.assertEqual(self.send().status_code, 400)
        with self.app.state.sessions() as db:
            db.get(Asset, self.portrait).media_type = "image/jpeg"
            db.commit()
        gift = self.ok(self.send())
        with self.app.state.sessions() as db:
            db.get(Asset, self.portrait).media_type = "application/pdf"
            db.commit()
        self.assertEqual(self.accept(gift).status_code, 409)
        self.assertEqual(self.asset_count("person_demo_friend"), 0)
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")
            self.assertEqual(db.get(Gift, gift["id"]).status, "pending")

    def test_stale_pending_read_cannot_overwrite_cancel_or_decline(self):
        for action, actor in [("cancel", self.sender), ("decline", self.recipient)]:
            with self.subTest(action=action):
                gift = self.ok(self.send())
                with self.app.state.sessions() as db:
                    stale = db.get(Gift, gift["id"])
                    self.assertEqual(stale.status, "pending")
                    self.ok(actor.post(f'/api/gifts/{gift["id"]}/decision', json={"action": action}))
                    with self.assertRaises(domain.DomainError) as caught:
                        domain.accept_gift(db, "person_demo_friend", gift["id"])
                    self.assertEqual(caught.exception.status, 409)
                    # Even a caller committing after catching the error cannot
                    # persist ownership, profiles or orphan recipient assets.
                    db.commit()
                    self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")
                    self.assertEqual(db.get(Gift, gift["id"]).status, "cancelled" if action == "cancel" else "declined")
                self.assertEqual(self.asset_count("person_demo_friend"), 0)

    def test_stale_acceptance_retry_preserves_first_recipient_choice(self):
        gift = self.ok(self.send())
        with self.app.state.sessions() as db:
            stale = db.get(Gift, gift["id"])
            self.assertEqual(stale.status, "pending")
            self.ok(self.accept(gift))
            received = self.ok(self.recipient.get(f'/api/items/{self.item["id"]}'))
            before = self.asset_count("person_demo_friend")
            from wujian.api_models import GiftAccept
            retried = domain.accept_gift(db, "person_demo_friend", gift["id"],
                acceptance=GiftAccept(wake_avatar=False, allow_story_ai=True))
            self.assertEqual(retried["status"], "accepted")
            profile = db.get(Profile, ("person_demo_friend", self.item["id"]))
            self.assertTrue(profile.avatar["enabled"])
            self.assertEqual(profile.avatar["image_id"], received["avatar"]["image_id"])
            self.assertEqual(self.asset_count("person_demo_friend"), before)

    def test_failure_before_portrait_copy_rolls_back_the_whole_business_operation(self):
        gift = self.ok(self.send())
        with self.app.state.sessions() as db:
            with patch("wujian.continuity.copy_public_evidence", side_effect=RuntimeError("offline failure")):
                with self.assertRaisesRegex(RuntimeError, "offline failure"):
                    domain.accept_gift(db, "person_demo_friend", gift["id"])
            db.commit()
            self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")
            self.assertEqual(db.get(Gift, gift["id"]).status, "pending")
            self.assertIsNone(db.get(Profile, ("person_demo_friend", self.item["id"])))
        self.assertEqual(self.asset_count("person_demo_friend"), 0)
        self.ok(self.accept(gift))

    def test_failed_copy_or_commit_removes_partial_files_and_recipient_assets(self):
        gift = self.ok(self.send())
        with self.app.state.sessions() as db:
            directory = Path(db.get(Asset, self.portrait).path).parent
        before = set(directory.iterdir())
        def partial_copy(source, destination):
            Path(destination).write_bytes(b"partial-image")
            raise OSError("offline disk failure")
        with patch("wujian.domain.shutil.copyfile", side_effect=partial_copy):
            self.assertEqual(self.accept(gift).status_code, 409)
        self.assertEqual(set(directory.iterdir()), before)
        self.assertEqual(self.asset_count("person_demo_friend"), 0)
        with self.app.state.sessions() as db:
            with patch.object(db, "commit", side_effect=RuntimeError("offline commit failure")):
                with self.assertRaisesRegex(RuntimeError, "offline commit failure"):
                    domain.accept_gift(db, "person_demo_friend", gift["id"])
            db.commit()
            self.assertEqual(db.get(ItemRecord, self.item["id"]).owner_id, "person_demo_owner")
            self.assertEqual(db.get(Gift, gift["id"]).status, "pending")
        self.assertEqual(set(directory.iterdir()), before)
        self.assertEqual(self.asset_count("person_demo_friend"), 0)
        self.ok(self.accept(gift))

    def test_public_sources_are_rechecked_at_acceptance_after_retirement_or_privatization(self):
        with self.app.state.sessions() as db:
            item = db.get(ItemRecord, self.item["id"])
            for identity in ("now-private", "retired-claim"):
                source = SourceRecord(id=identity, owner_id="person_demo_owner", item_id=item.id,
                    title="公开型号证据（模拟）", url="https://example.invalid/illy-y33",
                    content="selected public evidence", pages=[], origin="public_web")
                db.add(source)
                db.flush()
                db.add(KnowledgeClaim(id=identity, owner_id="person_demo_owner", product_id=item.product_id,
                    content="never copy private interpretation", conditions={"identity_match": "model_text_matched"},
                    basis="document", source_id=identity, source_quote="selected public evidence",
                    source_message_id="offline-fixture", status="source_backed"))
            db.commit()
        gift = self.ok(self.send())
        self.assertEqual(set(gift["snapshot"]["public_source_ids"]), {"now-private", "retired-claim"})
        with self.app.state.sessions() as db:
            db.get(SourceRecord, "now-private").origin = "private_upload"
            db.get(KnowledgeClaim, "retired-claim").status = "retired"
            db.commit()
        self.ok(self.accept(gift))
        with self.app.state.sessions() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(SourceRecord).where(
                SourceRecord.owner_id == "person_demo_friend")), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(KnowledgeClaim).where(
                KnowledgeClaim.owner_id == "person_demo_friend")), 0)

    def test_omitted_portrait_keeps_legacy_shape_and_explicit_gift_voice(self):
        response = self.sender.post("/api/gifts", json={"item_id": self.item["id"], "recipient_id": "person_demo_friend",
            "message": "早上记得吃点东西。", "avatar": {"enabled": True, "form": "cup", "personality": "温柔一点，提醒她按时吃早餐。"}})
        gift = self.ok(response)
        self.assertIsNone(gift["snapshot"]["avatar"]["image_id"])
        self.ok(self.accept(gift))
        received = self.ok(self.recipient.get(f'/api/items/{self.item["id"]}'))
        self.assertIsNone(received["avatar"]["image_id"])
        self.assertEqual(received["avatar"]["form"], "cup")
        self.assertEqual(received["avatar"]["personality"], "温柔一点，提醒她按时吃早餐。")


if __name__ == "__main__":
    unittest.main()
