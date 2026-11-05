"""Retain story authorship independently of the account holding a gift copy."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "experiences",
        sa.Column("provenance", sa.JSON(), nullable=False, server_default="{}"),
    )
    connection = op.get_bind()
    rows = (
        connection.execute(
            sa.text(
                "SELECT experiences.id, experiences.creator_id, experiences.origin_id, users.display_name FROM experiences JOIN users ON users.id=experiences.creator_id"
            )
        )
        .mappings()
        .all()
    )
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        original = row
        visited = set()
        while original["origin_id"] in by_id and original["id"] not in visited:
            visited.add(original["id"])
            original = by_id[original["origin_id"]]
        provenance = {
            "kind": "received_story" if row["origin_id"] else "authored_record"
        }
        if not original["origin_id"]:
            provenance.update(
                author_id=original["creator_id"], author_name=original["display_name"]
            )
        connection.execute(
            sa.text("UPDATE experiences SET provenance=:value WHERE id=:id"),
            {"id": row["id"], "value": json.dumps(provenance, ensure_ascii=False)},
        )


def downgrade():
    op.drop_column("experiences", "provenance")
