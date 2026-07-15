import hashlib
import json
import logging
import os
import re
import sqlite3
import stat
import statistics
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from PIL import Image, ImageChops, ImageDraw, ImageFilter
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import selectinload

from muse_backend.config import Settings
from muse_backend.database.base import utc_now
from muse_backend.database.engine import Database
from muse_backend.database.models import ClothingImage, ClothingItem
from muse_backend.domain.enums import ImageKind, ImageProcessingState
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    StorageOperationError,
)
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)
_ATTEMPT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _is_sqlite_busy_error(error: SQLAlchemyError) -> bool:
    if not isinstance(error, OperationalError) or not isinstance(
        error.orig, sqlite3.OperationalError
    ):
        return False
    error_code = getattr(error.orig, "sqlite_errorcode", None)
    if isinstance(error_code, int) and error_code & 0xFF in {
        sqlite3.SQLITE_BUSY,
        sqlite3.SQLITE_LOCKED,
    }:
        return True
    message = str(error.orig).lower()
    return "database is locked" in message or "database table is locked" in message


@dataclass(frozen=True, slots=True)
class BackgroundResult:
    created: bool
    error_code: str | None = None
    width: int | None = None
    height: int | None = None
    byte_size: int | None = None
    content_sha256: str | None = None


class BackgroundRemovalProcessor(Protocol):
    def process(self, source: Path, destination: Path) -> BackgroundResult: ...


class ExistingAlphaProcessor:
    """Preserve real source transparency; never fabricate a cutout from opaque pixels."""

    def process(self, source: Path, destination: Path) -> BackgroundResult:
        try:
            with Image.open(source) as image:
                image.load()
                if "A" not in image.getbands():
                    return BackgroundResult(
                        created=False,
                        error_code="background_processor_unavailable",
                    )
                alpha = image.getchannel("A")
                minimum, maximum = alpha.getextrema()
                if minimum == maximum == 255:
                    return BackgroundResult(
                        created=False,
                        error_code="background_processor_unavailable",
                    )
                width, height = image.size
            with source.open("rb") as input_handle, destination.open("xb") as output_handle:
                digest = hashlib.sha256()
                byte_size = 0
                while chunk := input_handle.read(256 * 1024):
                    output_handle.write(chunk)
                    digest.update(chunk)
                    byte_size += len(chunk)
                output_handle.flush()
                os.fsync(output_handle.fileno())
            destination.chmod(0o600)
            return BackgroundResult(
                created=True,
                width=width,
                height=height,
                byte_size=byte_size,
                content_sha256=digest.hexdigest(),
            )
        except (OSError, ValueError):
            logger.exception("Local alpha-preservation processor failed")
            return BackgroundResult(created=False, error_code="background_processing_failed")


