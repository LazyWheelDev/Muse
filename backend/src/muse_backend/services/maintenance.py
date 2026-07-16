import hashlib
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, cast

from muse_backend.config import Settings
from muse_backend.database.migrations import upgrade_database
from muse_backend.services.backups import (
    _database_integrity,
    _exclusive_descriptor,
    _head_revisions,
)
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.runtime_lock import RuntimeServiceLock
from muse_backend.storage.local import LocalStorageService

_MAX_STAGED_MANIFEST_BYTES = 512 * 1024
_ACTIVATION_JOURNAL = "activation-journal.json"
logger = logging.getLogger(__name__)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _remove_path(path: Path) -> None:
    if path.is_symlink():
        raise RuntimeError("refusing to maintain a symbolic-link storage path")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def _fsync_existing_directories(*paths: Path) -> None:
    for path in dict.fromkeys(paths):
        try:
            if path.is_dir() and not path.is_symlink():
                LocalStorageService._fsync_directory(path)
        except OSError:
            # The operation journal remains until the commit marker is removed,
            # so a failed durability barrier must abort rather than be hidden.
            raise


def _write_activation_journal(
    settings: Settings,
    *,
    marker: dict[str, str],
    phase: str,
) -> None:
    destination = settings.maintenance_root / _ACTIVATION_JOURNAL
    temporary = destination.with_suffix(".tmp")
    temporary.unlink(missing_ok=True)
    payload = {
        "type": marker["type"],
        "operation_id": marker["operation_id"],
        "phase": phase,
    }
    descriptor = _exclusive_descriptor(temporary)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(payload, output, sort_keys=True, separators=(",", ":"))
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, destination)
    LocalStorageService._fsync_directory(settings.maintenance_root)


def _activation_phase(settings: Settings, marker: dict[str, str]) -> str | None:
    journal = settings.maintenance_root / _ACTIVATION_JOURNAL
    if not journal.exists():
        return None
    if journal.is_symlink() or not journal.is_file() or journal.stat().st_size > 4096:
        raise RuntimeError("the Muse maintenance recovery journal is invalid")
    try:
        payload: Any = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("the Muse maintenance recovery journal is invalid") from error
    if (
        not isinstance(payload, dict)
        or set(payload) != {"type", "operation_id", "phase"}
        or payload["type"] != marker["type"]
        or payload["operation_id"] != marker["operation_id"]
        or payload["phase"] not in {"prepared", "old_moved", "new_moved"}
    ):
        raise RuntimeError("the Muse maintenance recovery journal is invalid")
    return cast(str, payload["phase"])


def _clear_activation_journal(settings: Settings) -> None:
    (settings.maintenance_root / _ACTIVATION_JOURNAL).unlink(missing_ok=True)
    LocalStorageService._fsync_directory(settings.maintenance_root)


