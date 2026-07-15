import http.client
from typing import Any

import pytest

from muse_backend.config import Settings
from muse_backend.domain.enums import PhoneUploadListenerStatus
from muse_backend.services.phone_upload_listener import PhoneUploadListenerProbe


class _Response:
    def __init__(
        self,
        *,
        status: int = 200,
        content_type: str = "application/json",
        body: bytes = b'{"status":"ok"}',
    ) -> None:
        self.status = status
        self.content_type = content_type
        self.body = body
        self.read_limit: int | None = None

    def read(self, amount: int) -> bytes:
        self.read_limit = amount
        return self.body[:amount]

    def getheader(self, name: str, default: str = "") -> str:
        return self.content_type if name.lower() == "content-type" else default


class _Connection:
    def __init__(
        self,
        response: _Response,
        *,
        request_error: BaseException | None = None,
    ) -> None:
        self.response = response
        self.request_error = request_error
        self.request: tuple[str, str, dict[str, str]] | None = None
        self.closed = False

    def send_request(self, method: str, path: str, headers: dict[str, str]) -> None:
        if self.request_error is not None:
            raise self.request_error
        self.request = (method, path, headers)

    def close(self) -> None:
        self.closed = True


def _install_connection(
    monkeypatch: pytest.MonkeyPatch,
    connection: _Connection,
) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    class FakeHttpConnection:
        def __init__(self, *, host: str, port: int, timeout: float) -> None:
            captured.update(host=host, port=port, timeout=timeout)

        def request(self, method: str, path: str, *, headers: dict[str, str]) -> None:
            connection.send_request(method, path, headers)

        def getresponse(self) -> _Response:
            return connection.response

        def close(self) -> None:
            connection.close()

    monkeypatch.setattr(http.client, "HTTPConnection", FakeHttpConnection)
    return captured


def test_probe_uses_only_the_numeric_bind_endpoint_and_bounded_safe_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _Response(content_type="application/json; charset=utf-8")
    connection = _Connection(response)
    captured = _install_connection(monkeypatch, connection)
    settings = Settings.model_validate(
        {
            "phone_upload_bind_host": "192.168.1.50",
            "phone_upload_port": 8001,
        }
    )

    result = PhoneUploadListenerProbe(settings, timeout_seconds=0.25).check()

    assert result is PhoneUploadListenerStatus.READY
    assert captured == {"host": "192.168.1.50", "port": 8001, "timeout": 0.25}
    assert connection.request == (
        "GET",
        "/listener-status",
        {
            "Accept": "application/json",
            "Connection": "close",
            "Host": "192.168.1.50:8001",
        },
    )
    assert response.read_limit == 65
    assert connection.closed is True


@pytest.mark.parametrize(
    ("response", "request_error"),
    [
        (_Response(status=307), None),
        (_Response(content_type="text/plain"), None),
        (_Response(body=b'{"status":"not-ready"}'), None),
        (_Response(body=b'{"status":"ok"}' + b" " * 80), None),
        (_Response(), TimeoutError()),
        (_Response(), OSError("connection refused")),
    ],
)
def test_probe_fails_closed_without_following_or_leaking_transport_errors(
    monkeypatch: pytest.MonkeyPatch,
    response: _Response,
    request_error: BaseException | None,
) -> None:
    connection = _Connection(response, request_error=request_error)
    _install_connection(monkeypatch, connection)

    result = PhoneUploadListenerProbe(Settings()).check()

    assert result is PhoneUploadListenerStatus.UNAVAILABLE
    assert connection.closed is True
