from collections.abc import Callable
from typing import Any, cast
from urllib.parse import unquote
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from muse_backend.database.models import ClothingImage, Outfit
from muse_backend.domain.enums import ImageKind
from muse_backend.domain.exceptions import StorageOperationError
from muse_backend.schemas.outfit import OutfitUpdate
from muse_backend.services.outfit_previews import (
    OutfitPreviewCoordinator,
    reconcile_outfit_previews,
)
from muse_backend.services.outfits import OutfitService
from tests.support import create_clothing_item, outfit_item, running_client

pytestmark = pytest.mark.integration


def _relative_preview_path(preview_url: str) -> str:
    return unquote(preview_url.removeprefix("/api/v1/media/"))


def _add_image_group(
    app: FastAPI,
    clothing_item_id: int,
    *,
    missing_kind: ImageKind | None = None,
) -> None:
    group_id = uuid4().hex
    colors = {
        ImageKind.ORIGINAL: (150, 80, 60, 255),
        ImageKind.NORMALIZED: (60, 120, 180, 255),
        ImageKind.THUMBNAIL: (90, 150, 80, 255),
        ImageKind.CUTOUT: (210, 150, 40, 210),
    }
    with app.state.database.session() as session, session.begin():
        for kind in (
            ImageKind.ORIGINAL,
            ImageKind.NORMALIZED,
            ImageKind.THUMBNAIL,
            ImageKind.CUTOUT,
        ):
            filename = app.state.storage.generate_internal_filename(".webp")
            relative_path = app.state.storage.media_relative_path(
                app.state.storage.image_root(kind) / filename
            )
            destination = app.state.storage.resolve_media_path(relative_path)
            if kind is not missing_kind:
                image = Image.new("RGBA", (80, 120), colors[kind])
                image.save(destination, format="WEBP", lossless=True, method=0)
                byte_size = destination.stat().st_size
            else:
                byte_size = 1
            session.add(
                ClothingImage(
                    clothing_item_id=clothing_item_id,
                    image_kind=kind.value,
                    relative_path=relative_path,
                    mime_type="image/webp",
                    width=80,
                    height=120,
                    byte_size=byte_size,
                    is_primary=kind is ImageKind.CUTOUT,
                    image_group_id=group_id,
                    display_order=0,
                )
            )


async def _create_outfit(
    client: httpx.AsyncClient,
    clothing_item_id: int,
    *,
    name: str = "Preview Look",
    position_x: float = 0.5,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/outfits",
        json={
            "name": name,
            "items": [
                outfit_item(
                    clothing_item_id,
                    body_zone="upper_body",
                    position_x=position_x,
                    position_y=0.42,
                    scale=1.1,
                    rotation=5,
                    layer_index=3,
                )
            ],
        },
    )
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def _write_payload(item: dict[str, Any], **changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "clothing_item_id": item["clothing_item_id"],
        "body_zone": item["body_zone"],
        "position_x": item["position_x"],
        "position_y": item["position_y"],
        "scale": item["scale"],
        "rotation": item["rotation"],
        "layer_index": item["layer_index"],
    }
    payload.update(changes)
    return payload


