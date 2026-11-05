"""Minimal shared identities plus the development fixture envelope.

This validates data shape and references, not product truth, authorization,
model quality, or hardware capabilities. Product behavior must not branch on
fixture IDs. Business API contracts will evolve from real vertical slices.
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Identifier = Annotated[str, Field(min_length=1)]
Text = Annotated[str, Field(min_length=1)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(Contract):
    id: Identifier
    url: HttpUrl
    title: Text
    checked_on: date
    checked_scope: Literal["product_identity_only"] = "product_identity_only"
    note: str = ""


class Product(Contract):
    id: Identifier
    brand: Text
    commercial_name: Text
    model: Text
    market: str = Field(min_length=2, description="Market code; CN means mainland China.")
    edition: Text
    hardware_revision: str | None = None
    firmware_version: str | None = None
    source_ids: list[Identifier] = Field(min_length=1)


class Person(Contract):
    id: Identifier
    display_name: Text


class Item(Contract):
    id: Identifier
    owner_id: Identifier
    name: Text
    kind: Literal["standard_product", "nonstandard_object"]
    product_id: Identifier | None = None
    personal_description: str = ""


class Experience(Contract):
    id: Identifier
    creator_id: Identifier
    title: Text
    text: Text
    occurred_on: date
    item_ids: list[Identifier] = Field(min_length=1)


class DevelopmentCatalog(Contract):
    """An explicitly simulated developer dataset, never a held-out acceptance set."""

    schema_version: Literal["0.1.0"] = "0.1.0"
    dataset_kind: Literal["development_simulation"]
    physical_devices_available: Literal[False]
    sources: list[Source]
    products: list[Product]
    people: list[Person]
    items: list[Item]
    experiences: list[Experience]

    @model_validator(mode="after")
    def check_references(self) -> "DevelopmentCatalog":
        collections = {
            "source": self.sources,
            "product": self.products,
            "person": self.people,
            "item": self.items,
            "experience": self.experiences,
        }
        ids: dict[str, set[str]] = {}
        all_ids: set[str] = set()
        for kind, rows in collections.items():
            identifiers = [row.id for row in rows]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"Duplicate {kind} identity.")
            ids[kind] = set(identifiers)
            if all_ids.intersection(identifiers):
                raise ValueError("Dataset identities must be globally unique.")
            all_ids.update(identifiers)

        for product in self.products:
            if product.market != "CN":
                raise ValueError("Development products must use mainland China market identities.")
            if not set(product.source_ids).issubset(ids["source"]):
                raise ValueError(f"Unknown source for product {product.id}.")
        for item in self.items:
            if item.kind == "standard_product" and item.product_id is None:
                raise ValueError("Standard product fixtures require an explicit product identity.")
            if item.owner_id not in ids["person"]:
                raise ValueError(f"Unknown owner for item {item.id}.")
            if item.product_id is not None and item.product_id not in ids["product"]:
                raise ValueError(f"Unknown product for item {item.id}.")
        for experience in self.experiences:
            if experience.creator_id not in ids["person"]:
                raise ValueError(f"Unknown creator for experience {experience.id}.")
            if not set(experience.item_ids).issubset(ids["item"]):
                raise ValueError(f"Unknown item for experience {experience.id}.")
            if len(experience.item_ids) != len(set(experience.item_ids)):
                raise ValueError("An experience links to each item once.")
        return self
