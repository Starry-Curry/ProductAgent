"""An unknown past event date must not silently become its recording date."""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("experiences") as batch:
        batch.alter_column("occurred_on", existing_type=sa.String(), nullable=True)


def downgrade():
    raise RuntimeError("Restore the verified pre-0007 database and media backup; unknown dates cannot be invented for downgrade")
