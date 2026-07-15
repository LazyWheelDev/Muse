from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from muse_backend.database.models import ClothingItem, Outfit, OutfitItem

_OUTFIT_LOAD_OPTIONS = (
    selectinload(Outfit.items)
    .selectinload(OutfitItem.clothing_item)
    .selectinload(ClothingItem.images),
)


class OutfitRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, outfit: Outfit) -> Outfit:
        self.session.add(outfit)
        self.session.flush()
        return outfit

    def get_active(self, outfit_id: int) -> Outfit | None:
        statement = (
            select(Outfit)
            .where(Outfit.id == outfit_id, Outfit.deleted_at.is_(None))
            .options(*_OUTFIT_LOAD_OPTIONS)
        )
        return self.session.scalar(statement)

    def get_any(self, outfit_id: int) -> Outfit | None:
        statement = select(Outfit).where(Outfit.id == outfit_id).options(*_OUTFIT_LOAD_OPTIONS)
        return self.session.scalar(statement)

    def list_active(self, *, limit: int, offset: int) -> tuple[list[tuple[Outfit, int]], int]:
        filters = (Outfit.deleted_at.is_(None),)
        total = self.session.scalar(select(func.count(Outfit.id)).where(*filters)) or 0
        item_count = (
            select(func.count(OutfitItem.id))
            .where(OutfitItem.outfit_id == Outfit.id)
            .correlate(Outfit)
            .scalar_subquery()
        )
        statement = (
            select(Outfit, item_count.label("item_count"))
            .where(*filters)
            .order_by(
                Outfit.updated_at.desc(),
                Outfit.created_at.desc(),
                Outfit.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return [(outfit, count) for outfit, count in self.session.execute(statement)], total

    def replace_items(self, outfit: Outfit, items: list[OutfitItem]) -> None:
        self.session.execute(delete(OutfitItem).where(OutfitItem.outfit_id == outfit.id))
        self.session.flush()
        for item in items:
            self.session.add(item)
        self.session.flush()
        self.session.expire(outfit, ["items"])
