from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from muse_backend.middleware.security import _transport_error

_SETTINGS_PREFIX = "/api/v1/settings"
_MUTATING_METHODS = frozenset({"POST", "PATCH", "DELETE"})


class SensitiveSettingsMutationMiddleware:
    """CSRF defense for privileged local Settings mutations.

    JSON-only POST/PATCH routes cannot be submitted by an HTML form. When a
    browser supplies Origin it must match the main application or an explicitly
    configured development origin; the LAN listener never mounts these routes.
    """

    def __init__(self, app: ASGIApp, *, allowed_development_origins: list[str]) -> None:
        self.app = app
        self.allowed_development_origins = frozenset(allowed_development_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] not in _MUTATING_METHODS
            or (
                str(scope.get("path", "")) != _SETTINGS_PREFIX
                and not str(scope.get("path", "")).startswith(f"{_SETTINGS_PREFIX}/")
            )
        ):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is not None:
            scheme = str(scope.get("scheme", "http")).lower()
            authority = headers.get("host", "")
            same_origin = f"{scheme}://{authority}".lower()
            try:
                parsed = urlsplit(origin)
                normalized = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
                valid = (
                    parsed.scheme in {"http", "https"}
                    and parsed.netloc
                    and not parsed.path.strip("/")
                    and not parsed.query
                    and not parsed.fragment
                    and (
                        normalized == same_origin or normalized in self.allowed_development_origins
                    )
                )
            except ValueError:
                valid = False
            if not valid:
                response = _transport_error(
                    scope,
                    status_code=403,
                    code="settings_origin_rejected",
                    message="The Settings request origin is not allowed.",
                )
                await response(scope, receive, send)
                return
        if scope["method"] in {"POST", "PATCH", "DELETE"}:
            content_type = headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json":
                response = _transport_error(
                    scope,
                    status_code=415,
                    code="settings_json_required",
                    message="Settings mutations require a JSON request.",
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
