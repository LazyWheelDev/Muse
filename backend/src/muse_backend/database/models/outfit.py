from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from muse_backend.database.base import Base, SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from muse_backend.database.models.clothing import ClothingItem


class Outfit(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "outfits"
    __table_args__ = (
        Index("ix_outfits_active_order", "deleted_at", "updated_at", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    preview_image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    items: Mapped[list["OutfitItem"]] = relationship(
        back_populates="outfit",
        cascade="all, delete-orphan",
        order_by=lambda: (OutfitItem.layer_index, OutfitItem.id),
        passive_deletes=True,
    )


class OutfitItem(TimestampMixin, Base):
    __tablename__ = "outfit_items"
    __table_args__ = (
        CheckConstraint("position_x >= 0 AND position_x <= 1", name="position_x_normalized"),
        CheckConstraint("position_y >= 0 AND position_y <= 1", name="position_y_normalized"),
        CheckConstraint("scale >= 0.1 AND scale <= 4", name="scale_range"),
        CheckConstraint("rotation >= -180 AND rotation <= 180", name="rotation_range"),
        CheckConstraint("layer_index >= 0", name="layer_nonnegative"),
        UniqueConstraint("outfit_id", "layer_index", name="uq_outfit_items_outfit_layer"),
        UniqueConstraint("outfit_id", "clothing_item_id", name="uq_outfit_items_outfit_clothing"),
        Index("ix_outfit_items_order", "outfit_id", "layer_index", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    outfit_id: Mapped[int] = mapped_column(
        ForeignKey("outfits.id", ondelete="CASCADE"), nullable=False
    )
    clothing_item_id: Mapped[int] = mapped_column(
        ForeignKey("clothing_items.id", ondelete="RESTRICT"), nullable=False
    )
    body_zone: Mapped[str] = mapped_column(String(32), nullable=False)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    scale: Mapped[float] = mapped_column(Float, nullable=False)
    rotation: Mapped[float] = mapped_column(Float, nullable=False)
    layer_index: Mapped[int] = mapped_column(Integer, nullable=False)

    outfit: Mapped[Outfit] = relationship(back_populates="items")
    clothing_item: Mapped["ClothingItem"] = relationship(back_populates="outfit_items")