class ConservativeLocalBackgroundProcessor(ExistingAlphaProcessor):
    """Remove only a highly uniform, border-connected background using bounded Pillow work."""

    _color_threshold = 30
    _minimum_uniform_border_ratio = 0.92
    _minimum_background_ratio = 0.08
    _maximum_background_ratio = 0.92

    def process(self, source: Path, destination: Path) -> BackgroundResult:
        alpha_result = super().process(source, destination)
        if alpha_result.created or alpha_result.error_code == "background_processing_failed":
            return alpha_result
        try:
            with Image.open(source) as opened:
                opened.load()
                rgb = opened.convert("RGB")
            preview = rgb.copy()
            preview.thumbnail((256, 256), Image.Resampling.BILINEAR)
            border = self._border_pixels(preview)
            background = tuple(
                int(statistics.median(pixel[channel] for pixel in border)) for channel in range(3)
            )
            uniform = sum(
                max(abs(pixel[channel] - background[channel]) for channel in range(3))
                <= self._color_threshold
                for pixel in border
            ) / len(border)
            preview.close()
            if uniform < self._minimum_uniform_border_ratio:
                rgb.close()
                return BackgroundResult(
                    created=False,
                    error_code="background_not_uniform",
                )

            solid = Image.new("RGB", rgb.size, background)
            difference = ImageChops.difference(rgb, solid)
            red, green, blue = difference.split()
            maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            connected = maximum.point(
                lambda value: 0 if value <= self._color_threshold else 255,
                mode="L",
            )
            corners = (
                (0, 0),
                (connected.width - 1, 0),
                (0, connected.height - 1),
                (connected.width - 1, connected.height - 1),
            )
            for corner in corners:
                if connected.getpixel(corner) == 0:
                    ImageDraw.floodfill(connected, corner, 128)
            alpha = connected.point(lambda value: 0 if value == 128 else 255, mode="L")
            background_pixels = alpha.histogram()[0]
            background_ratio = background_pixels / (alpha.width * alpha.height)
            if (
                not self._minimum_background_ratio
                <= background_ratio
                <= self._maximum_background_ratio
            ):
                rgb.close()
                solid.close()
                difference.close()
                maximum.close()
                connected.close()
                alpha.close()
                return BackgroundResult(
                    created=False,
                    error_code="background_confidence_too_low",
                )
            softened = alpha.filter(ImageFilter.GaussianBlur(radius=0.6))
            rgba = rgb.copy()
            rgba.putalpha(softened)
            with destination.open("xb") as output:
                rgba.save(
                    output,
                    format="WEBP",
                    lossless=True,
                    method=4,
                    exact=True,
                    exif=b"",
                    icc_profile=None,
                )
                output.flush()
                os.fsync(output.fileno())
            destination.chmod(0o600)
            payload = destination.read_bytes()
            width, height = rgba.size
            for image in (
                rgb,
                solid,
                difference,
                maximum,
                connected,
                alpha,
                softened,
                rgba,
            ):
                image.close()
            return BackgroundResult(
                created=True,
                width=width,
                height=height,
                byte_size=len(payload),
                content_sha256=hashlib.sha256(payload).hexdigest(),
            )
        except (OSError, ValueError, ZeroDivisionError):
            destination.unlink(missing_ok=True)
            logger.exception("Conservative local background removal failed")
            return BackgroundResult(created=False, error_code="background_processing_failed")

    @staticmethod
    def _border_pixels(image: Image.Image) -> list[tuple[int, int, int]]:
        width, height = image.size

        def pixel(x: int, y: int) -> tuple[int, int, int]:
            value = image.getpixel((x, y))
            if not isinstance(value, tuple) or len(value) < 3:
                raise ValueError("background preview is not an RGB image")
            return int(value[0]), int(value[1]), int(value[2])

        return [
            *(pixel(x, 0) for x in range(width)),
            *(pixel(x, height - 1) for x in range(width)),
            *(pixel(0, y) for y in range(1, height - 1)),
            *(pixel(width - 1, y) for y in range(1, height - 1)),
        ]


def _validate_cutout_output(
    destination: Path,
    result: BackgroundResult,
    *,
    settings: Settings,
) -> None:
    if None in {
        result.width,
        result.height,
        result.byte_size,
        result.content_sha256,
    }:
        raise ValueError("processor returned incomplete cutout metadata")
    if destination.is_symlink() or not destination.is_file():
        raise ValueError("processor did not create a regular cutout file")
    stat = destination.stat()
    if stat.st_size <= 0 or stat.st_size > settings.max_upload_size_bytes:
        raise ValueError("processor created an invalid cutout size")
    with Image.open(destination) as image:
        if image.format != "WEBP" or getattr(image, "n_frames", 1) != 1:
            raise ValueError("processor did not create a static WebP cutout")
        width, height = image.size
        if (
            width <= 0
            or height <= 0
            or max(width, height) > settings.normalized_image_max_dimension
            or width * height > settings.max_image_pixels
        ):
            raise ValueError("processor created invalid cutout dimensions")
        image.load()
        if "A" not in image.getbands():
            raise ValueError("processor output does not contain a transparent cutout")
        alpha_minimum, alpha_maximum = image.getchannel("A").getextrema()
        if alpha_minimum == 255 or alpha_maximum == 0:
            raise ValueError("processor output is either opaque or fully transparent")
    with destination.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if (
        result.width != width
        or result.height != height
        or result.byte_size != stat.st_size
        or result.content_sha256 != digest
    ):
        raise ValueError("processor cutout metadata does not match its output")


