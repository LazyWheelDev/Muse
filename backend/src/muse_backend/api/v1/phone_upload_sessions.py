from typing import Annotated

from fastapi import APIRouter, Path, Request, Response, status

from muse_backend.domain.enums import PhoneUploadListenerStatus
from muse_backend.domain.exceptions import MuseError
from muse_backend.schemas.phone_upload import (
    PhoneUploadDeviceSession,
    PhoneUploadSessionCreated,
    PhoneUploadSessionRead,
)
from muse_backend.services.lan_address import LanEndpoint, resolve_lan_endpoint
from muse_backend.services.phone_upload_listener import PhoneUploadListenerProbe
from muse_backend.services.phone_upload_sessions import (
    CreatedPhoneUploadSession,
    PhoneUploadSessionService,
)

router = APIRouter(prefix="/phone-upload-sessions", tags=["phone-upload"])
SessionId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


def _service(request: Request) -> PhoneUploadSessionService:
    return PhoneUploadSessionService(
        database=request.app.state.database,
        settings=request.app.state.settings,
    )


def _enabled_endpoint(request: Request) -> LanEndpoint:
    settings = request.app.state.settings
    if not settings.phone_upload_enabled:
        raise MuseError(
            status_code=503,
            code="phone_upload_unavailable",
            message="Phone upload is not enabled on this Muse device.",
        )
    return resolve_lan_endpoint(settings)


def _listener_status(request: Request) -> PhoneUploadListenerStatus:
    probe = getattr(request.app.state, "phone_upload_listener_probe", None)
    if probe is None:
        probe = PhoneUploadListenerProbe(request.app.state.settings)
    return probe.check()


def _require_listener(request: Request) -> PhoneUploadListenerStatus:
    listener_status = _listener_status(request)
    if listener_status is PhoneUploadListenerStatus.UNAVAILABLE:
        raise MuseError(
            status_code=503,
            code="phone_upload_listener_unavailable",
            message="Phone upload is temporarily unavailable on the local network.",
            details={"retryable": True},
        )
    return listener_status


def _device_response(
    session: PhoneUploadSessionRead,
    listener_status: PhoneUploadListenerStatus,
) -> PhoneUploadDeviceSession:
    return PhoneUploadDeviceSession(
        **session.model_dump(),
        listener_status=listener_status,
    )


def _created_response(
    created: CreatedPhoneUploadSession,
    endpoint: LanEndpoint,
    listener_status: PhoneUploadListenerStatus,
) -> PhoneUploadSessionCreated:
    upload_url, fallback = endpoint.session_urls(created.raw_token)
    return PhoneUploadSessionCreated(
        **created.session.model_dump(),
        upload_url=upload_url,
        qr_payload=upload_url,
        fallback_upload_url=fallback,
        listener_status=listener_status,
    )


@router.post("", response_model=PhoneUploadSessionCreated, status_code=status.HTTP_201_CREATED)
def create_phone_upload_session(request: Request, response: Response) -> PhoneUploadSessionCreated:
    endpoint = _enabled_endpoint(request)
    listener_status = _require_listener(request)
    created = _service(request).create()
    response.headers["Cache-Control"] = "no-store"
    response.headers["Location"] = f"/api/v1/phone-upload-sessions/{created.session.id}"
    return _created_response(created, endpoint, listener_status)


@router.get("/{session_id}", response_model=PhoneUploadDeviceSession)
def get_phone_upload_session(
    session_id: SessionId, request: Request, response: Response
) -> PhoneUploadDeviceSession:
    response.headers["Cache-Control"] = "no-store"
    session = _service(request).get_device(session_id)
    return _device_response(session, _listener_status(request))


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_phone_upload_session(session_id: SessionId, request: Request) -> Response:
    _service(request).cancel(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


@router.post(
    "/{session_id}/regenerate",
    response_model=PhoneUploadSessionCreated,
    status_code=status.HTTP_201_CREATED,
)
def regenerate_phone_upload_session(
    session_id: SessionId, request: Request, response: Response
) -> PhoneUploadSessionCreated:
    endpoint = _enabled_endpoint(request)
    listener_status = _require_listener(request)
    created = _service(request).regenerate(session_id)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Location"] = f"/api/v1/phone-upload-sessions/{created.session.id}"
    return _created_response(created, endpoint, listener_status)
