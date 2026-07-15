from datetime import datetime
from typing import Literal, Self

from pydantic import Field, field_validator, model_validator

from muse_backend.domain.enums import BodyZone
from muse_backend.domain.validation import normalize_required_name
from muse_backend.schemas.clothing import ClothingReferenceRead
from muse_backend.schemas.common import SQLITE_MAX_INTEGER, ApiSchema, TimestampedSchema


class OutfitItemWrite(ApiSchema):
    clothing_item_id: int = Field(gt=0, le=SQLITE_MAX_INTEGER)
    body_zone: BodyZone
    position_x: float = Field(ge=0, le=1)
    position_y: float = Field(ge=0, le=1)
    scale: float = Field(default=1.0, ge=0.1, le=4.0)
    rotation: float = Field(default=0.0, ge=-180, le=180)
    layer_index: int = Field(ge=0, le=10_000)


class OutfitItemsValidator(ApiSchema):
    items: list[OutfitItemWrite] = Field(min_length=1, max_length=250)

    @model_validator(mode="after")
    def validate_unique_items_and_layers(self) -> Self:
        clothing_ids = [item.clothing_item_id for item in self.items]
        if len(clothing_ids) != len(set(clothing_ids)):
            raise ValueError("an outfit cannot contain the same clothing item more than once")
        layers = [item.layer_index for item in self.items]
        if len(layers) != len(set(layers)):
            raise ValueError("layer_index values must be unique within an outfit")
        return self


class OutfitCreate(OutfitItemsValidator):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_required_name(value)


class OutfitUpdate(ApiSchema):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    items: list[OutfitItemWrite] | None = Field(default=None, min_length=1, max_length=250)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return normalize_required_name(value)

    @model_validator(mode="after")
    def validate_unique_items_and_layers(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field must be supplied")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name may not be null")
        if "items" in self.model_fields_set and self.items is None:
            raise ValueError("items may not be null")
        if self.items is None:
            return self
        clothing_ids = [item.clothing_item_id for item in self.items]
        if len(clothing_ids) != len(set(clothing_ids)):
            raise ValueError("an outfit cannot contain the same clothing item more than once")
        layers = [item.layer_index for item in self.items]
        if len(layers) != len(set(layers)):
            raise ValueError("layer_index values must be unique within an outfit")
        return self


class OutfitItemRead(TimestampedSchema):
    id: int
    clothing_item_id: int
    clothing_item_status: Literal["active", "deleted"]
    clothing_item: ClothingReferenceRead
    body_zone: BodyZone
    position_x: float
    position_y: float
    scale: float
    rotation: float
    layer_index: int


class OutfitSummary(TimestampedSchema):
    id: int
    name: str
    item_count: int = Field(ge=0)
    preview_url: str | None


class OutfitDetail(OutfitSummary):
    items: list[OutfitItemRead]
    deleted_at: datetime | None = None
