from decimal import Decimal

from sqlalchemy.orm import Session

from muse_backend.database.base import utc_now
from muse_backend.database.models import ClothingItem
from muse_backend.domain.enums import BodyZone, GarmentCategory, default_body_zone_for
from muse_backend.domain.exceptions import DomainValidationError, ResourceNotFoundError
from muse_backend.repositories.clothing import ClothingRepository
from muse_backend.schemas.clothing import (
    ClothingItemCreate,
    ClothingItemDetail,
    ClothingItemSummary,
    ClothingItemUpdate,
)
from muse_backend.schemas.common import Page
from muse_backend.services.presenters import clothing_detail, clothing_summary


def _enum_value(value: GarmentCategory | BodyZone | None) -> str | None:
    return value.value if value is not None else None


def _validate_purchase_pair(price: Decimal | None, currency: str | None) -> None:
    if (price is None) != (currency is None):
        raise DomainValidationError(
            code="invalid_purchase_value",
            message="Purchase price and currency must be supplied together.",
        )


class ClothingService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repository = ClothingRepository(session)

    def create(self, payload: ClothingItemCreate) -> ClothingItemDetail:
        zone = payload.default_body_zone
        if "default_body_zone" not in payload.model_fields_set:
            zone = default_body_zone_for(payload.garment_category)

        item = ClothingItem(
            name=payload.name,
            garment_category=payload.garment_category.value,
            default_body_zone=_enum_value(zone),
            brand=payload.brand,
            size=payload.size,
            color_name=payload.color_name,
            material=payload.material,
            season=payload.season,
            purchase_price=payload.purchase_price,
            purchase_currency=payload.purchase_currency,
            purchase_date=payload.purchase_date,
            notes=payload.notes,
        )
        with self.session.begin():
            self.repository.add(item)
        return clothing_detail(item)

    def list(
        self,
        *,
        limit: int,
        offset: int,
        garment_category: GarmentCategory | None = None,
    ) -> Page[ClothingItemSummary]:
        items, total = self.repository.list_active(
            limit=limit,
            offset=offset,
            garment_category=garment_category.value if garment_category is not None else None,
        )
        return Page[ClothingItemSummary](
            items=[clothing_summary(item) for item in items],
            total=total,
            limit=limit,
            offset=offset,
        )

    def get(self, item_id: int) -> ClothingItemDetail:
        item = self.repository.get_active(item_id)
        if item is None:
            raise self._not_found()
        return clothing_detail(item)

    def update(self, item_id: int, payload: ClothingItemUpdate) -> ClothingItemDetail:
        with self.session.begin():
            item = self.repository.get_active(item_id)
            if item is None:
                raise self._not_found()

            proposed_price = (
                payload.purchase_price
                if "purchase_price" in payload.model_fields_set
                else item.purchase_price
            )
            proposed_currency = (
                payload.purchase_currency
                if "purchase_currency" in payload.model_fields_set
                else item.purchase_currency
            )
            _validate_purchase_pair(proposed_price, proposed_currency)

            for field_name in payload.model_fields_set:
                value = getattr(payload, field_name)
                if isinstance(value, GarmentCategory | BodyZone):
                    value = value.value
                setattr(item, field_name, value)
            item.updated_at = utc_now()
        return clothing_detail(item)

    def soft_delete(self, item_id: int) -> None:
        with self.session.begin():
            item = self.repository.get_active(item_id)
            if item is None:
                raise self._not_found()
            deleted_at = utc_now()
            item.deleted_at = deleted_at
            item.updated_at = deleted_at

    @staticmethod
    def _not_found() -> ResourceNotFoundError:
        return ResourceNotFoundError(
            code="clothing_item_not_found",
            message="The requested clothing item was not found.",
        )
