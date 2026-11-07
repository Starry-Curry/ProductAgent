"""Explicit family audience for the original authored experience."""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "sqlite":
        # SQLite permits a nullable REFERENCES column directly. Rebuilding the
        # parent table would risk cascading deletion of existing story shares.
        op.execute("ALTER TABLE experiences ADD COLUMN household_id VARCHAR REFERENCES households(id)")
    else:
        op.add_column("experiences", sa.Column("household_id", sa.String(),
            sa.ForeignKey("households.id"), nullable=True))
    op.create_index("ix_experiences_household_id", "experiences", ["household_id"])


def downgrade():
    raise RuntimeError("Restore the verified pre-0009 backup; removing family audience would lose sharing intent")
