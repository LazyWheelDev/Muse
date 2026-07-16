import re
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError

from muse_backend import __version__
from muse_backend.application import create_app
from muse_backend.config import Settings
from muse_backend.database.migrations import migration_status
from tests.support import running_client

pytestmark = pytest.mark.integration


async def test_health_is_live_before_database_migration(settings: Settings) -> None:
    async with running_client(settings) as client:
        health = await client.get("/api/v1/health")
        readiness = await client.get("/api/v1/readiness")

    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "service": "muse-backend",
        "version": __version__,
    }
    assert readiness.status_code == 503
    assert readiness.json()["status"] == "not_ready"
    assert readiness.json()["checks"]["database"]["status"] == "ok"
    assert readiness.json()["checks"]["migrations"] == {
        "status": "error",
        "message": "The local database schema is not current.",
    }
    assert readiness.json()["checks"]["storage"]["status"] == "ok"
    assert "script-src 'self'" in health.headers["content-security-policy"]
    assert "style-src-attr 'unsafe-inline'" in health.headers["content-security-policy"]
    assert "form-action 'self'" in health.headers["content-security-policy"]
    assert health.headers["x-frame-options"] == "DENY"
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["referrer-policy"] == "no-referrer"


async def test_readiness_reports_all_local_dependencies_ready(
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    response = await client.get("/api/v1/readiness")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {
            "database": {"status": "ok"},
            "migrations": {"status": "ok"},
            "storage": {"status": "ok"},
        },
    }
    assert migration_status(migrated_settings).is_current


async def test_readiness_degrades_cleanly_for_database_migration_and_storage_failures(
    app: FastAPI,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "muse_backend.api.v1.health.verify_database_connection",
        lambda _engine: False,
    )
    monkeypatch.setattr(app.state.storage, "writable", lambda: False)
    response = await client.get("/api/v1/readiness")

    assert response.status_code == 503
    assert response.json()["checks"] == {
        "database": {
            "status": "error",
            "message": "The local database is unavailable.",
        },
        "migrations": {
            "status": "error",
            "message": "The local database schema is not current.",
        },
        "storage": {
            "status": "error",
            "message": "Local storage is not writable.",
        },
    }


