"""Add garment import grouping, hashing, and processing state.

Revision ID: 20260715_0002
Revises: 20260715_0001
Create Date: 2026-07-15
"""

from collections import Counter, defaultdict
from collections.abc import Sequence
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from alembic import op

revision: str = "20260715_0002"
down_revision: str | Sequence[str] | None = "20260715_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROCESSING_STATES = (
    "not_requested",
    "pending",
    "processing",
    "completed",
    "completed_with_fallback",
    "failed",
)
IMAGE_KINDS = ("original", "normalized", "thumbnail", "cutout")


def _legacy_group_id(scope: str) -> str:
    """Return a stable, portable lower-hex identifier for a legacy image group."""
    return uuid5(NAMESPACE_URL, f"urn:muse:legacy-image-group:{scope}").hex


def _backfill_legacy_images() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            """
            SELECT id, clothing_item_id, image_kind
            FROM clothing_images
            ORDER BY clothing_item_id, created_at, id
            """
        )
    ).mappings()

    by_item: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for row in rows:
        image_id = int(row["id"])
        clothing_item_id = int(row["clothing_item_id"])
        image_kind = str(row["image_kind"])
        canonical_kind = "normalized" if image_kind == "processed" else image_kind
        if canonical_kind not in IMAGE_KINDS:
            raise RuntimeError(
                "Cannot migrate clothing image with unsupported legacy image kind "
                f"{image_kind!r} (image id {image_id})."
            )
        by_item[clothing_item_id].append((image_id, canonical_kind))

    update_image = sa.text(
        """
        UPDATE clothing_images
        SET image_kind = :image_kind,
            image_group_id = :image_group_id,
            display_order = :display_order
        WHERE id = :image_id
        """
    )
    for clothing_item_id, images in by_item.items():
        kinds = Counter(kind for _, kind in images)
        conflicting_kinds = any(count > 1 for count in kinds.values())
        shared_group_id = _legacy_group_id(f"clothing-item:{clothing_item_id}")

        for position, (image_id, image_kind) in enumerate(images):
            image_group_id = (
                _legacy_group_id(f"clothing-image:{image_id}")
                if conflicting_kinds
                else shared_group_id
            )
            connection.execute(
                update_image,
                {
                    "image_id": image_id,
                    "image_kind": image_kind,
                    "image_group_id": image_group_id,
                    "display_order": position if conflicting_kinds else 0,
                },
            )


