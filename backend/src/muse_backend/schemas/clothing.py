from datetime import date, datetime
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Self
from uuid import uuid4

from pydantic import Field, field_validator, model_validator

from muse_backend.domain.enums import (
    BodyZone,
    GarmentCategory,
    ImageKind,
    ImageProcessingState,
)
from muse_backend.domain.validation import (
    normalize_optional_text,
    normalize_relative_path,
    normalize_required_name,
)
from muse_backend.schemas.common import SQLITE_MAX_INTEGER, ApiSchema, TimestampedSchema

OPTIONAL_TEXT_FIELDS = (
    "brand",
    "size",
    "color_name",
    "material",
    "season",
    "notes",
)
IMAGE_EXTENSIONS_BY_MIME_TYPE = {
    "image/jpeg": frozenset({".jpeg", ".jpg"}),
    "image/png": frozenset({".png"}),
    "image/webp": frozenset({".webp"}),
}


class ClothingMetadata(ApiSchema):
    name: str = Field(min_length=1, max_length=120)
    garment_category: GarmentCategory
    default_body_zone: BodyZone | None = None
    brand: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=60)
    color_name: str | None = Field(default=None, max_length=80)
    material: str | None = Field(default=None, max_length=200)
    season: str | None = Field(default=None, max_length=120)
    purchase_price: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=2,
    )
    purchase_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    purchase_date: date | None = None
    notes: str | None = Field(default=None, max_length=4_000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_required_name(value)

    @field_validator(*OPTIONAL_TEXT_FIELDS)
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("purchase_currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().upper()
            return normalized or None
        return value

    @model_validator(mode="after")
    def validate_purchase_pair(self) -> Self:
        if (self.purchase_price is None) != (self.purchase_currency is None):
            raise ValueError("purchase_price and purchase_currency must be supplied together")
        return self


class ClothingItemCreate(ClothingMetadata):
    pass


class ClothingItemUpdate(ApiSchema):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    garment_category: GarmentCategory | None = None
    default_body_zone: BodyZone | None = None
    brand: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=60)
    color_name: str | None = Field(default=None, max_length=80)
    material: str | None = Field(default=None, max_length=200)
    season: str | None = Field(default=None, max_length=120)
    purchase_price: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=2,
    )
    purchase_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    purchase_date: date | None = None
    notes: str | None = Field(default=None, max_length=4_000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return normalize_required_name(value)

    @field_validator(*OPTIONAL_TEXT_FIELDS)
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("purchase_currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().upper()
            return normalized or None
        return value

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field must be supplied")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name may not be null")
        if "garment_category" in self.model_fields_set and self.garment_category is None:
            raise ValueError("garment_category may not be null")
        return self


class ClothingImageRegistration(ApiSchema):
    clothing_item_id: int = Field(gt=0, le=SQLITE_MAX_INTEGER)
    image_kind: ImageKind
    relative_path: str = Field(min_length=1, max_length=500)
    mime_type: str = Field(pattern=r"^image/(jpeg|png|webp)$")
    width: int = Field(gt=0, le=100_000)
    height: int = Field(gt=0, le=100_000)
    byte_size: int = Field(gt=0, le=SQLITE_MAX_INTEGER)
    is_primary: bool = False
    content_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    image_group_id: str = Field(
        default_factory=lambda: uuid4().hex,
        pattern=r"^[0-9a-f]{32}$",
    )
    display_order: int = Field(default=0, ge=0, le=SQLITE_MAX_INTEGER)

    @field_validator("relative_path")
    @classmethod
    def normalize_path(cls, value: str) -> str:
        return normalize_relative_path(value)

    @model_validator(mode="after")
    def validate_path_matches_mime_type(self) -> Self:
        suffix = PurePosixPath(self.relative_path).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS_BY_MIME_TYPE[self.mime_type]:
            raise ValueError("relative_path extension must match mime_type")
        return self


class ClothingImageRead(TimestampedSchema):
    id: int
    image_kind: ImageKind
    mime_type: str
    width: int
    height: int
    byte_size: int
    is_primary: bool
    image_group_id: str
    display_order: int
    content_url: str


class ClothingImageGroupRead(ApiSchema):
    image_group_id: str
    display_order: int
    display_image: ClothingImageRead
    thumbnail_image: ClothingImageRead
    original_image: ClothingImageRead | None
    images: list[ClothingImageRead]


class ClothingItemBaseRead(ClothingMetadata, TimestampedSchema):
    id: int
    image_processing_state: ImageProcessingState
    processing_error_code: str | None


class ClothingItemSummary(ClothingItemBaseRead):
    primary_image: ClothingImageRead | None
    display_image: ClothingImageRead | None
    thumbnail_image: ClothingImageRead | None


class ClothingItemDetail(ClothingItemBaseRead):
    images: list[ClothingImageRead]
    image_groups: list[ClothingImageGroupRead]


class ClothingReferenceRead(ApiSchema):
    id: int
    name: str
    garment_category: GarmentCategory
    deleted_at: datetime | None
    primary_image: ClothingImageRead | None