def _audit_registered_media(
    *,
    settings: Settings,
    storage: LocalStorageService,
    registered_images: list[tuple[str, str]],
) -> None:
    registered_paths = {relative_path for relative_path, _ in registered_images}
    for relative_path, raw_kind in registered_images:
        try:
            kind = ImageKind(raw_kind)
            candidate = storage.validate_image_location(relative_path, kind)
            if candidate.is_symlink() or not candidate.is_file():
                logger.warning("Registered garment media is missing: %s", relative_path)
        except (OSError, ValueError, DomainValidationError, StorageOperationError):
            logger.warning("Registered garment media has an invalid local path: %s", relative_path)

    for root in (
        settings.original_image_root,
        settings.processed_image_root,
        settings.thumbnail_root,
        settings.cutout_image_root,
    ):
        try:
            entries = list(root.iterdir())
        except OSError:
            logger.warning("Could not inspect generated media directory: %s", root)
            continue
        for entry in entries:
            if not entry.is_file() and not entry.is_symlink():
                continue
            try:
                relative_path = storage.media_relative_path(entry)
            except Exception:
                logger.warning("Generated media has an invalid local path: %s", entry)
                continue
            if relative_path not in registered_paths:
                logger.warning("Unregistered generated media was retained: %s", relative_path)


def _reconcile_temporary_import_attempts(
    *,
    settings: Settings,
    storage: LocalStorageService,
    registered_paths: set[str],
    limit: int,
) -> int:
    """Remove at most ``limit`` stale import attempts while preserving owned media."""

    processed = 0
    try:
        attempts = os.scandir(settings.temp_upload_root)
    except OSError:
        logger.exception("Could not enumerate temporary imports during reconciliation")
        return 0
    with attempts:
        for entry in attempts:
            if processed >= limit:
                break
            try:
                is_directory = entry.is_dir(follow_symlinks=False)
            except OSError:
                continue
            if not is_directory or _ATTEMPT_ID_PATTERN.fullmatch(entry.name) is None:
                continue

            processed += 1
            attempt = Path(entry.path)
            manifest_path = attempt / "manifest.json"
            final_paths: list[str] = []
            try:
                if manifest_path.exists() or manifest_path.is_symlink():
                    descriptor = os.open(
                        manifest_path,
                        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                    )
                    with os.fdopen(descriptor, "rb") as handle:
                        metadata = os.fstat(handle.fileno())
                        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 64 * 1024:
                            raise ValueError("manifest is not a bounded regular file")
                        encoded = handle.read(64 * 1024 + 1)
                    if len(encoded) > 64 * 1024:
                        raise ValueError("manifest exceeds the reconciliation limit")
                    payload = json.loads(encoded.decode("utf-8"))
                    paths = payload.get("final_paths", []) if isinstance(payload, dict) else []
                    if isinstance(paths, list) and all(isinstance(path, str) for path in paths):
                        final_paths = paths
            except (OSError, UnicodeDecodeError, ValueError):
                logger.warning("Discarding a malformed temporary import manifest")
            for relative_path in final_paths:
                if relative_path in registered_paths:
                    continue
                try:
                    storage.delete_owned_media(relative_path)
                except Exception:
                    logger.exception("Could not reconcile an uncommitted promoted media file")
            try:
                storage.delete_temporary_tree(entry.name)
            except StorageOperationError:
                logger.exception("Could not remove a stale temporary import directory")
    return processed


