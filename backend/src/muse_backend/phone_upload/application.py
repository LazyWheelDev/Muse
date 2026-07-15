import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI, Path, Request, Response, status

from muse_backend import __version__
from muse_backend.api.errors import register_error_handlers
from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import migration_status
from muse_backend.domain.enums import PhoneUploadSessionStatus
from muse_backend.domain.exceptions import MuseError, ResourceNotFoundError
from muse_backend.middleware.request_id import RequestIdMiddleware
from muse_backend.middleware.security import JsonTrustedHostMiddleware, RequestBodyLimitMiddleware
from muse_backend.phone_upload.security import (
    BoundedPhoneRateLimitMiddleware,
    PhoneSecurityHeadersMiddleware,
    SameOriginPhoneUploadMiddleware,
)
from muse_backend.phone_upload.static import (
    phone_asset_response,
    phone_frontend_build_available,
    phone_index_response,
)
from muse_backend.schemas.common import ErrorEnvelope
from muse_backend.schemas.phone_upload import PhoneUploadCompleted, PhoneUploadPublicStatus
from muse_backend.services.background_processing import reconcile_temporary_imports
from muse_backend.services.garment_import_workflow import GarmentImportWorkflow
from muse_backend.services.import_admission import ImportAdmission
from muse_backend.services.imports import ImportResult
from muse_backend.services.lan_address import resolve_lan_endpoint
from muse_backend.services.phone_upload_sessions import (
    PhoneUploadSessionService,
    phone_upload_idempotency_key,
)
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)
_TOKEN_HEADER = b"x-muse-upload-token"
_ASSET_PATH = Path(min_length=1, max_length=500)

PHONE_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "Invalid request"},
    404: {"model": ErrorEnvelope, "description": "Resource not found"},
    408: {"model": ErrorEnvelope, "description": "Upload timed out"},
    409: {"model": ErrorEnvelope, "description": "Session conflict"},
    410: {"model": ErrorEnvelope, "description": "Session unavailable"},
    413: {"model": ErrorEnvelope, "description": "Upload too large"},
    422: {"model": ErrorEnvelope, "description": "Upload validation failed"},
    429: {"model": ErrorEnvelope, "description": "Rate limit exceeded"},
    500: {"model": ErrorEnvelope, "description": "Unexpected local error"},
    503: {"model": ErrorEnvelope, "description": "Local dependency unavailable"},
}


def _raw_phone_token(request: Request) -> str:
    headers = cast(list[tuple[bytes, bytes]], request.scope.get("headers", []))
    values = [value for name, value in headers if name.lower() == _TOKEN_HEADER]
    if len(values) != 1:
        raise ResourceNotFoundError(
            code="phone_upload_session_invalid",
            message="This phone upload session is unavailable.",
        )
    try:
        return values[0].decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise ResourceNotFoundError(
            code="phone_upload_session_invalid",
            message="This phone upload session is unavailable.",
        ) from error


def _retryable_upload_error(error: MuseError, *, session_retryable: bool) -> MuseError:
    details = dict(error.details or {})
    details["retryable"] = session_retryable and error.status_code in {
        400,
        408,
        413,
        422,
        503,
    }
    return MuseError(
        status_code=error.status_code,
        code=error.code,
        message=error.message,
        details=details,
    )


