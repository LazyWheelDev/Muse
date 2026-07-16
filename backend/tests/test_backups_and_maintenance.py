import hashlib
import json
import os
import shutil
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from muse_backend.config import Settings
from muse_backend.database.migrations import migration_status
from muse_backend.database.models import ClothingImage, ClothingItem, PhoneUploadSession
from muse_backend.domain.enums import ImageKind, PhoneUploadSessionStatus
from muse_backend.domain.exceptions import DomainValidationError
from muse_backend.services.backups import BackupService
from muse_backend.services.maintenance import apply_staged_maintenance
from muse_backend.services.runtime_lock import RuntimeServicesActiveError
from tests.support import running_client

pytestmark = pytest.mark.integration


def _seed_garment(app: FastAPI, settings: Settings, *, name: str) -> Path:
    relative_path = f"garments/original/{'a' * 32}.jpg"
    media = settings.media_root / relative_path
    media.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    media.write_bytes(b"safe-original-image")
    with app.state.database.session() as session, session.begin():
        item = ClothingItem(name=name, garment_category="top")
        session.add(item)
        session.flush()
        session.add(
            ClothingImage(
                clothing_item_id=item.id,
                image_kind=ImageKind.ORIGINAL.value,
                relative_path=relative_path,
                mime_type="image/jpeg",
                width=10,
                height=10,
                byte_size=media.stat().st_size,
                is_primary=True,
                content_sha256=hashlib.sha256(media.read_bytes()).hexdigest(),
                image_group_id="b" * 32,
            )
        )
        session.add(
            PhoneUploadSession(
                id="c" * 32,
                token_hash="d" * 64,
                status=PhoneUploadSessionStatus.PENDING.value,
                expires_at=app.state.started_at,
            )
        )
    return media


async def test_backup_is_atomic_checksummed_sanitized_and_contains_referenced_media_only(
    app: FastAPI,
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    media = _seed_garment(app, migrated_settings, name="Backed Up Shirt")
    unreferenced = migrated_settings.media_root / "garments/original" / f"{'e' * 32}.jpg"
    unreferenced.write_bytes(b"unreferenced")

    created = await client.post(
        "/api/v1/settings/backups",
        json={"confirmation": "CREATE BACKUP"},
    )
    assert created.status_code == 201, created.text
    backup = created.json()
    assert backup["clothing_items"] == 1
    assert backup["media_files"] == 1

    archive_path = BackupService(migrated_settings).validated_path(backup["id"])
    with zipfile.ZipFile(archive_path) as archive:
        assert set(archive.namelist()) == {
            "manifest.json",
            "database/muse.sqlite3",
            f"media/{media.relative_to(migrated_settings.media_root).as_posix()}",
        }
        manifest = json.loads(archive.read("manifest.json"))
        assert [entry["path"] for entry in manifest["files"]] == sorted(
            entry["path"] for entry in manifest["files"]
        )
        for entry in manifest["files"]:
            content = archive.read(entry["path"])
            assert len(content) == entry["size"]
            assert hashlib.sha256(content).hexdigest() == entry["sha256"]
        snapshot = migrated_settings.maintenance_root / "backup-test.sqlite3"
        snapshot.write_bytes(archive.read("database/muse.sqlite3"))
    connection = sqlite3.connect(snapshot)
    try:
        assert connection.execute("SELECT count(*) FROM phone_upload_sessions").fetchone() == (0,)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()

    listing = await client.get("/api/v1/settings/backups")
    settings_response = await client.get("/api/v1/settings")
    assert listing.json() == {"items": [backup], "total": 1}
    assert settings_response.json()["last_successful_backup"] == backup


async def test_backup_mutations_require_typed_confirmation_and_support_safe_download_delete(
    client: httpx.AsyncClient,
) -> None:
    missing_confirmation = await client.post("/api/v1/settings/backups", json={})
    assert missing_confirmation.status_code == 422
    created = await client.post(
        "/api/v1/settings/backups",
        json={"confirmation": "CREATE BACKUP"},
    )
    backup_id = created.json()["id"]
    download = await client.get(f"/api/v1/settings/backups/{backup_id}/download")
    wrong_delete = await client.request(
        "DELETE",
        f"/api/v1/settings/backups/{backup_id}",
        json={"confirmation": "DELETE ALL MUSE DATA"},
    )
    deleted = await client.request(
        "DELETE",
        f"/api/v1/settings/backups/{backup_id}",
        json={"confirmation": "DELETE BACKUP"},
    )

    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert download.headers["cache-control"] == "no-store"
    assert wrong_delete.status_code == 422
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/settings/backups")).json()["total"] == 0


async def test_staged_restore_requires_stopped_services_and_restores_with_checksum_validation(
    app: FastAPI,
    client: httpx.AsyncClient,
    migrated_settings: Settings,
) -> None:
    _seed_garment(app, migrated_settings, name="Restore Me")
    backup = await client.post(
        "/api/v1/settings/backups",
        json={"confirmation": "CREATE BACKUP"},
    )
    backup_id = backup.json()["id"]
    with app.state.database.session() as session, session.begin():
        session.add(ClothingItem(name="Remove Me", garment_category="bottom"))
    staged = await client.post(
        f"/api/v1/settings/backups/{backup_id}/stage-restore",
        json={"confirmation": "RESTORE"},
    )
    assert staged.status_code == 202
    assert staged.json()["status"] == "staged_restart_required"
    with pytest.raises(RuntimeServicesActiveError):
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )

    # The active fixture still owns the runtime lease; activation is verified
    # in the standalone test below after the application lifespan exits.


