from pathlib import Path

import pytest

from muse_backend.config import Environment, Settings
from muse_backend.database.migrations import upgrade_database
from muse_backend.frontend import frontend_build_available
from muse_backend.storage.local import LocalStorageService
from tests.support import running_client

pytestmark = pytest.mark.integration


def production_settings(tmp_path: Path, build_path: Path) -> Settings:
    settings = Settings(
        environment=Environment.PRODUCTION,
        data_root=tmp_path / "device-data",
        frontend_build_path=build_path,
        serve_frontend=True,
        allowed_origins=[],
        trusted_hosts=["testserver"],
    )
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    return settings


async def test_production_serves_spa_files_with_safe_cache_policy_and_api_precedence(
    tmp_path: Path,
) -> None:
    build = tmp_path / "dist"
    assets = build / "assets"
    assets.mkdir(parents=True)
    index = b"<!doctype html><title>Muse kiosk</title><div id='root'></div>"
    (build / "index.html").write_bytes(index)
    (build / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    (assets / "app-abc123.js").write_text("window.Muse = true;", encoding="utf-8")
    settings = production_settings(tmp_path, build)

    async with running_client(settings) as client:
        root = await client.get("/")
        wardrobe = await client.get("/wardrobe")
        nested = await client.get("/saved-outfits/preview")
        head = await client.head("/settings")
        icon = await client.get("/favicon.svg")
        asset = await client.get("/assets/app-abc123.js")
        missing_file = await client.get("/not-present.png")
        health = await client.get("/api/v1/health")
        unknown_api = await client.get("/api/v1/not-a-route")
        api_root = await client.get("/api/docs")

    for response in (root, wardrobe, nested):
        assert response.status_code == 200
        assert response.content == index
        assert response.headers["content-type"].startswith("text/html")
        assert response.headers["cache-control"] == "no-cache"
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["cache-control"] == "no-cache"
    assert icon.status_code == 200
    assert icon.headers["cache-control"] == "no-cache"
    assert asset.status_code == 200
    assert asset.text == "window.Muse = true;"
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert missing_file.status_code == 404
    assert missing_file.json()["error"]["code"] == "resource_not_found"
    assert health.status_code == 200
    assert health.json()["service"] == "muse-backend"
    assert unknown_api.status_code == 404
    assert unknown_api.json()["error"]["code"] == "resource_not_found"
    assert api_root.status_code == 404
    assert api_root.json()["error"]["code"] == "resource_not_found"


async def test_missing_production_build_keeps_health_live_and_readiness_false(
    tmp_path: Path,
) -> None:
    build = tmp_path / "missing-dist"
    settings = production_settings(tmp_path, build)

    async with running_client(settings) as client:
        health = await client.get("/api/v1/health")
        readiness = await client.get("/api/v1/readiness")
        root = await client.get("/")
        unknown_api = await client.get("/api/v1/unknown")

        build.mkdir()
        (build / "index.html").write_text("Muse restored", encoding="utf-8")
        restored_readiness = await client.get("/api/v1/readiness")
        restored_root = await client.get("/")

        (build / "index.html").unlink()
        removed_readiness = await client.get("/api/v1/readiness")
        removed_root = await client.get("/")

    assert health.status_code == 200
    assert readiness.status_code == 503
    assert readiness.json()["checks"]["frontend"] == {
        "status": "error",
        "message": "The production interface build is unavailable.",
    }
    assert root.status_code == 503
    assert root.json()["error"]["code"] == "frontend_build_unavailable"
    assert unknown_api.status_code == 404
    assert unknown_api.json()["error"]["code"] == "resource_not_found"
    assert restored_readiness.status_code == 200
    assert restored_root.status_code == 200
    assert restored_root.text == "Muse restored"
    assert removed_readiness.status_code == 503
    assert removed_root.status_code == 503


async def test_production_readiness_includes_available_frontend_check(tmp_path: Path) -> None:
    build = tmp_path / "dist"
    build.mkdir()
    (build / "index.html").write_text("Muse", encoding="utf-8")
    settings = production_settings(tmp_path, build)

    async with running_client(settings) as client:
        readiness = await client.get("/api/v1/readiness")

    assert readiness.status_code == 200
    assert readiness.json()["checks"]["frontend"] == {"status": "ok"}


@pytest.mark.unit
def test_frontend_build_availability_rejects_missing_directory_and_index_symlink(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "missing"
    assert not frontend_build_available(missing)

    build = tmp_path / "dist"
    build.mkdir()
    outside = tmp_path / "outside-index.html"
    outside.write_text("outside", encoding="utf-8")
    (build / "index.html").symlink_to(outside)
    assert not frontend_build_available(build)

    (build / "index.html").unlink()
    (build / "index.html").write_text("inside", encoding="utf-8")
    assert frontend_build_available(build)


@pytest.mark.unit
def test_frontend_build_availability_treats_filesystem_errors_as_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build = tmp_path / "dist"
    build.mkdir()
    index = build / "index.html"
    index.write_text("Muse", encoding="utf-8")
    original_resolve = Path.resolve

    def deny_index(path: Path, strict: bool = False) -> Path:
        if path == index:
            raise PermissionError("private build")
        return original_resolve(path, strict=strict)

    monkeypatch.setattr(Path, "resolve", deny_index)
    assert not frontend_build_available(build)


async def test_assets_symlink_is_not_mounted_as_static_root(tmp_path: Path) -> None:
    build = tmp_path / "dist"
    build.mkdir()
    (build / "index.html").write_text("Muse", encoding="utf-8")
    outside_assets = tmp_path / "outside-assets"
    outside_assets.mkdir()
    (outside_assets / "secret.js").write_text("secret", encoding="utf-8")
    (build / "assets").symlink_to(outside_assets, target_is_directory=True)
    settings = production_settings(tmp_path, build)

    async with running_client(settings) as client:
        response = await client.get("/assets/secret.js")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource_not_found"
