from collections import defaultdict
from urllib.parse import quote

from muse_backend.database.models import ClothingImage, ClothingItem, Outfit, OutfitItem
from muse_backend.schemas.clothing import (
    ClothingImageGroupRead,
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
        image_group_id=image.image_group_id,
        display_order=image.display_order,
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
        "image_processing_state": item.image_processing_state,
        "processing_error_code": item.processing_error_code,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _image_groups(item: ClothingItem) -> list[ClothingImageGroupRead]:
    grouped: dict[str, list[ClothingImage]] = defaultdict(list)
    for image in item.images:
        grouped[image.image_group_id].append(image)
    preference = {"cutout": 0, "normalized": 1, "original": 2, "thumbnail": 3}
    rendered: list[ClothingImageGroupRead] = []
    for image_group_id, images in grouped.items():
        ordered = sorted(images, key=lambda image: (preference.get(image.image_kind, 99), image.id))
        display = next(
            (
                image
                for image in ordered
                if image.image_kind in {"cutout", "normalized", "original"}
            ),
            ordered[0],
        )
        thumbnail = next(
            (image for image in ordered if image.image_kind == "thumbnail"),
            display,
        )
        original = next((image for image in ordered if image.image_kind == "original"), None)
        rendered.append(
            ClothingImageGroupRead(
                image_group_id=image_group_id,
                display_order=min(image.display_order for image in images),
                display_image=clothing_image_read(display),
                thumbnail_image=clothing_image_read(thumbnail),
                original_image=clothing_image_read(original) if original is not None else None,
                images=[clothing_image_read(image) for image in ordered],
            )
        )
    return sorted(
        rendered,
        key=lambda group: (
            group.display_order,
            group.image_group_id,
        ),
    )


def _primary_group(item: ClothingItem) -> ClothingImageGroupRead | None:
    groups = _image_groups(item)
    primary = next((image for image in item.images if image.is_primary), None)
    if primary is not None:
        return next(
            (group for group in groups if group.image_group_id == primary.image_group_id),
            None,
        )
    return groups[0] if groups else None


def clothing_summary(item: ClothingItem) -> ClothingItemSummary:
    primary_group = _primary_group(item)
    display = primary_group.display_image if primary_group is not None else None
    thumbnail = primary_group.thumbnail_image if primary_group is not None else None
    return ClothingItemSummary(
        **_clothing_metadata(item),
        primary_image=display,
        display_image=display,
        thumbnail_image=thumbnail,
    )


def clothing_detail(item: ClothingItem) -> ClothingItemDetail:
    ordered_images = sorted(
        item.images, key=lambda image: (not image.is_primary, image.created_at, image.id)
    )
    return ClothingItemDetail(
        **_clothing_metadata(item),
        images=[clothing_image_read(image) for image in ordered_images],
        image_groups=_image_groups(item),
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
