import argparse
import ipaddress
import logging
import sys
from pathlib import Path

import uvicorn

from muse_backend.application import create_app
from muse_backend.config import Environment, Settings
from muse_backend.database.engine import Database
from muse_backend.database.migrations import (
    check_migration_consistency,
    migration_status,
    upgrade_database,
)
from muse_backend.domain.exceptions import MuseError
from muse_backend.phone_upload.application import create_phone_upload_app
from muse_backend.services.background_processing import reconcile_temporary_imports
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.phone_upload_sessions import PhoneUploadSessionService
from muse_backend.storage.local import LocalStorageService

logger = logging.getLogger(__name__)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="muse-backend", description="Manage the local Muse API")
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="run the FastAPI server")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")

    commands.add_parser(
        "serve-phone-upload",
        help="run the restricted phone-upload listener on its configured LAN interface",
    )

    migrate = commands.add_parser("migrate", help="upgrade the configured database")
    migrate.add_argument("revision", nargs="?", default="head")

    commands.add_parser("migration-status", help="show current and expected revisions")
    commands.add_parser("migration-check", help="check models against the migration head")
    commands.add_parser(
        "cleanup-phone-upload-sessions",
        help="reconcile and remove one bounded batch of retained phone-upload sessions",
    )

    reset = commands.add_parser("reset-dev", help="reset only the configured development database")
    reset.add_argument(
        "--confirm",
        action="store_true",
        help="confirm destructive removal of the configured development database",
    )
    return parser


def _remove_database_files(database_path: Path) -> None:
    for candidate in (
        database_path,
        Path(f"{database_path}-wal"),
        Path(f"{database_path}-shm"),
    ):
        if candidate.is_symlink():
            raise RuntimeError("refusing to remove a symbolic-link database file")
        if candidate.exists():
            if not candidate.is_file():
                raise RuntimeError("refusing to remove a non-file database path")
            candidate.unlink()


def _reset_development_database(settings: Settings, *, confirmed: bool) -> None:
    if settings.environment is not Environment.DEVELOPMENT:
        raise RuntimeError("reset-dev is available only in the development environment")
    if not confirmed:
        raise RuntimeError("reset-dev requires --confirm")
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    _remove_database_files(settings.database_path)
    upgrade_database(settings)


def _is_loopback_host(host: str) -> bool:
    if host.lower().removesuffix(".") == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _cleanup_phone_upload_sessions(settings: Settings) -> int:
    storage = LocalStorageService(settings)
    storage.create_required_directories()
    storage.secure_database_file()
    database = Database(settings.database_path)
    try:
        if not migration_status(settings, database).is_current:
            raise RuntimeError("phone-upload cleanup requires a current database migration")
        service = PhoneUploadSessionService(database=database, settings=settings)
        with InterprocessImportLock(settings).acquire(blocking=True):
            processed = service.cleanup()
            return processed + reconcile_temporary_imports(
                settings=settings,
                storage=storage,
                database=database,
                limit=max(0, settings.phone_upload_cleanup_batch_size - processed),
            )
    finally:
        database.dispose()


def main() -> None:
    arguments = _parser().parse_args()
    settings = Settings()
    logging.basicConfig(level=settings.log_level)

    try:
        if arguments.command == "serve":
            if settings.environment is Environment.PRODUCTION and not _is_loopback_host(
                arguments.host
            ):
                raise RuntimeError("the production Muse application must bind to loopback")
            if arguments.reload:
                if settings.environment is not Environment.DEVELOPMENT:
                    raise RuntimeError("--reload is available only in development")
                uvicorn.run(
                    "muse_backend.main:app",
                    host=arguments.host,
                    port=arguments.port,
                    reload=True,
                    workers=1,
                    log_level=settings.log_level.lower(),
                    proxy_headers=False,
                )
            else:
                uvicorn.run(
                    create_app(settings),
                    host=arguments.host,
                    port=arguments.port,
                    workers=1,
                    log_level=settings.log_level.lower(),
                    proxy_headers=False,
                )
        elif arguments.command == "serve-phone-upload":
            if not settings.phone_upload_enabled:
                raise RuntimeError("the dedicated phone-upload listener is disabled")
            uvicorn.run(
                create_phone_upload_app(settings),
                host=str(settings.phone_upload_bind_host),
                port=settings.phone_upload_port,
                workers=1,
                log_level=settings.log_level.lower(),
                access_log=False,
                proxy_headers=False,
                server_header=False,
            )
        elif arguments.command == "migrate":
            upgrade_database(settings, arguments.revision)
        elif arguments.command == "migration-status":
            status = migration_status(settings)
            print(f"current: {', '.join(status.current_revisions) or 'none'}")
            print(f"head: {', '.join(status.head_revisions) or 'none'}")
            if not status.is_current:
                raise RuntimeError("database migration is not current")
        elif arguments.command == "migration-check":
            check_migration_consistency(settings)
        elif arguments.command == "cleanup-phone-upload-sessions":
            processed = _cleanup_phone_upload_sessions(settings)
            print(f"processed phone-upload cleanup records: {processed}")
        elif arguments.command == "reset-dev":
            _reset_development_database(settings, confirmed=arguments.confirm)
    except MuseError as error:
        logger.error("%s", error.message)
        sys.exit(1)
    except (OSError, RuntimeError) as error:
        logger.error("%s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
