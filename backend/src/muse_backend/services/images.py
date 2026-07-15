from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from muse_backend.database.models import ClothingImage
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    ResourceNotFoundError,
)
from muse_backend.repositories.clothing import ClothingRepository
from muse_backend.schemas.clothing import ClothingImageRead, ClothingImageRegistration
from muse_backend.services.presenters import clothing_image_read
from muse_backend.storage.local import LocalStorageService


class ClothingImageService:
    """Registers backend-owned image files; this is intentionally not a public upload API."""

    def __init__(self, session: Session, storage: LocalStorageService) -> None:
        self.session = session
        self.storage = storage
        self.repository = ClothingRepository(session)

    def register(self, payload: ClothingImageRegistration) -> ClothingImageRead:
        path = self.storage.validate_image_location(payload.relative_path, payload.image_kind)
        if path.is_symlink() or not path.is_file():
            raise DomainValidationError(
                code="media_file_not_found",
                message="The local media file is not available for registration.",
            )
        if path.stat().st_size != payload.byte_size:
            raise DomainValidationError(
                code="media_metadata_mismatch",
                message="The local media metadata does not match the stored file.",
            )

        image = ClothingImage(
            clothing_item_id=payload.clothing_item_id,
            image_kind=payload.image_kind.value,
            relative_path=payload.relative_path,
            mime_type=payload.mime_type,
            width=payload.width,
            height=payload.height,
            byte_size=payload.byte_size,
            is_primary=payload.is_primary,
            content_sha256=payload.content_sha256,
            image_group_id=payload.image_group_id,
            display_order=payload.display_order,
        )
        try:
            with self.session.begin():
                clothing = self.repository.get_active(payload.clothing_item_id)
                if clothing is None:
                    raise ResourceNotFoundError(
                        code="clothing_item_not_found",
                        message="The requested clothing item was not found.",
                    )
                if payload.is_primary and any(existing.is_primary for existing in clothing.images):
                    raise ResourceConflictError(
                        code="primary_image_conflict",
                        message="This clothing item already has a primary image.",
                    )
                self.session.add(image)
                self.session.flush()
        except IntegrityError as error:
            raise ResourceConflictError(
                code="image_registration_conflict",
                message="The local image could not be registered because it already exists.",
            ) from error
        return clothing_image_read(image)
