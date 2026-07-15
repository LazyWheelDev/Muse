from collections.abc import Collection

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from muse_backend.database.models import ClothingItem


class ClothingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, item: ClothingItem) -> ClothingItem:
        self.session.add(item)
        self.session.flush()
        return item

    def get_active(self, item_id: int) -> ClothingItem | None:
        statement = (
            select(ClothingItem)
            .where(ClothingItem.id == item_id, ClothingItem.deleted_at.is_(None))
            .options(selectinload(ClothingItem.images))
        )
        return self.session.scalar(statement)

    def get_any(self, item_id: int) -> ClothingItem | None:
        statement = (
            select(ClothingItem)
            .where(ClothingItem.id == item_id)
            .options(selectinload(ClothingItem.images))
        )
        return self.session.scalar(statement)

    def get_many_any(self, item_ids: Collection[int]) -> dict[int, ClothingItem]:
        if not item_ids:
            return {}
        statement = select(ClothingItem).where(ClothingItem.id.in_(item_ids))
        return {item.id: item for item in self.session.scalars(statement)}

    def list_active(self, *, limit: int, offset: int) -> tuple[list[ClothingItem], int]:
        filters = (ClothingItem.deleted_at.is_(None),)
        total = self.session.scalar(select(func.count(ClothingItem.id)).where(*filters)) or 0
        statement = (
            select(ClothingItem)
            .where(*filters)
            .order_by(
                ClothingItem.updated_at.desc(),
                ClothingItem.created_at.desc(),
                ClothingItem.id.desc(),
            )
            .limit(limit)
            .offset(offset)
            .options(selectinload(ClothingItem.images))
        )
        return list(self.session.scalars(statement)), total