def _load_pending(settings: Settings) -> dict[str, str]:
    pending = settings.maintenance_root / "pending-operation.json"
    if pending.is_symlink() or not pending.is_file() or pending.stat().st_size > 4096:
        raise RuntimeError("no valid staged Muse maintenance operation exists")
    try:
        marker: Any = json.loads(pending.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("the staged Muse maintenance marker is invalid") from error
    if not isinstance(marker, dict) or any(not isinstance(key, str) for key in marker):
        raise RuntimeError("the staged Muse maintenance marker is invalid")
    operation_type = marker.get("type")
    expected = (
        {"type", "operation_id", "safety_backup_id", "staged_database", "staged_media"}
        if operation_type == "restore"
        else {"type", "operation_id", "safety_backup_id"}
    )
    if operation_type not in {"restore", "delete_all"} or set(marker) != expected:
        raise RuntimeError("the staged Muse maintenance marker is invalid")
    for name in ("operation_id", "safety_backup_id"):
        value = marker.get(name)
        if (
            not isinstance(value, str)
            or len(value) != 32
            or any(character not in "0123456789abcdef" for character in value)
        ):
            raise RuntimeError("the staged Muse maintenance marker is invalid")
    return cast(dict[str, str], marker)


def apply_staged_maintenance(settings: Settings, *, confirmation: str) -> str:
    if confirmation != "APPLY STAGED MUSE MAINTENANCE":
        raise RuntimeError("staged maintenance requires --confirm 'APPLY STAGED MUSE MAINTENANCE'")
    marker = _load_pending(settings)
    with (
        RuntimeServiceLock(settings).exclusive(),
        InterprocessImportLock(settings).acquire(blocking=False),
    ):
        if marker["type"] == "restore":
            _apply_restore(settings, marker)
        else:
            _apply_delete_all(settings, marker)
        (settings.maintenance_root / "pending-operation.json").unlink()
        LocalStorageService._fsync_directory(settings.maintenance_root)
        _clear_activation_journal(settings)
    return marker["type"]


def _apply_restore(settings: Settings, marker: dict[str, str]) -> None:
    operation = settings.maintenance_root / f"restore-{marker['operation_id']}"
    expected_database = operation / "database" / "muse.sqlite3"
    expected_media = operation / "media"
    rollback = settings.maintenance_root / f"rollback-{marker['operation_id']}"
    phase = _activation_phase(settings, marker)
    if phase == "new_moved":
        try:
            _database_integrity(settings.database_path, _head_revisions())
        except Exception:
            _return_active_restore_to_staging(
                settings,
                expected_database=expected_database,
                expected_media=expected_media,
                rollback=rollback,
            )
            _restore_restore_rollback(settings, rollback)
            _clear_activation_journal(settings)
            raise
        _finalize_restore(settings, operation=operation, rollback=rollback)
        return
    if phase in {"prepared", "old_moved"}:
        _return_active_restore_to_staging(
            settings,
            expected_database=expected_database,
            expected_media=expected_media,
            rollback=rollback,
        )
        _restore_restore_rollback(settings, rollback)
        shutil.rmtree(rollback, ignore_errors=True)
        _clear_activation_journal(settings)

    if (
        marker["staged_database"] != f"restore-{marker['operation_id']}/database/muse.sqlite3"
        or marker["staged_media"] != f"restore-{marker['operation_id']}/media"
        or operation.is_symlink()
        or expected_database.is_symlink()
        or not expected_database.is_file()
        or expected_media.is_symlink()
        or not expected_media.is_dir()
    ):
        raise RuntimeError("the staged Muse restore is invalid")
    _validate_staged_restore(operation)
    _database_integrity(expected_database, _head_revisions())
    _write_activation_journal(settings, marker=marker, phase="prepared")
    rollback.mkdir(mode=0o700, exist_ok=False)
    database_rollback = rollback / "database"
    database_rollback.mkdir(mode=0o700)
    media_rollback = rollback / "media"
    try:
        for active in (
            settings.database_path,
            Path(f"{settings.database_path}-wal"),
            Path(f"{settings.database_path}-shm"),
        ):
            if active.is_symlink():
                raise RuntimeError("refusing to restore over a symbolic-link database path")
            if active.exists():
                target = database_rollback / active.name
                os.replace(active, target)
        if settings.media_root.is_symlink():
            raise RuntimeError("refusing to restore over a symbolic-link media path")
        if settings.media_root.exists():
            os.replace(settings.media_root, media_rollback)
        _fsync_existing_directories(
            settings.database_path.parent,
            database_rollback,
            rollback,
            settings.data_root,
        )
        _write_activation_journal(settings, marker=marker, phase="old_moved")
        os.replace(expected_database, settings.database_path)
        os.replace(expected_media, settings.media_root)
        _fsync_existing_directories(
            settings.database_path.parent,
            expected_database.parent,
            operation,
            settings.data_root,
        )
        _write_activation_journal(settings, marker=marker, phase="new_moved")
        LocalStorageService(settings).create_required_directories()
        _database_integrity(settings.database_path, _head_revisions())
    except Exception:
        _return_active_restore_to_staging(
            settings,
            expected_database=expected_database,
            expected_media=expected_media,
            rollback=rollback,
        )
        _restore_restore_rollback(settings, rollback)
        shutil.rmtree(rollback, ignore_errors=True)
        _clear_activation_journal(settings)
        raise
    else:
        _finalize_restore(settings, operation=operation, rollback=rollback)


def _return_active_restore_to_staging(
    settings: Settings,
    *,
    expected_database: Path,
    expected_media: Path,
    rollback: Path,
) -> None:
    if not expected_database.exists() and settings.database_path.is_file():
        expected_database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.replace(settings.database_path, expected_database)
    rollback_media = rollback / "media"
    if (
        not expected_media.exists()
        and rollback_media.exists()
        and settings.media_root.is_dir()
        and not settings.media_root.is_symlink()
    ):
        expected_media.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.replace(settings.media_root, expected_media)
    _fsync_existing_directories(
        settings.database_path.parent,
        expected_database.parent,
        expected_media.parent,
        settings.data_root,
    )


def _restore_restore_rollback(settings: Settings, rollback: Path) -> None:
    database_rollback = rollback / "database"
    if database_rollback.is_dir() and not database_rollback.is_symlink():
        for source in database_rollback.iterdir():
            destination = settings.database_path.parent / source.name
            _remove_path(destination)
            os.replace(source, destination)
    media_rollback = rollback / "media"
    if media_rollback.is_dir() and not media_rollback.is_symlink():
        _remove_path(settings.media_root)
        os.replace(media_rollback, settings.media_root)
    _fsync_existing_directories(
        settings.database_path.parent,
        rollback,
        settings.data_root,
    )


def _finalize_restore(settings: Settings, *, operation: Path, rollback: Path) -> None:
    cleanup_failed = False
    for path in (rollback, operation):
        try:
            shutil.rmtree(path, ignore_errors=False)
        except FileNotFoundError:
            pass
        except OSError:
            cleanup_failed = True
    if cleanup_failed:
        logger.warning("Committed Muse restore cleanup will be retried later")
    _fsync_existing_directories(settings.maintenance_root)


def _validate_staged_restore(operation: Path) -> None:
    manifest_path = operation / "staged-manifest.json"
    if (
        manifest_path.is_symlink()
        or not manifest_path.is_file()
        or manifest_path.stat().st_size > _MAX_STAGED_MANIFEST_BYTES
    ):
        raise RuntimeError("the staged Muse restore manifest is invalid")
    try:
        manifest: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = manifest["files"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("the staged Muse restore manifest is invalid") from error
    if not isinstance(entries, list):
        raise RuntimeError("the staged Muse restore manifest is invalid")
    expected = {"staged-manifest.json"}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
            raise RuntimeError("the staged Muse restore manifest is invalid")
        relative = entry["path"]
        if not isinstance(relative, str) or relative in expected:
            raise RuntimeError("the staged Muse restore manifest is invalid")
        target = operation / Path(*relative.split("/"))
        try:
            target.resolve(strict=True).relative_to(operation.resolve(strict=True))
        except (OSError, RuntimeError, ValueError) as error:
            raise RuntimeError("the staged Muse restore contains an unsafe path") from error
        if target.is_symlink() or not target.is_file():
            raise RuntimeError("the staged Muse restore contains an unsafe file")
        if target.stat().st_size != entry["size"] or _sha256(target) != entry["sha256"]:
            raise RuntimeError("the staged Muse restore checksum validation failed")
        expected.add(relative)
    actual = {
        path.relative_to(operation).as_posix() for path in operation.rglob("*") if path.is_file()
    }
    if actual != expected:
        raise RuntimeError("the staged Muse restore contains unexpected files")


def _delete_all_targets(settings: Settings, rollback: Path) -> tuple[tuple[Path, Path], ...]:
    database_rollback = rollback / "database"
    data_rollback = rollback / "data"
    return (
        (settings.database_path, database_rollback / settings.database_path.name),
        (
            Path(f"{settings.database_path}-wal"),
            database_rollback / f"{settings.database_path.name}-wal",
        ),
        (
            Path(f"{settings.database_path}-shm"),
            database_rollback / f"{settings.database_path.name}-shm",
        ),
        (settings.media_root, data_rollback / "media"),
        (settings.temp_upload_root, data_rollback / "temp-uploads"),
        (settings.temp_preview_root, data_rollback / "temp-previews"),
        (settings.backup_root, data_rollback / "backups"),
    )


def _restore_delete_all_rollback(
    targets: tuple[tuple[Path, Path], ...],
    *,
    remove_all_active: bool,
) -> None:
    if remove_all_active:
        for active, _rollback_path in targets:
            _remove_path(active)
    for active, rollback_path in targets:
        if not rollback_path.exists():
            continue
        _remove_path(active)
        active.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.replace(rollback_path, active)
    _fsync_existing_directories(
        *(active.parent for active, _rollback_path in targets),
        *(rollback_path.parent for _active, rollback_path in targets),
    )


def _finalize_delete_all(rollback: Path) -> None:
    try:
        shutil.rmtree(rollback)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Committed Muse data-deletion cleanup will be retried later")
    _fsync_existing_directories(rollback.parent)


def _apply_delete_all(settings: Settings, marker: dict[str, str]) -> None:
    rollback = settings.maintenance_root / f"rollback-{marker['operation_id']}"
    targets = _delete_all_targets(settings, rollback)
    phase = _activation_phase(settings, marker)
    if phase == "new_moved":
        try:
            _database_integrity(settings.database_path, _head_revisions())
        except Exception:
            _restore_delete_all_rollback(targets, remove_all_active=True)
            shutil.rmtree(rollback, ignore_errors=True)
            _clear_activation_journal(settings)
            raise
        _finalize_delete_all(rollback)
        return
    if phase in {"prepared", "old_moved"}:
        _restore_delete_all_rollback(
            targets,
            remove_all_active=phase == "old_moved",
        )
        shutil.rmtree(rollback, ignore_errors=True)
        _clear_activation_journal(settings)

    _write_activation_journal(settings, marker=marker, phase="prepared")
    rollback.mkdir(mode=0o700, exist_ok=False)
    try:
        for active, rollback_path in targets:
            if active.is_symlink():
                raise RuntimeError("refusing to delete a symbolic-link Muse storage path")
            if active.exists():
                rollback_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                os.replace(active, rollback_path)
        _fsync_existing_directories(
            settings.data_root,
            rollback,
            rollback / "database",
            rollback / "data",
        )
        _write_activation_journal(settings, marker=marker, phase="old_moved")
        LocalStorageService(settings).create_required_directories()
        upgrade_database(settings)
        LocalStorageService._fsync_directory(settings.database_path.parent)
        _write_activation_journal(settings, marker=marker, phase="new_moved")
        _database_integrity(settings.database_path, _head_revisions())
    except Exception:
        _restore_delete_all_rollback(targets, remove_all_active=True)
        shutil.rmtree(rollback, ignore_errors=True)
        _clear_activation_journal(settings)
        raise
    else:
        _finalize_delete_all(rollback)
