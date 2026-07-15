"""Add single-use local-network phone upload sessions.

Revision ID: 20260715_0003
Revises: 20260715_0002
Create Date: 2026-07-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260715_0003"
down_revision: str | Sequence[str] | None = "20260715_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC_NOW = sa.text("(strftime('%Y-%m-%d %H:%M:%f', 'now'))")


def upgrade() -> None:
    op.create_table(
        "phone_upload_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clothing_item_id", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_phone_upload_sessions_attempt_count_nonnegative",
        ),
        sa.CheckConstraint(
            "length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'",
            name="ck_phone_upload_sessions_id_lower_hex",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'opened', 'uploading', 'processing', "
            "'completed', 'failed', 'cancelled', 'expired')",
            name="ck_phone_upload_sessions_status_supported",
        ),
        sa.CheckConstraint(
            "length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'",
            name="ck_phone_upload_sessions_token_hash_lower_hex",
        ),
        sa.ForeignKeyConstraint(
            ["clothing_item_id"],
            ["clothing_items.id"],
            name="fk_phone_upload_sessions_clothing_item_id_clothing_items",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_phone_upload_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_phone_upload_sessions_token_hash"),
    )
    op.create_index(
        "ix_phone_upload_sessions_expiry",
        "phone_upload_sessions",
        ["status", "expires_at"],
    )
    op.create_index(
        "ix_phone_upload_sessions_retention",
        "phone_upload_sessions",
        ["status", "updated_at"],
    )
    op.create_index(
        "uq_phone_upload_sessions_clothing_item_id",
        "phone_upload_sessions",
        ["clothing_item_id"],
        unique=True,
        sqlite_where=sa.text("clothing_item_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_phone_upload_sessions_clothing_item_id",
        table_name="phone_upload_sessions",
    )
    op.drop_index("ix_phone_upload_sessions_retention", table_name="phone_upload_sessions")
    op.drop_index("ix_phone_upload_sessions_expiry", table_name="phone_upload_sessions")
    op.drop_table("phone_upload_sessions")