def create_phone_upload_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings()
    if not active_settings.phone_upload_enabled:
        raise RuntimeError("the dedicated phone-upload listener is disabled")

    logging.basicConfig(level=active_settings.log_level)
    database = Database(active_settings.database_path)
    storage = LocalStorageService(active_settings)
    admission = ImportAdmission(active_settings)
    sessions = PhoneUploadSessionService(database=database, settings=active_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        storage.create_required_directories()
        storage.secure_database_file()
        if not phone_frontend_build_available(active_settings.phone_upload_frontend_build_path):
            raise RuntimeError("the phone-upload listener requires the compiled mobile build")
        if not migration_status(active_settings, database).is_current:
            raise RuntimeError("the phone-upload listener requires a current database migration")
        with admission.interprocess_lock.acquire(blocking=True):
            sessions.reconcile_all()
            reconcile_temporary_imports(
                settings=active_settings,
                storage=storage,
                database=database,
                limit=active_settings.phone_upload_cleanup_batch_size,
            )
        app.state.ready = True
        try:
            yield
        finally:
            app.state.ready = False
            database.dispose()

    app = FastAPI(
        title="Muse Restricted Phone Upload",
        version=__version__,
        description="Restricted local-network garment upload surface.",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
        responses=PHONE_ERROR_RESPONSES,
    )
    app.state.settings = active_settings
    app.state.database = database
    app.state.storage = storage
    app.state.import_admission = admission
    app.state.phone_upload_sessions = sessions
    app.state.ready = False

    @app.get("/listener-status", include_in_schema=False)
    def listener_status(request: Request) -> dict[str, str]:
        if not request.app.state.ready or not phone_frontend_build_available(
            active_settings.phone_upload_frontend_build_path
        ):
            raise MuseError(
                status_code=503,
                code="listener_unavailable",
                message="The phone upload listener is not ready.",
            )
        return {"status": "ok"}

    @app.get("/u", include_in_schema=False)
    @app.get("/u/", include_in_schema=False)
    def phone_upload_page() -> Response:
        return phone_index_response(active_settings.phone_upload_frontend_build_path)

    @app.get("/phone-assets/{relative_path:path}", include_in_schema=False)
    def phone_upload_asset(relative_path: str = _ASSET_PATH) -> Response:
        return phone_asset_response(active_settings.phone_upload_frontend_build_path, relative_path)

    @app.get(
        "/phone-api/v1/session",
        response_model=PhoneUploadPublicStatus,
        tags=["phone-upload"],
    )
    def phone_upload_session(request: Request) -> PhoneUploadPublicStatus:
        return sessions.open_with_token(_raw_phone_token(request))

    @app.post(
        "/phone-api/v1/upload",
        response_model=PhoneUploadCompleted,
        status_code=status.HTTP_201_CREATED,
        tags=["phone-upload"],
    )
    async def upload_phone_garment(request: Request) -> PhoneUploadCompleted:
        raw_token = _raw_phone_token(request)
        claimed_session_id: str | None = None
        completed_status: PhoneUploadSessionStatus | None = None

        async def claim_session() -> None:
            nonlocal claimed_session_id
            claimed_session_id = sessions.claim_upload(raw_token)

        async def mark_processing(*_: object) -> None:
            if claimed_session_id is None:  # pragma: no cover - protected by workflow order.
                raise RuntimeError("phone upload session was not claimed")
            sessions.mark_processing(claimed_session_id)

        async def complete_session(result: ImportResult) -> None:
            nonlocal completed_status
            if claimed_session_id is None:  # pragma: no cover - protected by workflow order.
                raise RuntimeError("phone upload session was not claimed")
            completed = sessions.complete(claimed_session_id, result.item.id)
            completed_status = completed.status

        workflow = GarmentImportWorkflow(
            settings=active_settings,
            storage=storage,
            database=database,
            admission=admission,
        )
        try:
            result = await workflow.run(
                request,
                idempotency_key=lambda: (
                    phone_upload_idempotency_key(claimed_session_id)
                    if claimed_session_id is not None
                    else None
                ),
                busy_code="upload_concurrency_exceeded",
                busy_message="Muse is already receiving another garment photograph.",
                on_admitted=claim_session,
                on_parsed=mark_processing,
                on_imported=complete_session,
                parse_timeout_seconds=active_settings.phone_upload_receive_timeout_seconds,
            )
        except TimeoutError as error:
            retryable = False
            if claimed_session_id is not None:
                failed = sessions.fail(claimed_session_id, "phone_upload_receive_timeout")
                retryable = failed is not None and failed.can_retry
            raise MuseError(
                status_code=408,
                code="phone_upload_receive_timeout",
                message="The phone upload took too long to receive.",
                details={"retryable": retryable},
            ) from error
        except asyncio.CancelledError:
            if claimed_session_id is not None:
                sessions.fail(claimed_session_id, "phone_upload_interrupted")
            raise
        except MuseError as error:
            if claimed_session_id is not None:
                failed = sessions.fail(claimed_session_id, error.code)
                raise _retryable_upload_error(
                    error,
                    session_retryable=failed is not None and failed.can_retry,
                ) from error
            if error.code == "upload_concurrency_exceeded":
                details = dict(error.details or {})
                details["retryable"] = True
                raise MuseError(
                    status_code=error.status_code,
                    code=error.code,
                    message=error.message,
                    details=details,
                ) from error
            raise
        except Exception:
            if claimed_session_id is not None:
                sessions.fail(claimed_session_id, "phone_upload_failed")
            raise

        return PhoneUploadCompleted(
            status=completed_status or PhoneUploadSessionStatus.COMPLETED,
            clothing_item_id=result.item.id,
        )

    # Added from inner to outer. Request IDs wrap every rejecting middleware,
    # while the security-header layer wraps every response produced beneath it.
    app.add_middleware(SameOriginPhoneUploadMiddleware)
    app.add_middleware(
        BoundedPhoneRateLimitMiddleware,
        request_limit=active_settings.phone_upload_rate_limit_requests,
        window_seconds=active_settings.phone_upload_rate_limit_window_seconds,
        max_clients=active_settings.phone_upload_rate_limit_clients,
    )
    endpoint = resolve_lan_endpoint(active_settings)
    exact_hosts = set(active_settings.phone_upload_trusted_hosts)
    exact_hosts.add(endpoint.primary_host)
    if endpoint.fallback_ipv4 is not None:
        exact_hosts.add(endpoint.fallback_ipv4)
    app.add_middleware(JsonTrustedHostMiddleware, allowed_hosts=sorted(exact_hosts))
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_size=active_settings.max_api_body_size_bytes,
        streaming_paths=("/phone-api/v1/upload",),
    )
    app.add_middleware(PhoneSecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    return app