async def test_readiness_handles_migration_inspection_failure(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_status(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("corrupt migration metadata")

    monkeypatch.setattr("muse_backend.api.v1.health.migration_status", fail_status)
    response = await client.get("/api/v1/readiness")

    assert response.status_code == 503
    assert response.json()["checks"]["database"]["status"] == "ok"
    assert response.json()["checks"]["migrations"]["status"] == "error"


async def test_readiness_does_not_recreate_missing_storage_during_migration_check(
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    migrated_settings.backup_root.rmdir()

    response = await client.get("/api/v1/readiness")

    assert response.status_code == 503
    assert response.json()["checks"]["migrations"]["status"] == "ok"
    assert response.json()["checks"]["storage"]["status"] == "error"
    assert not migrated_settings.backup_root.exists()


async def test_errors_are_structured_and_propagate_safe_request_ids(
    client: httpx.AsyncClient,
) -> None:
    requested_id = "muse-test.request_42"
    missing = await client.get(
        "/api/v1/clothing-items/99999",
        headers={"X-Request-ID": requested_id},
    )

    assert missing.status_code == 404
    assert missing.headers["x-request-id"] == requested_id
    assert missing.json() == {
        "error": {
            "code": "clothing_item_not_found",
            "message": "The requested clothing item was not found.",
            "details": None,
            "request_id": requested_id,
        }
    }

    invalid_header = await client.get(
        "/api/v1/not-a-route",
        headers={"X-Request-ID": "not valid because spaces"},
    )
    generated_id = invalid_header.headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", generated_id)
    assert invalid_header.json()["error"]["request_id"] == generated_id
    assert invalid_header.json()["error"]["code"] == "resource_not_found"


async def test_request_validation_and_method_errors_share_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    validation = await client.post(
        "/api/v1/clothing-items",
        json={"name": "", "garment_category": "not-a-category", "unknown": True},
    )

    assert validation.status_code == 422
    body = validation.json()["error"]
    assert body["code"] == "request_validation_failed"
    locations = {tuple(field["location"]) for field in body["details"]["fields"]}
    assert ("body", "name") in locations
    assert ("body", "garment_category") in locations
    assert ("body", "unknown") in locations
    assert body["request_id"] == validation.headers["x-request-id"]

    method = await client.post("/api/v1/health")
    assert method.status_code == 405
    assert method.json()["error"]["code"] == "method_not_allowed"

    openapi = await client.get("/api/openapi.json")
    create_responses = openapi.json()["paths"]["/api/v1/clothing-items"]["post"]["responses"]
    assert create_responses["422"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorEnvelope"
    }


async def test_unexpected_and_database_errors_do_not_leak_internal_details(
    migrated_settings: Settings,
) -> None:
    application = create_app(migrated_settings)

    @application.get("/test/unexpected")
    async def unexpected() -> None:
        raise RuntimeError("sensitive unexpected details")

    @application.get("/test/database")
    async def database_failure() -> None:
        raise SQLAlchemyError("sensitive database details")

    async with running_client(migrated_settings, application=application) as client:
        unexpected_response = await client.get("/test/unexpected")
        database_response = await client.get("/test/database")

    assert unexpected_response.status_code == 500
    assert unexpected_response.json()["error"]["code"] == "internal_error"
    assert (
        unexpected_response.headers["x-request-id"]
        == unexpected_response.json()["error"]["request_id"]
    )
    assert "sensitive" not in unexpected_response.text
    assert database_response.status_code == 503
    assert database_response.json()["error"]["code"] == "database_unavailable"
    assert "sensitive" not in database_response.text


async def test_cors_is_local_and_explicit(tmp_path: Path) -> None:
    settings = Settings(
        environment="testing",
        data_root=tmp_path / "data",
        allowed_origins=["http://localhost:5173"],
        trusted_hosts=["testserver"],
    )
    from muse_backend.database.migrations import upgrade_database
    from muse_backend.storage.local import LocalStorageService

    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)

    async with running_client(settings) as client:
        allowed = await client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        denied = await client.options(
            "/api/v1/health",
            headers={
                "Origin": "https://remote.example",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers
    assert denied.json()["error"]["code"] == "cors_preflight_rejected"
    assert denied.json()["error"]["request_id"] == denied.headers["x-request-id"]


async def test_transport_guards_use_the_structured_error_contract(
    client: httpx.AsyncClient,
) -> None:
    invalid_host = await client.get(
        "/api/v1/health",
        headers={"Host": "untrusted.example", "X-Request-ID": "transport-test"},
    )

    assert invalid_host.status_code == 400
    assert invalid_host.json() == {
        "error": {
            "code": "invalid_host",
            "message": "The request host is not allowed.",
            "details": None,
            "request_id": "transport-test",
        }
    }
    assert invalid_host.headers["x-request-id"] == "transport-test"

    for malformed_host in (
        "testserver:evil",
        "testserver:443@evil.example",
        f"testserver:{'9' * 5_000}",
    ):
        rejected = await client.get("/api/v1/health", headers={"Host": malformed_host})
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "invalid_host"

    canonical_host = await client.get("/api/v1/health", headers={"Host": "TESTSERVER:8000"})
    assert canonical_host.status_code == 200


async def test_request_body_limit_rejects_declared_and_malformed_lengths(tmp_path: Path) -> None:
    settings = Settings(
        environment="testing",
        data_root=tmp_path / "limited-data",
        max_api_body_size_bytes=1024,
        trusted_hosts=["testserver", "::1"],
    )
    from muse_backend.database.migrations import upgrade_database
    from muse_backend.storage.local import LocalStorageService

    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)

    async with running_client(settings) as client:
        too_large = await client.post(
            "/api/v1/clothing-items",
            json={
                "name": "Oversized",
                "garment_category": "top",
                "notes": "x" * 2_000,
            },
        )
        malformed = await client.post(
            "/api/v1/clothing-items",
            content=b"{}",
            headers={"Content-Length": "invalid"},
        )
        ipv6_host = await client.get("/api/v1/health", headers={"Host": "[::1]:8000"})

    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "request_body_too_large"
    assert too_large.json()["error"]["request_id"] == too_large.headers["x-request-id"]
    assert malformed.status_code == 400
    assert malformed.json()["error"]["code"] == "invalid_content_length"
    assert ipv6_host.status_code == 200
