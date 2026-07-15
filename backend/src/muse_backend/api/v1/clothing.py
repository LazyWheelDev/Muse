import asyncio
from typing import Annotated

from fastapi import APIRouter, Header, Path, Query, Request, Response, status
from pydantic import ValidationError

from muse_backend.api.dependencies import SessionDependency, SettingsDependency, StorageDependency
from muse_backend.domain.enums import GarmentCategory
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
)
from muse_backend.schemas.clothing import (
    ClothingItemCreate,
    ClothingItemDetail,
    ClothingItemSummary,
    ClothingItemUpdate,
)
from muse_backend.schemas.common import MAX_PAGE_OFFSET, SQLITE_MAX_INTEGER, Page
from muse_backend.services.clothing import ClothingService
from muse_backend.services.imports import GarmentImportService
from muse_backend.services.multipart_import import parse_import_request

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
    import_lock: asyncio.Lock = request.app.state.import_lock
    try:
        await asyncio.wait_for(import_lock.acquire(), timeout=0.01)
    except TimeoutError as error:
        raise ResourceConflictError(
            code="clothing_import_busy",
            message="Muse is already processing another local garment import.",
        ) from error
    try:
        parsed = await parse_import_request(request, storage=storage, settings=settings)
        try:
            metadata = ClothingItemCreate.model_validate(parsed.metadata)
        except ValidationError as error:
            storage.delete_temporary_tree(parsed.attempt_relative_path)
            raise DomainValidationError(
                code="invalid_import_metadata",
                message="The garment information did not pass validation.",
                details={
                    "fields": [
                        {
                            "location": [str(part) for part in issue["loc"]],
                            "message": issue["msg"],
                            "type": issue["type"],
                        }
                        for issue in error.errors()
                    ]
                },
            ) from error
        service = GarmentImportService(
            settings=settings,
            storage=storage,
            database=request.app.state.database,
        )
        import_task = asyncio.create_task(
            asyncio.to_thread(
                service.import_item,
                parsed,
                metadata,
                idempotency_key=idempotency_key,
            )
        )
        try:
            result = await asyncio.shield(import_task)
        except asyncio.CancelledError:
            await import_task
            raise
    finally:
        import_lock.release()
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
