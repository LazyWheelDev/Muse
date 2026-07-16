import sqlite3
from contextlib import closing

from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import migration_status, upgrade_database
from muse_backend.services.background_processing import (
    reconcile_interrupted_imports,
    reconcile_temporary_imports,
)
from muse_backend.services.backups import BackupService
from muse_backend.services.device_control import DeviceControlService
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.maintenance import apply_staged_maintenance
from muse_backend.services.outfit_previews import reconcile_outfit_previews
from muse_backend.services.phone_upload_sessions import PhoneUploadSessionService
from muse_backend.services.runtime_lock import RuntimeServiceLock
from muse_backend.storage.local import LocalStorageService


def prepare_production(settings: Settings) -> str | None:
    """Apply already-confirmed maintenance, migrate, and reconcile before listeners start."""

    if settings.environment is Environment.DEVELOPMENT:
        raise RuntimeError("prepare-production requires a testing or production environment")
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    storage.secure_database_file()
    maintenance = BackupService(settings).maintenance_status()
    applied: str | None = None
    if maintenance.status == "staged_restart_required":
        applied = apply_staged_maintenance(
            settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )

    with RuntimeServiceLock(settings).exclusive():
        upgrade_database(settings)
        database = Database(settings.database_path)
        try:
            if not migration_status(settings, database).is_current:
                raise RuntimeError("the production database migration is not current")
            with InterprocessImportLock(settings).acquire(blocking=True):
                reconcile_interrupted_imports(
                    settings=settings,
                    storage=storage,
                    database=database,
                )
                PhoneUploadSessionService(database=database, settings=settings).reconcile_all()
                reconcile_temporary_imports(
                    settings=settings,
                    storage=storage,
                    database=database,
                    limit=settings.phone_upload_cleanup_batch_size,
                )
            reconcile_outfit_previews(
                settings=settings,
                storage=storage,
                database=database,
            )
        finally:
            database.dispose()
    BackupService(settings).reconcile_committed_cleanup(
        limit=settings.maintenance_cleanup_batch_size
    )
    DeviceControlService(settings).clear_stale_marker()
    _verify_database(settings)
    return applied


def create_verified_backup(settings: Settings) -> str:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    storage.secure_database_file()
    database = Database(settings.database_path)
    try:
        if not migration_status(settings, database).is_current:
            raise RuntimeError("a current database migration is required before backup")
    finally:
        database.dispose()
    with InterprocessImportLock(settings).acquire(blocking=False):
        service = BackupService(settings)
        summary = service.create()
        service.validated_path(summary.id)
    return summary.id


def verify_backup(settings: Settings, backup_id: str | None) -> str:
    service = BackupService(settings)
    selected = backup_id
    if selected is None:
        latest = service.latest()
        if latest is None:
            raise RuntimeError("no Muse backup is available")
        selected = latest.id
    service.validated_path(selected)
    return selected


def _verify_database(settings: Settings) -> None:
    with closing(sqlite3.connect(settings.database_path)) as connection:
        quick_check = connection.execute("PRAGMA quick_check").fetchall()
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    if quick_check != [("ok",)] or foreign_keys:
        raise RuntimeError("the production database integrity check failed")
