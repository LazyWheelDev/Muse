import asyncio
import hashlib
import io
import json
import logging
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from asgi_lifespan import LifespanManager
from PIL import Image
from sqlalchemy import func, inspect, select

import muse_backend.services.imports as imports_module
import muse_backend.services.lan_address as lan_address_module
from muse_backend.application import create_app
from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import (
    check_migration_consistency,
    downgrade_database,
    migration_status,
    upgrade_database,
)
from muse_backend.database.models import ClothingItem, PhoneUploadSession
from muse_backend.domain.enums import PhoneUploadListenerStatus, PhoneUploadSessionStatus
from muse_backend.domain.exceptions import MuseError, ResourceConflictError
from muse_backend.phone_upload.application import create_phone_upload_app
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.lan_address import resolve_lan_endpoint
from muse_backend.services.phone_upload_sessions import (
    PhoneUploadSessionService,
    phone_upload_idempotency_key,
)
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.integration


class _StaticListenerProbe:
    def __init__(
        self,
        status: PhoneUploadListenerStatus = PhoneUploadListenerStatus.READY,
    ) -> None:
        self.status = status

    def check(self) -> PhoneUploadListenerStatus:
        return self.status


def _main_app(
    settings: Settings,
    probe: _StaticListenerProbe | None = None,
) -> Any:
    application = create_app(settings)
    application.state.phone_upload_listener_probe = probe or _StaticListenerProbe()
    return application


def _settings(tmp_path: Path, **updates: object) -> Settings:
    values: dict[str, object] = {
        "environment": Environment.TESTING,
        "data_root": tmp_path / "data",
        "frontend_build_path": tmp_path / "frontend-dist",
        "phone_upload_frontend_build_path": tmp_path / "phone-dist",
        "allowed_origins": [],
        "trusted_hosts": ["testserver"],
        "phone_upload_enabled": True,
        "phone_upload_bind_host": "127.0.0.1",
        "phone_upload_trusted_hosts": ["127.0.0.1", "testserver"],
        "background_processing_enabled": False,
    }
    values.update(updates)
    return Settings.model_validate(values)


def _create_phone_build(settings: Settings) -> None:
    root = settings.phone_upload_frontend_build_path
    assets = root / "assets"
    manifest = root / ".vite"
    assets.mkdir(parents=True)
    manifest.mkdir()
    (root / "index.html").write_text(
        '<!doctype html><html><body><div id="root"></div>'
        '<script type="module" src="/phone-assets/assets/app.js"></script></body></html>',
        encoding="utf-8",
    )
    (assets / "app.js").write_text("document.body.dataset.muse = 'phone';", encoding="utf-8")
    (assets / "unlisted.js").write_text("throw new Error('not public');", encoding="utf-8")
    (manifest / "manifest.json").write_text(
        json.dumps({"index.html": {"file": "assets/app.js", "isEntry": True}}),
        encoding="utf-8",
    )


def _image_bytes(image_format: str) -> bytes:
    image = Image.new("RGB", (96, 128), (188, 150, 113))
    output = io.BytesIO()
    image.save(output, format=image_format)
    image.close()
    return output.getvalue()


def _files(
    image: bytes,
    *,
    filename: str = "garment.jpg",
    mime_type: str = "image/jpeg",
    name: str = "Phone garment",
) -> list[tuple[str, tuple[str | None, bytes | str, str]]]:
    return [
        (
            "metadata",
            (
                None,
                json.dumps({"name": name, "garment_category": "top"}),
                "application/json",
            ),
        ),
        ("image", (filename, image, mime_type)),
    ]


def _token_from_url(url: str) -> str:
    token = parse_qs(urlsplit(url).fragment).get("token", [])
    assert len(token) == 1
    return token[0]


@asynccontextmanager
async def _client_for(application: Any) -> Any:
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            yield client


