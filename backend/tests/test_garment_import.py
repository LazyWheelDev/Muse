import asyncio
import hashlib
import io
import json
import sqlite3
import threading
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from fastapi import Request
from PIL import Image, ImageDraw
from python_multipart import MultipartParser
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

import muse_backend.services.background_processing as background_module
import muse_backend.services.imports as imports_module
import muse_backend.services.multipart_import as multipart_module
from muse_backend.config import Settings
from muse_backend.database.models import ClothingImage, ClothingItem
from muse_backend.domain.enums import ImageKind, ImageProcessingState
from muse_backend.domain.exceptions import DomainValidationError, MuseError, StorageOperationError
from muse_backend.services.background_processing import (
    BackgroundProcessingWorker,
    BackgroundResult,
    ConservativeLocalBackgroundProcessor,
    reconcile_interrupted_imports,
)
from muse_backend.services.image_processing import validate_and_process_upload
from muse_backend.services.imports import GarmentImportService
from muse_backend.services.multipart_import import parse_import_request
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.integration


def image_bytes(
    image_format: str,
    *,
    size: tuple[int, int] = (640, 800),
    transparent: bool = False,
    exif_orientation: int | None = None,
) -> bytes:
    mode = "RGBA" if transparent else "RGB"
    background = (248, 244, 235, 0 if transparent else 255)
    image = Image.new(mode, size, background)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (size[0] // 4, size[1] // 6, size[0] * 3 // 4, size[1] * 5 // 6),
        radius=max(1, min(size) // 20),
        fill=(80, 45, 30, 255),
    )
    output = io.BytesIO()
    kwargs: dict[str, object] = {}
    if exif_orientation is not None:
        exif = Image.Exif()
        exif[274] = exif_orientation
        kwargs["exif"] = exif
    if image_format == "JPEG":
        image = image.convert("RGB")
        kwargs["quality"] = 92
    image.save(output, format=image_format, **kwargs)
    image.close()
    return output.getvalue()


def import_files(
    payload: bytes,
    *,
    filename: str,
    mime_type: str,
    metadata: dict[str, object] | None = None,
) -> list[tuple[str, tuple[str | None, bytes | str, str]]]:
    return [
        (
            "metadata",
            (
                None,
                json.dumps(metadata or {"name": "Linen Layer", "garment_category": "top"}),
                "application/json",
            ),
        ),
        ("image", (filename, payload, mime_type)),
    ]


async def post_import(
    client: httpx.AsyncClient,
    payload: bytes,
    *,
    filename: str = "garment.jpg",
    mime_type: str = "image/jpeg",
    metadata: dict[str, object] | None = None,
    idempotency_key: str | None = None,
) -> httpx.Response:
    headers = {"Idempotency-Key": idempotency_key} if idempotency_key is not None else None
    return await client.post(
        "/api/v1/clothing-items/import",
        files=import_files(
            payload,
            filename=filename,
            mime_type=mime_type,
            metadata=metadata,
        ),
        headers=headers,
    )


def all_media_files(settings: Settings) -> list[Path]:
    roots = (
        settings.original_image_root,
        settings.processed_image_root,
        settings.thumbnail_root,
        settings.cutout_image_root,
    )
    return [path for root in roots for path in root.iterdir() if path.is_file()]


@pytest.mark.parametrize(
    ("image_format", "filename", "mime_type"),
    [
        ("JPEG", "garment.jpg", "image/jpeg"),
        ("PNG", "garment.png", "image/png"),
        ("WEBP", "garment.webp", "image/webp"),
    ],
)
async def test_import_preserves_original_and_creates_grouped_safe_derivatives(
    app: Any,
    client: httpx.AsyncClient,
    image_format: str,
    filename: str,
    mime_type: str,
) -> None:
    assert app.state.background_worker.stop()
    original = image_bytes(image_format, size=(1800, 1200), transparent=image_format != "JPEG")

    response = await post_import(
        client,
        original,
        filename=filename,
        mime_type=mime_type,
        metadata={
            "name": "  Imported Garment  ",
            "garment_category": "outerwear",
            "brand": "  Muse Atelier ",
        },
    )

    assert response.status_code == 201, response.text
    assert response.headers["idempotency-replayed"] == "false"
    detail = response.json()
    assert response.headers["location"].endswith(str(detail["id"]))
    assert detail["name"] == "Imported Garment"
    assert detail["brand"] == "Muse Atelier"
    assert detail["default_body_zone"] == "upper_body"
    assert detail["image_processing_state"] == "pending"
    assert {image["image_kind"] for image in detail["images"]} == {
        "original",
        "normalized",
        "thumbnail",
    }
    assert len(detail["image_groups"]) == 1
    group = detail["image_groups"][0]
    assert group["display_image"]["image_kind"] == "normalized"
    assert group["thumbnail_image"]["image_kind"] == "thumbnail"
    assert group["original_image"]["image_kind"] == "original"
    assert len({image["image_group_id"] for image in detail["images"]}) == 1

    by_kind = {image["image_kind"]: image for image in detail["images"]}
    original_response = await client.get(by_kind["original"]["content_url"])
    assert original_response.status_code == 200
    assert original_response.content == original
    assert (
        hashlib.sha256(original_response.content).hexdigest()
        == hashlib.sha256(original).hexdigest()
    )

    for kind, maximum in (("normalized", 1600), ("thumbnail", 384)):
        media = await client.get(by_kind[kind]["content_url"])
        assert media.status_code == 200
        with Image.open(io.BytesIO(media.content)) as derivative:
            derivative.load()
            assert derivative.format == "WEBP"
            assert derivative.size == (
                by_kind[kind]["width"],
                by_kind[kind]["height"],
            )
            assert max(derivative.size) <= maximum
        assert by_kind[kind]["byte_size"] == len(media.content)

    listing = await client.get("/api/v1/clothing-items")
    summary = listing.json()["items"][0]
    assert summary["display_image"]["image_kind"] == "normalized"
    assert summary["thumbnail_image"]["image_kind"] == "thumbnail"
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_import_idempotency_category_filter_and_soft_delete_keep_media(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    assert app.state.background_worker.stop()
    payload = image_bytes("JPEG")
    first = await post_import(
        client,
        payload,
        metadata={"name": "Coat", "garment_category": "outerwear"},
        idempotency_key="wardrobe-import-1",
    )
    replay = await post_import(
        client,
        payload,
        metadata={"name": "Ignored replay", "garment_category": "hat"},
        idempotency_key="wardrobe-import-1",
    )

    assert first.status_code == replay.status_code == 201
    assert replay.headers["idempotency-replayed"] == "true"
    assert first.json()["id"] == replay.json()["id"]
    assert (await client.get("/api/v1/clothing-items?garment_category=outerwear")).json()[
        "total"
    ] == 1
    assert (await client.get("/api/v1/clothing-items?garment_category=hat")).json()["total"] == 0
    files_before_delete = {path: path.read_bytes() for path in all_media_files(app.state.settings)}

    deleted = await client.delete(f"/api/v1/clothing-items/{first.json()['id']}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/clothing-items")).json()["total"] == 0
    assert {path: path.read_bytes() for path in files_before_delete} == files_before_delete


@pytest.mark.parametrize(
    ("payload_factory", "filename", "mime_type", "expected_code"),
    [
        (lambda: b"", "empty.jpg", "image/jpeg", "empty_image"),
        (lambda: image_bytes("PNG"), "spoof.jpg", "image/jpeg", "image_mime_mismatch"),
        (lambda: b"GIF89a" + b"0" * 64, "animated.gif", "image/gif", "unsupported_image_format"),
        (lambda: b"\xff\xd8\xffbroken", "broken.jpg", "image/jpeg", "corrupt_image"),
        (
            lambda: image_bytes("JPEG")[:100],
            "truncated.jpg",
            "image/jpeg",
            "corrupt_image",
        ),
        (lambda: image_bytes("JPEG"), "../escape.jpg", "image/jpeg", "invalid_upload_filename"),
    ],
)
async def test_import_rejects_unsafe_or_invalid_images_and_cleans_temporary_files(
    app: Any,
    client: httpx.AsyncClient,
    payload_factory: Callable[[], bytes],
    filename: str,
    mime_type: str,
    expected_code: str,
) -> None:
    assert app.state.background_worker.stop()
    response = await post_import(
        client,
        payload_factory(),
        filename=filename,
        mime_type=mime_type,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code
    assert list(app.state.settings.temp_upload_root.iterdir()) == []
    assert all_media_files(app.state.settings) == []


async def test_import_rejects_animated_webp_and_invalid_metadata(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    assert app.state.background_worker.stop()
    frames = [Image.new("RGB", (24, 24), color) for color in ("red", "blue")]
    output = io.BytesIO()
    frames[0].save(
        output, format="WEBP", save_all=True, append_images=frames[1:], duration=20, loop=0
    )
    for frame in frames:
        frame.close()

    animated = await post_import(
        client,
        output.getvalue(),
        filename="animated.webp",
        mime_type="image/webp",
    )
    invalid_metadata = await post_import(
        client,
        image_bytes("JPEG"),
        metadata={"name": " ", "garment_category": "invented"},
    )

    assert animated.status_code == 422
    assert animated.json()["error"]["code"] == "animated_image_unsupported"
    assert invalid_metadata.status_code == 422
    assert invalid_metadata.json()["error"]["code"] == "invalid_import_metadata"
    assert invalid_metadata.json()["error"]["details"]["fields"]
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_import_accepts_generic_browser_mime_but_rejects_explicit_wrong_image_mime(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    assert app.state.background_worker.stop()
    payload = image_bytes("PNG")

    generic = await post_import(
        client,
        payload,
        filename="garment.png",
        mime_type="application/octet-stream",
    )
    wrong = await post_import(
        client,
        payload,
        filename="other.png",
        mime_type="image/jpeg",
    )

    assert generic.status_code == 201, generic.text
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "image_mime_mismatch"


def test_image_processing_normalizes_exif_orientation_and_enforces_limits(
    settings: Settings,
) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    attempt = settings.temp_upload_root / ("a" * 32)
    attempt.mkdir()
    source = attempt / "upload.bin"
    source.write_bytes(image_bytes("JPEG", size=(80, 40), exif_orientation=6))

    processed = validate_and_process_upload(
        source,
        filename="portrait.jpg",
        declared_mime_type="image/jpeg",
        settings=settings,
    )

    assert (processed.validated.encoded_width, processed.validated.encoded_height) == (80, 40)
    assert (processed.validated.display_width, processed.validated.display_height) == (40, 80)
    assert (processed.normalized.width, processed.normalized.height) == (40, 80)

    oversized = attempt / "oversized.bin"
    oversized.write_bytes(image_bytes("PNG", size=(513, 512)))
    strict_dimensions = settings.model_copy(update={"max_image_dimension": 512})
    with pytest.raises(DomainValidationError) as dimensions:
        validate_and_process_upload(
            oversized,
            filename="large.png",
            declared_mime_type="image/png",
            settings=strict_dimensions,
        )
    assert dimensions.value.code == "image_dimensions_exceeded"

    pixel_heavy = attempt / "pixels.bin"
    pixel_heavy.write_bytes(image_bytes("PNG", size=(1001, 1000)))
    strict_pixels = settings.model_copy(update={"max_image_pixels": 1_000_000})
    with pytest.raises(DomainValidationError) as pixels:
        validate_and_process_upload(
            pixel_heavy,
            filename="pixels.png",
            declared_mime_type="image/png",
            settings=strict_pixels,
        )
    assert pixels.value.code == "image_pixel_limit_exceeded"


def multipart_body(
    *,
    boundary: str,
    image: bytes,
    metadata: str = '{"name":"Layer","garment_category":"top"}',
    extra_part: bool = False,
) -> bytes:
    chunks = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
        "Content-Type: application/json\r\n\r\n".encode(),
        metadata.encode(),
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; '
        'filename="garment.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(),
        image,
    ]
    if extra_part:
        chunks.extend(
            [
                f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="extra"'
                "\r\n\r\nnope".encode(),
            ]
        )
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(chunks)


def request_for_body(
    body: bytes,
    *,
    boundary: str,
    content_length: bytes | None = None,
    disconnect_after_first_chunk: bool = False,
) -> Request:
    headers = [(b"content-type", f"multipart/form-data; boundary={boundary}".encode())]
    if content_length is not None:
        headers.append((b"content-length", content_length))
    delivered = False

    async def receive() -> dict[str, object]:
        nonlocal delivered
        if disconnect_after_first_chunk and delivered:
            return {"type": "http.disconnect"}
        if delivered:
            return {"type": "http.request", "body": b"", "more_body": False}
        delivered = True
        return {
            "type": "http.request",
            "body": body,
            "more_body": disconnect_after_first_chunk,
        }

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/clothing-items/import",
            "headers": headers,
        },
        receive,
    )


async def test_streaming_parser_exact_boundary_negative_length_and_disconnect_cleanup(
    settings: Settings,
) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    boundary = "muse-boundary"
    exact_settings = settings.model_copy(
        update={
            "max_upload_size_bytes": 1024,
            "upload_chunk_size_bytes": 128,
        }
    )
    exact_body = multipart_body(boundary=boundary, image=b"x" * 1024)
    parsed = await parse_import_request(
        request_for_body(exact_body, boundary=boundary),
        storage=storage,
        settings=exact_settings,
    )
    assert parsed.byte_size == 1024
    assert parsed.image_path.read_bytes() == b"x" * 1024
    storage.delete_temporary_tree(parsed.attempt_id)

    oversized_body = multipart_body(boundary=boundary, image=b"x" * 1025)
    with pytest.raises(MuseError) as oversized:
        await parse_import_request(
            request_for_body(oversized_body, boundary=boundary),
            storage=storage,
            settings=exact_settings,
        )
    assert oversized.value.code == "upload_too_large"

    with pytest.raises(DomainValidationError) as negative:
        await parse_import_request(
            request_for_body(b"", boundary=boundary, content_length=b"-1"),
            storage=storage,
            settings=exact_settings,
        )
    assert negative.value.code == "invalid_multipart_request"

    partial_body = exact_body[:100]
    with pytest.raises(MuseError) as disconnected:
        await parse_import_request(
            request_for_body(
                partial_body,
                boundary=boundary,
                disconnect_after_first_chunk=True,
            ),
            storage=storage,
            settings=exact_settings,
        )
    assert disconnected.value.code == "upload_cancelled"
    assert list(settings.temp_upload_root.iterdir()) == []


async def test_streaming_parser_waits_for_callback_thread_before_cancellation_cleanup(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    boundary = "muse-cancel"
    body = multipart_body(boundary=boundary, image=image_bytes("JPEG"))
    request = request_for_body(body, boundary=boundary)
    started = threading.Event()
    release = threading.Event()
    original_write = MultipartParser.write

    def blocking_write(parser: Any, data: bytes) -> int:
        started.set()
        assert release.wait(timeout=5)
        return original_write(parser, data)

    monkeypatch.setattr(MultipartParser, "write", blocking_write)
    task = asyncio.create_task(parse_import_request(request, storage=storage, settings=settings))
    assert await asyncio.to_thread(started.wait, 5)
    task.cancel()
    await asyncio.sleep(0)
    assert any(settings.temp_upload_root.iterdir())
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert list(settings.temp_upload_root.iterdir()) == []


async def test_streaming_parser_maps_short_file_write_and_cleans_attempt(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert app.state.background_worker.stop()
    callbacks_class = multipart_module._MultipartCallbacks
    original_headers_finished = callbacks_class.on_headers_finished

    class ShortWritingFile:
        def __init__(self, wrapped: Any) -> None:
            self.wrapped = wrapped

        def write(self, payload: bytes) -> int:
            if not payload:
                return 0
            self.wrapped.write(payload[:-1])
            return len(payload) - 1

        def __getattr__(self, name: str) -> Any:
            return getattr(self.wrapped, name)

    def install_short_writer(callbacks: Any) -> None:
        original_headers_finished(callbacks)
        if callbacks.current_part == "image" and callbacks.image_handle is not None:
            callbacks.image_handle = ShortWritingFile(callbacks.image_handle)

    monkeypatch.setattr(callbacks_class, "on_headers_finished", install_short_writer)

    response = await post_import(client, image_bytes("JPEG"))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "storage_operation_failed"
    assert list(app.state.settings.temp_upload_root.iterdir()) == []
    assert all_media_files(app.state.settings) == []


async def test_import_endpoint_rejects_unexpected_parts_and_concurrent_work(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    assert app.state.background_worker.stop()
    boundary = "muse-extra"
    invalid = await client.post(
        "/api/v1/clothing-items/import",
        content=multipart_body(
            boundary=boundary,
            image=image_bytes("JPEG"),
            extra_part=True,
        ),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_multipart_request"

    await app.state.import_lock.acquire()
    try:
        busy = await post_import(client, image_bytes("JPEG"))
    finally:
        app.state.import_lock.release()
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "clothing_import_busy"
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_import_openapi_contract_documents_streamed_multipart(
    client: httpx.AsyncClient,
) -> None:
    schema = (await client.get("/api/openapi.json")).json()
    request_body = schema["paths"]["/api/v1/clothing-items/import"]["post"]["requestBody"]
    multipart = request_body["content"]["multipart/form-data"]
    assert request_body["required"] is True
    assert multipart["schema"]["required"] == ["metadata", "image"]
    assert multipart["schema"]["properties"]["image"]["format"] == "binary"
    assert multipart["encoding"]["metadata"]["contentType"] == "application/json"


async def test_import_database_and_presenter_failures_roll_back_and_compensate(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert app.state.background_worker.stop()

    def fail_presentation(_item: ClothingItem) -> Any:
        raise RuntimeError("injected presenter failure")

    monkeypatch.setattr(imports_module, "clothing_detail", fail_presentation)
    response = await post_import(client, image_bytes("JPEG"))

    assert response.status_code == 500
    with app.state.database.session() as session:
        assert session.scalar(select(sa.func.count()).select_from(ClothingItem)) == 0
        assert session.scalar(select(sa.func.count()).select_from(ClothingImage)) == 0
    assert all_media_files(app.state.settings) == []
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_import_keeps_committed_rows_and_media_when_final_manifest_update_fails(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert app.state.background_worker.stop()
    original_write = app.state.storage.write_import_manifest

    def fail_after_commit(attempt_id: str, payload: dict[str, object]) -> Path:
        if payload.get("phase") == "committed":
            raise StorageOperationError()
        result: Path = original_write(attempt_id, payload)
        return result

    monkeypatch.setattr(app.state.storage, "write_import_manifest", fail_after_commit)
    response = await post_import(client, image_bytes("JPEG"))

    assert response.status_code == 201, response.text
    detail = response.json()
    assert len(detail["images"]) == 3
    assert len(all_media_files(app.state.settings)) == 3
    with app.state.database.session() as session:
        assert session.scalar(select(sa.func.count()).select_from(ClothingItem)) == 1
        paths = list(session.scalars(select(ClothingImage.relative_path)))
    service = GarmentImportService(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )
    assert service._compensate(paths)
    assert len(all_media_files(app.state.settings)) == 3
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_failed_filesystem_compensation_preserves_manifest_for_startup_reconciliation(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert app.state.background_worker.stop()

    def fail_persist(*args: object, **kwargs: object) -> Any:
        del args, kwargs
        raise OperationalError("INSERT", {}, RuntimeError("injected database failure"))

    original_delete = app.state.storage.delete_owned_media

    def fail_delete(_relative_path: str) -> None:
        raise StorageOperationError()

    monkeypatch.setattr(GarmentImportService, "_persist", fail_persist)
    monkeypatch.setattr(app.state.storage, "delete_owned_media", fail_delete)
    response = await post_import(client, image_bytes("JPEG"))

    assert response.status_code == 503
    assert len(all_media_files(app.state.settings)) == 3
    attempts = list(app.state.settings.temp_upload_root.iterdir())
    assert len(attempts) == 1
    assert (attempts[0] / "manifest.json").is_file()
    with app.state.database.session() as session:
        assert session.scalar(select(sa.func.count()).select_from(ClothingItem)) == 0

    monkeypatch.setattr(app.state.storage, "delete_owned_media", original_delete)
    reconcile_interrupted_imports(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )
    assert all_media_files(app.state.settings) == []
    assert list(app.state.settings.temp_upload_root.iterdir()) == []


async def test_category_filter_uses_covering_order_index(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    assert app.state.background_worker.stop()
    for index in range(8):
        response = await post_import(
            client,
            image_bytes("JPEG", size=(80, 120)),
            metadata={
                "name": f"Garment {index}",
                "garment_category": "top" if index % 2 else "pants",
            },
        )
        assert response.status_code == 201

    with app.state.database.engine.connect() as connection:
        plan = connection.execute(
            sa.text(
                """
                EXPLAIN QUERY PLAN
                SELECT id, name
                FROM clothing_items
                WHERE deleted_at IS NULL AND garment_category = :category
                ORDER BY updated_at DESC, created_at DESC, id DESC
                LIMIT 24 OFFSET 0
                """
            ),
            {"category": "top"},
        ).all()
    assert any("ix_clothing_items_category_order" in str(row) for row in plan)


class SuccessfulCutoutProcessor:
    def process(self, source: Path, destination: Path) -> BackgroundResult:
        with Image.open(source) as opened:
            width, height = opened.size
        cutout = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(cutout)
        draw.rectangle(
            (width // 4, height // 4, width * 3 // 4, height * 3 // 4),
            fill=(90, 50, 30, 255),
        )
        cutout.save(destination, format="WEBP", lossless=True)
        cutout.close()
        payload = destination.read_bytes()
        return BackgroundResult(
            created=True,
            width=width,
            height=height,
            byte_size=len(payload),
            content_sha256=hashlib.sha256(payload).hexdigest(),
        )


class FailedCutoutProcessor:
    def __init__(self, error_code: str = "background_processing_failed") -> None:
        self.error_code = error_code

    def process(self, source: Path, destination: Path) -> BackgroundResult:
        del source, destination
        return BackgroundResult(created=False, error_code=self.error_code)


class InvalidCutoutProcessor:
    def __init__(self, *, fully_transparent: bool) -> None:
        self.fully_transparent = fully_transparent

    def process(self, source: Path, destination: Path) -> BackgroundResult:
        with Image.open(source) as opened:
            size = opened.size
        alpha = 0 if self.fully_transparent else 255
        output = Image.new("RGBA", size, (80, 40, 20, alpha))
        output.save(destination, format="WEBP", lossless=True)
        output.close()
        payload = destination.read_bytes()
        return BackgroundResult(
            created=True,
            width=size[0],
            height=size[1],
            byte_size=len(payload),
            content_sha256=hashlib.sha256(payload).hexdigest(),
        )


def worker_for(app: Any, processor: Any) -> BackgroundProcessingWorker:
    return BackgroundProcessingWorker(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
        processor=processor,
    )


async def pending_import(app: Any, client: httpx.AsyncClient) -> int:
    assert app.state.background_worker.stop()
    response = await post_import(
        client,
        image_bytes("PNG", transparent=True),
        filename="garment.png",
        mime_type="image/png",
    )
    assert response.status_code == 201, response.text
    assert response.json()["image_processing_state"] == "pending"
    return int(response.json()["id"])


def processing_snapshot(app: Any, item_id: int) -> tuple[str, int, str | None, list[ClothingImage]]:
    with app.state.database.session() as session:
        item = session.get(ClothingItem, item_id)
        assert item is not None
        images = list(
            session.scalars(select(ClothingImage).where(ClothingImage.clothing_item_id == item_id))
        )
        return (
            item.image_processing_state,
            item.processing_attempts,
            item.processing_error_code,
            images,
        )


async def test_background_worker_registers_validated_cutout_and_presenter_prefers_it(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    item_id = await pending_import(app, client)
    worker = worker_for(app, SuccessfulCutoutProcessor())

    assert worker._claim_next() == item_id
    worker._process_item(item_id)

    state, attempts, error, images = processing_snapshot(app, item_id)
    assert (state, attempts, error) == ("completed", 1, None)
    cutout = next(image for image in images if image.image_kind == "cutout")
    assert cutout.is_primary
    assert app.state.storage.resolve_media_path(cutout.relative_path).is_file()
    assert all(not image.is_primary for image in images if image.id != cutout.id)
    detail = (await client.get(f"/api/v1/clothing-items/{item_id}")).json()
    assert detail["image_groups"][0]["display_image"]["image_kind"] == "cutout"


async def test_background_processing_retries_failures_but_confidence_fallback_is_terminal(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    item_id = await pending_import(app, client)
    worker = worker_for(app, FailedCutoutProcessor())

    assert worker._claim_next() == item_id
    worker._process_item(item_id)
    assert processing_snapshot(app, item_id)[:3] == (
        "pending",
        1,
        "background_processing_failed",
    )
    assert worker._claim_next() == item_id
    worker._process_item(item_id)
    assert processing_snapshot(app, item_id)[:3] == (
        "completed_with_fallback",
        2,
        "background_processing_failed",
    )
    assert worker._claim_next() is None

    second = await post_import(client, image_bytes("JPEG"))
    second_id = int(second.json()["id"])
    confidence_worker = worker_for(app, FailedCutoutProcessor("background_not_uniform"))
    assert confidence_worker._claim_next() == second_id
    confidence_worker._process_item(second_id)
    assert processing_snapshot(app, second_id)[:3] == (
        "completed_with_fallback",
        1,
        "background_not_uniform",
    )


async def test_background_claim_treats_sqlite_busy_as_transient_and_recovers(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item_id = await pending_import(app, client)
    worker = worker_for(app, FailedCutoutProcessor())
    original_session = app.state.database.session
    warnings: list[str] = []

    def locked_session() -> Any:
        raise OperationalError(
            "UPDATE clothing_items",
            {},
            sqlite3.OperationalError("database is locked"),
        )

    def record_warning(message: str, *args: object) -> None:
        warnings.append(message % args if args else message)

    def unexpected_exception(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("transient SQLite contention must not log a traceback")

    monkeypatch.setattr(app.state.database, "session", locked_session)
    monkeypatch.setattr(background_module.logger, "warning", record_warning)
    monkeypatch.setattr(background_module.logger, "exception", unexpected_exception)

    assert worker._claim_next() is None
    monkeypatch.setattr(app.state.database, "session", original_session)
    assert processing_snapshot(app, item_id)[:2] == ("pending", 0)
    assert warnings == ["Background worker deferred a claim while SQLite was busy; retrying"]

    assert worker._claim_next() == item_id


@pytest.mark.parametrize("fully_transparent", [True, False])
async def test_worker_rejects_invisible_or_opaque_processor_output(
    app: Any,
    client: httpx.AsyncClient,
    fully_transparent: bool,
) -> None:
    item_id = await pending_import(app, client)
    worker = worker_for(app, InvalidCutoutProcessor(fully_transparent=fully_transparent))

    assert worker._claim_next() == item_id
    worker._process_item(item_id)

    state, attempts, error, images = processing_snapshot(app, item_id)
    assert (state, attempts, error) == ("pending", 1, "background_processing_failed")
    assert all(image.image_kind != "cutout" for image in images)
    assert list(app.state.settings.cutout_image_root.iterdir()) == []


def test_conservative_background_processor_succeeds_only_with_confident_local_signal(
    tmp_path: Path,
) -> None:
    processor = ConservativeLocalBackgroundProcessor()
    uniform = tmp_path / "uniform.webp"
    uniform_image = Image.new("RGB", (320, 320), "white")
    ImageDraw.Draw(uniform_image).rectangle((90, 50, 230, 280), fill=(70, 30, 20))
    uniform_image.save(uniform, format="WEBP", lossless=True)
    uniform_image.close()
    result = processor.process(uniform, tmp_path / "uniform-cutout.webp")
    assert result.created
    with Image.open(tmp_path / "uniform-cutout.webp") as cutout:
        cutout.load()
        alpha_extrema = cutout.getchannel("A").getextrema()
        assert isinstance(alpha_extrema, tuple)
        assert alpha_extrema[0] == 0
        assert alpha_extrema[1] > 0

    irregular = tmp_path / "irregular.webp"
    noisy = Image.new("RGB", (128, 128), "white")
    draw = ImageDraw.Draw(noisy)
    for position in range(0, 128, 2):
        draw.point((position, 0), fill="black")
        draw.point((position, 127), fill="red")
    noisy.save(irregular, format="WEBP", lossless=True)
    noisy.close()
    fallback = processor.process(irregular, tmp_path / "irregular-cutout.webp")
    assert not fallback.created
    assert fallback.error_code == "background_not_uniform"


async def test_failed_cutout_compensation_preserves_manifest_until_reconciliation(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item_id = await pending_import(app, client)
    worker = worker_for(app, SuccessfulCutoutProcessor())
    assert worker._claim_next() == item_id
    original_session = app.state.database.session
    session_calls = 0

    @contextmanager
    def fail_registration_session() -> Any:
        nonlocal session_calls
        session_calls += 1
        if session_calls == 2:
            raise OperationalError("INSERT", {}, RuntimeError("injected failure"))
        with original_session() as session:
            yield session

    def fail_delete(_relative_path: str) -> None:
        raise StorageOperationError()

    monkeypatch.setattr(app.state.database, "session", fail_registration_session)
    monkeypatch.setattr(app.state.storage, "delete_owned_media", fail_delete)
    worker._process_item(item_id)

    attempts = list(app.state.settings.temp_upload_root.iterdir())
    assert len(attempts) == 1
    assert (attempts[0] / "manifest.json").is_file()
    assert len(list(app.state.settings.cutout_image_root.iterdir())) == 1
    assert processing_snapshot(app, item_id)[0] == "processing"


async def test_startup_reconciliation_recovers_states_and_handles_malformed_attempts(
    app: Any,
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    warnings: list[str] = []

    def record_warning(message: str, *args: object, **kwargs: object) -> None:
        del kwargs
        warnings.append(message % args if args else message)

    monkeypatch.setattr(background_module.logger, "warning", record_warning)
    first_id = await pending_import(app, client)
    second_response = await post_import(client, image_bytes("JPEG"))
    second_id = int(second_response.json()["id"])
    with app.state.database.session() as session, session.begin():
        first = session.get(ClothingItem, first_id)
        second = session.get(ClothingItem, second_id)
        assert first is not None and second is not None
        first.image_processing_state = ImageProcessingState.PROCESSING.value
        first.processing_attempts = 1
        second.image_processing_state = ImageProcessingState.PROCESSING.value
        second.processing_attempts = app.state.settings.background_processing_max_attempts

    missing_image: ClothingImage
    with app.state.database.session() as session:
        missing_image = session.scalar(
            select(ClothingImage).where(
                ClothingImage.clothing_item_id == first_id,
                ClothingImage.image_kind == ImageKind.THUMBNAIL.value,
            )
        )
        assert missing_image is not None
        missing_path = missing_image.relative_path
    app.state.storage.resolve_media_path(missing_path).unlink()
    unknown = (
        app.state.settings.processed_image_root
        / app.state.storage.generate_internal_filename(".webp")
    )
    unknown.write_bytes(b"retained-orphan-evidence")

    malformed = app.state.settings.temp_upload_root / ("z" * 32)
    malformed.mkdir()
    valid = app.state.settings.temp_upload_root / ("b" * 32)
    valid.mkdir()
    outside_manifest = tmp_path / "outside-manifest.json"
    outside_manifest.write_text('{"final_paths":[]}', encoding="utf-8")
    (valid / "manifest.json").symlink_to(outside_manifest)

    reconcile_interrupted_imports(
        settings=app.state.settings,
        storage=app.state.storage,
        database=app.state.database,
    )

    assert processing_snapshot(app, first_id)[:3] == (
        "pending",
        1,
        "background_processing_interrupted",
    )
    assert processing_snapshot(app, second_id)[:3] == (
        "completed_with_fallback",
        app.state.settings.background_processing_max_attempts,
        "background_processing_attempts_exhausted",
    )
    assert malformed.is_dir()
    assert not valid.exists()
    assert outside_manifest.is_file()
    assert unknown.is_file()
    assert any("Registered garment media is missing" in warning for warning in warnings)
    assert any("Unregistered generated media was retained" in warning for warning in warnings)


async def test_reconciliation_terminalizes_queue_when_processing_is_disabled(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    item_id = await pending_import(app, client)
    disabled = app.state.settings.model_copy(update={"background_processing_enabled": False})

    reconcile_interrupted_imports(
        settings=disabled,
        storage=app.state.storage,
        database=app.state.database,
    )

    assert processing_snapshot(app, item_id)[:3] == (
        "completed_with_fallback",
        0,
        "background_processing_disabled",
    )


class BlockingCutoutProcessor(SuccessfulCutoutProcessor):
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def process(self, source: Path, destination: Path) -> BackgroundResult:
        self.started.set()
        assert self.release.wait(timeout=10)
        return super().process(source, destination)


async def test_background_worker_is_single_concurrency_api_responsive_and_shutdown_safe(
    app: Any,
    client: httpx.AsyncClient,
) -> None:
    await pending_import(app, client)
    processor = BlockingCutoutProcessor()
    worker = BackgroundProcessingWorker(
        settings=app.state.settings.model_copy(update={"background_shutdown_timeout_seconds": 0.1}),
        storage=app.state.storage,
        database=app.state.database,
        processor=processor,
    )
    worker.start()
    worker.start()
    assert await asyncio.to_thread(processor.started.wait, 5)

    listing = await asyncio.wait_for(client.get("/api/v1/clothing-items"), timeout=1)
    assert listing.status_code == 200
    assert not worker.stop()
    assert worker.is_alive
    processor.release.set()
    assert worker.stop()
    assert not worker.is_alive