async def test_create_generates_serves_and_hydrates_preview_contract(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(
        client,
        name="Layered Shirt",
        default_body_zone="upper_body",
    )
    _add_image_group(app, garment["id"])

    outfit = await _create_outfit(client, garment["id"])

    assert outfit["preview_width"] == 600
    assert outfit["preview_height"] == 750
    assert outfit["preview_url"].startswith("/api/v1/media/outfits/previews/")
    reference = outfit["items"][0]["clothing_item"]
    assert reference["default_body_zone"] == "upper_body"
    assert [image["image_kind"] for image in reference["image_candidates"]] == [
        "cutout",
        "normalized",
        "original",
    ]
    assert reference["primary_image"]["image_kind"] == "cutout"
    assert reference["display_image"]["image_kind"] == "cutout"
    assert reference["thumbnail_image"]["image_kind"] == "thumbnail"

    preview = await client.get(outfit["preview_url"])
    assert preview.status_code == 200
    assert preview.headers["cache-control"] == "public, max-age=31536000, immutable"
    listing = await client.get("/api/v1/outfits")
    assert listing.status_code == 200
    summary = listing.json()["items"][0]
    assert summary["preview_url"] == outfit["preview_url"]
    assert summary["preview_width"] == 600
    assert summary["preview_height"] == 750
    preview_path = app.state.storage.resolve_media_path(
        _relative_preview_path(outfit["preview_url"])
    )
    with Image.open(preview_path) as image:
        assert image.format == "WEBP"
        assert image.size == (600, 750)


async def test_name_only_and_unchanged_updates_reuse_preview_but_transform_replaces_it(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"])
    original_url = outfit["preview_url"]
    original_path = app.state.storage.resolve_media_path(_relative_preview_path(original_url))

    renamed = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"name": "Renamed"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["preview_url"] == original_url

    unchanged = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"items": [_write_payload(outfit["items"][0])]},
    )
    assert unchanged.status_code == 200
    assert unchanged.json()["preview_url"] == original_url

    changed = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"items": [_write_payload(outfit["items"][0], position_x=0.7)]},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["preview_url"] != original_url
    assert not original_path.exists()
    assert app.state.storage.resolve_media_path(
        _relative_preview_path(changed.json()["preview_url"])
    ).is_file()


async def test_stale_unchanged_placement_update_cannot_overwrite_concurrent_preview(
    app: FastAPI,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"])
    original_update = OutfitService.update
    injected = False
    concurrent_preview_url: str | None = None

    def inject_concurrent_update(
        service: OutfitService,
        outfit_id: int,
        payload: OutfitUpdate,
        **kwargs: object,
    ) -> Any:
        nonlocal concurrent_preview_url, injected
        if not injected:
            injected = True
            concurrent_payload = OutfitUpdate.model_validate(
                {
                    "items": [
                        _write_payload(
                            outfit["items"][0],
                            position_x=0.8,
                        )
                    ]
                }
            )
            concurrent = OutfitPreviewCoordinator(
                settings=app.state.settings,
                storage=app.state.storage,
                database=app.state.database,
            ).update(outfit_id, concurrent_payload)
            concurrent_preview_url = concurrent.preview_url
        return cast(Callable[..., Any], original_update)(service, outfit_id, payload, **kwargs)

    monkeypatch.setattr(OutfitService, "update", inject_concurrent_update)
    response = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"items": [_write_payload(outfit["items"][0])]},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "outfit_update_conflict"
    persisted = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["items"][0]["position_x"] == 0.8
    assert persisted.json()["preview_url"] == concurrent_preview_url
    assert persisted.json()["preview_url"] != outfit["preview_url"]


@pytest.mark.parametrize("failure", ["render", "promote", "database"])
async def test_failed_preview_update_preserves_previous_row_and_preview(
    app: FastAPI,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"], name="Stable")
    old_url = outfit["preview_url"]
    files_before = set(app.state.settings.outfit_preview_root.iterdir())

    if failure == "render":

        def fail_render(*args: object, **kwargs: object) -> None:
            del args, kwargs
            raise OSError("injected render failure")

        monkeypatch.setattr(
            "muse_backend.services.outfit_previews.render_outfit_preview",
            fail_render,
        )
    elif failure == "promote":

        def fail_promote(*args: object, **kwargs: object) -> None:
            del args, kwargs
            raise StorageOperationError()

        monkeypatch.setattr(app.state.storage, "atomic_promote_preview", fail_promote)
    else:

        def fail_database(*args: object, **kwargs: object) -> None:
            del args, kwargs
            raise OperationalError("UPDATE", {}, RuntimeError("injected database failure"))

        monkeypatch.setattr(OutfitService, "update", fail_database)

    response = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={
            "name": "Must not persist",
            "items": [_write_payload(outfit["items"][0], position_x=0.75)],
        },
    )

    assert response.status_code == 503
    persisted = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["name"] == "Stable"
    assert persisted.json()["items"][0]["position_x"] == 0.5
    assert persisted.json()["preview_url"] == old_url
    assert set(app.state.settings.outfit_preview_root.iterdir()) == files_before
    assert list(app.state.settings.temp_preview_root.iterdir()) == []