async def test_real_phone_upload_reuses_secure_import_and_is_single_use(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)

    raw_tokens: list[str] = []
    last_session_id = ""
    last_clothing_item_id = 0
    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        for image_format, filename, mime_type in (
            ("JPEG", "phone.jpg", "image/jpeg"),
            ("PNG", "phone.png", "image/png"),
            ("WEBP", "phone.webp", "image/webp"),
        ):
            created = await main.post("/api/v1/phone-upload-sessions")
            assert created.status_code == 201, created.text
            created_body = created.json()
            assert created_body["qr_payload"] == created_body["upload_url"]
            assert created_body["upload_url"].startswith("http://127.0.0.1:8787/u/#token=")
            token = _token_from_url(created_body["upload_url"])
            raw_tokens.append(token)
            assert len(token) == 43

            database = Database(settings.database_path)
            try:
                with database.session() as session:
                    persisted = session.get(PhoneUploadSession, created_body["id"])
                    assert persisted is not None
                    assert persisted.token_hash == hashlib.sha256(token.encode("ascii")).hexdigest()
                    assert token not in persisted.token_hash
            finally:
                database.dispose()

            opened = await phone.get(
                "/phone-api/v1/session",
                headers={"X-Muse-Upload-Token": token},
            )
            assert opened.status_code == 200
            assert opened.json()["status"] == "opened"
            assert opened.json()["can_upload"] is True
            assert opened.json()["can_retry"] is False

            original = _image_bytes(image_format)
            uploaded = await phone.post(
                "/phone-api/v1/upload",
                files=_files(
                    original,
                    filename=filename,
                    mime_type=mime_type,
                    name=f"Phone {image_format}",
                ),
                headers={
                    "Origin": "http://testserver",
                    "X-Muse-Upload-Token": token,
                },
            )
            assert uploaded.status_code == 201, uploaded.text
            assert uploaded.json()["status"] == "completed"
            clothing_item_id = uploaded.json()["clothing_item_id"]
            last_session_id = created_body["id"]
            last_clothing_item_id = clothing_item_id

            device_status = await main.get(f"/api/v1/phone-upload-sessions/{created_body['id']}")
            assert device_status.json()["status"] == "completed"
            assert device_status.json()["clothing_item_id"] == clothing_item_id
            assert token not in device_status.text
            detail = await main.get(f"/api/v1/clothing-items/{clothing_item_id}")
            assert detail.status_code == 200
            assert detail.json()["name"] == f"Phone {image_format}"
            original_image = next(
                item for item in detail.json()["images"] if item["image_kind"] == "original"
            )
            media = await main.get(original_image["content_url"])
            assert media.content == original

            replay = await phone.post(
                "/phone-api/v1/upload",
                files=_files(original, filename=filename, mime_type=mime_type),
                headers={
                    "Origin": "http://testserver",
                    "X-Muse-Upload-Token": token,
                },
            )
            assert replay.status_code == 409
            assert replay.json()["error"]["code"] == "phone_upload_session_used"

            used = await phone.get(
                "/phone-api/v1/session",
                headers={"X-Muse-Upload-Token": token},
            )
            assert used.json()["status"] == "completed"
            assert used.json()["can_upload"] is False

        listing = await main.get("/api/v1/clothing-items")
        assert listing.json()["total"] == 3

    assert all(token not in caplog.text for token in raw_tokens)
    assert all(f"#token={token}" not in caplog.text for token in raw_tokens)

    restarted_main = _main_app(settings)
    restarted_phone = create_phone_upload_app(settings)
    async with _client_for(restarted_main) as main, _client_for(restarted_phone) as phone:
        persisted_session = await main.get(f"/api/v1/phone-upload-sessions/{last_session_id}")
        assert persisted_session.json()["status"] == "completed"
        assert (
            await main.get(f"/api/v1/clothing-items/{last_clothing_item_id}")
        ).status_code == 200
        replay = await phone.post(
            "/phone-api/v1/upload",
            files=_files(_image_bytes("JPEG")),
            headers={
                "Origin": "http://testserver",
                "X-Muse-Upload-Token": raw_tokens[-1],
            },
        )
        assert replay.status_code == 409
        assert replay.json()["error"]["code"] == "phone_upload_session_used"


async def test_phone_upload_is_fail_closed_when_disabled(
    client: httpx.AsyncClient,
    settings: Settings,
) -> None:
    response = await client.post("/api/v1/phone-upload-sessions")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "phone_upload_unavailable"
    with pytest.raises(RuntimeError, match="disabled"):
        create_phone_upload_app(settings)


