from dataclasses import dataclass

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

from muse_backend.config import BACKEND_ROOT, Settings
from muse_backend.database.engine import Database, database_url
from muse_backend.storage.local import LocalStorageService


@dataclass(frozen=True, slots=True)
class MigrationStatus:
    current_revisions: tuple[str, ...]
    head_revisions: tuple[str, ...]

    @property
    def is_current(self) -> bool:
        return set(self.current_revisions) == set(self.head_revisions)


def alembic_config(settings: Settings) -> Config:
    config = Config(BACKEND_ROOT / "alembic.ini")
    rendered_url = database_url(settings.database_path).render_as_string(hide_password=False)
    config.set_main_option("sqlalchemy.url", rendered_url.replace("%", "%%"))
    return config


def _prepare_storage(settings: Settings) -> None:
    LocalStorageService(settings).create_required_directories()


def _secure_database_file(settings: Settings) -> None:
    LocalStorageService(settings).secure_database_file()


def upgrade_database(settings: Settings, revision: str = "head") -> None:
    _prepare_storage(settings)
    try:
        command.upgrade(alembic_config(settings), revision)
    finally:
        _secure_database_file(settings)


def downgrade_database(settings: Settings, revision: str = "base") -> None:
    _prepare_storage(settings)
    try:
        command.downgrade(alembic_config(settings), revision)
    finally:
        _secure_database_file(settings)


def migration_status(settings: Settings, database: Database | None = None) -> MigrationStatus:
    config = alembic_config(settings)
    script = ScriptDirectory.from_config(config)
    heads = tuple(sorted(script.get_heads()))

    owns_database = database is None
    if owns_database:
        _prepare_storage(settings)
    active_database = database or Database(settings.database_path)
    try:
        with active_database.engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"transactional_ddl": True})
            current = tuple(sorted(context.get_current_heads()))
    finally:
        if owns_database:
            active_database.dispose()
            _secure_database_file(settings)
    return MigrationStatus(current_revisions=current, head_revisions=heads)


def check_migration_consistency(settings: Settings) -> None:
    _prepare_storage(settings)
    try:
        command.check(alembic_config(settings))
    finally:
        _secure_database_file(settings)
