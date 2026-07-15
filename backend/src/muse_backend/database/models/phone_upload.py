from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from muse_backend.database.base import Base, TimestampMixin, UTCDateTime
from muse_backend.domain.enums import PhoneUploadSessionStatus


class PhoneUploadSession(TimestampMixin, Base):
    __tablename__ = "phone_upload_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'opened', 'uploading', 'processing', "
            "'completed', 'failed', 'cancelled', 'expired')",
            name="status_supported",
        ),
        CheckConstraint(
            "length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'",
            name="id_lower_hex",
        ),
        CheckConstraint(
            "length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'",
            name="token_hash_lower_hex",
        ),
        CheckConstraint("attempt_count >= 0", name="attempt_count_nonnegative"),
        Index("ix_phone_upload_sessions_expiry", "status", "expires_at"),
        Index("ix_phone_upload_sessions_retention", "status", "updated_at"),
        Index(
            "uq_phone_upload_sessions_clothing_item_id",
            "clothing_item_id",
            unique=True,
            sqlite_where=text("clothing_item_id IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=PhoneUploadSessionStatus.PENDING.value,
        server_default=PhoneUploadSessionStatus.PENDING.value,
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    clothing_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("clothing_items.id", ondelete="RESTRICT"), nullable=True
    )
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
