import json
import logging
import os
import re
import stat
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.database.models import ClothingImage, ClothingItem, Outfit, OutfitItem
from muse_backend.domain.enums import ImageKind
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceNotFoundError,
    StorageOperationError,
)
from muse_backend.repositories.clothing import ClothingRepository
from muse_backend.repositories.outfits import OutfitRepository
from muse_backend.schemas.outfit import OutfitCreate, OutfitDetail, OutfitItemWrite, OutfitUpdate
from muse_backend.services.outfit_preview_renderer import (
    OutfitPreviewPlacement,
    PreviewImageCandidate,
    render_outfit_preview,
)
from muse_backend.services.outfits import OutfitService
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)
_ATTEMPT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_MANIFEST_LIMIT_BYTES = 64 * 1024
_DISPLAY_IMAGE_KINDS = (ImageKind.CUTOUT, ImageKind.NORMALIZED, ImageKind.ORIGINAL)


@dataclass(frozen=True, slots=True)
class _UpdateSnapshot:
    placements: tuple[OutfitPreviewPlacement, ...]
    updated_at: datetime
    preview_image_path: str | None
    placements_changed: bool


@dataclass(slots=True)
class _PreparedPreview:
    attempt_id: str
    final_relative_path: str
    obsolete_relative_path: str | None
    manifest: dict[str, object]


