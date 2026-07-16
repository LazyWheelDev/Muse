import ipaddress
import re
from collections.abc import Sequence

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from muse_backend.schemas.common import ErrorBody, ErrorEnvelope

_DNS_LABEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def _valid_port(value: str) -> bool:
    return (
        1 <= len(value) <= 5 and value.isascii() and value.isdecimal() and 0 <= int(value) <= 65_535
    )


def _host_from_authority(authority: str) -> str | None:
    candidate = authority.lower()
    if not candidate or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in candidate
    ):
        return None

    if candidate.startswith("["):
        closing_bracket = candidate.find("]")
        if closing_bracket < 0:
            return None
        raw_host = candidate[1:closing_bracket]
        remainder = candidate[closing_bracket + 1 :]
        if remainder and (not remainder.startswith(":") or not _valid_port(remainder[1:])):
            return None
        try:
            return ipaddress.IPv6Address(raw_host).compressed
        except ipaddress.AddressValueError:
            return None

    if candidate.count(":") > 1:
        return None
    raw_host, separator, port = candidate.partition(":")
    if separator and not _valid_port(port):
        return None
    normalized_host = raw_host.removesuffix(".")
    if not normalized_host or len(normalized_host) > 253:
        return None
    if not all(_DNS_LABEL_PATTERN.fullmatch(label) for label in normalized_host.split(".")):
        return None
    return normalized_host


def _transport_error(
    scope: Scope,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    state = scope.get("state", {})
    request_id = str(state.get("request_id", "unavailable"))
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code=code,
            message=message,
            details=details,
            request_id=request_id,
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(mode="json"),
        headers=headers,
    )


class JsonTrustedHostMiddleware:
    def __init__(self, app: ASGIApp, *, allowed_hosts: Sequence[str]) -> None:
        self.app = app
        self.allowed_hosts = tuple(host.lower() for host in allowed_hosts)
        self.allow_any = "*" in allowed_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_any or scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        host = _host_from_authority(Headers(scope=scope).get("host", ""))
        is_allowed = (
            any(
                host == pattern or (pattern.startswith("*.") and host.endswith(pattern[1:]))
                for pattern in self.allowed_hosts
            )
            if host is not None
            else False
        )
        if is_allowed:
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":  # pragma: no cover - Muse exposes no WebSocket API.
            await send({"type": "websocket.close", "code": 1008})
            return

        response = _transport_error(
            scope,
            status_code=400,
            code="invalid_host",
            message="The request host is not allowed.",
        )
        await response(scope, receive, send)


class JsonCORSMiddleware(CORSMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            if scope["method"] == "OPTIONS" and "access-control-request-method" in headers:
                response = self.preflight_response(request_headers=headers)
                if response.status_code >= 400:
                    cors_headers = {
                        name: value
                        for name, value in response.headers.items()
                        if name.lower().startswith("access-control-") or name.lower() == "vary"
                    }
                    response = _transport_error(
                        scope,
                        status_code=400,
                        code="cors_preflight_rejected",
                        message="The cross-origin request is not allowed.",
                        headers=cors_headers,
                    )
                await response(scope, receive, send)
                return
        await super().__call__(scope, receive, send)


class RequestBodyLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        max_body_size: int,
        streaming_paths: Sequence[str] = (),
    ) -> None:
        self.app = app
        self.max_body_size = max_body_size
        self.streaming_paths = frozenset(streaming_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}
            or scope.get("path") in self.streaming_paths
        ):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                await self._reject(
                    scope,
                    receive,
                    send,
                    status_code=400,
                    code="invalid_content_length",
                    message="The request Content-Length is invalid.",
                )
                return
            if declared_size < 0:
                await self._reject(
                    scope,
                    receive,
                    send,
                    status_code=400,
                    code="invalid_content_length",
                    message="The request Content-Length is invalid.",
                )
                return
            if declared_size > self.max_body_size:
                await self._reject_too_large(scope, receive, send)
                return

        buffered_messages: list[Message] = []
        received_size = 0
        while True:
            message = await receive()
            buffered_messages.append(message)
            if message["type"] != "http.request":
                break
            received_size += len(message.get("body", b""))
            if received_size > self.max_body_size:
                await self._reject_too_large(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        message_iterator = iter(buffered_messages)

        async def replay_receive() -> Message:
            try:
                return next(message_iterator)
            except StopIteration:
                return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)

    async def _reject_too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._reject(
            scope,
            receive,
            send,
            status_code=413,
            code="request_body_too_large",
            message="The request body exceeds the configured local limit.",
        )

    @staticmethod
    async def _reject(
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        code: str,
        message: str,
    ) -> None:
        response = _transport_error(
            scope,
            status_code=status_code,
            code=code,
            message=message,
        )
        await response(scope, receive, send)


class MainSecurityHeadersMiddleware:
    """Static local-kiosk browser policy for the loopback Muse application."""

    _HEADERS = (
        (
            b"content-security-policy",
            b"default-src 'self'; script-src 'self'; style-src 'self'; "
            b"style-src-elem 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; "
            b"img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; "
            b"base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        ),
        (b"x-frame-options", b"DENY"),
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {name.lower() for name, _value in headers}
                headers.extend(header for header in self._HEADERS if header[0] not in existing)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class LoopbackOnlyMiddleware:
    """Defense in depth if the supported production CLI is misconfigured or bypassed."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        try:
            is_loopback = client is not None and ipaddress.ip_address(client[0]).is_loopback
        except ValueError:
            is_loopback = False
        if is_loopback:
            await self.app(scope, receive, send)
            return
        response = _transport_error(
            scope,
            status_code=403,
            code="loopback_access_required",
            message="The Muse device interface is available only on this device.",
        )
        await response(scope, receive, send)
