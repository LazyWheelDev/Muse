import stat
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import func, inspect, select
from sqlalchemy.dialects.sqlite import dialect as sqlite_dialect

from muse_backend.config import REPOSITORY_ROOT, Environment, Settings
from muse_backend.database.base import UTCDateTime
from muse_backend.database.engine import (
    SQLITE_BUSY_TIMEOUT_MILLISECONDS,
    Database,
    database_url,
    verify_database_connection,
)
from muse_backend.database.migrations import (
    check_migration_consistency,
    downgrade_database,
    migration_status,
    upgrade_database,
)
from muse_backend.database.models import ClothingItem
from muse_backend.storage.local import LocalStorageService

pytestmark = pytest.mark.integration


def test_settings_resolve_all_writable_paths_under_external_data_root(tmp_path: Path) -> None:
    data_root = tmp_path / "muse-data"
    frontend_path = tmp_path / "frontend" / "dist"

    settings = Settings(
        environment="production",
        data_root=data_root,
        frontend_build_path=frontend_path,
        log_level="warning",
        allowed_origins=["http://localhost:5173/"],
    )

    assert settings.environment is Environment.PRODUCTION
    assert settings.log_level == "WARNING"
    assert settings.data_root == data_root.resolve()
    assert settings.database_path == (data_root / "muse.sqlite3").resolve()
    assert settings.original_image_root.is_relative_to(settings.media_root)
    assert settings.frontend_build_path == frontend_path.resolve()
    assert settings.allowed_origins == ["http://localhost:5173"]
    assert all(path.is_relative_to(settings.data_root) for path in settings.required_directories)


@pytest.mark.parametrize("environment", [Environment.TESTING, Environment.PRODUCTION])
def test_settings_reject_non_development_data_inside_repository(
    environment: Environment,
) -> None:
    with pytest.raises(ValidationError, match="outside the source tree"):
        Settings(environment=environment, data_root=REPOSITORY_ROOT / "unsafe-data")


def test_settings_reject_writable_or_media_paths_that_escape_their_roots(tmp_path: Path) -> None:
    data_root = tmp_path / "data"

    with pytest.raises(ValidationError, match="beneath data_root"):
        Settings(data_root=data_root, database_path=tmp_path / "outside.sqlite3")

    with pytest.raises(ValidationError, match="beneath media_root"):
        Settings(data_root=data_root, original_image_root=data_root / "outside-originals")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("database_path", Path("media/exposed.sqlite3")),
        ("temp_upload_root", Path("media/exposed-tmp")),
        ("temp_preview_root", Path("media/exposed-previews")),
        ("backup_root", Path("media/exposed-backups")),
    ],
)
def test_settings_keep_private_storage_out_of_public_media(
    tmp_path: Path,
    field: str,
    value: Path,
) -> None:
    with pytest.raises(ValidationError, match="must not overlap"):
        Settings.model_validate({"data_root": tmp_path / "data", field: value})


@pytest.mark.parametrize("field", ["temp_upload_root", "temp_preview_root", "backup_root"])
def test_settings_reject_private_directory_ancestors_of_media(
    tmp_path: Path,
    field: str,
) -> None:
    with pytest.raises(ValidationError, match="must not overlap"):
        Settings.model_validate({"data_root": tmp_path / "data", field: Path(".")})


