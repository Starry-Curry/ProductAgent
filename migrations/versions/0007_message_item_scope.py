"""Snapshot photo/message object scope; later topic switches cannot relabel it."""
import sqlalchemy as sa
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('messages', sa.Column('item_ids', sa.JSON(), nullable=False, server_default='[]'))
    # Legacy conversations may already have changed focus. Do not invent a
    # historical object association by copying today's conversation scope.


def downgrade():
    op.drop_column('messages', 'item_ids')
