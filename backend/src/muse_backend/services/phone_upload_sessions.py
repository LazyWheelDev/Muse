import base64
import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Never, cast

from sqlalchemy import delete, func, literal, select, update
from sqlalchemy.engine import CursorResult

from muse_backend.config import Settings
from muse_backend.database.base import utc_now
from muse_backend.database.engine import Database
from muse_backend.database.models import ClothingItem, PhoneUploadSession
from muse_backend.domain.enums import PhoneUploadSessionStatus
from muse_backend.domain.exceptions import MuseError, ResourceConflictError, ResourceNotFoundError
from muse_backend.schemas.phone_upload import PhoneUploadPublicStatus, PhoneUploadSessionRead

_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_SAFE_ERROR_PATTERN = re.compile(r"^[a-z0-9_]{1,64}$")
_OPEN_UPLOAD_STATES = (
    PhoneUploadSessionStatus.PENDING.value,
    PhoneUploadSessionStatus.OPENED.value,
    PhoneUploadSessionStatus.FAILED.value,
)
_TERMINAL_RETENTION_STATES = (
    PhoneUploadSessionStatus.COMPLETED.value,
    PhoneUploadSessionStatus.CANCELLED.value,
    PhoneUploadSessionStatus.EXPIRED.value,
)
_RECOVERABLE_COMMITTED_STATES = (
    PhoneUploadSessionStatus.UPLOADING.value,
    PhoneUploadSessionStatus.PROCESSING.value,
    PhoneUploadSessionStatus.FAILED.value,
    PhoneUploadSessionStatus.CANCELLED.value,
    PhoneUploadSessionStatus.EXPIRED.value,
)
_INTERRUPTED_UPLOAD_STATES = (
    PhoneUploadSessionStatus.UPLOADING.value,
    PhoneUploadSessionStatus.PROCESSING.value,
)


@dataclass(frozen=True, slots=True)
class CreatedPhoneUploadSession:
    session: PhoneUploadSessionRead
    raw_token: str


def phone_upload_idempotency_key(session_id: str) -> str:
    return f"phone-upload:{session_id}"


def _generate_token() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def _hash_token(raw_token: str) -> str:
    if _TOKEN_PATTERN.fullmatch(raw_token) is None:
        raise ResourceNotFoundError(
            code="phone_upload_session_invalid",
            message="This phone upload session is unavailable.",
        )
    return hashlib.sha256(raw_token.encode("ascii")).hexdigest()


def _safe_error_code(error_code: str) -> str:
    return error_code if _SAFE_ERROR_PATTERN.fullmatch(error_code) else "phone_upload_failed"


