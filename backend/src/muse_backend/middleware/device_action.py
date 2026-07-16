import json

from starlette.types import ASGIApp, Receive, Scope, Send

from muse_backend.config import Settings


class DeviceActionPendingMiddleware:
    """Stop new mutations once a coordinated restart or power action is scheduled."""

    def __init__(self, app: ASGIApp, *, settings: Settings) -> None:
        self.app = app
        self.marker = settings.device_action_marker_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope.get("method") not in {"GET", "HEAD", "OPTIONS"}
            and scope.get("path", "").rsplit("/", 1)[-1]
            not in {"restart_application", "reboot_device", "shutdown_device"}
            and self.marker.is_file()
        ):
            request_id = str(scope.get("state", {}).get("request_id", "unavailable"))
            body = json.dumps(
                {
                    "error": {
                        "code": "device_action_pending",
                        "message": "Muse is preparing a device action. Please wait.",
                        "details": None,
                        "request_id": request_id,
                    }
                },
                separators=(",", ":"),
            ).encode("utf-8")
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"cache-control", b"no-store"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
