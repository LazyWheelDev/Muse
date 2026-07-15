from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import event, func, select

from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import upgrade_database
from muse_backend.database.models import ClothingItem, PhoneUploadSession
from muse_backend.domain.enums import PhoneUploadSessionStatus
from muse_backend.services.background_processing import reconcile_temporary_imports
from muse_backend.services.phone_upload_sessions import (
    PhoneUploadSessionService,
    phone_upload_idempotency_key,
)
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.integration


def _settings(tmp_path: Path, *, batch_size: int) -> Settings:
    return Settings.model_validate(
        {
            "environment": Environment.TESTING,
            "data_root": tmp_path / "data",
            "frontend_build_path": tmp_path / "frontend-dist",
            "phone_upload_frontend_build_path": tmp_path / "phone-dist",
            "allowed_origins": [],
            "trusted_hosts": ["testserver"],
            "phone_upload_enabled": True,
            "phone_upload_bind_host": "127.0.0.1",
            "phone_upload_trusted_hosts": ["127.0.0.1", "testserver"],
            "phone_upload_retention_seconds": 300,
            "phone_upload_cleanup_batch_size": batch_size,
            "background_processing_enabled": False,
        }
    )


def test_cleanup_shares_one_batch_across_recovery_expiry_and_deletion(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path, batch_size=2)
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    database = Database(settings.database_path)
    service = PhoneUploadSessionService(database=database, settings=settings)
    now = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)

    try:
        committed = service.create(now=now)
        service.claim_upload(committed.raw_token, now=now)
        with database.session() as session, session.begin():
            item = ClothingItem(
                name="Committed during interrupted completion",
                garment_category="top",
                import_idempotency_key=phone_upload_idempotency_key(committed.session.id),
            )
            session.add(item)

        overdue = service.create(
            now=now - timedelta(seconds=settings.phone_upload_session_ttl_seconds + 1)
        )
        interrupted = service.create(now=now)
        service.claim_upload(interrupted.raw_token, now=now)
        retained = service.create(now=now)
        service.cancel(retained.session.id, now=now)
        with database.session() as session, session.begin():
            retained_model = session.get(PhoneUploadSession, retained.session.id)
            assert retained_model is not None
            retained_model.updated_at = now - timedelta(seconds=301)

        assert service.cleanup(now=now) == settings.phone_upload_cleanup_batch_size
        with database.session() as session:
            committed_model = session.get(PhoneUploadSession, committed.session.id)
            overdue_model = session.get(PhoneUploadSession, overdue.session.id)
            interrupted_model = session.get(PhoneUploadSession, interrupted.session.id)
            assert committed_model is not None
            assert overdue_model is not None
            assert interrupted_model is not None
            assert committed_model.status == PhoneUploadSessionStatus.COMPLETED.value
            assert overdue_model.status == PhoneUploadSessionStatus.EXPIRED.value
            assert interrupted_model.status == PhoneUploadSessionStatus.UPLOADING.value
            assert session.get(PhoneUploadSession, retained.session.id) is not None

        assert service.cleanup(now=now) == settings.phone_upload_cleanup_batch_size
        with database.session() as session:
            interrupted_model = session.get(PhoneUploadSession, interrupted.session.id)
            assert interrupted_model is not None
            assert interrupted_model.status == PhoneUploadSessionStatus.FAILED.value
            assert interrupted_model.error_code == "phone_upload_interrupted"
            assert session.get(PhoneUploadSession, retained.session.id) is None
            assert session.scalar(select(func.count(ClothingItem.id))) == 1

        assert service.cleanup(now=now) == 0
    finally:
        database.dispose()


def test_interrupted_upload_cleanup_is_bounded_and_repeatable(tmp_path: Path) -> None:
    settings = _settings(tmp_path, batch_size=2)
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    upgrade_database(settings)
    database = Database(settings.database_path)

    try:
        for attempt_id in ("a" * 32, "b" * 32, "c" * 32):
            attempt = settings.temp_upload_root / attempt_id
            attempt.mkdir(mode=0o700)
            (attempt / "upload.bin").write_bytes(b"interrupted private image")

        assert (
            reconcile_temporary_imports(
                settings=settings,
                storage=storage,
                database=database,
                limit=settings.phone_upload_cleanup_batch_size,
            )
            == 2
        )
        assert len(list(settings.temp_upload_root.iterdir())) == 1
        assert (
            reconcile_temporary_imports(
                settings=settings,
                storage=storage,
                database=database,
                limit=settings.phone_upload_cleanup_batch_size,
            )
            == 1
        )
        assert list(settings.temp_upload_root.iterdir()) == []
        assert (
            reconcile_temporary_imports(
                settings=settings,
                storage=storage,
                database=database,
                limit=settings.phone_upload_cleanup_batch_size,
            )
            == 0
        )
    finally:
        database.dispose()


def test_committed_session_recovery_uses_fixed_query_count_instead_of_n_plus_one(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path, batch_size=10)
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    database = Database(settings.database_path)
    service = PhoneUploadSessionService(database=database, settings=settings)
    now = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)

    try:
        for index in range(3):
            created = service.create(now=now)
            service.claim_upload(created.raw_token, now=now)
            with database.session() as session, session.begin():
                session.add(
                    ClothingItem(
                        name=f"Recovered garment {index}",
                        garment_category="top",
                        import_idempotency_key=phone_upload_idempotency_key(created.session.id),
                    )
                )

        select_statements = 0

        def count_selects(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            nonlocal select_statements
            if statement.lstrip().upper().startswith("SELECT"):
                select_statements += 1

        event.listen(database.engine, "before_cursor_execute", count_selects)
        try:
            assert service.reconcile(now=now + timedelta(seconds=1)) == 3
        finally:
            event.remove(database.engine, "before_cursor_execute", count_selects)

        # One joined committed-item lookup plus the fixed expiry and interrupted
        # lookups; the count does not grow with the three recovered sessions.
        assert select_statements == 3
        with database.session() as session:
            statuses = set(session.scalars(select(PhoneUploadSession.status)))
            assert statuses == {PhoneUploadSessionStatus.COMPLETED.value}
    finally:
        database.dispose()


def test_reconcile_all_drains_startup_work_through_bounded_passes(tmp_path: Path) -> None:
    settings = _settings(tmp_path, batch_size=1)
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    database = Database(settings.database_path)
    service = PhoneUploadSessionService(database=database, settings=settings)
    now = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)

    try:
        expired_ids = [
            service.create(
                now=now - timedelta(seconds=settings.phone_upload_session_ttl_seconds + index + 1)
            ).session.id
            for index in range(3)
        ]
        interrupted = service.create(now=now)
        service.claim_upload(interrupted.raw_token, now=now)

        assert service.reconcile(now=now) == 1
        assert service.reconcile_all(now=now) == 3

        with database.session() as session:
            expired_statuses = list(
                session.scalars(
                    select(PhoneUploadSession.status).where(PhoneUploadSession.id.in_(expired_ids))
                )
            )
            interrupted_model = session.get(PhoneUploadSession, interrupted.session.id)
            assert expired_statuses == [PhoneUploadSessionStatus.EXPIRED.value] * 3
            assert interrupted_model is not None
            assert interrupted_model.status == PhoneUploadSessionStatus.FAILED.value
    finally:
        database.dispose()
