from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from muse_backend.domain.enums import ImageKind
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    ResourceNotFoundError,
)
from muse_backend.repositories.clothing import ClothingRepository
from muse_backend.schemas.clothing import ClothingImageRegistration
from muse_backend.services.images import ClothingImageService
from tests.support import create_clothing_item, outfit_item

pytestmark = pytest.mark.integration


def registration(
    *,
    clothing_item_id: int,
    relative_path: str,
    byte_size: int,
    is_primary: bool = False,
    image_kind: ImageKind = ImageKind.ORIGINAL,
) -> ClothingImageRegistration:
    return ClothingImageRegistration(
        clothing_item_id=clothing_item_id,
        image_kind=image_kind,
        relative_path=relative_path,
        mime_type="image/jpeg",
        width=640,
        height=800,
        byte_size=byte_size,
        is_primary=is_primary,
    )


def register_image(app: FastAPI, payload: ClothingImageRegistration) -> dict[str, Any]:
    with app.state.database.session() as session:
        result = ClothingImageService(session, app.state.storage).register(payload)
        return result.model_dump(mode="json")


async def test_internal_image_registration_links_primary_image_and_media_route(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    clothing = await create_clothing_item(client, name="Photographed Coat", category="outerwear")
    media = b"fake-local-jpeg-content"
    relative_path = "garments/original/coat-local.jpg"
    path = app.state.storage.resolve_media_path(relative_path)
    path.write_bytes(media)

    image = register_image(
        app,
        registration(
            clothing_item_id=clothing["id"],
            relative_path=relative_path,
            byte_size=len(media),
            is_primary=True,
        ),
    )

    assert image["id"] > 0
    assert image["image_kind"] == "original"
    assert image["is_primary"] is True
    assert image["content_url"] == "/api/v1/media/garments/original/coat-local.jpg"

    detail = await client.get(f"/api/v1/clothing-items/{clothing['id']}")
    assert detail.status_code == 200
    assert detail.json()["images"] == [image]

    listing = await client.get("/api/v1/clothing-items")
    assert listing.json()["items"][0]["primary_image"] == image

    content = await client.get(image["content_url"])
    assert content.status_code == 200
    assert content.content == media
    assert content.headers["content-type"] == "image/jpeg"
    assert content.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert content.headers["x-content-type-options"] == "nosniff"


async def test_image_detail_orders_primary_before_other_images(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    clothing = await create_clothing_item(client)
    non_primary_path = "garments/original/first.jpg"
    primary_path = "garments/processed/primary.jpg"
    app.state.storage.resolve_media_path(non_primary_path).write_bytes(b"first")
    app.state.storage.resolve_media_path(primary_path).write_bytes(b"primary")

    first = register_image(
        app,
        registration(
            clothing_item_id=clothing["id"],
            relative_path=non_primary_path,
            byte_size=5,
        ),
    )
    primary_payload = registration(
        clothing_item_id=clothing["id"],
        relative_path=primary_path,
        byte_size=7,
        is_primary=True,
        image_kind=ImageKind.NORMALIZED,
    )
    primary = register_image(app, primary_payload)

    detail = await client.get(f"/api/v1/clothing-items/{clothing['id']}")
    assert [image["id"] for image in detail.json()["images"]] == [
        primary["id"],
        first["id"],
    ]


async def test_soft_deleted_outfit_reference_retains_primary_image_contract(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    clothing = await create_clothing_item(client, name="Archived garment")
    relative_path = "garments/original/archived.jpg"
    app.state.storage.resolve_media_path(relative_path).write_bytes(b"archived")
    image = register_image(
        app,
        registration(
            clothing_item_id=clothing["id"],
            relative_path=relative_path,
            byte_size=8,
            is_primary=True,
        ),
    )
    created = await client.post(
        "/api/v1/outfits",
        json={"name": "Preserved", "items": [outfit_item(clothing["id"])]},
    )
    assert created.status_code == 201

    deleted = await client.delete(f"/api/v1/clothing-items/{clothing['id']}")
    assert deleted.status_code == 204
    fetched = await client.get(f"/api/v1/outfits/{created.json()['id']}")

    reference = fetched.json()["items"][0]["clothing_item"]
    assert reference["deleted_at"] is not None
    assert reference["primary_image"] == image


async def test_registration_rejects_second_primary_and_duplicate_paths(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    first_item = await create_clothing_item(client, name="First")
    second_item = await create_clothing_item(client, name="Second")
    for filename, contents in (("one.jpg", b"one"), ("two.jpg", b"two")):
        path = app.state.storage.resolve_media_path(f"garments/original/{filename}")
        path.write_bytes(contents)

    register_image(
        app,
        registration(
            clothing_item_id=first_item["id"],
            relative_path="garments/original/one.jpg",
            byte_size=3,
            is_primary=True,
        ),
    )

    with pytest.raises(ResourceConflictError) as primary_conflict:
        register_image(
            app,
            registration(
                clothing_item_id=first_item["id"],
                relative_path="garments/original/two.jpg",
                byte_size=3,
                is_primary=True,
            ),
        )
    assert primary_conflict.value.code == "primary_image_conflict"

    with pytest.raises(ResourceConflictError) as path_conflict:
        register_image(
            app,
            registration(
                clothing_item_id=second_item["id"],
                relative_path="  garments/original/one.jpg  ",
                byte_size=3,
            ),
        )
    assert path_conflict.value.code == "image_registration_conflict"


@pytest.mark.unit
def test_image_registration_canonicalizes_paths_and_matches_mime_to_extension() -> None:
    canonical = registration(
        clothing_item_id=1,
        relative_path="  garments/original/photo.JPG  ",
        byte_size=3,
    )
    assert canonical.relative_path == "garments/original/photo.JPG"

    with pytest.raises(ValidationError):
        registration(
            clothing_item_id=1,
            relative_path="garments/original/page.html",
            byte_size=3,
        )


async def test_registration_validates_file_location_size_and_active_clothing(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    clothing = await create_clothing_item(client)

    with pytest.raises(DomainValidationError) as missing:
        register_image(
            app,
            registration(
                clothing_item_id=clothing["id"],
                relative_path="garments/original/missing.jpg",
                byte_size=10,
            ),
        )
    assert missing.value.code == "media_file_not_found"

    existing = app.state.storage.resolve_media_path("garments/original/existing.jpg")
    existing.write_bytes(b"1234")
    with pytest.raises(DomainValidationError) as mismatched:
        register_image(
            app,
            registration(
                clothing_item_id=clothing["id"],
                relative_path="garments/original/existing.jpg",
                byte_size=99,
            ),
        )
    assert mismatched.value.code == "media_metadata_mismatch"

    with pytest.raises(DomainValidationError) as wrong_location:
        register_image(
            app,
            registration(
                clothing_item_id=clothing["id"],
                relative_path="garments/original/existing.jpg",
                byte_size=4,
                image_kind=ImageKind.THUMBNAIL,
            ),
        )
    assert wrong_location.value.code == "invalid_image_location"

    await client.delete(f"/api/v1/clothing-items/{clothing['id']}")
    with pytest.raises(ResourceNotFoundError) as deleted:
        register_image(
            app,
            registration(
                clothing_item_id=clothing["id"],
                relative_path="garments/original/existing.jpg",
                byte_size=4,
            ),
        )
    assert deleted.value.code == "clothing_item_not_found"

    with app.state.database.session() as session:
        repository = ClothingRepository(session)
        assert repository.get_active(clothing["id"]) is None
        assert repository.get_any(clothing["id"]) is not None


async def test_media_route_rejects_missing_traversal_and_symbolic_links(
    app: FastAPI,
    client: httpx.AsyncClient,
    tmp_path: Path,
) -> None:
    missing = await client.get("/api/v1/media/garments/original/nope.jpg")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "media_not_found"

    traversal = await client.get("/api/v1/media/%2E%2E/outside.jpg")
    assert traversal.status_code in {404, 422}
    assert traversal.json()["error"]["code"] in {"invalid_relative_path", "resource_not_found"}

    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"outside")
    link = app.state.storage.resolve_media_path("garments/original/link.jpg")
    link.symlink_to(outside)
    linked = await client.get("/api/v1/media/garments/original/link.jpg")
    assert linked.status_code == 422
    assert linked.json()["error"]["code"] == "invalid_relative_path"

    oversized = await client.get(f"/api/v1/media/garments/original/{'a' * 300}.jpg")
    assert oversized.status_code == 422
    assert oversized.json()["error"]["code"] == "invalid_relative_path"

    executable = app.state.storage.resolve_media_path("garments/original/page.html")
    executable.write_text("<script>alert('no')</script>", encoding="utf-8")
    rejected_type = await client.get("/api/v1/media/garments/original/page.html")
    assert rejected_type.status_code == 404
    assert rejected_type.json()["error"]["code"] == "media_not_found"

    unapproved = app.state.storage.resolve_media_path("other/rogue.jpg")
    unapproved.parent.mkdir()
    unapproved.write_bytes(b"rogue")
    rejected_location = await client.get("/api/v1/media/other/rogue.jpg")
    assert rejected_location.status_code == 404
    assert rejected_location.json()["error"]["code"] == "media_not_found"


async def test_image_registration_is_internal_not_a_public_upload_surface(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/api/v1/clothing-images", json={})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource_not_found"


@pytest.mark.unit
def test_image_registration_schema_rejects_invalid_metadata() -> None:
    with pytest.raises(ValidationError):
        ClothingImageRegistration(
            clothing_item_id=0,
            image_kind="original",
            relative_path="x.jpg",
            mime_type="image/gif",
            width=0,
            height=-1,
            byte_size=0,
        )
