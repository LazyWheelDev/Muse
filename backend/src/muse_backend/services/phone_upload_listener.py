import http.client

from muse_backend.config import Settings
from muse_backend.domain.enums import PhoneUploadListenerStatus

_MAX_STATUS_BODY_BYTES = 64
_PROBE_TIMEOUT_SECONDS = 0.5
_READY_BODY = b'{"status":"ok"}'


class PhoneUploadListenerProbe:
    """Check the configured restricted listener without following redirects or using DNS."""

    def __init__(
        self,
        settings: Settings,
        *,
        timeout_seconds: float = _PROBE_TIMEOUT_SECONDS,
    ) -> None:
        self.host = str(settings.phone_upload_bind_host)
        self.port = settings.phone_upload_port
        self.timeout_seconds = timeout_seconds

    def check(self) -> PhoneUploadListenerStatus:
        connection = http.client.HTTPConnection(
            host=self.host,
            port=self.port,
            timeout=self.timeout_seconds,
        )
        try:
            connection.request(
                "GET",
                "/listener-status",
                headers={
                    "Accept": "application/json",
                    "Connection": "close",
                    "Host": f"{self.host}:{self.port}",
                },
            )
            response = connection.getresponse()
            body = response.read(_MAX_STATUS_BODY_BYTES + 1)
            content_type = response.getheader("Content-Type", "")
            if (
                response.status == 200
                and content_type.partition(";")[0].strip().lower() == "application/json"
                and body == _READY_BODY
            ):
                return PhoneUploadListenerStatus.READY
        except (OSError, TimeoutError, http.client.HTTPException):
            pass
        finally:
            connection.close()
        return PhoneUploadListenerStatus.UNAVAILABLE
