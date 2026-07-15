from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status

from muse_backend.api.dependencies import (
    DatabaseDependency,
    SessionDependency,
    SettingsDependency,
    StorageDependency,
)
from muse_backend.schemas.common import MAX_PAGE_OFFSET, SQLITE_MAX_INTEGER, Page
from muse_backend.schemas.outfit import OutfitCreate, OutfitDetail, OutfitSummary, OutfitUpdate
from muse_backend.services.outfit_previews import OutfitPreviewCoordinator
from muse_backend.services.outfits import OutfitService

router = APIRouter(prefix="/outfits", tags=["outfits"])
OutfitId = Annotated[int, Path(gt=0, le=SQLITE_MAX_INTEGER)]


@router.post("", response_model=OutfitDetail, status_code=status.HTTP_201_CREATED)
def create_outfit(
    payload: OutfitCreate,
    settings: SettingsDependency,
    storage: StorageDependency,
    database: DatabaseDependency,
) -> OutfitDetail:
    return OutfitPreviewCoordinator(
        settings=settings,
        storage=storage,
        database=database,
    ).create(payload)


@router.get("", response_model=Page[OutfitSummary])
def list_outfits(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=MAX_PAGE_OFFSET)] = 0,
) -> Page[OutfitSummary]:
    return OutfitService(session).list(limit=limit, offset=offset)


@router.get("/{outfit_id}", response_model=OutfitDetail)
def get_outfit(outfit_id: OutfitId, session: SessionDependency) -> OutfitDetail:
    return OutfitService(session).get(outfit_id)


@router.patch("/{outfit_id}", response_model=OutfitDetail)
def update_outfit(
    outfit_id: OutfitId,
    payload: OutfitUpdate,
    settings: SettingsDependency,
    storage: StorageDependency,
    database: DatabaseDependency,
) -> OutfitDetail:
    return OutfitPreviewCoordinator(
        settings=settings,
        storage=storage,
        database=database,
    ).update(outfit_id, payload)


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_outfit(outfit_id: OutfitId, session: SessionDependency) -> Response:
    OutfitService(session).soft_delete(outfit_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
