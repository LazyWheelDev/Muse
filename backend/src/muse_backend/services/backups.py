import hashlib
import json
import logging
import os
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, cast
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory

from muse_backend import __version__
from muse_backend.config import BACKEND_ROOT, Settings
from muse_backend.domain.exceptions import (
    DomainValidationError,
    ResourceConflictError,
    ResourceNotFoundError,
    StorageOperationError,
)
from muse_backend.schemas.settings import (
    BackupList,
    BackupSummary,
    MaintenanceStatus,
    StagedMaintenanceResponse,
)

_FORMAT = "muse-backup-v1"
_ARCHIVE_SUFFIX = ".muse-backup.zip"
_MANIFEST = "manifest.json"
_DATABASE_ENTRY = "database/muse.sqlite3"
_BACKUP_ID_LENGTH = 32
_MAX_MANIFEST_BYTES = 512 * 1024
_FREE_SPACE_RESERVE_BYTES = 16 * 1024 * 1024
logger = logging.getLogger(__name__)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _stream_digest(source: Any) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        digest.update(chunk)
    return size, digest.hexdigest()


def _write_archive_file(archive: zipfile.ZipFile, source: Path, name: str) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    with source.open("rb") as input_file, archive.open(info, "w", force_zip64=True) as output:
        shutil.copyfileobj(input_file, output, length=1024 * 1024)


def _exclusive_descriptor(path: Path) -> int:
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    return os.open(path, flags, 0o600)


def _safe_backup_id(value: str) -> str:
    if len(value) != _BACKUP_ID_LENGTH or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise ResourceNotFoundError(
            code="backup_not_found",
            message="The requested Muse backup was not found.",
        )
    return value


