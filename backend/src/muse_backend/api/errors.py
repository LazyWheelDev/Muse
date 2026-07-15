import logging
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from muse_backend.domain.exceptions import DatabaseUnavailableError, MuseError
from muse_backend.schemas.common import ErrorBody, ErrorEnvelope

logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str:
    return cast(str, getattr(request.state, "request_id", "unavailable"))


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    payload = ErrorEnvelope(
        error=ErrorBody(
            code=code,
            message=message,
            details=details,
            request_id=request_id,
        )
    )
    response_headers = dict(headers) if headers is not None else {}
    response_headers["X-Request-ID"] = request_id
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(mode="json"),
        headers=response_headers,
    )


async def handle_muse_error(request: Request, error: MuseError) -> JSONResponse:
    return _error_response(
        request,
        status_code=error.status_code,
        code=error.code,
        message=error.message,
        details=error.details,
    )


async def handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    fields = [
        {
            "location": [str(part) for part in issue["loc"]],
            "message": issue["msg"],
            "type": issue["type"],
        }
        for issue in error.errors()
    ]
    return _error_response(
        request,
        status_code=422,
        code="request_validation_failed",
        message="The request did not pass validation.",
        details={"fields": fields},
    )


async def handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
    message = "The requested resource was not found."
    code = "resource_not_found"
    if error.status_code == 405:
        message = "The requested operation is not allowed."
        code = "method_not_allowed"
    elif error.status_code != 404:
        message = "Muse could not complete the request."
        code = "http_error"
    headers = dict(error.headers) if error.headers is not None else None
    return _error_response(
        request,
        status_code=error.status_code,
        code=code,
        message=message,
        headers=headers,
    )


async def handle_database_error(request: Request, error: SQLAlchemyError) -> JSONResponse:
    logger.exception(
        "Unhandled database error (request_id=%s)",
        _request_id(request),
        exc_info=error,
    )
    unavailable = DatabaseUnavailableError()
    return await handle_muse_error(request, unavailable)


async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled application error (request_id=%s)",
        _request_id(request),
        exc_info=error,
    )
    return _error_response(
        request,
        status_code=500,
        code="internal_error",
        message="Muse encountered an unexpected local error.",
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(MuseError, handle_muse_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, handle_validation_error)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, handle_http_error)  # type: ignore[arg-type]
    app.add_exception_handler(SQLAlchemyError, handle_database_error)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, handle_unexpected_error)
