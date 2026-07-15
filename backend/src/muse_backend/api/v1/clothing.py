from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status

from muse_backend.api.dependencies import SessionDependency
from muse_backend.schemas.clothing import (
    ClothingItemCreate,
    ClothingItemDetail,
    ClothingItemSummary,
    ClothingItemUpdate,
)
from muse_backend.schemas.common import MAX_PAGE_OFFSET, SQLITE_MAX_INTEGER, Page
from muse_backend.services.clothing import ClothingService

router = APIRouter(prefix="/clothing-items", tags=["clothing"])
ItemId = Annotated[int, Path(gt=0, le=SQLITE_MAX_INTEGER)]


@router.post("", response_model=ClothingItemDetail, status_code=status.HTTP_201_CREATED)
def create_clothing_item(
    payload: ClothingItemCreate,
    session: SessionDependency,
) -> ClothingItemDetail:
    return ClothingService(session).create(payload)


@router.get("", response_model=Page[ClothingItemSummary])
def list_clothing_items(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=MAX_PAGE_OFFSET)] = 0,
) -> Page[ClothingItemSummary]:
    return ClothingService(session).list(limit=limit, offset=offset)


@router.get("/{item_id}", response_model=ClothingItemDetail)
def get_clothing_item(item_id: ItemId, session: SessionDependency) -> ClothingItemDetail:
    return ClothingService(session).get(item_id)


@router.patch("/{item_id}", response_model=ClothingItemDetail)
def update_clothing_item(
    item_id: ItemId,
    payload: ClothingItemUpdate,
    session: SessionDependency,
) -> ClothingItemDetail:
    return ClothingService(session).update(item_id, payload)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_clothing_item(item_id: ItemId, session: SessionDependency) -> Response:
    ClothingService(session).soft_delete(item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
