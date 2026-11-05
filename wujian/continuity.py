"""Continue public product evidence without transferring private interpretations."""

from sqlalchemy import select

from .database import Asset, KnowledgeClaim, SourceRecord, uid


def public_product_sources(db, user_id, item):
    if not item.product_id:
        return []
    rows = db.scalars(
        select(KnowledgeClaim).where(
            KnowledgeClaim.owner_id == user_id,
            KnowledgeClaim.product_id == item.product_id,
            KnowledgeClaim.basis == "document",
            KnowledgeClaim.status == "source_backed",
        )
    )
    result = {}
    for row in rows:
        source = db.get(SourceRecord, row.source_id)
        if (
            source
            and source.owner_id == user_id
            and source.origin == "public_web"
            and row.conditions.get("identity_match") == "model_text_matched"
        ):
            result.setdefault(source.id, (source, row))
    return list(result.values())


def copy_public_evidence(db, sender_id, recipient_id, item, source_ids):
    selected = set(source_ids)
    for source, claim in public_product_sources(db, sender_id, item):
        if source.id not in selected:
            continue
        copied_asset = None
        if source.asset_id:
            original = db.get(Asset, source.asset_id)
            if original and original.owner_id == sender_id:
                copied_asset = Asset(
                    id=uid(),
                    owner_id=recipient_id,
                    path=original.path,
                    media_type=original.media_type,
                    original_name=original.original_name,
                )
                db.add(copied_asset)
        copied = SourceRecord(
            id=uid(),
            owner_id=recipient_id,
            item_id=item.id,
            title=source.title,
            url=source.url,
            content=source.content,
            pages=source.pages,
            asset_id=copied_asset.id if copied_asset else None,
            origin="public_web",
        )
        db.add(copied)
        db.flush()
        # The transferable fact is the public source excerpt, not the giver's
        # free-form interpretation, personal conditions or private failures.
        db.add(
            KnowledgeClaim(
                owner_id=recipient_id,
                product_id=item.product_id,
                content=claim.source_quote,
                conditions={
                    "kind": "source_excerpt",
                    "identity_match": "model_text_matched",
                    "requirements": [],
                    "limits": [],
                    "unknowns": ["具体操作条件需结合原始全文核对"],
                },
                basis="document",
                source_id=copied.id,
                source_quote=claim.source_quote,
                source_message_id="gift_public_evidence",
                status="source_backed",
            )
        )
