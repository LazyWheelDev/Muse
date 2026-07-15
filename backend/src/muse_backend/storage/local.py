import json
import logging
import os
import re
import shutil
import time
from pathlib import Path
from threading import Lock
from uuid import uuid4

from muse_backend.config import Settings
from muse_backend.domain.enums import ImageKind
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    StorageOperationError,
)
from muse_backend.domain.validation import normalize_relative_path

logger = logging.getLogger(__name__)
_EXTENSION_PATTERN = re.compile(r"^\.[a-z0-9]{1,10}$")
_APPROVED_IMAGE_EXTENSIONS = frozenset({".jpeg", ".jpg", ".png", ".webp"})
_INTERNAL_IMAGE_FILENAME_PATTERN = re.compile(r"^[0-9a-f]{32}\.(?:jpeg|jpg|png|webp)$")
_ATTEMPT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class LocalStorageService:
    def __init__(self, settings: Settings, *, probe_ttl_seconds: float = 300.0) -> None:
        self.settings = settings
        self._probe_ttl_seconds = probe_ttl_seconds
        self._probe_lock = Lock()
        self._promotion_lock = Lock()
        self._last_probe_at: float | None = None
        self._last_probe_result = False

    def create_required_directories(self) -> None:
        try:
            for directory in self.settings.required_directories:
                directory.mkdir(mode=0o700, parents=True, exist_ok=True)
                if not directory.is_dir():
                    raise OSError("configured storage path is not a directory")
                directory.chmod(0o700)
        except OSError as error:
            logger.exception("Could not initialize Muse storage directories")
            raise StorageOperationError from error

    def secure_database_file(self) -> None:
        database_path = self.settings.database_path
        try:
            if database_path.is_file() and not database_path.is_symlink():
                database_path.chmod(0o600)
        except OSError as error:
            logger.exception("Could not secure the Muse database file")
            raise StorageOperationError from error

    def resolve_media_path(self, relative_path: str) -> Path:
        return self.resolve_beneath(self.settings.media_root, relative_path)

    def resolve_temp_path(self, relative_path: str) -> Path:
        return self.resolve_beneath(self.settings.temp_upload_root, relative_path)

    def resolve_preview_temp_path(self, relative_path: str) -> Path:
        return self.resolve_beneath(self.settings.temp_preview_root, relative_path)

    @staticmethod
    def resolve_beneath(root: Path, relative_path: str) -> Path:
        try:
            normalized = normalize_relative_path(relative_path)
            resolved_root = root.resolve()
            candidate = resolved_root / Path(*normalized.split("/"))
            resolved_candidate = candidate.resolve(strict=False)
            resolved_candidate.relative_to(resolved_root)
        except (OSError, RuntimeError, ValueError) as error:
            raise DomainValidationError(
                code="invalid_relative_path",
                message="The supplied local media reference is invalid.",
            ) from error
        return candidate

    @staticmethod
    def generate_internal_filename(extension: str) -> str:
        normalized_extension = extension.lower()
        if (
            not _EXTENSION_PATTERN.fullmatch(normalized_extension)
            or normalized_extension not in _APPROVED_IMAGE_EXTENSIONS
        ):
            raise DomainValidationError(
                code="invalid_media_extension",
                message="The media extension is not supported.",
            )
        return f"{uuid4().hex}{normalized_extension}"

    def image_root(self, image_kind: ImageKind) -> Path:
        return {
            ImageKind.ORIGINAL: self.settings.original_image_root,
            ImageKind.NORMALIZED: self.settings.processed_image_root,
            ImageKind.THUMBNAIL: self.settings.thumbnail_root,
            ImageKind.CUTOUT: self.settings.cutout_image_root,
        }[image_kind]

    def validate_image_location(self, relative_path: str, image_kind: ImageKind) -> Path:
        candidate = self.resolve_media_path(relative_path)
        try:
            expected_root = self.image_root(image_kind).resolve()
            candidate.resolve(strict=False).relative_to(expected_root)
        except (OSError, RuntimeError, ValueError) as error:
            raise DomainValidationError(
                code="invalid_image_location",
                message="The image is not stored in the expected local directory.",
            ) from error
        if self._contains_symlink(expected_root, candidate):
            raise DomainValidationError(
                code="invalid_image_location",
                message="The image is not stored in the expected local directory.",
            )
        return candidate

    def atomic_promote(self, *, temp_relative_path: str, final_relative_path: str) -> Path:
        source = self.resolve_temp_path(temp_relative_path)
        return self._atomic_promote(
            source_root=self.settings.temp_upload_root,
            source=source,
            final_relative_path=final_relative_path,
        )

    def atomic_promote_preview(
        self,
        *,
        temp_relative_path: str,
        final_relative_path: str,
    ) -> Path:
        source = self.resolve_preview_temp_path(temp_relative_path)
        return self._atomic_promote(
            source_root=self.settings.temp_preview_root,
            source=source,
            final_relative_path=final_relative_path,
        )

    def _atomic_promote(
        self,
        *,
        source_root: Path,
        source: Path,
        final_relative_path: str,
    ) -> Path:
        destination = self.resolve_media_path(final_relative_path)
        if not self.is_approved_image_path(destination):
            raise DomainValidationError(
                code="invalid_media_extension",
                message="The media extension is not supported.",
            )
        if not _INTERNAL_IMAGE_FILENAME_PATTERN.fullmatch(destination.name):
            raise DomainValidationError(
                code="invalid_storage_filename",
                message="Persistent media must use a backend-generated filename.",
            )
        if not self.is_approved_persistent_media_location(destination):
            raise DomainValidationError(
                code="invalid_media_location",
                message="Persistent media must use an approved local directory.",
            )
        try:
            with self._promotion_lock:
                if self._contains_symlink(source_root, source) or not source.is_file():
                    raise OSError("temporary source is not a regular file")
                destination.parent.mkdir(parents=True, exist_ok=True)
                if self._contains_symlink(
                    self.settings.media_root, destination, include_leaf=False
                ):
                    raise OSError("final storage path contains a symbolic link")
                if destination.exists() or destination.is_symlink():
                    raise ResourceConflictError(
                        code="media_path_conflict",
                        message="Muse could not allocate a unique local media path.",
                    )
                if source.stat().st_dev != destination.parent.stat().st_dev:
                    raise OSError("temporary and final storage are on different filesystems")
                source.chmod(0o600)
                with source.open("rb") as source_file:
                    os.fsync(source_file.fileno())
                os.replace(source, destination)
                self._fsync_directory(destination.parent)
                if source.parent != destination.parent:
                    self._fsync_directory(source.parent)
            return destination
        except ResourceConflictError:
            raise
        except OSError as error:
            logger.exception("Could not atomically promote a Muse media file")
            raise StorageOperationError from error

    @staticmethod
    def is_approved_image_path(path: Path) -> bool:
        return path.suffix.lower() in _APPROVED_IMAGE_EXTENSIONS

    def is_approved_persistent_media_location(self, path: Path) -> bool:
        try:
            resolved = path.resolve(strict=False)
            approved_roots = (
                self.settings.original_image_root,
                self.settings.processed_image_root,
                self.settings.thumbnail_root,
                self.settings.cutout_image_root,
                self.settings.outfit_preview_root,
            )
            return any(resolved.is_relative_to(root.resolve()) for root in approved_roots)
        except (OSError, RuntimeError):
            return False

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _contains_symlink(root: Path, candidate: Path, *, include_leaf: bool = True) -> bool:
        resolved_root = root.resolve()
        try:
            relative_parts = candidate.relative_to(resolved_root).parts
        except ValueError:
            return True
        if not include_leaf:
            relative_parts = relative_parts[:-1]
        current = resolved_root
        for part in relative_parts:
            current /= part
            if current.is_symlink():
                return True
        return False

    def delete_temporary_file(self, relative_path: str) -> None:
        candidate = self.resolve_temp_path(relative_path)
        try:
            candidate.unlink(missing_ok=True)
        except OSError as error:
            logger.exception("Could not delete a Muse temporary file")
            raise StorageOperationError from error

    def delete_temporary_tree(self, attempt_id: str) -> None:
        self._delete_temporary_tree(
            root=self.settings.temp_upload_root,
            attempt_id=attempt_id,
            operation="import",
        )

    def create_preview_attempt(self, attempt_id: str) -> Path:
        if not _ATTEMPT_ID_PATTERN.fullmatch(attempt_id):
            raise DomainValidationError(
                code="invalid_relative_path",
                message="The supplied local media reference is invalid.",
            )
        candidate = self.resolve_preview_temp_path(attempt_id)
        try:
            candidate.mkdir(mode=0o700, parents=False, exist_ok=False)
            self._fsync_directory(self.settings.temp_preview_root)
            return candidate
        except OSError as error:
            logger.exception("Could not create a Muse temporary preview directory")
            raise StorageOperationError from error

    def delete_preview_temporary_tree(self, attempt_id: str) -> None:
        self._delete_temporary_tree(
            root=self.settings.temp_preview_root,
            attempt_id=attempt_id,
            operation="preview",
        )

    def _delete_temporary_tree(self, *, root: Path, attempt_id: str, operation: str) -> None:
        if not _ATTEMPT_ID_PATTERN.fullmatch(attempt_id):
            raise DomainValidationError(
                code="invalid_relative_path",
                message="The supplied local media reference is invalid.",
            )
        candidate = self.resolve_beneath(root, attempt_id)
        try:
            if candidate.is_symlink():
                candidate.unlink(missing_ok=True)
            elif candidate.exists():
                shutil.rmtree(candidate)
            if root.is_dir():
                self._fsync_directory(root)
        except OSError as error:
            logger.exception("Could not delete a Muse temporary %s directory", operation)
            raise StorageOperationError from error

    def write_import_manifest(self, attempt_id: str, payload: dict[str, object]) -> Path:
        return self._write_manifest(
            root=self.settings.temp_upload_root,
            attempt_id=attempt_id,
            payload=payload,
            operation="import",
        )

    def write_preview_manifest(self, attempt_id: str, payload: dict[str, object]) -> Path:
        return self._write_manifest(
            root=self.settings.temp_preview_root,
            attempt_id=attempt_id,
            payload=payload,
            operation="preview",
        )

    def _write_manifest(
        self,
        *,
        root: Path,
        attempt_id: str,
        payload: dict[str, object],
        operation: str,
    ) -> Path:
        if not _ATTEMPT_ID_PATTERN.fullmatch(attempt_id):
            raise DomainValidationError(
                code="invalid_relative_path",
                message="The supplied local media reference is invalid.",
            )
        attempt_directory = self.resolve_beneath(root, attempt_id)
        destination = attempt_directory / "manifest.json"
        temporary = attempt_directory / "manifest.json.tmp"
        encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        try:
            with temporary.open("xb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            temporary.chmod(0o600)
            os.replace(temporary, destination)
            self._fsync_directory(attempt_directory)
            return destination
        except OSError as error:
            temporary.unlink(missing_ok=True)
            logger.exception("Could not persist a Muse %s manifest", operation)
            raise StorageOperationError from error

    def validate_outfit_preview_location(self, relative_path: str) -> Path:
        candidate = self.resolve_media_path(relative_path)
        try:
            expected_root = self.settings.outfit_preview_root.resolve()
            candidate.resolve(strict=False).relative_to(expected_root)
        except (OSError, RuntimeError, ValueError) as error:
            raise DomainValidationError(
                code="invalid_preview_location",
                message="The outfit preview is not stored in the expected local directory.",
            ) from error
        if (
            self._contains_symlink(expected_root, candidate)
            or not _INTERNAL_IMAGE_FILENAME_PATTERN.fullmatch(candidate.name)
            or candidate.suffix.lower() != ".webp"
        ):
            raise DomainValidationError(
                code="invalid_preview_location",
                message="The outfit preview is not stored in the expected local directory.",
            )
        return candidate

    def delete_owned_media(self, relative_path: str) -> None:
        candidate = self.resolve_media_path(relative_path)
        if (
            not _INTERNAL_IMAGE_FILENAME_PATTERN.fullmatch(candidate.name)
            or not self.is_approved_persistent_media_location(candidate)
            or self._contains_symlink(self.settings.media_root, candidate)
        ):
            raise DomainValidationError(
                code="invalid_media_location",
                message="Persistent media must use an approved local directory.",
            )
        try:
            candidate.unlink(missing_ok=True)
            if candidate.parent.is_dir():
                self._fsync_directory(candidate.parent)
        except OSError as error:
            logger.exception("Could not compensate a Muse media promotion")
            raise StorageOperationError from error

    def media_relative_path(self, path: Path) -> str:
        try:
            return (
                path.resolve(strict=False)
                .relative_to(self.settings.media_root.resolve())
                .as_posix()
            )
        except (OSError, RuntimeError, ValueError) as error:
            raise DomainValidationError(
                code="invalid_media_location",
                message="Persistent media must use an approved local directory.",
            ) from error

    def writable(self, *, force: bool = False) -> bool:
        now = time.monotonic()
        with self._probe_lock:
            if (
                not force
                and self._last_probe_at is not None
                and now - self._last_probe_at < self._probe_ttl_seconds
            ):
                return self._last_probe_result
            result = self._probe_directories()
            self._last_probe_at = now
            self._last_probe_result = result
            return result

    def _probe_directories(self) -> bool:
        try:
            for directory in self.settings.required_directories:
                if not directory.is_dir():
                    return False
                probe = directory / f".muse-write-probe-{uuid4().hex}"
                probe.write_bytes(b"")
                probe.unlink()
            return True
        except OSError:
            logger.exception("Muse storage write probe failed")
            return False
