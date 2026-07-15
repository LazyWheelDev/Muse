from datetime import datetime

from pydantic import Field

from muse_backend.domain.enums import PhoneUploadListenerStatus, PhoneUploadSessionStatus
from muse_backend.schemas.common import ApiSchema, TimestampedSchema


class PhoneUploadSessionRead(TimestampedSchema):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    status: PhoneUploadSessionStatus
    expires_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    failed_at: datetime | None
    clothing_item_id: int | None
    error_code: str | None
    attempt_count: int = Field(ge=0)


class PhoneUploadDeviceSession(PhoneUploadSessionRead):
    listener_status: PhoneUploadListenerStatus


class PhoneUploadSessionCreated(PhoneUploadDeviceSession):
    upload_url: str
    qr_payload: str
    fallback_upload_url: str | None = None


class PhoneUploadPublicStatus(ApiSchema):
    status: PhoneUploadSessionStatus
    expires_at: datetime
    can_upload: bool
    can_retry: bool
    error_code: str | None


class PhoneUploadCompleted(ApiSchema):
    status: PhoneUploadSessionStatus
    clothing_item_id: int = Field(gt=0)
