from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from muse_backend.database.base import Base, SoftDeleteMixin, TimestampMixin, UTCDateTime
from muse_backend.domain.enums import ImageProcessingState

if TYPE_CHECKING:
    from muse_backend.database.models.outfit import OutfitItem


class ClothingItem(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "clothing_items"
    __table_args__ = (
        CheckConstraint(
            "(purchase_price IS NULL AND purchase_currency IS NULL) OR "
            "(purchase_price IS NOT NULL AND purchase_currency IS NOT NULL)",
            name="purchase_value_pair",
        ),
        CheckConstraint("purchase_price IS NULL OR purchase_price >= 0", name="price_nonnegative"),
        CheckConstraint(
            "image_processing_state IN "
            "('not_requested', 'pending', 'processing', 'completed', "
            "'completed_with_fallback', 'failed')",
            name="processing_state",
        ),
        CheckConstraint("processing_attempts >= 0", name="processing_attempts_nonnegative"),
        Index("ix_clothing_items_active_order", "deleted_at", "updated_at", "created_at", "id"),
        Index("ix_clothing_items_active_category", "deleted_at", "garment_category"),
        Index(
            "ix_clothing_items_category_order",
            "deleted_at",
            "garment_category",
            "updated_at",
            "created_at",
            "id",
        ),
        Index(
            "ix_clothing_items_processing_queue",
            "image_processing_state",
            "created_at",
            "id",
        ),
        Index(
            "uq_clothing_items_import_idempotency_key",
            "import_idempotency_key",
            unique=True,
            sqlite_where=text("import_idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    garment_category: Mapped[str] = mapped_column(String(32), nullable=False)
    default_body_zone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size: Mapped[str | None] = mapped_column(String(60), nullable=True)
    color_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    material: Mapped[str | None] = mapped_column(String(200), nullable=True)
    season: Mapped[str | None] = mapped_column(String(120), nullable=True)
    purchase_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    purchase_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_processing_state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=ImageProcessingState.NOT_REQUESTED.value,
        server_default=ImageProcessingState.NOT_REQUESTED.value,
    )
    processing_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    processing_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    processing_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    processing_completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    import_idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    images: Mapped[list["ClothingImage"]] = relationship(
        back_populates="clothing_item",
        cascade="all, delete-orphan",
        order_by=lambda: (ClothingImage.created_at, ClothingImage.id),
        passive_deletes=True,
    )
    outfit_items: Mapped[list["OutfitItem"]] = relationship(
        back_populates="clothing_item",
        passive_deletes=True,
    )


class ClothingImage(TimestampMixin, Base):
    __tablename__ = "clothing_images"
    __table_args__ = (
        CheckConstraint("width > 0", name="width_positive"),
        CheckConstraint("height > 0", name="height_positive"),
        CheckConstraint("byte_size > 0", name="byte_size_positive"),
        CheckConstraint(
            "image_kind IN ('original', 'normalized', 'thumbnail', 'cutout')",
            name="kind_supported",
        ),
        CheckConstraint(
            "content_sha256 IS NULL OR "
            "(length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')",
            name="content_sha256_lower_hex",
        ),
        CheckConstraint(
            "length(image_group_id) = 32 AND image_group_id NOT GLOB '*[^0-9a-f]*'",
            name="image_group_id_lower_hex",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        Index(
            "uq_clothing_images_one_primary",
            "clothing_item_id",
            unique=True,
            sqlite_where=text("is_primary = 1"),
        ),
        Index("ix_clothing_images_item_order", "clothing_item_id", "created_at", "id"),
        Index(
            "ix_clothing_images_group_order",
            "clothing_item_id",
            "display_order",
            "image_group_id",
            "id",
        ),
        Index(
            "uq_clothing_images_group_kind",
            "clothing_item_id",
            "image_group_id",
            "image_kind",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clothing_item_id: Mapped[int] = mapped_column(
        ForeignKey("clothing_items.id", ondelete="RESTRICT"), nullable=False
    )
    image_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    image_group_id: Mapped[str] = mapped_column(String(32), nullable=False)
    display_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    clothing_item: Mapped[ClothingItem] = relationship(back_populates="images")
