"""Offline import safety: synthetic owners, domestic models, no provider calls."""
import tempfile
import unittest
import hashlib
import json
import copy
from pathlib import Path

from PIL import Image
from sqlalchemy import func, select

from scripts.import_demo_inventory import CATALOG_ORIGIN, import_inventory, read_catalog, DEFAULT_CATALOG
from wujian import domain, interactions
from wujian.api_models import AvatarSpec, ItemCreate
from wujian.config import Settings
from wujian.database import Asset, HouseholdItem, ItemRecord, User, make_database


class DemoInventoryImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        settings = Settings(data_dir=self.root)
        settings.prepare()
        self.engine, sessions = make_database(settings)
        self.db = sessions()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.db.add_all([User(id=value, username=value, display_name=value, password_hash="unused")
                         for value in ("owner", "other")])
        self.db.commit()
        self.household = interactions.create_household(self.db, "owner", "模拟家庭")["id"]
        self.catalog = read_catalog(DEFAULT_CATALOG)
        self.catalog = {**self.catalog, "items": self.catalog["items"][:2]}
        self.photos = self.root / "prepared-photos"
        self.photos.mkdir()
        for row in self.catalog["items"]:
            path = self.photos / (row["key"] + ".jpg")
            Image.new("RGB", (8, 8), "white").save(path)
            path.with_suffix(".source.json").write_text(json.dumps({"image_url": row["image_url"],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}), encoding="utf-8")

    def perform(self, *, apply=False, actor="owner", household=None):
        return import_inventory(self.db, actor, household or self.household, self.catalog,
                                self.photos, self.root / "assets", apply=apply)

    def test_dry_run_writes_nothing_and_repeat_apply_is_idempotent(self):
        planned = self.perform()
        self.assertEqual([entry["status"] for entry in planned], ["would_create"] * 2)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ItemRecord)), 0)
        self.perform(apply=True)
        first = [(row.id, row.version, row.photo_id) for row in self.db.scalars(select(ItemRecord))]
        self.assertEqual(len(first), 2)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(HouseholdItem)), 2)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Asset)), 2)
        again = self.perform(apply=True)
        self.assertEqual([entry["status"] for entry in again], ["already_imported"] * 2)
        self.assertEqual(first, [(row.id, row.version, row.photo_id) for row in self.db.scalars(select(ItemRecord))])
        for row in self.db.scalars(select(ItemRecord)):
            self.assertEqual(row.state["data_origin"], CATALOG_ORIGIN)
            self.assertEqual(row.state["ownership"], "simulated")

    def test_existing_same_model_and_other_owner_records_are_not_rewritten(self):
        payload = ItemCreate.model_validate(self.catalog["items"][0]["item"])
        payload.name = "真实用户自己起的名字"
        payload.state = {"location": "用户自定位置"}
        old = domain.create_item(self.db, "owner", payload)
        other = domain.create_item(self.db, "other", payload)
        receipt = self.perform(apply=True)
        self.assertEqual(receipt[0]["status"], "existing_model_untouched")
        for identity in (old["id"], other["id"]):
            row = self.db.get(ItemRecord, identity)
            self.assertEqual(row.name, "真实用户自己起的名字")
            self.assertEqual(row.state, {"location": "用户自定位置"})
            self.assertIsNone(row.photo_id)
        self.assertIsNone(self.db.get(HouseholdItem, (self.household, old["id"])))

    def test_household_permission_checked_before_any_write(self):
        with self.assertRaises(domain.DomainError):
            self.perform(apply=True, actor="other")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ItemRecord)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Asset)), 0)

    def test_all_photos_checked_before_first_item_write(self):
        (self.photos / (self.catalog["items"][1]["key"] + ".jpg")).unlink()
        with self.assertRaises(ValueError):
            self.perform(apply=True)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ItemRecord)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Asset)), 0)

    def test_stale_photo_source_rejected_before_any_write(self):
        self.catalog["items"][1]["image_url"] += "?changed-product-image"
        with self.assertRaises(ValueError):
            self.perform(apply=True)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ItemRecord)), 0)

    def test_refresh_is_limited_to_marked_demo_and_keeps_business_content(self):
        demo = "person_demo_owner"
        self.db.add(User(id=demo, username=demo, display_name="小林", password_hash="unused"))
        self.db.commit()
        row = self.catalog["items"][0]
        payload = ItemCreate.model_validate(row["item"])
        payload.name = "不改我的物品名"
        payload.description = "不改我的私人解释"
        payload.avatar = AvatarSpec(nickname="小盒", enabled=True, personality="安静")
        payload.state = {"data_origin": "development_simulation", "location": "原位置"}
        old = domain.create_item(self.db, demo, payload)
        single = {**self.catalog, "items": [row]}
        receipt = import_inventory(self.db, demo, None, single, self.photos, self.root / "assets",
                                   apply=True, refresh_demo_photos=True)
        self.assertEqual(receipt[0]["status"], "refresh_photo")
        updated = domain.item_view(self.db, demo, self.db.get(ItemRecord, old["id"]))
        for field in ("name", "description", "product", "avatar"):
            self.assertEqual(updated[field], old[field], field)
        self.assertEqual({key: value for key, value in updated["state"].items()
                          if key not in {"photo_origin", "photo_source_url"}}, old["state"])
        self.assertEqual(updated["state"]["photo_origin"], "official_product_reference_not_user_photo")
        self.assertEqual(updated["state"]["photo_source_url"], row["image_url"])
        version = updated["version"]
        again = import_inventory(self.db, demo, None, single, self.photos, self.root / "assets",
                                 apply=True, refresh_demo_photos=True)
        self.assertEqual(again[0]["status"], "photo_already_current")
        self.assertEqual(self.db.get(ItemRecord, old["id"]).version, version)

    def test_refresh_rejects_non_demo_account(self):
        with self.assertRaises(ValueError):
            import_inventory(self.db, "owner", None, self.catalog, self.photos, self.root / "assets",
                             apply=True, refresh_demo_photos=True)

    def test_verified_flag_does_not_replace_standard_product_identity(self):
        for field, value in (("brand", ""), ("model", "  "), ("commercial_name", ""),
                             ("source_urls", []), ("source_urls", ["not-a-source"]),
                             ("market", "US")):
            with self.subTest(field=field, value=value):
                data = copy.deepcopy(self.catalog)
                data["items"][0]["item"]["product"][field] = value
                path = self.root / "incomplete-catalog.json"
                path.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_catalog(path)


if __name__ == "__main__":
    unittest.main()