async def test_offline_restore_activation_and_delete_all_are_rollback_safe(
    migrated_settings: Settings,
) -> None:
    async with running_client(migrated_settings) as client:
        app = client._transport.app  # type: ignore[attr-defined]
        _seed_garment(app, migrated_settings, name="Persistent Shirt")
        backup = await client.post(
            "/api/v1/settings/backups",
            json={"confirmation": "CREATE BACKUP"},
        )
        backup_id = backup.json()["id"]
        with app.state.database.session() as session, session.begin():
            session.add(ClothingItem(name="Later Item", garment_category="bottom"))
        staged = await client.post(
            f"/api/v1/settings/backups/{backup_id}/stage-restore",
            json={"confirmation": "RESTORE"},
        )
        assert staged.status_code == 202

    assert (
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
        == "restore"
    )
    connection = sqlite3.connect(migrated_settings.database_path)
    try:
        names = [row[0] for row in connection.execute("SELECT name FROM clothing_items")]
    finally:
        connection.close()
    assert names == ["Persistent Shirt"]
    assert migration_status(migrated_settings).is_current

    async with running_client(migrated_settings) as client:
        deletion = await client.post(
            "/api/v1/settings/data-deletion/stage",
            json={
                "confirmation": "DELETE ALL MUSE DATA",
                "acknowledge_backup_loss": True,
            },
        )
        assert deletion.status_code == 202
    assert (
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
        == "delete_all"
    )
    connection = sqlite3.connect(migrated_settings.database_path)
    try:
        assert connection.execute("SELECT count(*) FROM clothing_items").fetchone() == (0,)
    finally:
        connection.close()
    assert not list(migrated_settings.backup_root.glob("*.muse-backup.zip"))


async def test_tampered_staged_restore_is_refused_before_active_data_changes(
    migrated_settings: Settings,
) -> None:
    async with running_client(migrated_settings) as client:
        app = client._transport.app  # type: ignore[attr-defined]
        media = _seed_garment(app, migrated_settings, name="Safe Active Item")
        backup = await client.post(
            "/api/v1/settings/backups",
            json={"confirmation": "CREATE BACKUP"},
        )
        staged = await client.post(
            f"/api/v1/settings/backups/{backup.json()['id']}/stage-restore",
            json={"confirmation": "RESTORE"},
        )
        operation = migrated_settings.maintenance_root / f"restore-{staged.json()['operation_id']}"
        staged_media = operation / "media" / media.relative_to(migrated_settings.media_root)
        staged_media.write_bytes(b"tampered")

    with pytest.raises(RuntimeError, match="checksum"):
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
    assert media.read_bytes() == b"safe-original-image"
    assert (migrated_settings.maintenance_root / "pending-operation.json").exists()


def test_hostile_backup_archive_is_rejected_without_unbounded_extraction(
    migrated_settings: Settings,
) -> None:
    backup_id = "f" * 32
    archive = migrated_settings.backup_root / f"{backup_id}.muse-backup.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", "{}")
        output.writestr("database/muse.sqlite3", b"not sqlite")
        output.writestr("../escape", b"hostile")

    with pytest.raises(DomainValidationError) as error:
        BackupService(migrated_settings).validated_path(backup_id)
    assert error.value.code == "backup_archive_invalid"
    assert not (migrated_settings.data_root.parent / "escape").exists()


def test_encrypted_zip_entry_is_rejected_before_decompression(migrated_settings: Settings) -> None:
    backup_id = "9" * 32
    archive = migrated_settings.backup_root / f"{backup_id}.muse-backup.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", "{}")
        output.writestr("database/muse.sqlite3", b"not sqlite")
    content = bytearray(archive.read_bytes())
    for signature, flag_offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        cursor = 0
        while (position := content.find(signature, cursor)) >= 0:
            start = position + flag_offset
            flags = int.from_bytes(content[start : start + 2], "little") | 0x1
            content[start : start + 2] = flags.to_bytes(2, "little")
            cursor = start + 2
    archive.write_bytes(content)

    with pytest.raises(DomainValidationError) as error:
        BackupService(migrated_settings).validated_path(backup_id)
    assert error.value.code == "backup_archive_invalid"