def test_settings_reject_frontend_and_data_path_overlap(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    with pytest.raises(ValidationError, match="must not overlap"):
        Settings(data_root=data_root, frontend_build_path=data_root / "public")

    build_root = tmp_path / "public"
    with pytest.raises(ValidationError, match="must not overlap"):
        Settings(data_root=build_root / "private-data", frontend_build_path=build_root)


def test_settings_reject_overlapping_public_media_directories(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="image and preview directories must not overlap"):
        Settings(
            data_root=tmp_path / "data",
            processed_image_root=Path("media/garments/original/processed"),
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("log_level", "verbose", "supported Python logging level"),
        ("trusted_hosts", [], "at least one host"),
        ("trusted_hosts", ["http://localhost"], "without schemes or paths"),
        ("trusted_hosts", ["local\thost"], "without schemes or paths"),
        ("trusted_hosts", ["local\x7fhost"], "without schemes or paths"),
        ("trusted_hosts", ["bad*host"], "without schemes or paths"),
        ("allowed_origins", ["ws://localhost"], "valid HTTP origins"),
        ("allowed_origins", ["http://local\thost"], "valid HTTP origins"),
        ("allowed_origins", ["http://local\x7fhost"], "valid HTTP origins"),
        ("allowed_origins", ["http://user@localhost"], "valid HTTP origins"),
        ("allowed_origins", ["http://localhost/path"], "without paths"),
    ],
)
def test_settings_reject_invalid_operational_values(
    tmp_path: Path,
    field: str,
    value: object,
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        Settings.model_validate({"data_root": tmp_path / "data", field: value})


def test_migrations_upgrade_check_status_and_downgrade(settings: Settings) -> None:
    LocalStorageService(settings).create_required_directories()

    initial = migration_status(settings)
    assert initial.current_revisions == ()
    assert initial.head_revisions == ("20260715_0002",)
    assert not initial.is_current

    upgrade_database(settings)
    current = migration_status(settings)
    assert current.is_current
    check_migration_consistency(settings)

    database = Database(settings.database_path)
    try:
        assert set(inspect(database.engine).get_table_names()) == {
            "alembic_version",
            "application_settings",
            "clothing_images",
            "clothing_items",
            "outfit_items",
            "outfits",
        }
        assert migration_status(settings, database).is_current
    finally:
        database.dispose()

    downgrade_database(settings)
    assert migration_status(settings).current_revisions == ()
    upgrade_database(settings, "head")
    assert migration_status(settings).is_current


def test_migration_bootstrap_uses_owner_only_storage_permissions(tmp_path: Path) -> None:
    settings = Settings(environment="testing", data_root=tmp_path / "fresh-data")

    upgrade_database(settings)

    assert stat.S_IMODE(settings.data_root.stat().st_mode) == 0o700
    assert stat.S_IMODE(settings.database_path.stat().st_mode) == 0o600
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o700 for path in settings.required_directories)


def test_sqlite_connection_pragmas_and_transaction_rollback(
    migrated_settings: Settings,
) -> None:
    database = Database(migrated_settings.database_path)
    try:
        assert database.engine.hide_parameters
        assert database_url(migrated_settings.database_path).drivername == "sqlite+pysqlite"
        assert verify_database_connection(database.engine)
        with database.engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            assert (
                connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
                == SQLITE_BUSY_TIMEOUT_MILLISECONDS
            )
            assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
            assert connection.exec_driver_sql("PRAGMA synchronous").scalar_one() == 2

        with (
            pytest.raises(RuntimeError, match="force rollback"),
            database.session() as session,
            session.begin(),
        ):
            session.add(ClothingItem(name="Rolled back", garment_category="top"))
            session.flush()
            raise RuntimeError("force rollback")

        with database.session() as session:
            count = session.scalar(select(func.count(ClothingItem.id)))
            assert count == 0
    finally:
        database.dispose()


def test_database_verification_returns_false_for_unopenable_path(tmp_path: Path) -> None:
    database = Database(tmp_path)
    try:
        assert not verify_database_connection(database.engine)
    finally:
        database.dispose()


@pytest.mark.unit
def test_utc_datetime_round_trip_contract() -> None:
    column_type = UTCDateTime()
    dialect = sqlite_dialect()
    aware = datetime(2026, 7, 15, 12, 30, tzinfo=UTC)

    bound = column_type.process_bind_param(aware, dialect)
    assert bound == datetime(2026, 7, 15, 12, 30)
    assert column_type.process_result_value(bound, dialect) == aware
    assert column_type.process_bind_param(None, dialect) is None
    assert column_type.process_result_value(None, dialect) is None
    with pytest.raises(ValueError, match="timezone-aware"):
        column_type.process_bind_param(datetime(2026, 7, 15, 12, 30), dialect)