async def test_failed_outfit_create_after_promotion_removes_unregistered_preview(
    app: FastAPI,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    garment = await create_clothing_item(client)

    def fail_database(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise OperationalError("INSERT", {}, RuntimeError("injected database failure"))

    monkeypatch.setattr(OutfitService, "create", fail_database)
    response = await client.post(
        "/api/v1/outfits",
        json={"name": "Must not persist", "items": [outfit_item(garment["id"])]},
    )

    assert response.status_code == 503
    with app.state.database.session() as session:
        assert session.scalar(select(func.count(Outfit.id))) == 0
    assert list(app.state.settings.outfit_preview_root.iterdir()) == []
    assert list(app.state.settings.temp_preview_root.iterdir()) == []


async def test_missing_preferred_media_uses_fallback_and_deleted_reference_remains_hydrated(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client, name="Fallback Garment")
    _add_image_group(app, garment["id"], missing_kind=ImageKind.CUTOUT)

    outfit = await _create_outfit(client, garment["id"])
    assert (await client.get(outfit["preview_url"])).status_code == 200

    assert (await client.delete(f"/api/v1/clothing-items/{garment['id']}")).status_code == 204
    detail = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert detail.status_code == 200
    item = detail.json()["items"][0]
    assert item["clothing_item_status"] == "deleted"
    assert item["clothing_item"]["deleted_at"] is not None
    assert [candidate["image_kind"] for candidate in item["clothing_item"]["image_candidates"]] == [
        "cutout",
        "normalized",
        "original",
    ]


async def test_soft_deleted_outfit_keeps_preview_and_reconciliation_treats_it_as_owned(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"])
    relative_path = _relative_preview_path(outfit["preview_url"])
    preview_path = app.state.storage.resolve_media_path(relative_path)

    assert (await client.delete(f"/api/v1/outfits/{outfit['id']}")).status_code == 204
    reconcile_outfit_previews(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )

    assert preview_path.is_file()
    with app.state.database.session() as session:
        persisted = session.get(Outfit, outfit["id"])
        assert persisted is not None
        assert persisted.deleted_at is not None
        assert persisted.preview_image_path == relative_path


async def test_obsolete_cleanup_failure_is_recovered_from_manifest(
    app: FastAPI,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"])
    old_relative_path = _relative_preview_path(outfit["preview_url"])
    old_path = app.state.storage.resolve_media_path(old_relative_path)
    original_delete: Callable[[str], None] = app.state.storage.delete_owned_media

    def fail_old_cleanup(relative_path: str) -> None:
        if relative_path == old_relative_path:
            raise StorageOperationError()
        original_delete(relative_path)

    monkeypatch.setattr(app.state.storage, "delete_owned_media", fail_old_cleanup)
    updated = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"items": [_write_payload(outfit["items"][0], position_y=0.65)]},
    )
    assert updated.status_code == 200
    new_path = app.state.storage.resolve_media_path(
        _relative_preview_path(updated.json()["preview_url"])
    )
    assert old_path.is_file()
    assert new_path.is_file()
    assert len(list(app.state.settings.temp_preview_root.iterdir())) == 1

    monkeypatch.setattr(app.state.storage, "delete_owned_media", original_delete)
    reconcile_outfit_previews(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )
    assert not old_path.exists()
    assert new_path.is_file()
    assert list(app.state.settings.temp_preview_root.iterdir()) == []


async def test_startup_reconciliation_removes_orphans_and_preserves_committed_preview(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await _create_outfit(client, garment["id"])
    committed_path = app.state.storage.resolve_media_path(
        _relative_preview_path(outfit["preview_url"])
    )

    orphan_name = app.state.storage.generate_internal_filename(".webp")
    orphan_path = app.state.settings.outfit_preview_root / orphan_name
    orphan_path.write_bytes(b"orphan")
    orphan_relative = app.state.storage.media_relative_path(orphan_path)
    attempt_id = uuid4().hex
    app.state.storage.create_preview_attempt(attempt_id)
    app.state.storage.write_preview_manifest(
        attempt_id,
        {
            "version": 1,
            "operation": "outfit_preview",
            "attempt_id": attempt_id,
            "phase": "promoted",
            "final_paths": [orphan_relative],
            "obsolete_paths": [],
        },
    )

    unmanifested_name = app.state.storage.generate_internal_filename(".webp")
    unmanifested = app.state.settings.outfit_preview_root / unmanifested_name
    unmanifested.write_bytes(b"unmanifested")
    malformed_id = uuid4().hex
    malformed = app.state.storage.create_preview_attempt(malformed_id)
    (malformed / "manifest.json").write_text("not json", encoding="utf-8")

    reconcile_outfit_previews(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )

    assert committed_path.is_file()
    assert not orphan_path.exists()
    assert not unmanifested.exists()
    assert list(app.state.settings.temp_preview_root.iterdir()) == []


async def test_startup_reconciliation_retains_manifest_until_failed_cleanup_can_retry(
    app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    orphan_name = app.state.storage.generate_internal_filename(".webp")
    orphan_path = app.state.settings.outfit_preview_root / orphan_name
    orphan_path.write_bytes(b"orphan")
    orphan_relative = app.state.storage.media_relative_path(orphan_path)
    attempt_id = uuid4().hex
    attempt = app.state.storage.create_preview_attempt(attempt_id)
    app.state.storage.write_preview_manifest(
        attempt_id,
        {
            "version": 1,
            "operation": "outfit_preview",
            "attempt_id": attempt_id,
            "phase": "promoted",
            "final_paths": [orphan_relative],
            "obsolete_paths": [],
        },
    )
    original_delete: Callable[[str], None] = app.state.storage.delete_owned_media

    def fail_cleanup(relative_path: str) -> None:
        if relative_path == orphan_relative:
            raise StorageOperationError()
        original_delete(relative_path)

    monkeypatch.setattr(app.state.storage, "delete_owned_media", fail_cleanup)
    reconcile_outfit_previews(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )

    assert orphan_path.is_file()
    assert attempt.is_dir()

    monkeypatch.setattr(app.state.storage, "delete_owned_media", original_delete)
    reconcile_outfit_previews(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )
    assert not orphan_path.exists()
    assert not attempt.exists()


async def test_outfit_and_preview_persist_across_service_restart(
    migrated_settings: Any,
) -> None:
    outfit_id: int
    preview_url: str
    async with running_client(migrated_settings) as first_client:
        garment = await create_clothing_item(first_client, name="Restart Garment")
        outfit = await _create_outfit(first_client, garment["id"], name="Restart Look")
        outfit_id = outfit["id"]
        preview_url = outfit["preview_url"]

    async with running_client(migrated_settings) as restarted_client:
        listing = await restarted_client.get("/api/v1/outfits")
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["items"][0]["id"] == outfit_id
        detail = await restarted_client.get(f"/api/v1/outfits/{outfit_id}")
        assert detail.status_code == 200
        assert detail.json()["name"] == "Restart Look"
        assert detail.json()["preview_url"] == preview_url
        assert (await restarted_client.get(preview_url)).status_code == 200


async def test_twenty_placements_render_one_bounded_preview(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garments = [await create_clothing_item(client, name=f"Garment {index}") for index in range(20)]
    response = await client.post(
        "/api/v1/outfits",
        json={
            "name": "Twenty Layers",
            "items": [
                outfit_item(
                    garment["id"],
                    layer_index=index,
                    position_x=0.25 + (index % 5) * 0.12,
                    position_y=0.2 + (index % 4) * 0.16,
                    scale=0.5 + (index % 3) * 0.2,
                    rotation=float((index % 7) * 5),
                )
                for index, garment in enumerate(garments)
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["item_count"] == 20
    assert len(list(app.state.settings.outfit_preview_root.iterdir())) == 1
    with app.state.database.session() as session:
        assert session.scalar(select(func.count(Outfit.id))) == 1
