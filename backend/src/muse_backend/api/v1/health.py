from fastapi import APIRouter, Request, status
from starlette.responses import JSONResponse

from muse_backend import __version__
from muse_backend.database.engine import Database, verify_database_connection
from muse_backend.database.migrations import migration_status
from muse_backend.frontend import frontend_build_available
from muse_backend.schemas.common import (
    HealthResponse,
    ReadinessCheck,
    ReadinessResponse,
)
from muse_backend.storage.local import LocalStorageService

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(version=__version__)


@router.get(
    "/readiness",
    response_model=ReadinessResponse,
    response_model_exclude_none=True,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadinessResponse}},
)
def readiness(request: Request) -> ReadinessResponse | JSONResponse:
    database: Database = request.app.state.database
    storage: LocalStorageService = request.app.state.storage
    settings = request.app.state.settings
    checks: dict[str, ReadinessCheck] = {}

    database_ok = verify_database_connection(database.engine)
    checks["database"] = ReadinessCheck(
        status="ok" if database_ok else "error",
        message=None if database_ok else "The local database is unavailable.",
    )

    migrations_ok = False
    if database_ok:
        try:
            migrations_ok = migration_status(settings, database).is_current
        except Exception:
            migrations_ok = False
    checks["migrations"] = ReadinessCheck(
        status="ok" if migrations_ok else "error",
        message=None if migrations_ok else "The local database schema is not current.",
    )

    storage_ok = bool(request.app.state.storage_initialized) and storage.writable()
    checks["storage"] = ReadinessCheck(
        status="ok" if storage_ok else "error",
        message=None if storage_ok else "Local storage is not writable.",
    )

    if settings.serve_frontend:
        frontend_ok = frontend_build_available(settings.frontend_build_path)
        checks["frontend"] = ReadinessCheck(
            status="ok" if frontend_ok else "error",
            message=None if frontend_ok else "The production interface build is unavailable.",
        )

    is_ready = all(check.status == "ok" for check in checks.values())
    response = ReadinessResponse(
        status="ready" if is_ready else "not_ready",
        checks=checks,
    )
    if is_ready:
        return response
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=response.model_dump(mode="json", exclude_none=True),
    )
