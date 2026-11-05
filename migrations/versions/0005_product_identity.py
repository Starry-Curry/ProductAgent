"""Separate stable product identity from instance descriptions and source URLs."""

import hashlib
import json
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def product_identity(spec):
    # Frozen migration semantics: later application identity rules may evolve.
    fields = ("brand", "model", "market", "edition", "firmware_version")
    identity = {key: spec.get(key) for key in fields}
    normalized = {
        key: " ".join(
            unicodedata.normalize("NFKC", str(value or "")).split()
        ).casefold()
        for key, value in identity.items()
    }
    return hashlib.sha256(
        json.dumps(normalized, sort_keys=True).encode()
    ).hexdigest(), identity


def upgrade():
    op.add_column(
        "memories",
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "sources",
        sa.Column("origin", sa.String(), nullable=False, server_default="legacy"),
    )
    connection = op.get_bind()
    products = (
        connection.execute(sa.text("SELECT id,spec FROM products")).mappings().all()
    )
    for row in products:
        spec = json.loads(row["spec"]) if isinstance(row["spec"], str) else row["spec"]
        new_id, identity = product_identity(spec)
        if not connection.execute(
            sa.text("SELECT id FROM products WHERE id=:id"), {"id": new_id}
        ).first():
            connection.execute(
                sa.text("INSERT INTO products(id,spec) VALUES (:id,:spec)"),
                {"id": new_id, "spec": json.dumps(identity, ensure_ascii=False)},
            )
        instances = (
            connection.execute(
                sa.text("SELECT id,identity_notes FROM items WHERE product_id=:id"),
                {"id": row["id"]},
            )
            .mappings()
            .all()
        )
        for item in instances:
            notes = (
                json.loads(item["identity_notes"])
                if isinstance(item["identity_notes"], str)
                else item["identity_notes"]
            )
            connection.execute(
                sa.text(
                    "UPDATE items SET product_id=:product,identity_notes=:notes WHERE id=:id"
                ),
                {
                    "id": item["id"],
                    "product": new_id,
                    "notes": json.dumps({**spec, **(notes or {})}, ensure_ascii=False),
                },
            )
        connection.execute(
            sa.text(
                "UPDATE knowledge_claims SET product_id=:new WHERE product_id=:old"
            ),
            {"new": new_id, "old": row["id"]},
        )
        if new_id != row["id"]:
            connection.execute(
                sa.text("DELETE FROM products WHERE id=:id"), {"id": row["id"]}
            )


def downgrade():
    # Identity notes preserve the complete original per-instance specification.
    pass
