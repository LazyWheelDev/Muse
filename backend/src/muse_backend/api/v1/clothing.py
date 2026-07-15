from typing import Annotated

from fastapi import APIRouter, Header, Path, Query, Request, Response, status

from muse_backend.api.dependencies import SessionDependency, SettingsDependency, StorageDependency
from muse_backend.domain.enums import GarmentCategory
from muse_backend.schemas.clothing import (
    ClothingItemCreate,
    ClothingItemDetail,
    ClothingItemSummary,
    ClothingItemUpdate,
)
from muse_backend.schemas.common import MAX_PAGE_OFFSET, SQLITE_MAX_INTEGER, Page
from muse_backend.services.clothing import ClothingService
from muse_backend.services.garment_import_workflow import GarmentImportWorkflow

router = APIRouter(prefix="/clothing-items", tags=["clothing"])
ItemId = Annotated[int, Path(gt=0, le=SQLITE_MAX_INTEGER)]


@router.post("", response_model=ClothingItemDetail, status_code=status.HTTP_201_CREATED)
def create_clothing_item(
    payload: ClothingItemCreate,
    session: SessionDependency,
) -> ClothingItemDetail:
    return ClothingService(session).create(payload)


@router.post(
    "/import",
    response_model=ClothingItemDetail,
    status_code=status.HTTP_201_CREATED,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["metadata", "image"],
                        "properties": {
                            "metadata": {
                                "type": "string",
                                "description": "A JSON-encoded ClothingItemCreate object.",
                            },
                            "image": {"type": "string", "format": "binary"},
                        },
                    },
                    "encoding": {"metadata": {"contentType": "application/json"}},
                }
            },
        }
    },
)
async def import_clothing_item(
    request: Request,
    response: Response,
    settings: SettingsDependency,
    storage: StorageDependency,
    idempotency_key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            min_length=1,
            max_length=64,
            pattern=r"^[A-Za-z0-9._:-]+$",
        ),
    ] = None,
) -> ClothingItemDetail:
    workflow = GarmentImportWorkflow(
        settings=settings,
        storage=storage,
        database=request.app.state.database,
        admission=request.app.state.import_admission,
    )
    result = await workflow.run(request, idempotency_key=idempotency_key)
    response.headers["Location"] = f"/api/v1/clothing-items/{result.item.id}"
    response.headers["Idempotency-Replayed"] = "true" if result.replayed else "false"
    worker = getattr(request.app.state, "background_worker", None)
    if worker is not None and result.item.image_processing_state == "pending":
        worker.notify()
    return result.item


@router.get("", response_model=Page[ClothingItemSummary])
def list_clothing_items(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=MAX_PAGE_OFFSET)] = 0,
    garment_category: GarmentCategory | None = None,
) -> Page[ClothingItemSummary]:
    return ClothingService(session).list(
        limit=limit,
        offset=offset,
        garment_category=garment_category,
    )


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
