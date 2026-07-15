import re
import stat
from pathlib import Path

import pytest

from muse_backend.config import Settings
from muse_backend.domain.enums import ImageKind
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    StorageOperationError,
)
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.unit


def test_storage_creates_required_directories_and_caches_successful_probe(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalStorageService(settings, probe_ttl_seconds=60)
    storage.create_required_directories()

    assert all(path.is_dir() for path in settings.required_directories)
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o700 for path in settings.required_directories)
    assert storage.writable(force=True)

    def should_not_probe() -> bool:
        raise AssertionError("the cached result should be used")

    monkeypatch.setattr(storage, "_probe_directories", should_not_probe)
    assert storage.writable()


def test_storage_first_write_probe_does_not_depend_on_system_uptime(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("muse_backend.storage.local.time.monotonic", lambda: 1.0)
    storage = LocalStorageService(settings, probe_ttl_seconds=300)
    storage.create_required_directories()

    assert storage.writable()


def test_storage_initialization_wraps_filesystem_failure(settings: Settings) -> None:
    settings.data_root.parent.mkdir(parents=True, exist_ok=True)
    settings.data_root.write_text("not a directory", encoding="utf-8")

    with pytest.raises(StorageOperationError) as captured:
        LocalStorageService(settings).create_required_directories()

    assert captured.value.code == "storage_operation_failed"


@pytest.mark.parametrize(
    "relative_path",
    [
        "",
        "   ",
        "/absolute.jpg",
        "../escape.jpg",
        "nested/../escape.jpg",
        "nested//image.jpg",
        "nested/./image.jpg",
        "nested\\image.jpg",
        "file://image.jpg",
        "C:/image.jpg",
        "image\x00.jpg",
        f"{'a' * 241}.jpg",
        f"nested/{'a' * 500}.jpg",
        "nested/line\nbreak.jpg",
    ],
)
def test_storage_rejects_unsafe_relative_paths(
    settings: Settings,
    relative_path: str,
) -> None:
    storage = LocalStorageService(settings)

    with pytest.raises(DomainValidationError) as captured:
        storage.resolve_media_path(relative_path)

    assert captured.value.code == "invalid_relative_path"


def test_storage_resolves_portable_nested_paths(settings: Settings) -> None:
    storage = LocalStorageService(settings)

    assert storage.resolve_media_path("garments/original/item.jpg") == (
        settings.media_root / "garments" / "original" / "item.jpg"
    )
    assert (
        storage.resolve_temp_path("batch/item.tmp") == settings.temp_upload_root / "batch/item.tmp"
    )


@pytest.mark.parametrize("extension", [".jpg", ".JPG", ".jpeg", ".png", ".webp"])
def test_internal_image_filename_is_random_portable_and_normalized(extension: str) -> None:
    first = LocalStorageService.generate_internal_filename(extension)
    second = LocalStorageService.generate_internal_filename(extension)

    assert re.fullmatch(r"[0-9a-f]{32}\.(?:jpg|jpeg|png|webp)", first)
    assert first != second


@pytest.mark.parametrize(
    "extension", ["jpg", ".gif", ".svg", ".tar.gz", ".$$$", ".toolongextension"]
)
def test_internal_image_filename_rejects_unapproved_extensions(extension: str) -> None:
    with pytest.raises(DomainValidationError) as captured:
        LocalStorageService.generate_internal_filename(extension)
    assert captured.value.code == "invalid_media_extension"


def test_image_locations_must_match_declared_kind(settings: Settings) -> None:
    storage = LocalStorageService(settings)
    original = "garments/original/item.jpg"

    assert storage.image_root(ImageKind.ORIGINAL) == settings.original_image_root
    assert storage.image_root(ImageKind.NORMALIZED) == settings.processed_image_root
    assert storage.image_root(ImageKind.CUTOUT) == settings.cutout_image_root
    assert storage.image_root(ImageKind.THUMBNAIL) == settings.thumbnail_root
    assert storage.validate_image_location(original, ImageKind.ORIGINAL) == (
        settings.media_root / original
    )

    with pytest.raises(DomainValidationError) as captured:
        storage.validate_image_location(original, ImageKind.THUMBNAIL)
    assert captured.value.code == "invalid_image_location"


def test_atomic_promote_moves_regular_temp_file_without_overwriting(settings: Settings) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    source = storage.resolve_temp_path("incoming/item.jpg")
    source.parent.mkdir(parents=True)
    source.write_bytes(b"local-image")
    final_name = storage.generate_internal_filename(".jpg")

    destination = storage.atomic_promote(
        temp_relative_path="incoming/item.jpg",
        final_relative_path=f"garments/original/{final_name}",
    )

    assert destination == settings.original_image_root / final_name
    assert destination.read_bytes() == b"local-image"
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
    assert not source.exists()

    second_source = storage.resolve_temp_path("incoming/second.jpg")
    second_source.write_bytes(b"other")
    with pytest.raises(ResourceConflictError) as captured:
        storage.atomic_promote(
            temp_relative_path="incoming/second.jpg",
            final_relative_path=f"garments/original/{final_name}",
        )
    assert captured.value.code == "media_path_conflict"
    assert second_source.read_bytes() == b"other"
    assert destination.read_bytes() == b"local-image"

    named_source = storage.resolve_temp_path("incoming/named.jpg")
    named_source.write_bytes(b"named")
    with pytest.raises(DomainValidationError) as invalid_name:
        storage.atomic_promote(
            temp_relative_path="incoming/named.jpg",
            final_relative_path="garments/original/caller-name.jpg",
        )
    assert invalid_name.value.code == "invalid_storage_filename"


def test_atomic_promote_rejects_missing_or_symbolic_link_sources(settings: Settings) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    missing_name = storage.generate_internal_filename(".jpg")

    with pytest.raises(StorageOperationError):
        storage.atomic_promote(
            temp_relative_path="missing.jpg",
            final_relative_path=f"garments/original/{missing_name}",
        )

    target = settings.temp_upload_root / "target.jpg"
    target.write_bytes(b"target")
    link = settings.temp_upload_root / "link.jpg"
    link.symlink_to(target)
    link_name = storage.generate_internal_filename(".jpg")
    with pytest.raises(StorageOperationError):
        storage.atomic_promote(
            temp_relative_path="link.jpg",
            final_relative_path=f"garments/original/{link_name}",
        )

    unsupported = storage.resolve_temp_path("unsupported.html")
    unsupported.write_text("<script></script>", encoding="utf-8")
    with pytest.raises(DomainValidationError) as invalid_extension:
        storage.atomic_promote(
            temp_relative_path="unsupported.html",
            final_relative_path="garments/original/unsupported.html",
        )
    assert invalid_extension.value.code == "invalid_media_extension"


def test_temporary_file_deletion_is_idempotent_and_wraps_failures(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    temporary = settings.temp_upload_root / "delete-me.tmp"
    temporary.write_bytes(b"temporary")

    storage.delete_temporary_file("delete-me.tmp")
    storage.delete_temporary_file("delete-me.tmp")
    assert not temporary.exists()

    original_unlink = Path.unlink

    def failing_unlink(path: Path, missing_ok: bool = False) -> None:
        if path.name == "cannot-delete.tmp":
            raise OSError("read-only filesystem")
        original_unlink(path, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", failing_unlink)
    with pytest.raises(StorageOperationError):
        storage.delete_temporary_file("cannot-delete.tmp")


def test_write_probe_reports_missing_or_unwritable_storage(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalStorageService(settings, probe_ttl_seconds=0)
    assert not storage.writable(force=True)

    storage.create_required_directories()
    original_write_bytes = Path.write_bytes

    def failing_probe_write(path: Path, data: bytes) -> int:
        if path.name.startswith(".muse-write-probe-"):
            raise OSError("read-only filesystem")
        return original_write_bytes(path, data)

    monkeypatch.setattr(Path, "write_bytes", failing_probe_write)
    assert not storage.writable(force=True)