class OutfitPreviewCoordinator:
    """Coordinate deterministic preview files with short outfit transactions."""

    def __init__(
        self,
        *,
        settings: Settings,
        storage: LocalStorageService,
        database: Database,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.database = database

    def create(self, payload: OutfitCreate) -> OutfitDetail:
        placements = self._create_placements(payload.items)
        prepared = self._prepare_preview(placements, obsolete_relative_path=None)
        try:
            with self.database.session() as session:
                detail = OutfitService(session).create(
                    payload,
                    preview_image_path=prepared.final_relative_path,
                )
        except Exception:
            self._compensate_and_clean(prepared)
            raise

        self._finish_committed(prepared, outfit_id=detail.id)
        return detail

    def update(self, outfit_id: int, payload: OutfitUpdate) -> OutfitDetail:
        snapshot = self._update_snapshot(outfit_id, payload)
        if "items" not in payload.model_fields_set:
            with self.database.session() as session:
                return OutfitService(session).update(outfit_id, payload)
        if not snapshot.placements_changed:
            with self.database.session() as session:
                return OutfitService(session).update(
                    outfit_id,
                    payload,
                    expected_updated_at=snapshot.updated_at,
                )

        prepared = self._prepare_preview(
            snapshot.placements,
            obsolete_relative_path=snapshot.preview_image_path,
        )
        try:
            with self.database.session() as session:
                detail = OutfitService(session).update(
                    outfit_id,
                    payload,
                    preview_image_path=prepared.final_relative_path,
                    expected_updated_at=snapshot.updated_at,
                )
        except Exception:
            self._compensate_and_clean(prepared)
            raise

        self._finish_committed(prepared, outfit_id=detail.id)
        return detail

    def _create_placements(
        self,
        item_payloads: Collection[OutfitItemWrite],
    ) -> tuple[OutfitPreviewPlacement, ...]:
        requested_ids = {item.clothing_item_id for item in item_payloads}
        with self.database.session() as session:
            clothing = ClothingRepository(session).get_many_any(requested_ids)
            _validate_clothing_references(
                requested_ids=requested_ids,
                clothing=clothing,
                retained_ids=frozenset(),
            )
            return tuple(
                self._preview_placement(item_payload, clothing[item_payload.clothing_item_id])
                for item_payload in item_payloads
            )

    def _update_snapshot(self, outfit_id: int, payload: OutfitUpdate) -> _UpdateSnapshot:
        with self.database.session() as session:
            outfit = OutfitRepository(session).get_active(outfit_id)
            if outfit is None:
                raise _outfit_not_found()
            if "items" not in payload.model_fields_set:
                return _UpdateSnapshot(
                    placements=(),
                    updated_at=outfit.updated_at,
                    preview_image_path=outfit.preview_image_path,
                    placements_changed=False,
                )

            item_payloads = payload.items
            if item_payloads is None:  # Rejected by OutfitUpdate; retained for type narrowing.
                raise DomainValidationError(
                    code="invalid_outfit_items",
                    message="Outfit items must be supplied as a non-empty collection.",
                )
            requested_ids = {item.clothing_item_id for item in item_payloads}
            retained_ids = frozenset(item.clothing_item_id for item in outfit.items)
            clothing = ClothingRepository(session).get_many_any(requested_ids)
            _validate_clothing_references(
                requested_ids=requested_ids,
                clothing=clothing,
                retained_ids=retained_ids,
            )
            return _UpdateSnapshot(
                placements=tuple(
                    self._preview_placement(item_payload, clothing[item_payload.clothing_item_id])
                    for item_payload in item_payloads
                ),
                updated_at=outfit.updated_at,
                preview_image_path=outfit.preview_image_path,
                placements_changed=not _placements_match(outfit.items, item_payloads),
            )

    def _preview_placement(
        self,
        payload: OutfitItemWrite,
        clothing: ClothingItem,
    ) -> OutfitPreviewPlacement:
        return OutfitPreviewPlacement(
            clothing_item_id=clothing.id,
            body_zone=payload.body_zone,
            position_x=payload.position_x,
            position_y=payload.position_y,
            scale=payload.scale,
            rotation=payload.rotation,
            layer_index=payload.layer_index,
            candidates=self._image_candidates(clothing.images),
        )

    def _image_candidates(
        self,
        images: Collection[ClothingImage],
    ) -> tuple[PreviewImageCandidate, ...]:
        if not images:
            return ()
        primary = next((image for image in images if image.is_primary), None)
        if primary is None:
            first = min(images, key=lambda image: (image.display_order, image.created_at, image.id))
            group_id = first.image_group_id
        else:
            group_id = primary.image_group_id
        grouped = [image for image in images if image.image_group_id == group_id]
        candidates: list[PreviewImageCandidate] = []
        for kind in _DISPLAY_IMAGE_KINDS:
            image = next((image for image in grouped if image.image_kind == kind.value), None)
            if image is None:
                continue
            try:
                path = self.storage.validate_image_location(image.relative_path, kind)
            except DomainValidationError:
                logger.warning(
                    "Skipping invalid garment media while rendering outfit preview: %s",
                    image.relative_path,
                )
                continue
            candidates.append(PreviewImageCandidate(path=path, kind=kind))
        return tuple(candidates)

    def _prepare_preview(
        self,
        placements: tuple[OutfitPreviewPlacement, ...],
        *,
        obsolete_relative_path: str | None,
    ) -> _PreparedPreview:
        attempt_id = uuid4().hex
        final_name = self.storage.generate_internal_filename(".webp")
        final_relative_path = self.storage.media_relative_path(
            self.settings.outfit_preview_root / final_name
        )
        manifest: dict[str, object] = {
            "version": 1,
            "operation": "outfit_preview",
            "attempt_id": attempt_id,
            "phase": "prepared",
            "final_paths": [final_relative_path],
            "obsolete_paths": (
                [obsolete_relative_path] if obsolete_relative_path is not None else []
            ),
        }
        prepared = _PreparedPreview(
            attempt_id=attempt_id,
            final_relative_path=final_relative_path,
            obsolete_relative_path=obsolete_relative_path,
            manifest=manifest,
        )
        try:
            attempt_directory = self.storage.create_preview_attempt(attempt_id)
            self.storage.write_preview_manifest(attempt_id, manifest)
            render_outfit_preview(placements, attempt_directory / "preview.webp")
            self.storage.atomic_promote_preview(
                temp_relative_path=f"{attempt_id}/preview.webp",
                final_relative_path=final_relative_path,
            )
            manifest["phase"] = "promoted"
            self.storage.write_preview_manifest(attempt_id, manifest)
        except Exception as error:
            self._compensate_and_clean(prepared)
            if isinstance(error, StorageOperationError):
                raise
            logger.exception("Could not generate a local outfit preview")
            raise StorageOperationError from error
        return prepared

    def _finish_committed(self, prepared: _PreparedPreview, *, outfit_id: int) -> None:
        prepared.manifest["phase"] = "committed"
        prepared.manifest["outfit_id"] = outfit_id
        try:
            self.storage.write_preview_manifest(prepared.attempt_id, prepared.manifest)
        except StorageOperationError:
            logger.exception("A committed outfit preview could not update its manifest")

        cleanup_complete = True
        obsolete = prepared.obsolete_relative_path
        if obsolete is not None and obsolete != prepared.final_relative_path:
            cleanup_complete = self._delete_if_unregistered((obsolete,))
        if cleanup_complete:
            self._clean_attempt(prepared.attempt_id)

    def _compensate_and_clean(self, prepared: _PreparedPreview) -> None:
        if self._delete_if_unregistered((prepared.final_relative_path,)):
            self._clean_attempt(prepared.attempt_id)

    def _delete_if_unregistered(self, paths: Collection[str]) -> bool:
        try:
            with self.database.session() as session:
                registered = set(
                    session.scalars(
                        select(Outfit.preview_image_path).where(
                            Outfit.preview_image_path.in_(paths)
                        )
                    )
                )
        except SQLAlchemyError:
            logger.exception("Preview cleanup deferred because database ownership is ambiguous")
            return False

        complete = True
        for relative_path in paths:
            if relative_path in registered:
                continue
            try:
                self.storage.validate_outfit_preview_location(relative_path)
                self.storage.delete_owned_media(relative_path)
            except (DomainValidationError, StorageOperationError):
                complete = False
                logger.exception("Outfit preview cleanup will be retried during startup")
        return complete

    def _clean_attempt(self, attempt_id: str) -> None:
        try:
            self.storage.delete_preview_temporary_tree(attempt_id)
        except StorageOperationError:
            logger.exception("A stale outfit preview attempt remains for startup reconciliation")


def _validate_clothing_references(
    *,
    requested_ids: Collection[int],
    clothing: dict[int, ClothingItem],
    retained_ids: Collection[int],
) -> None:
    missing_ids = sorted(set(requested_ids) - clothing.keys())
    invalid_deleted_ids = sorted(
        item_id
        for item_id, garment in clothing.items()
        if garment.deleted_at is not None and item_id not in retained_ids
    )
    if missing_ids or invalid_deleted_ids:
        raise DomainValidationError(
            code="invalid_clothing_reference",
            message="One or more clothing items cannot be used in this outfit.",
            details={"missing_ids": missing_ids, "deleted_ids": invalid_deleted_ids},
        )


def _placements_match(
    persisted: Collection[OutfitItem],
    requested: Collection[OutfitItemWrite],
) -> bool:
    persisted_values = sorted(
        (
            item.clothing_item_id,
            item.body_zone,
            item.position_x,
            item.position_y,
            item.scale,
            item.rotation,
            item.layer_index,
        )
        for item in persisted
    )
    requested_values = sorted(
        (
            item.clothing_item_id,
            item.body_zone.value,
            item.position_x,
            item.position_y,
            item.scale,
            item.rotation,
            item.layer_index,
        )
        for item in requested
    )
    return persisted_values == requested_values


def _outfit_not_found() -> ResourceNotFoundError:
    return ResourceNotFoundError(
        code="outfit_not_found",
        message="The requested outfit was not found.",
    )


def _read_manifest(manifest_path: Path) -> dict[str, object] | None:
    try:
        descriptor = os.open(
            manifest_path,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
        )
        with os.fdopen(descriptor, "rb") as handle:
            metadata = os.fstat(handle.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _MANIFEST_LIMIT_BYTES:
                raise ValueError("manifest is not a bounded regular file")
            encoded = handle.read(_MANIFEST_LIMIT_BYTES + 1)
        if len(encoded) > _MANIFEST_LIMIT_BYTES:
            raise ValueError("manifest exceeds the reconciliation limit")
        payload = json.loads(encoded.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("manifest root must be an object")
        if payload.get("operation") != "outfit_preview":
            raise ValueError("manifest operation is invalid")
        return payload
    except (OSError, UnicodeDecodeError, ValueError):
        logger.warning("Discarding a malformed temporary outfit preview manifest")
        return None


def _manifest_paths(payload: dict[str, object], key: str) -> tuple[str, ...]:
    value = payload.get(key, [])
    if not isinstance(value, list) or not all(isinstance(path, str) for path in value):
        return ()
    return tuple(value)


def reconcile_outfit_previews(
    *,
    settings: Settings,
    storage: LocalStorageService,
    database: Database,
) -> None:
    """Reconcile preview staging and generated files using all outfit rows as authority."""

    try:
        with database.session() as session:
            registered_paths = {
                path
                for path in session.scalars(
                    select(Outfit.preview_image_path).where(Outfit.preview_image_path.is_not(None))
                )
                if path is not None
            }
    except SQLAlchemyError:
        logger.warning("Skipping outfit preview reconciliation until the migration is current")
        return

    try:
        attempts = list(settings.temp_preview_root.iterdir())
    except OSError:
        logger.exception("Could not enumerate temporary outfit previews during reconciliation")
        attempts = []
    for attempt in attempts:
        if (
            not attempt.is_dir()
            or attempt.is_symlink()
            or _ATTEMPT_ID_PATTERN.fullmatch(attempt.name) is None
        ):
            continue
        payload = _read_manifest(attempt / "manifest.json")
        cleanup_complete = True
        if payload is not None:
            candidates = (
                *_manifest_paths(payload, "final_paths"),
                *_manifest_paths(payload, "obsolete_paths"),
            )
            for relative_path in candidates:
                if relative_path in registered_paths:
                    continue
                try:
                    storage.validate_outfit_preview_location(relative_path)
                    storage.delete_owned_media(relative_path)
                except DomainValidationError:
                    logger.warning(
                        "Temporary outfit preview manifest contains an invalid path: %s",
                        relative_path,
                    )
                except StorageOperationError:
                    cleanup_complete = False
                    logger.exception("Could not reconcile an unregistered outfit preview")
        if not cleanup_complete:
            continue
        try:
            storage.delete_preview_temporary_tree(attempt.name)
        except StorageOperationError:
            logger.exception("Could not remove a stale temporary outfit preview directory")

    for relative_path in registered_paths:
        try:
            candidate = storage.validate_outfit_preview_location(relative_path)
            if candidate.is_symlink() or not candidate.is_file():
                logger.warning("Registered outfit preview is missing: %s", relative_path)
        except (OSError, DomainValidationError):
            logger.warning("Registered outfit preview has an invalid local path: %s", relative_path)

    try:
        preview_files = list(settings.outfit_preview_root.iterdir())
    except OSError:
        logger.warning("Could not inspect generated outfit preview directory")
        return
    for preview_file in preview_files:
        if not preview_file.is_file() and not preview_file.is_symlink():
            continue
        try:
            relative_path = storage.media_relative_path(preview_file)
            storage.validate_outfit_preview_location(relative_path)
        except (OSError, DomainValidationError):
            logger.warning("Generated outfit preview has an invalid local path: %s", preview_file)
            continue
        if relative_path in registered_paths:
            continue
        try:
            storage.delete_owned_media(relative_path)
        except (DomainValidationError, StorageOperationError):
            logger.exception("Could not remove an unregistered generated outfit preview")