def reconcile_temporary_imports(
    *,
    settings: Settings,
    storage: LocalStorageService,
    database: Database,
    limit: int,
) -> int:
    """Clean one bounded batch left by a terminated local or phone import process."""

    if limit <= 0:
        return 0
    try:
        with database.session() as session:
            registered_paths = set(session.scalars(select(ClothingImage.relative_path)))
    except SQLAlchemyError:
        logger.warning("Skipping temporary import cleanup until the database migration is current")
        return 0
    return _reconcile_temporary_import_attempts(
        settings=settings,
        storage=storage,
        registered_paths=registered_paths,
        limit=limit,
    )


def reconcile_interrupted_imports(
    *,
    settings: Settings,
    storage: LocalStorageService,
    database: Database,
) -> None:
    try:
        with database.session() as session, session.begin():
            if settings.background_processing_enabled:
                session.execute(
                    update(ClothingItem)
                    .where(
                        ClothingItem.image_processing_state
                        == ImageProcessingState.PROCESSING.value,
                        ClothingItem.processing_attempts
                        < settings.background_processing_max_attempts,
                    )
                    .values(
                        image_processing_state=ImageProcessingState.PENDING.value,
                        processing_error_code="background_processing_interrupted",
                        processing_started_at=None,
                    )
                )
                session.execute(
                    update(ClothingItem)
                    .where(
                        ClothingItem.image_processing_state.in_(
                            (
                                ImageProcessingState.PENDING.value,
                                ImageProcessingState.PROCESSING.value,
                            )
                        ),
                        ClothingItem.processing_attempts
                        >= settings.background_processing_max_attempts,
                    )
                    .values(
                        image_processing_state=ImageProcessingState.COMPLETED_WITH_FALLBACK.value,
                        processing_error_code="background_processing_attempts_exhausted",
                        processing_started_at=None,
                        processing_completed_at=utc_now(),
                    )
                )
            else:
                session.execute(
                    update(ClothingItem)
                    .where(
                        ClothingItem.image_processing_state.in_(
                            (
                                ImageProcessingState.PENDING.value,
                                ImageProcessingState.PROCESSING.value,
                            )
                        )
                    )
                    .values(
                        image_processing_state=ImageProcessingState.COMPLETED_WITH_FALLBACK.value,
                        processing_error_code="background_processing_disabled",
                        processing_started_at=None,
                        processing_completed_at=utc_now(),
                    )
                )
        with database.session() as session:
            registered_images = list(
                session.execute(
                    select(ClothingImage.relative_path, ClothingImage.image_kind)
                ).tuples()
            )
            registered_paths = {relative_path for relative_path, _ in registered_images}
    except SQLAlchemyError:
        logger.warning("Skipping import reconciliation until the database migration is current")
        return

    _audit_registered_media(
        settings=settings,
        storage=storage,
        registered_images=registered_images,
    )
    _reconcile_temporary_import_attempts(
        settings=settings,
        storage=storage,
        registered_paths=registered_paths,
        limit=settings.phone_upload_cleanup_batch_size,
    )


