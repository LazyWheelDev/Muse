import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import URL, Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

SQLITE_BUSY_TIMEOUT_MILLISECONDS = 5_000


def database_url(database_path: Path) -> URL:
    return URL.create("sqlite+pysqlite", database=str(database_path))


class Database:
    def __init__(self, database_path: Path) -> None:
        self.engine = create_engine(
            database_url(database_path),
            connect_args={"autocommit": False, "timeout": 5.0},
            hide_parameters=True,
            pool_size=5,
            max_overflow=0,
            pool_timeout=5.0,
        )
        event.listen(self.engine, "connect", configure_sqlite_connection)
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
            autoflush=False,
        )

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def dispose(self) -> None:
        self.engine.dispose()


def configure_sqlite_connection(
    dbapi_connection: sqlite3.Connection,
    connection_record: ConnectionPoolEntry,
) -> None:
    del connection_record
    previous_autocommit = dbapi_connection.autocommit
    dbapi_connection.autocommit = True
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MILLISECONDS}")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=FULL")
        cursor.close()
    finally:
        dbapi_connection.autocommit = previous_autocommit


def verify_database_connection(engine: Engine) -> bool:
    try:
        with engine.connect() as connection:
            database_ok = bool(connection.exec_driver_sql("SELECT 1").scalar_one() == 1)
            foreign_keys_enabled = bool(
                connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            )
        return database_ok and foreign_keys_enabled
    except Exception:
        return False