class PhoneUploadSessionService:
    def __init__(self, *, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings

    def create(self, *, now: datetime | None = None) -> CreatedPhoneUploadSession:
        created_at = now or utc_now()
        raw_token = _generate_token()
        model = PhoneUploadSession(
            id=secrets.token_hex(16),
            token_hash=hashlib.sha256(raw_token.encode("ascii")).hexdigest(),
            status=PhoneUploadSessionStatus.PENDING.value,
            expires_at=created_at
            + timedelta(seconds=self.settings.phone_upload_session_ttl_seconds),
        )
        with self.database.session() as session, session.begin():
            session.add(model)
            session.flush()
        return CreatedPhoneUploadSession(
            session=PhoneUploadSessionRead.model_validate(model),
            raw_token=raw_token,
        )

    def get_device(self, session_id: str, *, now: datetime | None = None) -> PhoneUploadSessionRead:
        checked_at = now or utc_now()
        with self.database.session() as session, session.begin():
            model = session.get(PhoneUploadSession, session_id)
            if model is None:
                raise ResourceNotFoundError(
                    code="phone_upload_session_not_found",
                    message="The requested phone upload session was not found.",
                )
            self._expire_if_needed(model, checked_at)
            session.flush()
            return PhoneUploadSessionRead.model_validate(model)

    def open_with_token(
        self, raw_token: str, *, now: datetime | None = None
    ) -> PhoneUploadPublicStatus:
        checked_at = now or utc_now()
        token_hash = _hash_token(raw_token)
        with self.database.session() as session, session.begin():
            model = session.scalar(
                select(PhoneUploadSession).where(PhoneUploadSession.token_hash == token_hash)
            )
            if model is None:
                self._raise_invalid_token()
            self._expire_if_needed(model, checked_at)
            if model.status == PhoneUploadSessionStatus.PENDING.value:
                model.status = PhoneUploadSessionStatus.OPENED.value
                model.updated_at = checked_at
            session.flush()
            return self._public_status(model)

    def claim_upload(self, raw_token: str, *, now: datetime | None = None) -> str:
        claimed_at = now or utc_now()
        token_hash = _hash_token(raw_token)
        with self.database.session() as session, session.begin():
            claimed_id = session.scalar(
                update(PhoneUploadSession)
                .where(
                    PhoneUploadSession.token_hash == token_hash,
                    PhoneUploadSession.status.in_(_OPEN_UPLOAD_STATES),
                    PhoneUploadSession.expires_at > claimed_at,
                    PhoneUploadSession.attempt_count < self.settings.phone_upload_max_attempts,
                )
                .values(
                    status=PhoneUploadSessionStatus.UPLOADING.value,
                    started_at=func.coalesce(PhoneUploadSession.started_at, claimed_at),
                    failed_at=None,
                    error_code=None,
                    attempt_count=PhoneUploadSession.attempt_count + 1,
                    updated_at=claimed_at,
                )
                .returning(PhoneUploadSession.id)
            )
            if claimed_id is not None:
                return str(claimed_id)

            model = session.scalar(
                select(PhoneUploadSession).where(PhoneUploadSession.token_hash == token_hash)
            )
            if model is None:
                self._raise_invalid_token()
            self._expire_if_needed(model, claimed_at)
            session.flush()
            self._raise_unusable(model)
        raise AssertionError("unreachable phone upload claim")

    def mark_processing(self, session_id: str, *, now: datetime | None = None) -> None:
        changed_at = now or utc_now()
        with self.database.session() as session, session.begin():
            changed = cast(
                CursorResult[Any],
                session.execute(
                    update(PhoneUploadSession)
                    .where(
                        PhoneUploadSession.id == session_id,
                        PhoneUploadSession.status == PhoneUploadSessionStatus.UPLOADING.value,
                    )
                    .values(
                        status=PhoneUploadSessionStatus.PROCESSING.value,
                        updated_at=changed_at,
                    )
                ),
            ).rowcount
            if changed != 1:
                model = session.get(PhoneUploadSession, session_id)
                if model is None:
                    self._raise_invalid_token()
                self._raise_unusable(model)

    def complete(
        self,
        session_id: str,
        clothing_item_id: int,
        *,
        now: datetime | None = None,
    ) -> PhoneUploadSessionRead:
        completed_at = now or utc_now()
        with self.database.session() as session, session.begin():
            model = session.get(PhoneUploadSession, session_id)
            if model is None:
                self._raise_invalid_token()
            if model.clothing_item_id not in {None, clothing_item_id}:
                raise ResourceConflictError(
                    code="phone_upload_session_conflict",
                    message="This phone upload session already owns another garment.",
                )
            if model.status == PhoneUploadSessionStatus.COMPLETED.value:
                return PhoneUploadSessionRead.model_validate(model)
            item_matches_session = session.scalar(
                select(ClothingItem.id).where(
                    ClothingItem.id == clothing_item_id,
                    ClothingItem.import_idempotency_key == phone_upload_idempotency_key(session_id),
                )
            )
            if item_matches_session is None:
                raise ResourceConflictError(
                    code="phone_upload_session_conflict",
                    message="This garment does not belong to the phone upload session.",
                )
            if model.status not in {
                PhoneUploadSessionStatus.UPLOADING.value,
                PhoneUploadSessionStatus.PROCESSING.value,
                PhoneUploadSessionStatus.CANCELLED.value,
                PhoneUploadSessionStatus.FAILED.value,
            }:
                self._raise_unusable(model)
            model.status = PhoneUploadSessionStatus.COMPLETED.value
            model.clothing_item_id = clothing_item_id
            model.completed_at = completed_at
            model.error_code = None
            model.updated_at = completed_at
            session.flush()
            return PhoneUploadSessionRead.model_validate(model)

    def fail(
        self,
        session_id: str,
        error_code: str,
        *,
        now: datetime | None = None,
    ) -> PhoneUploadPublicStatus | None:
        failed_at = now or utc_now()
        with self.database.session() as session, session.begin():
            model = session.get(PhoneUploadSession, session_id)
            if model is None:
                return None
            self._expire_if_needed(model, failed_at)
            if model.status in {
                PhoneUploadSessionStatus.COMPLETED.value,
                PhoneUploadSessionStatus.CANCELLED.value,
                PhoneUploadSessionStatus.EXPIRED.value,
            }:
                session.flush()
                return self._public_status(model)
            if model.expires_at <= failed_at:
                model.status = PhoneUploadSessionStatus.EXPIRED.value
                model.failed_at = failed_at
                model.error_code = None
                model.updated_at = failed_at
                session.flush()
                return self._public_status(model)
            model.status = PhoneUploadSessionStatus.FAILED.value
            model.failed_at = failed_at
            model.error_code = _safe_error_code(error_code)
            model.updated_at = failed_at
            session.flush()
            return self._public_status(model)

    def cancel(self, session_id: str, *, now: datetime | None = None) -> PhoneUploadSessionRead:
        cancelled_at = now or utc_now()
        with self.database.session() as session, session.begin():
            model = session.get(PhoneUploadSession, session_id)
            if model is None:
                raise ResourceNotFoundError(
                    code="phone_upload_session_not_found",
                    message="The requested phone upload session was not found.",
                )
            self._expire_if_needed(model, cancelled_at)
            if model.status not in {
                PhoneUploadSessionStatus.COMPLETED.value,
                PhoneUploadSessionStatus.CANCELLED.value,
                PhoneUploadSessionStatus.EXPIRED.value,
            }:
                model.status = PhoneUploadSessionStatus.CANCELLED.value
                model.cancelled_at = cancelled_at
                model.updated_at = cancelled_at
            session.flush()
            return PhoneUploadSessionRead.model_validate(model)

    def regenerate(
        self, session_id: str, *, now: datetime | None = None
    ) -> CreatedPhoneUploadSession:
        regenerated_at = now or utc_now()
        raw_token = _generate_token()
        replacement = PhoneUploadSession(
            id=secrets.token_hex(16),
            token_hash=hashlib.sha256(raw_token.encode("ascii")).hexdigest(),
            status=PhoneUploadSessionStatus.PENDING.value,
            expires_at=regenerated_at
            + timedelta(seconds=self.settings.phone_upload_session_ttl_seconds),
        )
        with self.database.session() as session, session.begin():
            current = session.get(PhoneUploadSession, session_id)
            if current is None:
                raise ResourceNotFoundError(
                    code="phone_upload_session_not_found",
                    message="The requested phone upload session was not found.",
                )
            if current.status in {
                PhoneUploadSessionStatus.UPLOADING.value,
                PhoneUploadSessionStatus.PROCESSING.value,
            }:
                raise ResourceConflictError(
                    code="phone_upload_session_busy",
                    message="The current phone upload must finish before generating a new code.",
                )
            if current.status not in {
                PhoneUploadSessionStatus.COMPLETED.value,
                PhoneUploadSessionStatus.CANCELLED.value,
                PhoneUploadSessionStatus.EXPIRED.value,
            }:
                current.status = PhoneUploadSessionStatus.CANCELLED.value
                current.cancelled_at = regenerated_at
                current.updated_at = regenerated_at
            session.add(replacement)
            session.flush()
        return CreatedPhoneUploadSession(
            session=PhoneUploadSessionRead.model_validate(replacement),
            raw_token=raw_token,
        )

    def reconcile(self, *, now: datetime | None = None) -> int:
        """Reconcile at most one configured batch of actionable session rows."""

        return self._reconcile_batch(
            reconciled_at=now or utc_now(),
            limit=self.settings.phone_upload_cleanup_batch_size,
        )

    def reconcile_all(self, *, now: datetime | None = None) -> int:
        """Drain startup recovery through repeated, individually bounded transactions."""

        reconciled_at = now or utc_now()
        batch_size = self.settings.phone_upload_cleanup_batch_size
        total_changed = 0
        while True:
            changed = self._reconcile_batch(
                reconciled_at=reconciled_at,
                limit=batch_size,
            )
            total_changed += changed
            if changed < batch_size:
                return total_changed

    def _reconcile_batch(self, *, reconciled_at: datetime, limit: int) -> int:
        changed = 0
        with self.database.session() as session, session.begin():
            committed_rows = session.execute(
                select(PhoneUploadSession, ClothingItem.id)
                .join(
                    ClothingItem,
                    ClothingItem.import_idempotency_key
                    == literal("phone-upload:") + PhoneUploadSession.id,
                )
                .where(PhoneUploadSession.status.in_(_RECOVERABLE_COMMITTED_STATES))
                .order_by(PhoneUploadSession.updated_at, PhoneUploadSession.id)
                .limit(limit)
            ).tuples()
            for model, item_id in committed_rows:
                model.status = PhoneUploadSessionStatus.COMPLETED.value
                model.clothing_item_id = int(item_id)
                model.completed_at = reconciled_at
                model.error_code = None
                model.updated_at = reconciled_at
                changed += 1
            session.flush()

            remaining = limit - changed
            if remaining > 0:
                overdue = list(
                    session.scalars(
                        select(PhoneUploadSession)
                        .where(
                            PhoneUploadSession.status.in_(_OPEN_UPLOAD_STATES),
                            PhoneUploadSession.expires_at <= reconciled_at,
                        )
                        .order_by(PhoneUploadSession.expires_at, PhoneUploadSession.id)
                        .limit(remaining)
                    )
                )
                for model in overdue:
                    model.status = PhoneUploadSessionStatus.EXPIRED.value
                    model.error_code = None
                    model.updated_at = reconciled_at
                    changed += 1
                session.flush()

            remaining = limit - changed
            if remaining > 0:
                interrupted = list(
                    session.scalars(
                        select(PhoneUploadSession)
                        .where(PhoneUploadSession.status.in_(_INTERRUPTED_UPLOAD_STATES))
                        .order_by(PhoneUploadSession.updated_at, PhoneUploadSession.id)
                        .limit(remaining)
                    )
                )
                for model in interrupted:
                    if model.expires_at <= reconciled_at:
                        model.status = PhoneUploadSessionStatus.EXPIRED.value
                        model.error_code = None
                    else:
                        model.status = PhoneUploadSessionStatus.FAILED.value
                        model.failed_at = reconciled_at
                        model.error_code = "phone_upload_interrupted"
                    model.updated_at = reconciled_at
                    changed += 1
        return changed

    def cleanup(self, *, now: datetime | None = None) -> int:
        """Process one aggregate batch across recovery, expiry, and retention."""

        cleanup_at = now or utc_now()
        batch_size = self.settings.phone_upload_cleanup_batch_size
        processed = self._reconcile_batch(
            reconciled_at=cleanup_at,
            limit=batch_size,
        )
        remaining = batch_size - processed
        if remaining <= 0:
            return processed

        cutoff = cleanup_at - timedelta(seconds=self.settings.phone_upload_retention_seconds)
        with self.database.session() as session, session.begin():
            removable_ids = list(
                session.scalars(
                    select(PhoneUploadSession.id)
                    .where(
                        PhoneUploadSession.status.in_(_TERMINAL_RETENTION_STATES),
                        PhoneUploadSession.updated_at <= cutoff,
                    )
                    .order_by(PhoneUploadSession.updated_at, PhoneUploadSession.id)
                    .limit(remaining)
                )
            )
            if removable_ids:
                session.execute(
                    delete(PhoneUploadSession).where(PhoneUploadSession.id.in_(removable_ids))
                )
            return processed + len(removable_ids)

    def _expire_if_needed(self, model: PhoneUploadSession, now: datetime) -> None:
        if model.status in _OPEN_UPLOAD_STATES and model.expires_at <= now:
            model.status = PhoneUploadSessionStatus.EXPIRED.value
            model.error_code = None
            model.updated_at = now

    def _public_status(self, model: PhoneUploadSession) -> PhoneUploadPublicStatus:
        can_upload = (
            model.status in _OPEN_UPLOAD_STATES
            and model.attempt_count < self.settings.phone_upload_max_attempts
        )
        return PhoneUploadPublicStatus(
            status=PhoneUploadSessionStatus(model.status),
            expires_at=model.expires_at,
            can_upload=can_upload,
            can_retry=can_upload and model.status == PhoneUploadSessionStatus.FAILED.value,
            error_code=model.error_code,
        )

    @staticmethod
    def _raise_invalid_token() -> Never:
        raise ResourceNotFoundError(
            code="phone_upload_session_invalid",
            message="This phone upload session is unavailable.",
        )

    def _raise_unusable(self, model: PhoneUploadSession) -> None:
        status = PhoneUploadSessionStatus(model.status)
        if status is PhoneUploadSessionStatus.EXPIRED:
            raise MuseError(
                status_code=410,
                code="phone_upload_session_expired",
                message="This phone upload session has expired.",
            )
        if status is PhoneUploadSessionStatus.CANCELLED:
            raise MuseError(
                status_code=410,
                code="phone_upload_session_cancelled",
                message="This phone upload session was cancelled.",
            )
        if status is PhoneUploadSessionStatus.COMPLETED:
            raise ResourceConflictError(
                code="phone_upload_session_used",
                message="This phone upload session has already been used.",
            )
        if model.attempt_count >= self.settings.phone_upload_max_attempts:
            raise ResourceConflictError(
                code="phone_upload_attempts_exhausted",
                message="This phone upload session cannot accept another attempt.",
            )
        raise ResourceConflictError(
            code="phone_upload_session_busy",
            message="This phone upload session is already receiving an image.",
        )
