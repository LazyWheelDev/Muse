"""Create Muse wardrobe, outfit, image, and settings tables.

Revision ID: 20260715_0001
Revises:
Create Date: 2026-07-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260715_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC_NOW = sa.text("(strftime('%Y-%m-%d %H:%M:%f', 'now'))")


def _timestamp_columns() -> tuple[sa.Column[object], sa.Column[object]]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "clothing_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("garment_category", sa.String(length=32), nullable=False),
        sa.Column("default_body_zone", sa.String(length=32), nullable=True),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("size", sa.String(length=60), nullable=True),
        sa.Column("color_name", sa.String(length=80), nullable=True),
        sa.Column("material", sa.String(length=200), nullable=True),
        sa.Column("season", sa.String(length=120), nullable=True),
        sa.Column("purchase_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("purchase_currency", sa.String(length=3), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *_timestamp_columns(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purchase_price IS NULL OR purchase_price >= 0",
            name="ck_clothing_items_price_nonnegative",
        ),
        sa.CheckConstraint(
            "(purchase_price IS NULL AND purchase_currency IS NULL) OR "
            "(purchase_price IS NOT NULL AND purchase_currency IS NOT NULL)",
            name="ck_clothing_items_purchase_value_pair",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_clothing_items"),
    )
    op.create_index(
        "ix_clothing_items_active_category",
        "clothing_items",
        ["deleted_at", "garment_category"],
    )
    op.create_index(
        "ix_clothing_items_active_order",
        "clothing_items",
        ["deleted_at", "updated_at", "created_at", "id"],
    )

    op.create_table(
        "outfits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("preview_image_path", sa.String(length=500), nullable=True),
        *_timestamp_columns(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_outfits"),
    )
    op.create_index(
        "ix_outfits_active_order",
        "outfits",
        ["deleted_at", "updated_at", "created_at", "id"],
    )

    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("value_type", sa.String(length=32), nullable=False),
        *_timestamp_columns(),
        sa.PrimaryKeyConstraint("key", name="pk_application_settings"),
    )

    op.create_table(
        "clothing_images",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("clothing_item_id", sa.Integer(), nullable=False),
        sa.Column("image_kind", sa.String(length=32), nullable=False),
        sa.Column("relative_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        *_timestamp_columns(),
        sa.CheckConstraint("byte_size > 0", name="ck_clothing_images_byte_size_positive"),
        sa.CheckConstraint("height > 0", name="ck_clothing_images_height_positive"),
        sa.CheckConstraint("width > 0", name="ck_clothing_images_width_positive"),
        sa.ForeignKeyConstraint(
            ["clothing_item_id"],
            ["clothing_items.id"],
            name="fk_clothing_images_clothing_item_id_clothing_items",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_clothing_images"),
        sa.UniqueConstraint("relative_path", name="uq_clothing_images_relative_path"),
    )
    op.create_index(
        "ix_clothing_images_item_order",
        "clothing_images",
        ["clothing_item_id", "created_at", "id"],
    )
    op.create_index(
        "uq_clothing_images_one_primary",
        "clothing_images",
        ["clothing_item_id"],
        unique=True,
        sqlite_where=sa.text("is_primary = 1"),
    )

    op.create_table(
        "outfit_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("outfit_id", sa.Integer(), nullable=False),
        sa.Column("clothing_item_id", sa.Integer(), nullable=False),
        sa.Column("body_zone", sa.String(length=32), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("scale", sa.Float(), nullable=False),
        sa.Column("rotation", sa.Float(), nullable=False),
        sa.Column("layer_index", sa.Integer(), nullable=False),
        *_timestamp_columns(),
        sa.CheckConstraint("layer_index >= 0", name="ck_outfit_items_layer_nonnegative"),
        sa.CheckConstraint(
            "position_x >= 0 AND position_x <= 1",
            name="ck_outfit_items_position_x_normalized",
        ),
        sa.CheckConstraint(
            "position_y >= 0 AND position_y <= 1",
            name="ck_outfit_items_position_y_normalized",
        ),
        sa.CheckConstraint(
            "rotation >= -180 AND rotation <= 180",
            name="ck_outfit_items_rotation_range",
        ),
        sa.CheckConstraint("scale >= 0.1 AND scale <= 4", name="ck_outfit_items_scale_range"),
        sa.ForeignKeyConstraint(
            ["clothing_item_id"],
            ["clothing_items.id"],
            name="fk_outfit_items_clothing_item_id_clothing_items",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["outfit_id"],
            ["outfits.id"],
            name="fk_outfit_items_outfit_id_outfits",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_outfit_items"),
        sa.UniqueConstraint(
            "outfit_id",
            "clothing_item_id",
            name="uq_outfit_items_outfit_clothing",
        ),
        sa.UniqueConstraint("outfit_id", "layer_index", name="uq_outfit_items_outfit_layer"),
    )
    op.create_index(
        "ix_outfit_items_order",
        "outfit_items",
        ["outfit_id", "layer_index", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_outfit_items_order", table_name="outfit_items")
    op.drop_table("outfit_items")
    op.drop_index("uq_clothing_images_one_primary", table_name="clothing_images")
    op.drop_index("ix_clothing_images_item_order", table_name="clothing_images")
    op.drop_table("clothing_images")
    op.drop_table("application_settings")
    op.drop_index("ix_outfits_active_order", table_name="outfits")
    op.drop_table("outfits")
    op.drop_index("ix_clothing_items_active_order", table_name="clothing_items")
    op.drop_index("ix_clothing_items_active_category", table_name="clothing_items")
    op.drop_table("clothing_items")