async def test_valid_backup_remains_successful_when_summary_cache_write_fails(
    client: httpx.AsyncClient,
    migrated_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_sidecar(_path: Path, _summary: object) -> None:
        raise OSError("simulated cache failure")

    monkeypatch.setattr(
        BackupService,
        "_write_summary_sidecar",
        staticmethod(fail_sidecar),
    )
    created = await client.post(
        "/api/v1/settings/backups",
        json={"confirmation": "CREATE BACKUP"},
    )

    assert created.status_code == 201
    backup_id = created.json()["id"]
    assert BackupService(migrated_settings).validated_path(backup_id).is_file()
    assert (await client.get("/api/v1/settings/backups")).json()["total"] == 1


async def test_interrupted_restore_recovers_from_durable_journal(
    migrated_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with running_client(migrated_settings) as client:
        app = client._transport.app  # type: ignore[attr-defined]
        _seed_garment(app, migrated_settings, name="Journal Shirt")
        backup = await client.post(
            "/api/v1/settings/backups",
            json={"confirmation": "CREATE BACKUP"},
        )
        staged = await client.post(
            f"/api/v1/settings/backups/{backup.json()['id']}/stage-restore",
            json={"confirmation": "RESTORE"},
        )
        assert staged.status_code == 202

    original_replace = os.replace

    def interrupt_after_database_move(
        source: str | os.PathLike[str],
        destination: str | os.PathLike[str],
    ) -> None:
        original_replace(source, destination)
        if Path(source) == migrated_settings.database_path:
            raise KeyboardInterrupt

    monkeypatch.setattr(os, "replace", interrupt_after_database_move)
    with pytest.raises(KeyboardInterrupt):
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
    assert (migrated_settings.maintenance_root / "activation-journal.json").exists()
    assert (migrated_settings.maintenance_root / "pending-operation.json").exists()

    monkeypatch.setattr(os, "replace", original_replace)
    assert (
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
        == "restore"
    )
    connection = sqlite3.connect(migrated_settings.database_path)
    try:
        assert connection.execute("SELECT name FROM clothing_items").fetchall() == [
            ("Journal Shirt",)
        ]
    finally:
        connection.close()


async def test_committed_rollback_cleanup_is_reconciled_but_pending_rollback_is_preserved(
    migrated_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with running_client(migrated_settings) as client:
        app = client._transport.app  # type: ignore[attr-defined]
        _seed_garment(app, migrated_settings, name="Cleanup Shirt")
        backup = await client.post(
            "/api/v1/settings/backups",
            json={"confirmation": "CREATE BACKUP"},
        )
        staged = await client.post(
            f"/api/v1/settings/backups/{backup.json()['id']}/stage-restore",
            json={"confirmation": "RESTORE"},
        )
        operation_id = staged.json()["operation_id"]

    original_rmtree = shutil.rmtree

    def fail_rollback_cleanup(path: str | os.PathLike[str], *args: Any, **kwargs: Any) -> None:
        if Path(path).name == f"rollback-{operation_id}":
            raise OSError("simulated committed cleanup failure")
        original_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", fail_rollback_cleanup)
    assert (
        apply_staged_maintenance(
            migrated_settings,
            confirmation="APPLY STAGED MUSE MAINTENANCE",
        )
        == "restore"
    )
    committed_rollback = migrated_settings.maintenance_root / f"rollback-{operation_id}"
    assert committed_rollback.exists()

    monkeypatch.setattr(shutil, "rmtree", original_rmtree)
    assert BackupService(migrated_settings).reconcile_committed_cleanup(limit=10) == 1
    assert not committed_rollback.exists()

    stale_id = "6" * 32
    stale_rollback = migrated_settings.maintenance_root / f"rollback-{stale_id}"
    stale_rollback.mkdir()
    (stale_rollback / "committed").write_text("data", encoding="utf-8")
    (migrated_settings.maintenance_root / "activation-journal.json").write_text(
        json.dumps({"type": "restore", "operation_id": stale_id, "phase": "new_moved"}),
        encoding="utf-8",
    )
    assert BackupService(migrated_settings).reconcile_committed_cleanup(limit=10) == 1
    assert not stale_rollback.exists()
    assert not (migrated_settings.maintenance_root / "activation-journal.json").exists()

    protected_id = "7" * 32
    protected_rollback = migrated_settings.maintenance_root / f"rollback-{protected_id}"
    protected_rollback.mkdir()
    (protected_rollback / "preserved").write_text("data", encoding="utf-8")
    (migrated_settings.maintenance_root / "pending-operation.json").write_text(
        json.dumps(
            {
                "type": "delete_all",
                "operation_id": protected_id,
                "safety_backup_id": "8" * 32,
            }
        ),
        encoding="utf-8",
    )
    assert BackupService(migrated_settings).reconcile_committed_cleanup(limit=10) == 0
    assert protected_rollback.exists()
