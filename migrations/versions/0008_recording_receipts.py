"""Retain exact recording-tool results on their originating user messages."""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("recorded_experiences", sa.JSON(),
        nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    raise RuntimeError("Restore the verified pre-0008 backup; dropping recording receipts can replay deleted records")
