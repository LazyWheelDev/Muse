import logging
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import selectinload

from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.database.models import ClothingImage, ClothingItem
from muse_backend.domain.enums import ImageKind, ImageProcessingState, default_body_zone_for
from muse_backend.domain.exceptions import ResourceConflictError, StorageOperationError
from muse_backend.schemas.clothing import ClothingItemCreate, ClothingItemDetail
from muse_backend.services.image_processing import ProcessedUpload, validate_and_process_upload
from muse_backend.services.multipart_import import ParsedImportUpload
from muse_backend.services.presenters import clothing_detail
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ImportResult:
    item: ClothingItemDetail
    replayed: bool


class GarmentImportService:
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

    def import_item(
        self,
        parsed: ParsedImportUpload,
        metadata: ClothingItemCreate,
        *,
        idempotency_key: str | None,
    ) -> ImportResult:
        existing = self._existing_idempotent_item(idempotency_key)
        if existing is not None:
            self._clean_attempt(parsed.attempt_relative_path)
            return ImportResult(item=existing, replayed=True)

        try:
            processed = validate_and_process_upload(
                parsed.image_path,
                filename=parsed.original_filename,
                declared_mime_type=parsed.declared_mime_type,
                settings=self.settings,
            )
        except Exception:
            self._clean_attempt(parsed.attempt_relative_path)
            raise
        if processed.validated.byte_size != parsed.byte_size or (
            processed.validated.content_sha256 != parsed.content_sha256
        ):
            self._clean_attempt(parsed.attempt_relative_path)
            raise StorageOperationError()

        image_group_id = uuid4().hex
        original_name = self.storage.generate_internal_filename(processed.validated.extension)
        normalized_name = self.storage.generate_internal_filename(".webp")
        thumbnail_name = self.storage.generate_internal_filename(".webp")
        final_paths = {
            ImageKind.ORIGINAL: self.storage.media_relative_path(
                self.settings.original_image_root / original_name
            ),
            ImageKind.NORMALIZED: self.storage.media_relative_path(
                self.settings.processed_image_root / normalized_name
            ),
            ImageKind.THUMBNAIL: self.storage.media_relative_path(
                self.settings.thumbnail_root / thumbnail_name
            ),
        }
        manifest: dict[str, object] = {
            "version": 1,
            "attempt_id": parsed.attempt_id,
            "phase": "prepared",
            "idempotency_key": idempotency_key,
            "content_sha256": processed.validated.content_sha256,
            "final_paths": [final_paths[kind] for kind in final_paths],
        }
        try:
            self.storage.write_import_manifest(parsed.attempt_id, manifest)
        except Exception:
            self._clean_attempt(parsed.attempt_relative_path)
            raise

        promoted: list[str] = []
        try:
            promotions = (
                (
                    f"{parsed.attempt_relative_path}/upload.bin",
                    final_paths[ImageKind.ORIGINAL],
                ),
                (
                    f"{parsed.attempt_relative_path}/normalized.webp",
                    final_paths[ImageKind.NORMALIZED],
                ),
                (
                    f"{parsed.attempt_relative_path}/thumbnail.webp",
                    final_paths[ImageKind.THUMBNAIL],
                ),
            )
            for temp_path, final_path in promotions:
                self.storage.atomic_promote(
                    temp_relative_path=temp_path,
                    final_relative_path=final_path,
                )
                promoted.append(final_path)
                manifest["phase"] = "promoting"
                manifest["promoted_paths"] = promoted.copy()
                self.storage.write_import_manifest(parsed.attempt_id, manifest)

            item = self._persist(
                metadata,
                processed,
                final_paths=final_paths,
                image_group_id=image_group_id,
                idempotency_key=idempotency_key,
            )
        except IntegrityError as error:
            compensated = self._compensate(promoted)
            if compensated:
                self._clean_attempt(parsed.attempt_relative_path)
            existing = self._existing_idempotent_item(idempotency_key)
            if existing is not None:
                return ImportResult(item=existing, replayed=True)
            raise ResourceConflictError(
                code="clothing_import_conflict",
                message="Muse could not register this garment import because it conflicts locally.",
            ) from error
        except Exception:
            if self._compensate(promoted):
                self._clean_attempt(parsed.attempt_relative_path)
            raise

        # The database now owns the promoted files. A manifest update or cleanup
        # failure after this point must never compensate valid committed media.
        manifest["phase"] = "committed"
        manifest["clothing_item_id"] = item.id
        try:
            self.storage.write_import_manifest(parsed.attempt_id, manifest)
        except StorageOperationError:
            logger.exception("A committed import could not update its reconciliation manifest")
        self._clean_attempt(parsed.attempt_relative_path)
        return ImportResult(item=item, replayed=False)

    def _persist(
        self,
        metadata: ClothingItemCreate,
        processed: ProcessedUpload,
        *,
        final_paths: dict[ImageKind, str],
        image_group_id: str,
        idempotency_key: str | None,
    ) -> ClothingItemDetail:
        zone = metadata.default_body_zone
        if "default_body_zone" not in metadata.model_fields_set:
            zone = default_body_zone_for(metadata.garment_category)
        state = (
            ImageProcessingState.PENDING
            if self.settings.background_processing_enabled
            else ImageProcessingState.COMPLETED_WITH_FALLBACK
        )
        item = ClothingItem(
            name=metadata.name,
            garment_category=metadata.garment_category.value,
            default_body_zone=zone.value if zone is not None else None,
            brand=metadata.brand,
            size=metadata.size,
            color_name=metadata.color_name,
            material=metadata.material,
            season=metadata.season,
            purchase_price=metadata.purchase_price,
            purchase_currency=metadata.purchase_currency,
            purchase_date=metadata.purchase_date,
            notes=metadata.notes,
            image_processing_state=state.value,
            processing_error_code=(
                None
                if self.settings.background_processing_enabled
                else "background_processing_disabled"
            ),
            import_idempotency_key=idempotency_key,
        )
        item.images.extend(
            (
                ClothingImage(
                    image_kind=ImageKind.ORIGINAL.value,
                    relative_path=final_paths[ImageKind.ORIGINAL],
                    mime_type=processed.validated.mime_type,
                    width=processed.validated.encoded_width,
                    height=processed.validated.encoded_height,
                    byte_size=processed.validated.byte_size,
                    is_primary=False,
                    content_sha256=processed.validated.content_sha256,
                    image_group_id=image_group_id,
                    display_order=0,
                ),
                ClothingImage(
                    image_kind=ImageKind.NORMALIZED.value,
                    relative_path=final_paths[ImageKind.NORMALIZED],
                    mime_type=processed.normalized.mime_type,
                    width=processed.normalized.width,
                    height=processed.normalized.height,
                    byte_size=processed.normalized.byte_size,
                    is_primary=True,
                    content_sha256=processed.normalized.content_sha256,
                    image_group_id=image_group_id,
                    display_order=0,
                ),
                ClothingImage(
                    image_kind=ImageKind.THUMBNAIL.value,
                    relative_path=final_paths[ImageKind.THUMBNAIL],
                    mime_type=processed.thumbnail.mime_type,
                    width=processed.thumbnail.width,
                    height=processed.thumbnail.height,
                    byte_size=processed.thumbnail.byte_size,
                    is_primary=False,
                    content_sha256=processed.thumbnail.content_sha256,
                    image_group_id=image_group_id,
                    display_order=0,
                ),
            )
        )
        with self.database.session() as session, session.begin():
            session.add(item)
            session.flush()
            detail = clothing_detail(item)
        return detail

    def _existing_idempotent_item(self, key: str | None) -> ClothingItemDetail | None:
        if key is None:
            return None
        with self.database.session() as session:
            statement = (
                select(ClothingItem)
                .where(
                    ClothingItem.import_idempotency_key == key,
                    ClothingItem.deleted_at.is_(None),
                )
                .options(selectinload(ClothingItem.images))
            )
            item = session.scalar(statement)
            return clothing_detail(item) if item is not None else None

    def _compensate(self, promoted: list[str]) -> bool:
        try:
            with self.database.session() as session:
                registered_paths = set(
                    session.scalars(
                        select(ClothingImage.relative_path).where(
                            ClothingImage.relative_path.in_(promoted)
                        )
                    )
                )
        except SQLAlchemyError:
            logger.exception("Import compensation deferred because media ownership is ambiguous")
            return False
        all_removed = True
        for relative_path in reversed(promoted):
            if relative_path in registered_paths:
                logger.warning(
                    "Retaining promoted media already registered by a committed import: %s",
                    relative_path,
                )
                continue
            try:
                self.storage.delete_owned_media(relative_path)
            except StorageOperationError:
                all_removed = False
                logger.exception(
                    "Import compensation will be retried during startup reconciliation"
                )
        return all_removed

    def _clean_attempt(self, attempt_relative_path: str) -> None:
        try:
            self.storage.delete_temporary_tree(attempt_relative_path)
        except StorageOperationError:
            logger.exception(
                "A committed import left a stale temporary manifest for reconciliation"
            )
