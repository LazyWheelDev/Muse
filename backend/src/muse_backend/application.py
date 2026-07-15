import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from muse_backend import __version__
from muse_backend.api.errors import register_error_handlers
from muse_backend.api.v1.router import api_v1_router
from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.domain.exceptions import StorageOperationError
from muse_backend.frontend import frontend_build_available, register_frontend_routes
from muse_backend.middleware.request_id import RequestIdMiddleware
from muse_backend.middleware.security import (
    JsonCORSMiddleware,
    JsonTrustedHostMiddleware,
    RequestBodyLimitMiddleware,
)
from muse_backend.schemas.common import ErrorEnvelope
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)
API_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "Invalid request"},
    404: {"model": ErrorEnvelope, "description": "Resource not found"},
    409: {"model": ErrorEnvelope, "description": "Resource conflict"},
    413: {"model": ErrorEnvelope, "description": "Request body too large"},
    422: {"model": ErrorEnvelope, "description": "Request validation failed"},
    500: {"model": ErrorEnvelope, "description": "Unexpected local error"},
    503: {"model": ErrorEnvelope, "description": "Local dependency unavailable"},
}


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings()
    logging.basicConfig(level=active_settings.log_level)
    database = Database(active_settings.database_path)
    storage = LocalStorageService(active_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.storage_initialized = False
        try:
            storage.create_required_directories()
            storage.secure_database_file()
            app.state.storage_initialized = True
        except StorageOperationError:
            logger.exception("Muse storage initialization failed; readiness will remain false")

        if active_settings.serve_frontend and not frontend_build_available(
            active_settings.frontend_build_path
        ):
            logger.error("The configured Muse frontend build is unavailable")
        try:
            yield
        finally:
            database.dispose()

    docs_enabled = active_settings.environment is not Environment.PRODUCTION
    app = FastAPI(
        title="Muse Local API",
        version=__version__,
        description="Offline-first wardrobe persistence and local media API.",
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
        responses=API_ERROR_RESPONSES,
    )
    app.state.settings = active_settings
    app.state.database = database
    app.state.storage = storage
    app.state.storage_initialized = False
    if active_settings.allowed_origins:
        app.add_middleware(
            JsonCORSMiddleware,
            allow_origins=active_settings.allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Accept", "Content-Type", "X-Request-ID"],
            expose_headers=["X-Request-ID"],
        )
    app.add_middleware(JsonTrustedHostMiddleware, allowed_hosts=active_settings.trusted_hosts)
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_size=active_settings.max_api_body_size_bytes,
    )
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    app.include_router(api_v1_router)
    if active_settings.serve_frontend:
        register_frontend_routes(app, active_settings.frontend_build_path)
    return app
