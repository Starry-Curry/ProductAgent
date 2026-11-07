"""Read source evidence through ownership or an actual shared product grant."""

from . import domain
from .database import ItemRecord, SourceRecord


def readable_source(db, user_id, source_id):
    source = domain.require(db.get(SourceRecord, source_id))
    if source.owner_id == user_id:
        return source
    if source.item_id and source.origin == "public_web":
        try:
            domain.accessible_item(db, user_id, source.item_id)
            from .continuity import public_product_sources
            item = db.get(ItemRecord, source.item_id)
            if item and any(candidate.id == source.id for candidate, _ in
                            public_product_sources(db, source.owner_id, item)):
                return source
        except domain.DomainError:
            pass
    if source.origin == "public_web":
        from .continuity import public_product_sources

        for item in domain.list_items(db, user_id):
            if item["access"] == "shared" and item["owner_id"] == source.owner_id:
                row = db.get(ItemRecord, item["id"])
                if any(
                    candidate.id == source.id
                    for candidate, _ in public_product_sources(db, source.owner_id, row)
                ):
                    return source
    raise domain.DomainError("没有找到或无权访问这份资料", 404)
