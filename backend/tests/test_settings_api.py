import json

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from muse_backend.config import Settings
from muse_backend.database.models.setting import ApplicationSetting
from muse_backend.domain.enums import PhoneUploadListenerStatus
from muse_backend.services.phone_upload_listener import PhoneUploadListenerProbe
from tests.support import running_client

pytestmark = pytest.mark.integration


async def test_typed_settings_defaults_persist_and_reject_unknown_or_invalid_values(
    app: FastAPI,
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    defaults = await client.get("/api/v1/settings")
    assert defaults.status_code == 200
    assert defaults.json() == {
        "preferences": {
            "device_name": "Muse",
            "interface_brightness_percent": 100,
            "screen_timeout_minutes": 10,
            "reduced_motion": False,
            "splash_mode": "full",
        },
        "last_successful_backup": None,
    }

    updated = await client.patch(
        "/api/v1/settings",
        json={
            "device_name": "Bedroom Muse",
            "interface_brightness_percent": 65,
            "screen_timeout_minutes": 15,
            "reduced_motion": True,
            "splash_mode": "reduced",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["preferences"]["device_name"] == "Bedroom Muse"
    assert updated.json()["preferences"]["reduced_motion"] is True

    invalid = await client.patch(
        "/api/v1/settings",
        json={"interface_brightness_percent": 1, "cloud_sync": True},
    )
    assert invalid.status_code == 422

    with app.state.database.session() as session:
        rows = list(session.scalars(select(ApplicationSetting)))
    assert {row.key for row in rows} == {
        "device_name",
        "interface_brightness_percent",
        "screen_timeout_minutes",
        "reduced_motion",
        "splash_mode",
    }
    assert all("cloud" not in row.key for row in rows)

    async with running_client(migrated_settings) as restarted:
        persisted = await restarted.get("/api/v1/settings")
    assert persisted.json()["preferences"] == updated.json()["preferences"]


async def test_invalid_internal_setting_rows_fall_back_without_exposing_generic_storage(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    with app.state.database.session() as session, session.begin():
        session.add(
            ApplicationSetting(
                key="interface_brightness_percent",
                value_json=json.dumps(1000),
                value_type="integer",
            )
        )
        session.add(
            ApplicationSetting(
                key="future_internal_setting",
                value_json=json.dumps("secret"),
                value_type="string",
            )
        )

    response = await client.get("/api/v1/settings")

    assert response.status_code == 200
    assert response.json()["preferences"]["interface_brightness_percent"] == 100
    assert "future_internal_setting" not in response.text


async def test_sensitive_settings_mutations_require_json_and_an_allowed_origin(
    client: httpx.AsyncClient,
) -> None:
    wrong_type = await client.patch(
        "/api/v1/settings",
        content=b"{}",
        headers={"Content-Type": "text/plain"},
    )
    cross_origin = await client.patch(
        "/api/v1/settings",
        json={"reduced_motion": True},
        headers={"Origin": "https://attacker.invalid"},
    )
    same_origin = await client.patch(
        "/api/v1/settings",
        json={"reduced_motion": True},
        headers={"Origin": "http://testserver"},
    )
    no_delete_body = await client.request(
        "DELETE",
        "/api/v1/settings/backups/" + "0" * 32,
    )
    oversized_delete = await client.request(
        "DELETE",
        "/api/v1/settings/backups/" + "0" * 32,
        content=b"{" + b'"padding":"' + b"x" * 70_000 + b'"}',
        headers={"Content-Type": "application/json"},
    )

    assert wrong_type.status_code == 415
    assert wrong_type.json()["error"]["code"] == "settings_json_required"
    assert cross_origin.status_code == 403
    assert cross_origin.json()["error"]["code"] == "settings_origin_rejected"
    assert same_origin.status_code == 200
    assert no_delete_body.status_code == 415
    assert oversized_delete.status_code == 413
    assert oversized_delete.json()["error"]["code"] == "request_body_too_large"


async def test_device_network_capability_and_storage_contracts_are_safe_and_honest(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        PhoneUploadListenerProbe,
        "check",
        lambda _self: PhoneUploadListenerStatus.UNAVAILABLE,
    )
    network = await client.get("/api/v1/settings/network-status")
    storage = await client.get("/api/v1/settings/storage-summary")
    capabilities = await client.get("/api/v1/settings/capabilities")
    device = await client.get("/api/v1/settings/device-status")

    assert network.status_code == storage.status_code == capabilities.status_code == 200
    assert device.status_code == 200
    assert network.json()["internet_status"] == "not_checked"
    assert network.json()["listener_status"] == "disabled"
    assert storage.json()["database_bytes"] > 0
    assert storage.json()["backup_count"] == 0
    assert capabilities.json()["display_sleep"]["state"] == "available"
    for action in ("restart_application", "reboot_device", "shutdown_device"):
        assert capabilities.json()[action] == {
            "available": False,
            "state": "requires_deployment_configuration",
            "reason": "Available after the Raspberry Pi deployment milestone.",
        }
    assert device.json()["main_readiness"] == "ready"
    assert device.json()["internet_status"] == "not_checked"
    assert device.json()["last_successful_backup"] is None
    assert "data_root" not in device.text
    assert "database_path" not in device.text
    assert "/Users/" not in device.text


async def test_cleanup_is_typed_bounded_and_preserves_pending_staging(
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    orphan = migrated_settings.maintenance_root / f"restore-{'a' * 32}"
    orphan.mkdir()
    pending_operation = "b" * 32
    pending_staging = migrated_settings.maintenance_root / f"restore-{pending_operation}"
    pending_staging.mkdir()
    (migrated_settings.maintenance_root / "pending-operation.json").write_text(
        json.dumps(
            {
                "type": "delete_all",
                "operation_id": pending_operation,
                "safety_backup_id": "c" * 32,
            }
        ),
        encoding="utf-8",
    )

    rejected = await client.post("/api/v1/settings/cleanup", json={})
    cleaned = await client.post(
        "/api/v1/settings/cleanup",
        json={"confirmation": "CLEAN UP"},
    )

    assert rejected.status_code == 422
    assert cleaned.status_code == 200
    assert cleaned.json()["maintenance_entries"] == 1
    assert not orphan.exists()
    assert pending_staging.exists()
