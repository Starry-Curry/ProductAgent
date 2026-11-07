"""Shared interaction metadata, households and explicit reminder feedback."""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("preferences", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("experiences", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    # Historical records retain their previous use; new records default to record-only in the API.
    op.add_column("experiences", sa.Column("allow_ai", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("conversations", sa.Column("entry_context", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("reminders", sa.Column("status", sa.String(), nullable=False, server_default="pending"))
    op.add_column("reminders", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("reminders", sa.Column("feedback", sa.JSON(), nullable=False, server_default="[]"))
    op.execute("UPDATE reminders SET status='completed' WHERE completed=true")
    op.create_table("households",
        sa.Column("id", sa.String(), primary_key=True), sa.Column("name", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False))
    op.create_table("household_members",
        sa.Column("household_id", sa.String(), sa.ForeignKey("households.id"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("status", sa.String(), nullable=False), sa.Column("role", sa.String(), nullable=False))
    op.create_table("household_items",
        sa.Column("household_id", sa.String(), sa.ForeignKey("households.id"), primary_key=True),
        sa.Column("item_id", sa.String(), sa.ForeignKey("items.id"), primary_key=True),
        sa.Column("shared_by", sa.String(), sa.ForeignKey("users.id"), nullable=False))
    with op.batch_alter_table("reminders") as batch:
        batch.add_column(sa.Column("household_id", sa.String(), sa.ForeignKey("households.id", name="fk_reminder_household"), nullable=True))
    op.create_table("wishes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False), sa.Column("note", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False), sa.Column("visible_to_friends", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False), sa.Column("created_at", sa.String(), nullable=False))
    op.create_index("ix_wishes_user_id", "wishes", ["user_id"])
    op.create_table("task_participants",
        sa.Column("task_id", sa.String(), sa.ForeignKey("tasks.id"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("status", sa.String(), nullable=False))
    op.create_table("experience_shares",
        sa.Column("experience_id", sa.String(), sa.ForeignKey("experiences.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True))


def downgrade():
    # An intentional rollback is allowed only after restoring a verified backup;
    # silently discarding membership, feedback and use permissions is not reversible.
    raise RuntimeError("Restore the verified pre-0006 database and assets backup to roll back")