class BackgroundProcessingWorker:
    def __init__(
        self,
        *,
        settings: Settings,
        storage: LocalStorageService,
        database: Database,
        processor: BackgroundRemovalProcessor | None = None,
        interprocess_lock: InterprocessImportLock | None = None,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.database = database
        self.processor = processor or ConservativeLocalBackgroundProcessor()
        self.interprocess_lock = interprocess_lock or InterprocessImportLock(settings)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run,
            name="muse-background-worker",
            daemon=True,
        )
        self._thread.start()

    def notify(self) -> None:
        self._wake.set()

    def stop(self) -> bool:
        self._stop.set()
        self._wake.set()
        if self._thread is None:
            return True
        self._thread.join(timeout=self.settings.background_shutdown_timeout_seconds)
        if self._thread.is_alive():
            logger.warning("Background worker did not finish before the shutdown deadline")
            return False
        self._thread = None
        return True

    @property
    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with self.interprocess_lock.acquire(blocking=False):
                    item_id = self._claim_next()
                    if item_id is not None:
                        self._process_item(item_id)
            except ResourceConflictError:
                item_id = None
            if item_id is None:
                self._wake.wait(self.settings.background_worker_poll_seconds)
                self._wake.clear()

    def _claim_next(self) -> int | None:
        try:
            with self.database.session() as session, session.begin():
                next_item_id = (
                    select(ClothingItem)
                    .where(
                        ClothingItem.deleted_at.is_(None),
                        ClothingItem.image_processing_state == ImageProcessingState.PENDING.value,
                        ClothingItem.processing_attempts
                        < self.settings.background_processing_max_attempts,
                    )
                    .order_by(ClothingItem.created_at, ClothingItem.id)
                    .limit(1)
                    .with_only_columns(ClothingItem.id)
                    .scalar_subquery()
                )
                claimed_id = session.scalar(
                    update(ClothingItem)
                    .where(
                        ClothingItem.id == next_item_id,
                        ClothingItem.deleted_at.is_(None),
                        ClothingItem.image_processing_state == ImageProcessingState.PENDING.value,
                        ClothingItem.processing_attempts
                        < self.settings.background_processing_max_attempts,
                    )
                    .values(
                        image_processing_state=ImageProcessingState.PROCESSING.value,
                        processing_attempts=ClothingItem.processing_attempts + 1,
                        processing_started_at=utc_now(),
                        processing_error_code=None,
                    )
                    .returning(ClothingItem.id)
                )
                return int(claimed_id) if claimed_id is not None else None
        except SQLAlchemyError as error:
            if _is_sqlite_busy_error(error):
                logger.warning("Background worker deferred a claim while SQLite was busy; retrying")
                return None
            logger.exception("Background worker could not claim a processing job")
            return None

    def _process_item(self, item_id: int) -> None:
        attempt_id = uuid4().hex
        attempt_directory = self.storage.resolve_temp_path(attempt_id)
        promoted_path: str | None = None
        preserve_attempt = False
        try:
            with self.database.session() as session:
                item = session.scalar(
                    select(ClothingItem)
                    .where(ClothingItem.id == item_id, ClothingItem.deleted_at.is_(None))
                    .options(selectinload(ClothingItem.images))
                )
                if item is None:
                    self._finish(item_id, success=False, error_code="garment_deleted")
                    return
                normalized = next(
                    (
                        image
                        for image in item.images
                        if image.image_kind == ImageKind.NORMALIZED.value and image.is_primary
                    ),
                    None,
                )
                if normalized is None:
                    normalized = next(
                        (
                            image
                            for image in item.images
                            if image.image_kind == ImageKind.NORMALIZED.value
                        ),
                        None,
                    )
                if normalized is None:
                    self._finish(
                        item_id,
                        success=False,
                        error_code="normalized_image_unavailable",
                    )
                    return
                normalized_path = self.storage.validate_image_location(
                    normalized.relative_path,
                    ImageKind.NORMALIZED,
                )
                image_group_id = normalized.image_group_id
                display_order = normalized.display_order

            attempt_directory.mkdir(mode=0o700, parents=False, exist_ok=False)
            cutout_temp = attempt_directory / "cutout.webp"
            result = self.processor.process(normalized_path, cutout_temp)
            if not result.created:
                error_code = result.error_code or "background_processing_failed"
                if error_code == "background_processing_failed":
                    self._retry_or_fallback(item_id, error_code)
                else:
                    self._finish(
                        item_id,
                        success=False,
                        error_code=error_code,
                    )
                return
            _validate_cutout_output(cutout_temp, result, settings=self.settings)
            assert result.width is not None
            assert result.height is not None
            assert result.byte_size is not None
            assert result.content_sha256 is not None
            filename = self.storage.generate_internal_filename(".webp")
            promoted_path = self.storage.media_relative_path(
                self.settings.cutout_image_root / filename
            )
            self.storage.write_import_manifest(
                attempt_id,
                {
                    "version": 1,
                    "attempt_id": attempt_id,
                    "phase": "background_processing",
                    "final_paths": [promoted_path],
                    "clothing_item_id": item_id,
                },
            )
            self.storage.atomic_promote(
                temp_relative_path=f"{attempt_id}/cutout.webp",
                final_relative_path=promoted_path,
            )
            with self.database.session() as session, session.begin():
                item = session.scalar(
                    select(ClothingItem)
                    .where(ClothingItem.id == item_id, ClothingItem.deleted_at.is_(None))
                    .options(selectinload(ClothingItem.images))
                )
                if item is None:
                    raise ValueError("garment disappeared during processing")
                for image in item.images:
                    image.is_primary = False
                item.images.append(
                    ClothingImage(
                        image_kind=ImageKind.CUTOUT.value,
                        relative_path=promoted_path,
                        mime_type="image/webp",
                        width=result.width,
                        height=result.height,
                        byte_size=result.byte_size,
                        is_primary=True,
                        content_sha256=result.content_sha256,
                        image_group_id=image_group_id,
                        display_order=display_order,
                    )
                )
                item.image_processing_state = ImageProcessingState.COMPLETED.value
                item.processing_error_code = None
                item.processing_completed_at = utc_now()
                item.processing_started_at = None
                item.updated_at = utc_now()
        except Exception:
            logger.exception("Background processing failed for clothing item %s", item_id)
            retry_allowed = True
            if promoted_path is not None:
                registration = self._registration_status(promoted_path)
                if registration is True:
                    retry_allowed = False
                    logger.warning(
                        "Retaining a cutout registered before an ambiguous database error"
                    )
                elif registration is None:
                    retry_allowed = False
                    preserve_attempt = True
                else:
                    try:
                        self.storage.delete_owned_media(promoted_path)
                    except Exception:
                        retry_allowed = False
                        preserve_attempt = True
                        logger.exception("Could not compensate an unregistered cutout")
            if retry_allowed:
                self._retry_or_fallback(item_id, "background_processing_failed")
        finally:
            if not preserve_attempt:
                try:
                    self.storage.delete_temporary_tree(attempt_id)
                except StorageOperationError:
                    logger.exception("Could not clean a background-processing temporary directory")

    def _retry_or_fallback(self, item_id: int, error_code: str) -> None:
        try:
            with self.database.session() as session, session.begin():
                item = session.get(ClothingItem, item_id)
                if item is None:
                    return
                terminal = (
                    item.processing_attempts >= self.settings.background_processing_max_attempts
                )
                item.image_processing_state = (
                    ImageProcessingState.COMPLETED_WITH_FALLBACK.value
                    if terminal
                    else ImageProcessingState.PENDING.value
                )
                item.processing_error_code = error_code
                item.processing_started_at = None
                item.processing_completed_at = utc_now() if terminal else None
            self.notify()
        except SQLAlchemyError:
            logger.exception("Could not persist a background-processing retry")

    def _registration_status(self, relative_path: str) -> bool | None:
        try:
            with self.database.session() as session:
                return (
                    session.scalar(
                        select(ClothingImage.id).where(ClothingImage.relative_path == relative_path)
                    )
                    is not None
                )
        except SQLAlchemyError:
            logger.exception("Cutout compensation deferred because media ownership is ambiguous")
            return None

    def _finish(self, item_id: int, *, success: bool, error_code: str | None) -> None:
        del success
        try:
            with self.database.session() as session, session.begin():
                item = session.get(ClothingItem, item_id)
                if item is None:
                    return
                item.image_processing_state = ImageProcessingState.COMPLETED_WITH_FALLBACK.value
                item.processing_error_code = error_code
                item.processing_started_at = None
                item.processing_completed_at = utc_now()
        except SQLAlchemyError:
            logger.exception("Could not persist background fallback state")
