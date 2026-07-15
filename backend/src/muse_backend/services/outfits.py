from collections.abc import Collection

from sqlalchemy.orm import Session

from muse_backend.database.base import utc_now
from muse_backend.database.models import Outfit, OutfitItem
from muse_backend.domain.exceptions import DomainValidationError, ResourceNotFoundError
from muse_backend.repositories.clothing import ClothingRepository
from muse_backend.repositories.outfits import OutfitRepository
from muse_backend.schemas.common import Page
from muse_backend.schemas.outfit import (
    OutfitCreate,
    OutfitDetail,
    OutfitItemWrite,
    OutfitSummary,
    OutfitUpdate,
)
from muse_backend.services.presenters import outfit_detail, outfit_summary


class OutfitService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repository = OutfitRepository(session)
        self.clothing_repository = ClothingRepository(session)

    def create(self, payload: OutfitCreate) -> OutfitDetail:
        with self.session.begin():
            self._validate_clothing(payload.items, retained_ids=frozenset())
            outfit = Outfit(name=payload.name)
            self.repository.add(outfit)
            for item_payload in payload.items:
                self.session.add(self._new_item(outfit, item_payload))
            self.session.flush()
        loaded = self.repository.get_active(outfit.id)
        if loaded is None:  # Defensive: the row was just created in this transaction.
            raise self._not_found()
        return outfit_detail(loaded)

    def list(self, *, limit: int, offset: int) -> Page[OutfitSummary]:
        outfits, total = self.repository.list_active(limit=limit, offset=offset)
        return Page[OutfitSummary](
            items=[outfit_summary(outfit, item_count=item_count) for outfit, item_count in outfits],
            total=total,
            limit=limit,
            offset=offset,
        )

    def get(self, outfit_id: int) -> OutfitDetail:
        outfit = self.repository.get_active(outfit_id)
        if outfit is None:
            raise self._not_found()
        return outfit_detail(outfit)

    def update(self, outfit_id: int, payload: OutfitUpdate) -> OutfitDetail:
        with self.session.begin():
            outfit = self.repository.get_active(outfit_id)
            if outfit is None:
                raise self._not_found()
            retained_ids = frozenset(item.clothing_item_id for item in outfit.items)

            if "name" in payload.model_fields_set:
                outfit.name = payload.name  # type: ignore[assignment]
            if "items" in payload.model_fields_set:
                item_payloads = payload.items
                if item_payloads is None:  # Rejected by the schema; retained for type narrowing.
                    raise DomainValidationError(
                        code="invalid_outfit_items",
                        message="Outfit items must be supplied as a non-empty collection.",
                    )
                self._validate_clothing(item_payloads, retained_ids=retained_ids)
                replacements = [
                    self._new_item(outfit, item_payload) for item_payload in item_payloads
                ]
                self.repository.replace_items(outfit, replacements)
            outfit.updated_at = utc_now()

        loaded = self.repository.get_active(outfit_id)
        if loaded is None:
            raise self._not_found()
        return outfit_detail(loaded)

    def soft_delete(self, outfit_id: int) -> None:
        with self.session.begin():
            outfit = self.repository.get_active(outfit_id)
            if outfit is None:
                raise self._not_found()
            deleted_at = utc_now()
            outfit.deleted_at = deleted_at
            outfit.updated_at = deleted_at

    def _validate_clothing(
        self,
        items: Collection[OutfitItemWrite],
        *,
        retained_ids: Collection[int],
    ) -> None:
        requested_ids = {item.clothing_item_id for item in items}
        clothing = self.clothing_repository.get_many_any(requested_ids)
        missing_ids = sorted(requested_ids - clothing.keys())
        invalid_deleted_ids = sorted(
            item_id
            for item_id, garment in clothing.items()
            if garment.deleted_at is not None and item_id not in retained_ids
        )
        if missing_ids or invalid_deleted_ids:
            raise DomainValidationError(
                code="invalid_clothing_reference",
                message="One or more clothing items cannot be used in this outfit.",
                details={
                    "missing_ids": missing_ids,
                    "deleted_ids": invalid_deleted_ids,
                },
            )

    @staticmethod
    def _new_item(
        outfit: Outfit,
        payload: OutfitItemWrite,
    ) -> OutfitItem:
        return OutfitItem(
            outfit_id=outfit.id,
            clothing_item_id=payload.clothing_item_id,
            body_zone=payload.body_zone.value,
            position_x=payload.position_x,
            position_y=payload.position_y,
            scale=payload.scale,
            rotation=payload.rotation,
            layer_index=payload.layer_index,
        )

    @staticmethod
    def _not_found() -> ResourceNotFoundError:
        return ResourceNotFoundError(
            code="outfit_not_found",
            message="The requested outfit was not found.",
        )