def _database_integrity(database_path: Path, expected_heads: set[str]) -> None:
    connection = sqlite3.connect(f"file:{database_path}?mode=ro&immutable=1", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise DomainValidationError(
                code="backup_database_invalid",
                message="The backup database did not pass its integrity check.",
            )
        foreign_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_errors:
            raise DomainValidationError(
                code="backup_database_invalid",
                message="The backup database contains invalid relationships.",
            )
        revisions = {
            str(row[0]) for row in connection.execute("SELECT version_num FROM alembic_version")
        }
        if revisions != expected_heads:
            raise DomainValidationError(
                code="backup_schema_incompatible",
                message="The backup schema is not compatible with this Muse release.",
            )
    except sqlite3.Error as error:
        raise DomainValidationError(
            code="backup_database_invalid",
            message="The backup database could not be validated.",
        ) from error
    finally:
        connection.close()


def _head_revisions() -> set[str]:
    config = Config(BACKEND_ROOT / "alembic.ini")
    return set(ScriptDirectory.from_config(config).get_heads())


class BackupService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def list_backups(self) -> BackupList:
        summaries: list[BackupSummary] = []
        try:
            candidates = sorted(
                self.settings.backup_root.glob(f"*{_ARCHIVE_SUFFIX}"),
                key=lambda path: path.name,
                reverse=True,
            )
        except OSError:
            candidates = []
        for path in candidates:
            try:
                summaries.append(self._summary(path))
            except (DomainValidationError, OSError, zipfile.BadZipFile):
                continue
        summaries.sort(key=lambda item: item.created_at, reverse=True)
        return BackupList(items=summaries, total=len(summaries))

    def latest(self) -> BackupSummary | None:
        listing = self.list_backups()
        return listing.items[0] if listing.items else None

    def create(self) -> BackupSummary:
        backup_id = uuid4().hex
        created_at = datetime.now(UTC)
        destination = self.settings.backup_root / f"{backup_id}{_ARCHIVE_SUFFIX}"
        self.settings.backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.settings.maintenance_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        initial_required = (
            self.settings.database_path.stat().st_size * 2 + _FREE_SPACE_RESERVE_BYTES
        )
        if shutil.disk_usage(self.settings.data_root).free < initial_required:
            raise DomainValidationError(
                code="backup_insufficient_space",
                message="Muse does not have enough free local storage to create a backup.",
            )
        with tempfile.TemporaryDirectory(
            prefix="backup-",
            dir=self.settings.maintenance_root,
        ) as temporary:
            staging = Path(temporary)
            snapshot = staging / "muse.sqlite3"
            media_stage = staging / "media"
            media_stage.mkdir(mode=0o700)
            counts, referenced_media = self._snapshot_database(snapshot)
            media_sources = {
                relative_path: self._safe_media_source(relative_path)
                for relative_path in referenced_media
            }
            required_space = (
                snapshot.stat().st_size * 2
                + sum(path.stat().st_size * 2 for path in media_sources.values())
                + _FREE_SPACE_RESERVE_BYTES
            )
            if shutil.disk_usage(self.settings.data_root).free < required_space:
                raise DomainValidationError(
                    code="backup_insufficient_space",
                    message="Muse does not have enough free local storage to create a backup.",
                )
            file_entries: list[dict[str, Any]] = [
                {
                    "path": _DATABASE_ENTRY,
                    "size": snapshot.stat().st_size,
                    "sha256": _sha256(snapshot),
                }
            ]
            for relative_path in referenced_media:
                source = media_sources[relative_path]
                target = media_stage / Path(*PurePosixPath(relative_path).parts)
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(source, target, follow_symlinks=False)
                target.chmod(0o600)
                file_entries.append(
                    {
                        "path": f"media/{relative_path}",
                        "size": target.stat().st_size,
                        "sha256": _sha256(target),
                    }
                )
            file_entries.sort(key=lambda item: cast(str, item["path"]))
            manifest = {
                "format": _FORMAT,
                "backup_id": backup_id,
                "created_at": created_at.isoformat().replace("+00:00", "Z"),
                "app_version": __version__,
                "schema_revisions": sorted(_head_revisions()),
                "counts": {
                    **counts,
                    "media_files": len(referenced_media),
                },
                "files": file_entries,
            }
            archive_temp = staging / "archive.zip"
            with zipfile.ZipFile(
                archive_temp,
                "w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as archive:
                manifest_info = zipfile.ZipInfo(_MANIFEST, date_time=(1980, 1, 1, 0, 0, 0))
                manifest_info.compress_type = zipfile.ZIP_DEFLATED
                manifest_info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(
                    manifest_info,
                    json.dumps(manifest, sort_keys=True, separators=(",", ":")),
                )
                _write_archive_file(archive, snapshot, _DATABASE_ENTRY)
                for relative_path in referenced_media:
                    _write_archive_file(
                        archive,
                        media_stage / Path(*PurePosixPath(relative_path).parts),
                        f"media/{relative_path}",
                    )
            if archive_temp.stat().st_size > self.settings.max_backup_archive_bytes:
                raise DomainValidationError(
                    code="backup_too_large",
                    message="The Muse backup exceeds the configured local size limit.",
                )
            self._validate_archive(archive_temp, expected_id=backup_id)
            archive_temp.chmod(0o600)
            with archive_temp.open("rb") as archive_file:
                os.fsync(archive_file.fileno())
            os.replace(archive_temp, destination)
            _fsync_directory(destination.parent)
        summary = BackupSummary(
            id=backup_id,
            created_at=created_at,
            archive_bytes=destination.stat().st_size,
            clothing_items=counts["clothing_items"],
            outfits=counts["outfits"],
            media_files=len(referenced_media),
        )
        try:
            self._write_summary_sidecar(destination, summary)
        except OSError:
            logger.warning("Muse backup summary cache could not be persisted")
        return summary

    def path(self, backup_id: str) -> Path:
        safe_id = _safe_backup_id(backup_id)
        candidate = self.settings.backup_root / f"{safe_id}{_ARCHIVE_SUFFIX}"
        if candidate.is_symlink() or not candidate.is_file():
            raise ResourceNotFoundError(
                code="backup_not_found",
                message="The requested Muse backup was not found.",
            )
        return candidate

    def validated_path(self, backup_id: str) -> Path:
        candidate = self.path(backup_id)
        self._validate_archive(candidate, expected_id=backup_id)
        return candidate

    def delete(self, backup_id: str) -> None:
        candidate = self.path(backup_id)
        try:
            candidate.unlink()
            candidate.with_name(f"{candidate.name}.summary.json").unlink(missing_ok=True)
            _fsync_directory(candidate.parent)
        except OSError as error:
            raise StorageOperationError from error

    def stage_restore(self, backup_id: str) -> StagedMaintenanceResponse:
        source = self.path(backup_id)
        operation_id = uuid4().hex
        operation = self.settings.maintenance_root / f"restore-{operation_id}"
        pending = self.settings.maintenance_root / "pending-operation.json"
        self._reserve_pending(pending)
        try:
            manifest = self._validate_archive(source, expected_id=backup_id)
            safety = self.create()
            required_space = (
                sum(int(entry["size"]) for entry in manifest["files"]) + _FREE_SPACE_RESERVE_BYTES
            )
            if shutil.disk_usage(self.settings.data_root).free < required_space:
                raise DomainValidationError(
                    code="restore_insufficient_space",
                    message="Muse does not have enough free local storage to stage this restore.",
                )
            operation.mkdir(mode=0o700, parents=False)
            self._extract_validated(source, operation)
            marker = {
                "type": "restore",
                "operation_id": operation_id,
                "safety_backup_id": safety.id,
                "staged_database": f"restore-{operation_id}/database/muse.sqlite3",
                "staged_media": f"restore-{operation_id}/media",
            }
            self._write_pending(marker, pending)
        except Exception:
            shutil.rmtree(operation, ignore_errors=True)
            pending.unlink(missing_ok=True)
            raise
        return StagedMaintenanceResponse(
            operation_id=operation_id,
            safety_backup_id=safety.id,
        )

    def stage_delete_all(self) -> StagedMaintenanceResponse:
        operation_id = uuid4().hex
        pending = self.settings.maintenance_root / "pending-operation.json"
        self._reserve_pending(pending)
        try:
            safety = self.create()
            marker = {
                "type": "delete_all",
                "operation_id": operation_id,
                "safety_backup_id": safety.id,
            }
            self._write_pending(marker, pending)
        except Exception:
            pending.unlink(missing_ok=True)
            raise
        return StagedMaintenanceResponse(
            operation_id=operation_id,
            safety_backup_id=safety.id,
        )

    def cleanup_staging(self, *, limit: int) -> int:
        return self.reconcile_committed_cleanup(limit=limit)

    def reconcile_committed_cleanup(self, *, limit: int) -> int:
        pending_operation: str | None = None
        pending = self.settings.maintenance_root / "pending-operation.json"
        journal = self.settings.maintenance_root / "activation-journal.json"
        try:
            if pending.is_file() and not pending.is_symlink():
                marker = json.loads(pending.read_text(encoding="utf-8"))
                pending_operation = str(marker.get("operation_id", ""))
        except (OSError, json.JSONDecodeError):
            pass
        if pending_operation is None and journal.is_file() and not journal.is_symlink():
            try:
                payload: Any = json.loads(journal.read_text(encoding="utf-8"))
                if (
                    isinstance(payload, dict)
                    and set(payload) == {"type", "operation_id", "phase"}
                    and payload.get("type") in {"restore", "delete_all"}
                    and payload.get("phase") == "new_moved"
                    and isinstance(payload.get("operation_id"), str)
                ):
                    journal.unlink()
                    _fsync_directory(journal.parent)
            except (OSError, json.JSONDecodeError):
                pass
        removed = 0
        journal_present = journal.exists() or journal.is_symlink()
        for candidate in sorted(
            self.settings.maintenance_root.iterdir(), key=lambda path: path.name
        ):
            if removed >= limit:
                break
            is_restore = candidate.name.startswith("restore-")
            is_committed_rollback = (
                candidate.name.startswith("rollback-")
                and pending_operation is None
                and not journal_present
            )
            if (
                not (is_restore or is_committed_rollback)
                or candidate.is_symlink()
                or not candidate.is_dir()
            ):
                continue
            if candidate.name == f"restore-{pending_operation}":
                continue
            try:
                shutil.rmtree(candidate)
            except OSError:
                logger.warning("Deferred Muse maintenance cleanup could not be completed")
            else:
                removed += 1
        return removed

    def maintenance_status(self) -> MaintenanceStatus:
        pending = self.settings.maintenance_root / "pending-operation.json"
        try:
            if pending.is_symlink() or not pending.is_file() or pending.stat().st_size > 4096:
                return MaintenanceStatus(status="none", operation_type=None)
            marker: Any = json.loads(pending.read_text(encoding="utf-8"))
            operation_type = marker.get("type") if isinstance(marker, dict) else None
            operation_id = marker.get("operation_id") if isinstance(marker, dict) else None
            if (
                operation_type not in {"restore", "delete_all"}
                or not isinstance(operation_id, str)
                or len(operation_id) != 32
                or any(character not in "0123456789abcdef" for character in operation_id)
            ):
                return MaintenanceStatus(status="none", operation_type=None)
            return MaintenanceStatus(
                status="staged_restart_required",
                operation_type=operation_type,
                operation_id=operation_id,
            )
        except (OSError, json.JSONDecodeError):
            return MaintenanceStatus(status="none", operation_type=None)

    def _snapshot_database(self, target: Path) -> tuple[dict[str, int], list[str]]:
        source = sqlite3.connect(self.settings.database_path, timeout=5.0)
        destination = sqlite3.connect(target)
        try:
            source.backup(destination, pages=256)
            destination.execute("PRAGMA foreign_keys=ON")
            destination.execute("DELETE FROM phone_upload_sessions")
            destination.commit()
            clothing_items = int(
                destination.execute("SELECT count(*) FROM clothing_items").fetchone()[0]
            )
            outfits = int(destination.execute("SELECT count(*) FROM outfits").fetchone()[0])
            paths = {
                str(row[0])
                for row in destination.execute("SELECT relative_path FROM clothing_images")
            }
            paths.update(
                str(row[0])
                for row in destination.execute(
                    "SELECT preview_image_path FROM outfits WHERE preview_image_path IS NOT NULL"
                )
            )
        except sqlite3.Error as error:
            raise StorageOperationError from error
        finally:
            destination.close()
            source.close()
        _database_integrity(target, _head_revisions())
        return {"clothing_items": clothing_items, "outfits": outfits}, sorted(paths)

    def _safe_media_source(self, relative_path: str) -> Path:
        pure = PurePosixPath(relative_path)
        if (
            pure.is_absolute()
            or not pure.parts
            or any(part in {"", ".", ".."} for part in pure.parts)
        ):
            raise DomainValidationError(
                code="backup_media_invalid",
                message="Muse found an invalid local media reference while creating a backup.",
            )
        source = self.settings.media_root / Path(*pure.parts)
        try:
            media_root = self.settings.media_root.resolve(strict=True)
            source.resolve(strict=True).relative_to(media_root)
            if source.is_symlink() or not source.is_file():
                raise OSError("media is not a regular file")
            current = media_root
            for part in pure.parts:
                current /= part
                if current.is_symlink():
                    raise OSError("media path contains a symbolic link")
        except (OSError, RuntimeError, ValueError) as error:
            raise ResourceConflictError(
                code="backup_media_changed",
                message="Local media changed while Muse was creating the backup. Please retry.",
            ) from error
        return source

    def _summary(self, path: Path) -> BackupSummary:
        sidecar = path.with_name(f"{path.name}.summary.json")
        try:
            if sidecar.is_symlink() or not sidecar.is_file() or sidecar.stat().st_size > 4096:
                raise OSError("summary sidecar unavailable")
            payload: Any = json.loads(sidecar.read_text(encoding="utf-8"))
            summary = BackupSummary.model_validate(payload)
            if (
                summary.id != path.name[:_BACKUP_ID_LENGTH]
                or summary.archive_bytes != path.stat().st_size
            ):
                raise ValueError("summary does not match archive")
            return summary
        except (OSError, ValueError, json.JSONDecodeError):
            manifest = self._validate_archive(path, expected_id=path.name[:_BACKUP_ID_LENGTH])
        counts = cast(dict[str, Any], manifest["counts"])
        return BackupSummary(
            id=cast(str, manifest["backup_id"]),
            created_at=datetime.fromisoformat(
                cast(str, manifest["created_at"]).replace("Z", "+00:00")
            ),
            archive_bytes=path.stat().st_size,
            clothing_items=int(counts["clothing_items"]),
            outfits=int(counts["outfits"]),
            media_files=int(counts["media_files"]),
        )

    @staticmethod
    def _write_summary_sidecar(path: Path, summary: BackupSummary) -> None:
        destination = path.with_name(f"{path.name}.summary.json")
        temporary = destination.with_suffix(".tmp")
        descriptor = _exclusive_descriptor(temporary)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(summary.model_dump_json())
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, destination)
        _fsync_directory(destination.parent)

    def _validate_archive(self, path: Path, *, expected_id: str) -> dict[str, Any]:
        try:
            if (
                path.is_symlink()
                or not path.is_file()
                or path.stat().st_size > self.settings.max_backup_archive_bytes
            ):
                raise DomainValidationError(
                    code="backup_archive_invalid",
                    message="The Muse backup archive is invalid.",
                )
            with zipfile.ZipFile(path, "r") as archive:
                infos = archive.infolist()
                if len(infos) > self.settings.max_backup_entry_count:
                    raise DomainValidationError(
                        code="backup_archive_invalid",
                        message="The Muse backup archive contains too many files.",
                    )
                names: set[str] = set()
                casefolded_names: set[str] = set()
                total = 0
                for info in infos:
                    pure = PurePosixPath(info.filename)
                    mode = info.external_attr >> 16
                    file_type = mode & 0o170000
                    if (
                        info.filename in names
                        or info.filename.casefold() in casefolded_names
                        or info.is_dir()
                        or pure.is_absolute()
                        or any(part in {"", ".", ".."} for part in pure.parts)
                        or (file_type and not stat.S_ISREG(mode))
                        or bool(info.flag_bits & 0x1)
                        or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                    ):
                        raise DomainValidationError(
                            code="backup_archive_invalid",
                            message="The Muse backup archive contains an unsafe entry.",
                        )
                    names.add(info.filename)
                    casefolded_names.add(info.filename.casefold())
                    total += info.file_size
                    if total > self.settings.max_backup_archive_bytes:
                        raise DomainValidationError(
                            code="backup_archive_invalid",
                            message="The Muse backup archive expands beyond the configured limit.",
                        )
                    if (
                        info.file_size > 0
                        and info.file_size
                        > max(1, info.compress_size) * self.settings.max_backup_compression_ratio
                    ):
                        raise DomainValidationError(
                            code="backup_archive_invalid",
                            message="The Muse backup archive has an unsafe compression ratio.",
                        )
                if _MANIFEST not in names or _DATABASE_ENTRY not in names:
                    raise DomainValidationError(
                        code="backup_archive_invalid",
                        message="The Muse backup archive is incomplete.",
                    )
                manifest_info = archive.getinfo(_MANIFEST)
                if manifest_info.file_size > _MAX_MANIFEST_BYTES:
                    raise DomainValidationError(
                        code="backup_manifest_invalid",
                        message="The Muse backup manifest is too large.",
                    )
                manifest = json.loads(archive.read(_MANIFEST))
                self._validate_manifest(manifest, names=names, expected_id=expected_id)
                for entry in manifest["files"]:
                    with archive.open(entry["path"]) as content:
                        size, digest = _stream_digest(content)
                    if size != entry["size"] or digest != entry["sha256"]:
                        raise DomainValidationError(
                            code="backup_checksum_invalid",
                            message="The Muse backup archive did not pass its checksum validation.",
                        )
                with tempfile.TemporaryDirectory(
                    prefix="verify-", dir=self.settings.maintenance_root
                ) as temporary:
                    database_copy = Path(temporary) / "muse.sqlite3"
                    with (
                        archive.open(_DATABASE_ENTRY) as source,
                        database_copy.open("wb") as output,
                    ):
                        shutil.copyfileobj(source, output, length=1024 * 1024)
                    _database_integrity(database_copy, _head_revisions())
                    connection = sqlite3.connect(database_copy)
                    try:
                        if connection.execute(
                            "SELECT count(*) FROM phone_upload_sessions"
                        ).fetchone() != (0,):
                            raise DomainValidationError(
                                code="backup_contains_sessions",
                                message="The Muse backup contains private upload-session data.",
                            )
                    finally:
                        connection.close()
                return cast(dict[str, Any], manifest)
        except (
            OSError,
            zipfile.BadZipFile,
            KeyError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
        ) as error:
            if isinstance(error, DomainValidationError):
                raise
            raise DomainValidationError(
                code="backup_archive_invalid",
                message="The Muse backup archive is invalid.",
            ) from error

    @staticmethod
    def _validate_manifest(manifest: Any, *, names: set[str], expected_id: str) -> None:
        if not isinstance(manifest, dict) or set(manifest) != {
            "format",
            "backup_id",
            "created_at",
            "app_version",
            "schema_revisions",
            "counts",
            "files",
        }:
            raise DomainValidationError(
                code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
            )
        if manifest["format"] != _FORMAT or manifest["backup_id"] != expected_id:
            raise DomainValidationError(
                code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
            )
        datetime.fromisoformat(str(manifest["created_at"]).replace("Z", "+00:00"))
        if not isinstance(manifest["schema_revisions"], list) or not isinstance(
            manifest["files"], list
        ):
            raise DomainValidationError(
                code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
            )
        counts = manifest["counts"]
        if (
            not isinstance(counts, dict)
            or set(counts) != {"clothing_items", "outfits", "media_files"}
            or any(type(value) is not int or value < 0 for value in counts.values())
        ):
            raise DomainValidationError(
                code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
            )
        file_names: set[str] = set()
        for entry in manifest["files"]:
            if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
                raise DomainValidationError(
                    code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
                )
            name = entry["path"]
            if (
                not isinstance(name, str)
                or name in file_names
                or (name != _DATABASE_ENTRY and not name.startswith("media/"))
            ):
                raise DomainValidationError(
                    code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
                )
            if (
                type(entry["size"]) is not int
                or entry["size"] < 0
                or not isinstance(entry["sha256"], str)
                or len(entry["sha256"]) != 64
                or any(character not in "0123456789abcdef" for character in entry["sha256"])
            ):
                raise DomainValidationError(
                    code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
                )
            file_names.add(name)
        if file_names | {_MANIFEST} != names:
            raise DomainValidationError(
                code="backup_manifest_invalid",
                message="The Muse backup archive contains unexpected files.",
            )
        if counts["media_files"] != len(file_names - {_DATABASE_ENTRY}):
            raise DomainValidationError(
                code="backup_manifest_invalid", message="The Muse backup manifest is invalid."
            )

    def _extract_validated(self, source: Path, destination: Path) -> None:
        manifest = self._validate_archive(source, expected_id=source.name[:_BACKUP_ID_LENGTH])
        (destination / "media").mkdir(mode=0o700, parents=True, exist_ok=True)
        with zipfile.ZipFile(source, "r") as archive:
            for entry in manifest["files"]:
                name = cast(str, entry["path"])
                target = destination / Path(*PurePosixPath(name).parts)
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor = _exclusive_descriptor(target)
                with archive.open(name) as input_file, os.fdopen(descriptor, "wb") as output:
                    shutil.copyfileobj(input_file, output, length=1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
                target.chmod(0o600)
            staged_manifest = destination / "staged-manifest.json"
            descriptor = _exclusive_descriptor(staged_manifest)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(manifest, output, sort_keys=True, separators=(",", ":"))
                output.flush()
                os.fsync(output.fileno())
            staged_manifest.chmod(0o600)
        for directory in sorted(
            (path for path in destination.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        ):
            _fsync_directory(directory)
        _fsync_directory(destination)

    @staticmethod
    def _reserve_pending(pending: Path) -> None:
        try:
            descriptor = _exclusive_descriptor(pending)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write('{"status":"reserving"}')
                output.flush()
                os.fsync(output.fileno())
            pending.chmod(0o600)
            _fsync_directory(pending.parent)
        except FileExistsError as error:
            raise ResourceConflictError(
                code="maintenance_already_staged",
                message="A Muse maintenance operation is already waiting for restart.",
            ) from error

    @staticmethod
    def _write_pending(marker: dict[str, str], pending: Path) -> None:
        temporary = pending.with_suffix(".tmp")
        temporary.unlink(missing_ok=True)
        descriptor = _exclusive_descriptor(temporary)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(marker, output, sort_keys=True, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, pending)
        _fsync_directory(pending.parent)
