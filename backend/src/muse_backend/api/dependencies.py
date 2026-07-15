from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from muse_backend.config import Settings
from muse_backend.database.engine import Database
from muse_backend.storage.local import LocalStorageService


def get_session(request: Request) -> Iterator[Session]:
    database: Database = request.app.state.database
    with database.session() as session:
        yield session


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_storage(request: Request) -> LocalStorageService:
    storage: LocalStorageService = request.app.state.storage
    return storage


SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]
StorageDependency = Annotated[LocalStorageService, Depends(get_storage)]
