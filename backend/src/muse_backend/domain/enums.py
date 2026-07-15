from enum import StrEnum
from types import MappingProxyType


class GarmentCategory(StrEnum):
    HAT = "hat"
    SCARF = "scarf"
    TOP = "top"
    DRESS = "dress"
    PANTS = "pants"
    SHOES = "shoes"
    OUTERWEAR = "outerwear"
    ACCESSORY = "accessory"
    OTHER = "other"


class BodyZone(StrEnum):
    HEAD = "head"
    NECK = "neck"
    UPPER_BODY = "upper_body"
    FULL_BODY = "full_body"
    LOWER_BODY = "lower_body"
    FEET = "feet"
    ACCESSORY = "accessory"


class ImageKind(StrEnum):
    ORIGINAL = "original"
    NORMALIZED = "normalized"
    THUMBNAIL = "thumbnail"
    CUTOUT = "cutout"


class ImageProcessingState(StrEnum):
    NOT_REQUESTED = "not_requested"
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    COMPLETED_WITH_FALLBACK = "completed_with_fallback"
    FAILED = "failed"


class PhoneUploadSessionStatus(StrEnum):
    PENDING = "pending"
    OPENED = "opened"
    UPLOADING = "uploading"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class PhoneUploadListenerStatus(StrEnum):
    READY = "ready"
    UNAVAILABLE = "unavailable"


CATEGORY_DEFAULT_BODY_ZONES = MappingProxyType(
    {
        GarmentCategory.HAT: BodyZone.HEAD,
        GarmentCategory.SCARF: BodyZone.NECK,
        GarmentCategory.TOP: BodyZone.UPPER_BODY,
        GarmentCategory.DRESS: BodyZone.FULL_BODY,
        GarmentCategory.PANTS: BodyZone.LOWER_BODY,
        GarmentCategory.SHOES: BodyZone.FEET,
        GarmentCategory.OUTERWEAR: BodyZone.UPPER_BODY,
        GarmentCategory.ACCESSORY: BodyZone.ACCESSORY,
        GarmentCategory.OTHER: BodyZone.ACCESSORY,
    }
)


def default_body_zone_for(category: GarmentCategory) -> BodyZone:
    return CATEGORY_DEFAULT_BODY_ZONES[category]
