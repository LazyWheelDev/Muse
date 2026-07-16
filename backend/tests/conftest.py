from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from muse_backend.application import create_app
from muse_backend.config import Environment, Settings
from muse_backend.database.migrations import upgrade_database
from muse_backend.storage.local import LocalStorageService


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment=Environment.TESTING,
        data_root=tmp_path / "data",
        frontend_build_path=tmp_path / "frontend-dist",
        allowed_origins=[],
        trusted_hosts=["testserver"],
        phone_upload_enabled=False,
    )


@pytest.fixture
def migrated_settings(settings: Settings) -> Settings:
    LocalStorageService(settings).create_required_directories()
    upgrade_database(settings)
    return settings


@pytest.fixture
async def app(migrated_settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(migrated_settings)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as active:
        yield active
