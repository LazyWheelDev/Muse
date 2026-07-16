import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI

from muse_backend import __version__
from muse_backend.api.errors import register_error_handlers
from muse_backend.api.v1.router import api_v1_router
from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import migration_status
from muse_backend.domain.exceptions import ResourceConflictError, StorageOperationError
from muse_backend.frontend import frontend_build_available, register_frontend_routes
from muse_backend.middleware.device_action import DeviceActionPendingMiddleware
from muse_backend.middleware.request_id import RequestIdMiddleware
from muse_backend.middleware.security import (
    JsonCORSMiddleware,
    JsonTrustedHostMiddleware,
    LoopbackOnlyMiddleware,
    MainSecurityHeadersMiddleware,
    RequestBodyLimitMiddleware,
)
from muse_backend.middleware.settings_security import SensitiveSettingsMutationMiddleware
from muse_backend.schemas.common import ErrorEnvelope
from muse_backend.services.background_processing import (
    BackgroundProcessingWorker,
    reconcile_interrupted_imports,
    reconcile_temporary_imports,
)
from muse_backend.services.backups import BackupService
from muse_backend.services.import_admission import ImportAdmission
from muse_backend.services.outfit_previews import reconcile_outfit_previews
from muse_backend.services.phone_upload_sessions import PhoneUploadSessionService
from muse_backend.services.runtime_lock import RuntimeServiceLock
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
    import_admission = ImportAdmission(active_settings)
    background_worker = BackgroundProcessingWorker(
        settings=active_settings,
        storage=storage,
        database=database,
        interprocess_lock=import_admission.interprocess_lock,
    )
    phone_upload_sessions = PhoneUploadSessionService(
        database=database,
        settings=active_settings,
    )

    def cleanup_phone_upload_sessions() -> None:
        try:
            with import_admission.interprocess_lock.acquire(blocking=False):
                processed = phone_upload_sessions.cleanup()
                reconcile_temporary_imports(
                    settings=active_settings,
                    storage=storage,
                    database=database,
                    limit=max(
                        0,
                        active_settings.phone_upload_cleanup_batch_size - processed,
                    ),
                )
        except ResourceConflictError:
            # An active import owns the cross-process admission lock. The next
            # bounded cleanup interval can safely retry without touching it.
            return

    async def phone_upload_cleanup_loop(stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(
                    stop.wait(),
                    timeout=active_settings.phone_upload_cleanup_interval_seconds,
                )
            except TimeoutError:
                try:
                    await asyncio.to_thread(cleanup_phone_upload_sessions)
                except Exception:
                    logger.exception("Bounded phone-upload session cleanup failed")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        cleanup_stop = asyncio.Event()
        cleanup_task: asyncio.Task[None] | None = None
        app.state.storage_initialized = False
        try:
            storage.create_required_directories()
            storage.secure_database_file()
            app.state.storage_initialized = True
        except StorageOperationError:
            logger.exception("Muse storage initialization failed; readiness will remain false")

        with RuntimeServiceLock(active_settings).shared():
            if app.state.storage_initialized:
                BackupService(active_settings).reconcile_committed_cleanup(
                    limit=active_settings.maintenance_cleanup_batch_size
                )
            if active_settings.serve_frontend and not frontend_build_available(
                active_settings.frontend_build_path
            ):
                logger.error("The configured Muse frontend build is unavailable")
            migrations_current = False
            try:
                migrations_current = migration_status(active_settings, database).is_current
            except Exception:
                logger.warning("Background processing will wait for the database migration")
            if migrations_current:
                with import_admission.interprocess_lock.acquire(blocking=True):
                    reconcile_interrupted_imports(
                        settings=active_settings,
                        storage=storage,
                        database=database,
                    )
                    phone_upload_sessions.reconcile_all()
                reconcile_outfit_previews(
                    settings=active_settings,
                    storage=storage,
                    database=database,
                )
                if active_settings.background_processing_enabled:
                    background_worker.start()
                cleanup_task = asyncio.create_task(
                    phone_upload_cleanup_loop(cleanup_stop),
                    name="phone-upload-session-cleanup",
                )
            try:
                yield
            finally:
                cleanup_stop.set()
                if cleanup_task is not None:
                    await cleanup_task
                worker_stopped = background_worker.stop()
                if worker_stopped:
                    database.dispose()
                else:
                    logger.warning(
                        "Keeping the database engine available for an in-flight background job"
                    )

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
    app.state.background_worker = background_worker
    app.state.import_admission = import_admission
    app.state.phone_upload_sessions = phone_upload_sessions
    app.state.started_at = datetime.now(UTC)
    # Compatibility alias for tests and diagnostics; all production imports use
    # the combined local + inter-process admission object above.
    app.state.import_lock = import_admission.local_lock
    app.state.storage_initialized = False
    if active_settings.allowed_origins:
        app.add_middleware(
            JsonCORSMiddleware,
            allow_origins=active_settings.allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Accept", "Content-Type", "Idempotency-Key", "X-Request-ID"],
            expose_headers=["Idempotency-Replayed", "Location", "X-Request-ID"],
        )
    app.add_middleware(JsonTrustedHostMiddleware, allowed_hosts=active_settings.trusted_hosts)
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_size=active_settings.max_api_body_size_bytes,
        streaming_paths=("/api/v1/clothing-items/import",),
    )
    app.add_middleware(
        SensitiveSettingsMutationMiddleware,
        allowed_development_origins=active_settings.allowed_origins,
    )
    app.add_middleware(MainSecurityHeadersMiddleware)
    if active_settings.environment is Environment.PRODUCTION:
        app.add_middleware(LoopbackOnlyMiddleware)
    app.add_middleware(DeviceActionPendingMiddleware, settings=active_settings)
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    app.include_router(api_v1_router)
    if active_settings.serve_frontend:
        register_frontend_routes(app, active_settings.frontend_build_path)
    return app