async def test_loopback_api_tracks_listener_without_orphaning_or_invalidating_sessions(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    probe = _StaticListenerProbe(PhoneUploadListenerStatus.UNAVAILABLE)
    main_app = _main_app(settings, probe)

    async with _client_for(main_app) as main:
        unavailable = await main.post("/api/v1/phone-upload-sessions")
        assert unavailable.status_code == 503
        assert unavailable.json()["error"] == {
            "code": "phone_upload_listener_unavailable",
            "message": "Phone upload is temporarily unavailable on the local network.",
            "details": {"retryable": True},
            "request_id": unavailable.headers["x-request-id"],
        }

        with main_app.state.database.session() as session:
            assert session.scalar(select(func.count()).select_from(PhoneUploadSession)) == 0

        probe.status = PhoneUploadListenerStatus.READY
        created_response = await main.post("/api/v1/phone-upload-sessions")
        assert created_response.status_code == 201
        created = created_response.json()
        assert created["listener_status"] == "ready"
        raw_token = _token_from_url(created["upload_url"])

        probe.status = PhoneUploadListenerStatus.UNAVAILABLE
        status_response = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert status_response.status_code == 200
        status_body = status_response.json()
        assert status_body["status"] == "pending"
        assert status_body["listener_status"] == "unavailable"
        assert raw_token not in status_response.text

        regeneration = await main.post(f"/api/v1/phone-upload-sessions/{created['id']}/regenerate")
        assert regeneration.status_code == 503
        with main_app.state.database.session() as session:
            assert session.scalar(select(func.count()).select_from(PhoneUploadSession)) == 1

        token_status = PhoneUploadSessionService(
            database=main_app.state.database,
            settings=settings,
        ).open_with_token(raw_token)
        assert token_status.can_upload is True

        cancelled = await main.delete(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert cancelled.status_code == 204


async def test_listener_refuses_readiness_without_the_compiled_mobile_build(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    upgrade_database(settings)
    application = create_phone_upload_app(settings)

    with pytest.raises(RuntimeError, match="compiled mobile build"):
        async with LifespanManager(application):
            raise AssertionError("listener startup must fail before entering its lifespan")


async def test_listener_readiness_fails_closed_if_mobile_build_disappears(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    application = create_phone_upload_app(settings)

    async with _client_for(application) as phone:
        assert (await phone.get("/listener-status")).status_code == 200
        asset = settings.phone_upload_frontend_build_path / "assets" / "app.js"
        asset_contents = asset.read_text(encoding="utf-8")
        asset.unlink()
        assert (await phone.get("/listener-status")).status_code == 503
        asset.write_text(asset_contents, encoding="utf-8")
        assert (await phone.get("/listener-status")).status_code == 200

        manifest = settings.phone_upload_frontend_build_path / ".vite" / "manifest.json"
        manifest_contents = manifest.read_text(encoding="utf-8")
        manifest.write_text("{}", encoding="utf-8")
        assert (await phone.get("/listener-status")).status_code == 503
        manifest.write_text(manifest_contents, encoding="utf-8")
        assert (await phone.get("/listener-status")).status_code == 200

        (settings.phone_upload_frontend_build_path / "index.html").unlink()
        unavailable = await phone.get("/listener-status")
        assert unavailable.status_code == 503
        assert unavailable.json()["error"]["code"] == "listener_unavailable"


async def test_listener_startup_removes_an_interrupted_partial_upload(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    upgrade_database(settings)
    interrupted = settings.temp_upload_root / ("a" * 32)
    interrupted.mkdir(mode=0o700)
    (interrupted / "upload.bin").write_bytes(b"partial private photograph")

    application = create_phone_upload_app(settings)
    async with _client_for(application) as phone:
        assert (await phone.get("/listener-status")).status_code == 200
        assert not interrupted.exists()


async def test_phone_upload_failure_retry_limit_cancel_and_heic_contract(tmp_path: Path) -> None:
    settings = _settings(tmp_path, phone_upload_max_attempts=2)
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)

    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        created = (await main.post("/api/v1/phone-upload-sessions")).json()
        token = _token_from_url(created["upload_url"])
        for attempt, expected_retryable in ((1, True), (2, False)):
            rejected = await phone.post(
                "/phone-api/v1/upload",
                files=_files(
                    b"\x00\x00\x00\x18ftypheic" + b"0" * 32,
                    filename="iphone.heic",
                    mime_type="image/heic",
                ),
                headers={
                    "Origin": "http://testserver",
                    "X-Muse-Upload-Token": token,
                },
            )
            assert rejected.status_code == 422, (attempt, rejected.text)
            assert rejected.json()["error"]["code"] == "unsupported_image_format"
            assert rejected.json()["error"]["details"]["retryable"] is expected_retryable

        exhausted = await phone.post(
            "/phone-api/v1/upload",
            files=_files(_image_bytes("JPEG")),
            headers={
                "Origin": "http://testserver",
                "X-Muse-Upload-Token": token,
            },
        )
        assert exhausted.status_code == 409
        assert exhausted.json()["error"]["code"] == "phone_upload_attempts_exhausted"

        cancelled = (await main.post("/api/v1/phone-upload-sessions")).json()
        cancelled_token = _token_from_url(cancelled["upload_url"])
        response = await main.delete(f"/api/v1/phone-upload-sessions/{cancelled['id']}")
        assert response.status_code == 204
        terminal = await phone.get(
            "/phone-api/v1/session",
            headers={"X-Muse-Upload-Token": cancelled_token},
        )
        assert terminal.json()["status"] == "cancelled"
        cancelled_upload = await phone.post(
            "/phone-api/v1/upload",
            files=_files(_image_bytes("JPEG")),
            headers={
                "Origin": "http://testserver",
                "X-Muse-Upload-Token": cancelled_token,
            },
        )
        assert cancelled_upload.status_code == 410
        assert cancelled_upload.json()["error"]["code"] == "phone_upload_session_cancelled"

        original = (await main.post("/api/v1/phone-upload-sessions")).json()
        regenerated = await main.post(f"/api/v1/phone-upload-sessions/{original['id']}/regenerate")
        assert regenerated.status_code == 201
        replacement = regenerated.json()
        assert replacement["id"] != original["id"]
        assert replacement["upload_url"] != original["upload_url"]
        old_status = await phone.get(
            "/phone-api/v1/session",
            headers={"X-Muse-Upload-Token": _token_from_url(original["upload_url"])},
        )
        assert old_status.json()["status"] == "cancelled"


async def test_two_simultaneous_phone_posts_commit_at_most_one_garment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)
    processing_started = threading.Event()
    release_processing = threading.Event()
    original_processor = cast(
        Callable[..., Any],
        vars(imports_module)["validate_and_process_upload"],
    )

    def blocking_processor(*args: Any, **kwargs: Any) -> Any:
        processing_started.set()
        assert release_processing.wait(timeout=5)
        return original_processor(*args, **kwargs)

    monkeypatch.setattr(imports_module, "validate_and_process_upload", blocking_processor)
    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        created = (await main.post("/api/v1/phone-upload-sessions")).json()
        token = _token_from_url(created["upload_url"])
        headers = {
            "Origin": "http://testserver",
            "X-Muse-Upload-Token": token,
        }
        first_task = asyncio.create_task(
            phone.post(
                "/phone-api/v1/upload",
                files=_files(_image_bytes("JPEG"), name="Race winner"),
                headers=headers,
            )
        )
        assert await asyncio.to_thread(processing_started.wait, 5)
        try:
            second = await phone.post(
                "/phone-api/v1/upload",
                files=_files(_image_bytes("JPEG"), name="Race loser"),
                headers=headers,
            )
        finally:
            release_processing.set()
        first = await first_task

        assert sorted((first.status_code, second.status_code)) == [201, 409]
        rejected = second if second.status_code == 409 else first
        assert rejected.json()["error"]["code"] in {
            "phone_upload_session_busy",
            "upload_concurrency_exceeded",
        }
        listing = await main.get("/api/v1/clothing-items")
        assert listing.json()["total"] == 1
        session = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert session.json()["status"] == "completed"


async def test_restart_recovers_session_when_import_commits_before_completion_hook(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)
    original_complete = PhoneUploadSessionService.complete

    def fail_after_commit(*args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        raise MuseError(
            status_code=503,
            code="phone_upload_completion_interrupted",
            message="The local completion transition was interrupted.",
        )

    monkeypatch.setattr(PhoneUploadSessionService, "complete", fail_after_commit)
    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        created = (await main.post("/api/v1/phone-upload-sessions")).json()
        token = _token_from_url(created["upload_url"])
        response = await phone.post(
            "/phone-api/v1/upload",
            files=_files(_image_bytes("JPEG"), name="Committed before hook crash"),
            headers={
                "Origin": "http://testserver",
                "X-Muse-Upload-Token": token,
            },
        )
        assert response.status_code == 503
        failed = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert failed.json()["status"] == "failed"
        assert failed.json()["error_code"] == "phone_upload_completion_interrupted"
        assert (await main.get("/api/v1/clothing-items")).json()["total"] == 1

    monkeypatch.setattr(PhoneUploadSessionService, "complete", original_complete)
    restarted = _main_app(settings)
    async with _client_for(restarted) as main:
        recovered = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert recovered.json()["status"] == "completed"
        assert recovered.json()["clothing_item_id"] is not None
        assert recovered.json()["error_code"] is None
        assert (await main.get("/api/v1/clothing-items")).json()["total"] == 1


async def test_listener_wraps_all_image_rejections_with_safe_retry_state(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        max_upload_size_bytes=64 * 1024,
        max_image_pixels=1_000_000,
    )
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)
    pixel_image = Image.new("RGB", (1001, 1000), (210, 190, 170))
    pixel_output = io.BytesIO()
    pixel_image.save(pixel_output, format="PNG")
    pixel_image.close()
    cases = (
        (b"", "empty.jpg", "image/jpeg", "empty_image"),
        (_image_bytes("PNG"), "spoof.jpg", "image/jpeg", "image_mime_mismatch"),
        (b"\xff\xd8\xffbroken", "broken.jpg", "image/jpeg", "corrupt_image"),
        (
            pixel_output.getvalue(),
            "pixels.png",
            "image/png",
            "image_pixel_limit_exceeded",
        ),
        (b"x" * (64 * 1024 + 1), "large.jpg", "image/jpeg", "upload_too_large"),
    )

    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        for payload, filename, mime_type, expected_code in cases:
            created = (await main.post("/api/v1/phone-upload-sessions")).json()
            token = _token_from_url(created["upload_url"])
            response = await phone.post(
                "/phone-api/v1/upload",
                files=_files(payload, filename=filename, mime_type=mime_type),
                headers={
                    "Origin": "http://testserver",
                    "X-Muse-Upload-Token": token,
                },
            )
            assert response.status_code in {413, 422}
            assert response.json()["error"]["code"] == expected_code
            assert response.json()["error"]["details"]["retryable"] is True
            device_status = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
            assert device_status.json()["status"] == "failed"
            assert device_status.json()["error_code"] == expected_code
        assert (await main.get("/api/v1/clothing-items")).json()["total"] == 0
        assert list(settings.temp_upload_root.iterdir()) == []


async def test_preclaim_concurrency_rejection_is_retryable_without_consuming_session(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    _create_phone_build(settings)
    upgrade_database(settings)
    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)

    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        created = (await main.post("/api/v1/phone-upload-sessions")).json()
        token = _token_from_url(created["upload_url"])
        headers = {
            "Origin": "http://testserver",
            "X-Muse-Upload-Token": token,
        }
        admission = phone_app.state.import_admission
        await admission.local_lock.acquire()
        try:
            rejected = await phone.post(
                "/phone-api/v1/upload",
                files=_files(_image_bytes("JPEG"), name="Retry after busy"),
                headers=headers,
            )
        finally:
            admission.local_lock.release()

        assert rejected.status_code == 409
        assert rejected.json()["error"]["code"] == "upload_concurrency_exceeded"
        assert rejected.json()["error"]["details"]["retryable"] is True
        untouched = await main.get(f"/api/v1/phone-upload-sessions/{created['id']}")
        assert untouched.json()["status"] == "pending"
        assert untouched.json()["attempt_count"] == 0
        assert untouched.json()["started_at"] is None
        assert list(settings.temp_upload_root.iterdir()) == []

        retried = await phone.post(
            "/phone-api/v1/upload",
            files=_files(_image_bytes("JPEG"), name="Retry after busy"),
            headers=headers,
        )
        assert retried.status_code == 201


async def test_restricted_listener_surface_headers_origin_assets_and_rate_limit(
    tmp_path: Path,
) -> None:
    settings = _settings(
        tmp_path,
        max_api_body_size_bytes=1024,
        phone_upload_rate_limit_requests=5,
    )
    _create_phone_build(settings)
    upgrade_database(settings)
    application = create_phone_upload_app(settings)
    rate_limited_session = application.state.phone_upload_sessions.create()

    async with _client_for(application) as client:
        readiness = await client.get("/listener-status")
        assert readiness.json() == {"status": "ok"}
        assert readiness.headers["content-security-policy"].startswith("default-src 'self'")
        assert readiness.headers["permissions-policy"].startswith("camera=(self)")
        assert readiness.headers["referrer-policy"] == "no-referrer"
        assert readiness.headers["x-content-type-options"] == "nosniff"
        assert readiness.headers["x-frame-options"] == "DENY"
        assert readiness.headers["x-request-id"]
        assert "access-control-allow-origin" not in readiness.headers

        page = await client.get("/u/")
        asset = await client.get("/phone-assets/assets/app.js")
        hidden = await client.get("/phone-assets/assets/unlisted.js")
        assert page.status_code == 200
        assert page.headers["cache-control"] == "no-store"
        assert asset.status_code == 200
        assert "immutable" in asset.headers["cache-control"]
        assert hidden.status_code == 404

        for private_path in (
            "/api/v1/clothing-items",
            "/api/v1/outfits",
            "/api/v1/settings",
            "/api/v1/settings/backups",
            "/api/docs",
            "/api/openapi.json",
            "/openapi.json",
            "/docs",
        ):
            response = await client.get(private_path)
            assert response.status_code == 404, private_path

        missing = await client.get("/phone-api/v1/session")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "phone_upload_session_invalid"

        origin_rejected = await client.post(
            "/phone-api/v1/upload",
            headers={"X-Muse-Upload-Token": "a" * 43},
        )
        assert origin_rejected.status_code == 403
        assert origin_rejected.json()["error"]["code"] == "phone_upload_origin_rejected"

        oversized_control = await client.post(
            "/not-a-phone-route",
            content=b"x" * 1025,
        )
        assert oversized_control.status_code == 413
        assert oversized_control.json()["error"]["code"] == "request_body_too_large"

        unsupported_options = await client.options(
            "/phone-api/v1/session",
            headers={
                "Origin": "http://outside.invalid",
                "Access-Control-Request-Method": "GET",
            },
        )
        unsupported_put = await client.put(
            "/phone-api/v1/upload",
            headers={"Origin": "http://testserver"},
        )
        assert unsupported_options.status_code == 405
        assert unsupported_put.status_code == 405
        assert "access-control-allow-origin" not in unsupported_options.headers

        for _ in range(3):
            await client.get(
                "/phone-api/v1/session",
                headers={"X-Muse-Upload-Token": "a" * 43},
            )
        limited = await client.get(
            "/phone-api/v1/session",
            headers={"X-Muse-Upload-Token": rate_limited_session.raw_token},
        )
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "rate_limit_exceeded"
        assert limited.json()["error"]["details"]["retryable"] is True
        assert limited.headers["retry-after"]
        with application.state.database.session() as session:
            untouched = session.get(PhoneUploadSession, rate_limited_session.session.id)
            assert untouched is not None
            assert untouched.status == PhoneUploadSessionStatus.PENDING.value
            assert untouched.attempt_count == 0
            assert untouched.started_at is None

    bad_host_transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=bad_host_transport,
        base_url="http://not-trusted.local",
    ) as bad_host:
        response = await bad_host.get("/listener-status")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_host"
        assert response.headers["content-security-policy"]
        assert response.headers["x-request-id"]


def test_phone_session_service_token_race_reconciliation_and_cleanup(tmp_path: Path) -> None:
    settings = _settings(tmp_path, phone_upload_retention_seconds=300)
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    database = Database(settings.database_path)
    service = PhoneUploadSessionService(database=database, settings=settings)
    now = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)

    try:
        created = service.create(now=now)
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(
                pool.map(
                    lambda _: _claim_outcome(service, created.raw_token, now),
                    range(2),
                )
            )
        assert outcomes.count("claimed") == 1
        assert outcomes.count("phone_upload_session_busy") == 1

        with database.session() as session, session.begin():
            item = ClothingItem(
                name="Recovered phone item",
                garment_category="top",
                import_idempotency_key=phone_upload_idempotency_key(created.session.id),
            )
            session.add(item)
            session.flush()
            item_id = item.id
        assert service.reconcile(now=now + timedelta(seconds=1)) == 1
        completed = service.get_device(created.session.id, now=now + timedelta(seconds=1))
        assert completed.status is PhoneUploadSessionStatus.COMPLETED
        assert completed.clothing_item_id == item_id

        interrupted = service.create(now=now)
        service.claim_upload(interrupted.raw_token, now=now)
        service.reconcile(now=now + timedelta(seconds=2))
        failed = service.get_device(interrupted.session.id, now=now + timedelta(seconds=2))
        assert failed.status is PhoneUploadSessionStatus.FAILED
        assert failed.error_code == "phone_upload_interrupted"
        assert failed.started_at == now
        service.claim_upload(interrupted.raw_token, now=now + timedelta(seconds=3))
        retried = service.get_device(interrupted.session.id, now=now + timedelta(seconds=3))
        assert retried.started_at == now

        regenerated = service.create(now=now)
        replacement = service.regenerate(regenerated.session.id, now=now + timedelta(seconds=1))
        old = service.open_with_token(regenerated.raw_token, now=now + timedelta(seconds=2))
        assert old.status is PhoneUploadSessionStatus.CANCELLED
        assert replacement.session.id != regenerated.session.id
        assert replacement.raw_token != regenerated.raw_token

        expiring = service.create(now=now)
        expired = service.get_device(
            expiring.session.id,
            now=now + timedelta(seconds=settings.phone_upload_session_ttl_seconds + 1),
        )
        assert expired.status is PhoneUploadSessionStatus.EXPIRED
        with pytest.raises(MuseError, match="expired") as expired_claim:
            service.claim_upload(
                expiring.raw_token,
                now=now + timedelta(seconds=settings.phone_upload_session_ttl_seconds + 1),
            )
        assert expired_claim.value.status_code == 410

        late_failure = service.create(now=now)
        late_failure_id = service.claim_upload(late_failure.raw_token, now=now)
        late_status = service.fail(
            late_failure_id,
            "phone_upload_interrupted",
            now=now + timedelta(seconds=settings.phone_upload_session_ttl_seconds + 1),
        )
        assert late_status is not None
        assert late_status.status is PhoneUploadSessionStatus.EXPIRED
        assert late_status.can_retry is False

        cancelled = service.create(now=now)
        service.cancel(cancelled.session.id, now=now)
        removed = service.cleanup(now=now + timedelta(seconds=301))
        assert removed >= 1
        with database.session() as session:
            assert session.get(ClothingItem, item_id) is not None
            assert session.get(PhoneUploadSession, created.session.id) is None
            assert session.get(PhoneUploadSession, cancelled.session.id) is None
            assert session.scalar(select(func.count(ClothingItem.id))) == 1
    finally:
        database.dispose()


def _claim_outcome(
    service: PhoneUploadSessionService,
    raw_token: str,
    now: datetime,
) -> str:
    try:
        service.claim_upload(raw_token, now=now)
        return "claimed"
    except ResourceConflictError as error:
        return error.code


async def test_application_startup_reconciles_expired_and_committed_sessions(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path, phone_upload_cleanup_batch_size=1)
    _create_phone_build(settings)
    upgrade_database(settings)
    database = Database(settings.database_path)
    service = PhoneUploadSessionService(database=database, settings=settings)
    now = datetime.now(UTC)
    expired = service.create(
        now=now - timedelta(seconds=settings.phone_upload_session_ttl_seconds + 5)
    )
    committed = service.create(now=now)
    service.claim_upload(committed.raw_token, now=now)
    with database.session() as session, session.begin():
        item = ClothingItem(
            name="Committed before restart",
            garment_category="top",
            import_idempotency_key=phone_upload_idempotency_key(committed.session.id),
        )
        session.add(item)
        session.flush()
        committed_item_id = item.id
    database.dispose()

    main_app = _main_app(settings)
    phone_app = create_phone_upload_app(settings)
    async with _client_for(main_app) as main, _client_for(phone_app) as phone:
        expired_device = await main.get(f"/api/v1/phone-upload-sessions/{expired.session.id}")
        committed_device = await main.get(f"/api/v1/phone-upload-sessions/{committed.session.id}")
        assert expired_device.json()["status"] == "expired"
        assert committed_device.json()["status"] == "completed"
        assert committed_device.json()["clothing_item_id"] == committed_item_id

        expired_phone = await phone.get(
            "/phone-api/v1/session",
            headers={"X-Muse-Upload-Token": expired.raw_token},
        )
        committed_phone = await phone.get(
            "/phone-api/v1/session",
            headers={"X-Muse-Upload-Token": committed.raw_token},
        )
        assert expired_phone.json()["status"] == "expired"
        assert committed_phone.json()["status"] == "completed"


def test_phone_upload_migration_constraints_and_round_trip(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    upgrade_database(settings)
    database = Database(settings.database_path)
    try:
        assert migration_status(settings, database).current_revisions == ("20260715_0003",)
        check_migration_consistency(settings)
        inspector = inspect(database.engine)
        columns = {column["name"] for column in inspector.get_columns("phone_upload_sessions")}
        assert {
            "id",
            "token_hash",
            "status",
            "expires_at",
            "clothing_item_id",
            "attempt_count",
        } <= columns
        assert {
            "ix_phone_upload_sessions_expiry",
            "ix_phone_upload_sessions_retention",
            "uq_phone_upload_sessions_clothing_item_id",
        } <= {index["name"] for index in inspector.get_indexes("phone_upload_sessions")}
        with closing(sqlite3.connect(settings.database_path)) as connection:
            assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        database.dispose()

    downgrade_database(settings, "20260715_0002")
    database = Database(settings.database_path)
    try:
        assert "phone_upload_sessions" not in inspect(database.engine).get_table_names()
    finally:
        database.dispose()
    upgrade_database(settings)
    assert migration_status(settings).is_current


def test_lan_resolution_fragment_fallback_and_interprocess_lock(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(
        tmp_path,
        phone_upload_bind_host="192.168.1.44",
        phone_upload_advertised_host="muse.local",
        phone_upload_advertised_ipv4="192.168.1.44",
        phone_upload_trusted_hosts=["192.168.1.44", "muse.local", "testserver"],
    )
    monkeypatch.setattr(lan_address_module, "discover_lan_ipv4", lambda: "192.168.1.99")
    endpoint = resolve_lan_endpoint(settings)
    primary, fallback = endpoint.session_urls("a" * 43)
    assert primary == f"http://muse.local:8787/u/#token={'a' * 43}"
    assert fallback == f"http://192.168.1.44:8787/u/#token={'a' * 43}"
    assert "?" not in primary

    with pytest.raises(ValueError, match=r"loopback.*cannot advertise"):
        _settings(
            tmp_path / "invalid-loopback",
            phone_upload_advertised_host="muse.local",
            phone_upload_trusted_hosts=["127.0.0.1", "muse.local", "testserver"],
        )
    with pytest.raises(ValueError, match="must match the exact listener bind"):
        _settings(
            tmp_path / "invalid-mismatch",
            phone_upload_bind_host="192.168.1.44",
            phone_upload_advertised_ipv4="192.168.1.45",
            phone_upload_trusted_hosts=[
                "192.168.1.44",
                "192.168.1.45",
                "testserver",
            ],
        )

    storage = LocalStorageService(settings)
    storage.create_required_directories()
    first = InterprocessImportLock(settings)
    second = InterprocessImportLock(settings)
    with first.acquire(blocking=False):
        with (
            pytest.raises(ResourceConflictError) as busy,
            second.acquire(blocking=False),
        ):
            raise AssertionError("the second lock must not be admitted")
        assert busy.value.code == "clothing_import_busy"
    assert settings.import_lock_path.is_file()
    assert settings.import_lock_path.stat().st_mode & 0o777 == 0o600


async def test_production_main_application_rejects_non_loopback_client(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        environment=Environment.PRODUCTION,
        phone_upload_enabled=False,
    )
    upgrade_database(settings)
    application = _main_app(settings)
    async with LifespanManager(application):
        remote_transport = httpx.ASGITransport(
            app=application,
            raise_app_exceptions=False,
            client=("192.168.1.55", 43120),
        )
        async with httpx.AsyncClient(
            transport=remote_transport,
            base_url="http://testserver",
        ) as remote:
            denied = await remote.get("/api/v1/system/readiness")
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "loopback_access_required"
        assert denied.headers["x-request-id"]