def upgrade() -> None:
    # These are column-level checks so SQLite can evolve this parent table in place.
    # Rebuilding it would violate clothing_images/outfit_items foreign keys when data exists.
    op.add_column(
        "clothing_items",
        sa.Column(
            "image_processing_state",
            sa.String(length=32),
            sa.CheckConstraint(
                f"image_processing_state IN {PROCESSING_STATES!r}",
                name="ck_clothing_items_processing_state",
            ),
            server_default="not_requested",
            nullable=False,
        ),
    )
    op.add_column(
        "clothing_items",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            sa.CheckConstraint(
                "processing_attempts >= 0",
                name="ck_clothing_items_processing_attempts_nonnegative",
            ),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "clothing_items",
        sa.Column("processing_error_code", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "clothing_items",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "clothing_items",
        sa.Column("processing_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "clothing_items",
        sa.Column("import_idempotency_key", sa.String(length=64), nullable=True),
    )

    op.create_index(
        "ix_clothing_items_category_order",
        "clothing_items",
        ["deleted_at", "garment_category", "updated_at", "created_at", "id"],
    )
    op.create_index(
        "ix_clothing_items_processing_queue",
        "clothing_items",
        ["image_processing_state", "created_at", "id"],
    )
    op.create_index(
        "uq_clothing_items_import_idempotency_key",
        "clothing_items",
        ["import_idempotency_key"],
        unique=True,
        sqlite_where=sa.text("import_idempotency_key IS NOT NULL"),
    )

    op.add_column(
        "clothing_images",
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "clothing_images",
        sa.Column("image_group_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "clothing_images",
        sa.Column(
            "display_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    _backfill_legacy_images()

    with op.batch_alter_table("clothing_images", recreate="always") as batch_op:
        batch_op.alter_column(
            "image_group_id",
            existing_type=sa.String(length=32),
            nullable=False,
        )
        batch_op.create_check_constraint(
            "ck_clothing_images_kind_supported",
            f"image_kind IN {IMAGE_KINDS!r}",
        )
        batch_op.create_check_constraint(
            "ck_clothing_images_content_sha256_lower_hex",
            "content_sha256 IS NULL OR "
            "(length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')",
        )
        batch_op.create_check_constraint(
            "ck_clothing_images_image_group_id_lower_hex",
            "length(image_group_id) = 32 AND image_group_id NOT GLOB '*[^0-9a-f]*'",
        )
        batch_op.create_check_constraint(
            "ck_clothing_images_display_order_nonnegative",
            "display_order >= 0",
        )

    op.create_index(
        "ix_clothing_images_group_order",
        "clothing_images",
        ["clothing_item_id", "display_order", "image_group_id", "id"],
    )
    op.create_index(
        "uq_clothing_images_group_kind",
        "clothing_images",
        ["clothing_item_id", "image_group_id", "image_kind"],
        unique=True,
    )


def downgrade() -> None:
    # Revision 0001 does not understand cutouts. Retain their generated files for
    # operator recovery, but remove their DB rows and restore a legacy-compatible
    # display primary before removing the new grouping columns.
    op.execute(sa.text("UPDATE clothing_images SET is_primary = 0 WHERE image_kind = 'cutout'"))
    op.execute(sa.text("DELETE FROM clothing_images WHERE image_kind = 'cutout'"))
    op.execute(
        sa.text(
            """
            UPDATE clothing_images
            SET is_primary = 1
            WHERE id IN (
                SELECT COALESCE(
                    (
                        SELECT normalized.id
                        FROM clothing_images AS normalized
                        WHERE normalized.clothing_item_id = item.id
                          AND normalized.image_kind = 'normalized'
                        ORDER BY normalized.created_at, normalized.id
                        LIMIT 1
                    ),
                    (
                        SELECT original.id
                        FROM clothing_images AS original
                        WHERE original.clothing_item_id = item.id
                          AND original.image_kind = 'original'
                        ORDER BY original.created_at, original.id
                        LIMIT 1
                    ),
                    (
                        SELECT fallback.id
                        FROM clothing_images AS fallback
                        WHERE fallback.clothing_item_id = item.id
                        ORDER BY fallback.created_at, fallback.id
                        LIMIT 1
                    )
                )
                FROM clothing_items AS item
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM clothing_images AS current_primary
                    WHERE current_primary.clothing_item_id = item.id
                      AND current_primary.is_primary = 1
                )
            )
            """
        )
    )
    op.drop_index("uq_clothing_images_group_kind", table_name="clothing_images")
    op.drop_index("ix_clothing_images_group_order", table_name="clothing_images")
    with op.batch_alter_table("clothing_images", recreate="always") as batch_op:
        batch_op.drop_constraint(
            "ck_clothing_images_display_order_nonnegative",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_clothing_images_image_group_id_lower_hex",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_clothing_images_content_sha256_lower_hex",
            type_="check",
        )
        batch_op.drop_constraint("ck_clothing_images_kind_supported", type_="check")
        batch_op.drop_column("display_order")
        batch_op.drop_column("image_group_id")
        batch_op.drop_column("content_sha256")

    # The original schema called the normalized display derivative "processed".
    op.execute(
        sa.text(
            "UPDATE clothing_images SET image_kind = 'processed' WHERE image_kind = 'normalized'"
        )
    )

    op.drop_index(
        "uq_clothing_items_import_idempotency_key",
        table_name="clothing_items",
    )
    op.drop_index("ix_clothing_items_processing_queue", table_name="clothing_items")
    op.drop_index("ix_clothing_items_category_order", table_name="clothing_items")
    op.drop_column("clothing_items", "import_idempotency_key")
    op.drop_column("clothing_items", "processing_completed_at")
    op.drop_column("clothing_items", "processing_started_at")
    op.drop_column("clothing_items", "processing_error_code")
    op.drop_column("clothing_items", "processing_attempts")
    op.drop_column("clothing_items", "image_processing_state")
