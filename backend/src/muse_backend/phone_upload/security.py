import threading
import time
from collections import OrderedDict, deque
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from muse_backend.middleware.security import _transport_error

_SECURITY_HEADERS = (
    (
        b"content-security-policy",
        b"default-src 'self'; script-src 'self'; style-src 'self'; "
        b"font-src 'self'; img-src 'self' blob:; connect-src 'self'; "
        b"object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ),
    (b"referrer-policy", b"no-referrer"),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(self), microphone=(), geolocation=()"),
)


class PhoneSecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {name.lower() for name, _ in headers}
                headers.extend(
                    (name, value) for name, value in _SECURITY_HEADERS if name not in names
                )
                if b"cache-control" not in names:
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class SameOriginPhoneUploadMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        host = headers.get("host")
        accepted = False
        if origin is not None and host is not None:
            parsed = urlsplit(origin)
            accepted = (
                parsed.scheme == "http"
                and parsed.netloc.lower() == host.lower()
                and parsed.path in {"", "/"}
                and not parsed.query
                and not parsed.fragment
                and parsed.username is None
                and parsed.password is None
            )
        if accepted:
            await self.app(scope, receive, send)
            return
        response = _transport_error(
            scope,
            status_code=403,
            code="phone_upload_origin_rejected",
            message="The phone upload request must come from this Muse page.",
        )
        await response(scope, receive, send)


class BoundedPhoneRateLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        request_limit: int,
        window_seconds: float,
        max_clients: int,
    ) -> None:
        self.app = app
        self.request_limit = request_limit
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self._clients: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not str(scope.get("path", "")).startswith("/phone-api/"):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        client_key = str(client[0]) if client is not None else "unknown"
        now = time.monotonic()
        with self._lock:
            bucket = self._clients.pop(client_key, deque())
            cutoff = now - self.window_seconds
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            allowed = len(bucket) < self.request_limit
            if allowed:
                bucket.append(now)
            self._clients[client_key] = bucket
            while len(self._clients) > self.max_clients:
                self._clients.popitem(last=False)
        if allowed:
            await self.app(scope, receive, send)
            return
        response = _transport_error(
            scope,
            status_code=429,
            code="rate_limit_exceeded",
            message="Too many phone upload requests were received. Please wait and try again.",
            details={"retryable": True},
            headers={"Retry-After": str(max(1, round(self.window_seconds)))},
        )
        await response(scope, receive, send)
