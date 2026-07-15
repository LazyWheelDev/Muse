from urllib.parse import quote

from muse_backend.database.models import ClothingImage, ClothingItem, Outfit, OutfitItem
from muse_backend.schemas.clothing import (
    ClothingImageRead,
    ClothingItemDetail,
    ClothingItemSummary,
    ClothingReferenceRead,
)
from muse_backend.schemas.outfit import OutfitDetail, OutfitItemRead, OutfitSummary


def _media_url(relative_path: str) -> str:
    return f"/api/v1/media/{quote(relative_path, safe='/')}"


def clothing_image_read(image: ClothingImage) -> ClothingImageRead:
    return ClothingImageRead(
        id=image.id,
        image_kind=image.image_kind,
        mime_type=image.mime_type,
        width=image.width,
        height=image.height,
        byte_size=image.byte_size,
        is_primary=image.is_primary,
        created_at=image.created_at,
        updated_at=image.updated_at,
        content_url=_media_url(image.relative_path),
    )


def _clothing_metadata(item: ClothingItem) -> dict[str, object]:
    return {
        "id": item.id,
        "name": item.name,
        "garment_category": item.garment_category,
        "default_body_zone": item.default_body_zone,
        "brand": item.brand,
        "size": item.size,
        "color_name": item.color_name,
        "material": item.material,
        "season": item.season,
        "purchase_price": item.purchase_price,
        "purchase_currency": item.purchase_currency,
        "purchase_date": item.purchase_date,
        "notes": item.notes,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def clothing_summary(item: ClothingItem) -> ClothingItemSummary:
    primary = next((image for image in item.images if image.is_primary), None)
    return ClothingItemSummary(
        **_clothing_metadata(item),
        primary_image=clothing_image_read(primary) if primary is not None else None,
    )


def clothing_detail(item: ClothingItem) -> ClothingItemDetail:
    ordered_images = sorted(
        item.images, key=lambda image: (not image.is_primary, image.created_at, image.id)
    )
    return ClothingItemDetail(
        **_clothing_metadata(item),
        images=[clothing_image_read(image) for image in ordered_images],
    )


def clothing_reference(item: ClothingItem) -> ClothingReferenceRead:
    primary = next((image for image in item.images if image.is_primary), None)
    return ClothingReferenceRead(
        id=item.id,
        name=item.name,
        garment_category=item.garment_category,
        deleted_at=item.deleted_at,
        primary_image=clothing_image_read(primary) if primary is not None else None,
    )


def outfit_item_read(item: OutfitItem) -> OutfitItemRead:
    clothing = item.clothing_item
    return OutfitItemRead(
        id=item.id,
        clothing_item_id=item.clothing_item_id,
        clothing_item_status="deleted" if clothing.deleted_at is not None else "active",
        clothing_item=clothing_reference(clothing),
        body_zone=item.body_zone,
        position_x=item.position_x,
        position_y=item.position_y,
        scale=item.scale,
        rotation=item.rotation,
        layer_index=item.layer_index,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def outfit_summary(outfit: Outfit, *, item_count: int | None = None) -> OutfitSummary:
    return OutfitSummary(
        id=outfit.id,
        name=outfit.name,
        item_count=len(outfit.items) if item_count is None else item_count,
        preview_url=(
            _media_url(outfit.preview_image_path) if outfit.preview_image_path is not None else None
        ),
        created_at=outfit.created_at,
        updated_at=outfit.updated_at,
    )


def outfit_detail(outfit: Outfit) -> OutfitDetail:
    ordered_items = sorted(outfit.items, key=lambda item: (item.layer_index, item.id))
    return OutfitDetail(
        **outfit_summary(outfit).model_dump(),
        items=[outfit_item_read(item) for item in ordered_items],
        deleted_at=outfit.deleted_at,
    )
