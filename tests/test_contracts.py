import copy
import unittest
from pathlib import Path

from pydantic import ValidationError

from wujian.contracts import DevelopmentCatalog, Item

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/development/catalog.json"


class SharedIdentityTests(unittest.TestCase):
    def setUp(self):
        self.catalog = DevelopmentCatalog.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
        self.data = self.catalog.model_dump(mode="json")

    def test_one_experience_links_multiple_existing_items_without_copying_it(self):
        experience = self.catalog.experiences[0]
        linked = {item.id: item for item in self.catalog.items if item.id in experience.item_ids}
        self.assertEqual(len(linked), 2)
        self.assertEqual({item.kind for item in linked.values()}, {"standard_product", "nonstandard_object"})
        self.assertEqual(sum(row.id == experience.id for row in self.catalog.experiences), 1)

    def test_unresolved_foreign_market_is_rejected_for_this_development_dataset(self):
        self.data["products"][0]["market"] = "US"
        with self.assertRaisesRegex(ValidationError, "mainland China"):
            DevelopmentCatalog.model_validate(self.data)

    def test_dangling_reference_is_rejected_instead_of_inventing_an_item(self):
        self.data["experiences"][0]["item_ids"].append("item_does_not_exist")
        with self.assertRaisesRegex(ValidationError, "Unknown item"):
            DevelopmentCatalog.model_validate(self.data)

    def test_nonstandard_object_has_no_fabricated_sku(self):
        item = next(item for item in self.catalog.items if item.kind == "nonstandard_object")
        self.assertIsNone(item.product_id)
        self.assertEqual(Item.model_validate(item.model_dump()).id, item.id)

    def test_runtime_item_can_wait_for_identity_but_seeded_product_must_be_explicit(self):
        item = Item(id="new_photo", owner_id="person_demo_owner", name="刚拍到的设备", kind="standard_product")
        self.assertIsNone(item.product_id)
        self.data["items"].append(item.model_dump(mode="json"))
        with self.assertRaisesRegex(ValidationError, "explicit product identity"):
            DevelopmentCatalog.model_validate(self.data)

    def test_missing_product_source_is_rejected(self):
        self.data["sources"] = []
        with self.assertRaisesRegex(ValidationError, "Unknown source"):
            DevelopmentCatalog.model_validate(self.data)

    def test_duplicate_item_cannot_silently_overwrite_shared_identity(self):
        duplicate = copy.deepcopy(self.data["items"][0])
        duplicate["name"] = "另一个同ID对象"
        self.data["items"].append(duplicate)
        with self.assertRaisesRegex(ValidationError, "Duplicate item"):
            DevelopmentCatalog.model_validate(self.data)

    def test_simulation_cannot_be_relabelled_as_hardware_acceptance(self):
        self.data["physical_devices_available"] = True
        with self.assertRaises(ValidationError):
            DevelopmentCatalog.model_validate(self.data)


if __name__ == "__main__":
    unittest.main()
