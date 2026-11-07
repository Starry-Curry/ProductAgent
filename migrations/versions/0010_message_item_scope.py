"""Retain message object scope, including existing pre-merge feature databases."""
import sqlalchemy as sa
from alembic import op
revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None
def upgrade():
    inspector=sa.inspect(op.get_bind())
    if "item_ids" not in {column["name"] for column in inspector.get_columns("messages")}:
        op.add_column("messages",sa.Column("item_ids",sa.JSON(),nullable=False,server_default="[]"))
    date=next(column for column in inspector.get_columns("experiences") if column["name"]=="occurred_on")
    if not date["nullable"]:
        with op.batch_alter_table("experiences") as batch:
            batch.alter_column("occurred_on",existing_type=sa.String(),nullable=True)
def downgrade():
    raise RuntimeError("Restore the pre-0010 database and media backup; historical object scope must be retained")
