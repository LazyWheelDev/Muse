from enum import StrEnum
from pathlib import Path
from typing import Self
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = BACKEND_ROOT.parent


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TESTING = "testing"
    PRODUCTION = "production"


def _default_data_root() -> Path:
    return REPOSITORY_ROOT / "local-data"


def _default_frontend_build_path() -> Path:
    return REPOSITORY_ROOT / "frontend" / "dist"


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MUSE_",
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Environment = Environment.DEVELOPMENT
    data_root: Path = Field(default_factory=_default_data_root)
    database_path: Path = Path("muse.sqlite3")
    media_root: Path = Path("media")
    temp_upload_root: Path = Path("tmp/uploads")
    original_image_root: Path = Path("media/garments/original")
    processed_image_root: Path = Path("media/garments/processed")
    thumbnail_root: Path = Path("media/garments/thumbnails")
    outfit_preview_root: Path = Path("media/outfits/previews")
    backup_root: Path = Path("backups")
    max_upload_size_bytes: int = Field(default=25 * 1024 * 1024, ge=1024, le=500 * 1024 * 1024)
    max_api_body_size_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024)
    log_level: str = "INFO"
    frontend_build_path: Path = Field(default_factory=_default_frontend_build_path)
    serve_frontend: bool = False
    trusted_hosts: list[str] = Field(
        default_factory=lambda: ["127.0.0.1", "localhost", "testserver"]
    )
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:5173", "http://localhost:5173"]
    )

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("must be a supported Python logging level")
        return normalized

    @field_validator("trusted_hosts")
    @classmethod
    def validate_trusted_hosts(cls, values: list[str]) -> list[str]:
        if not values:
            raise ValueError("must contain at least one host")
        for value in values:
            if (
                not value
                or value != value.strip()
                or any(
                    character.isspace() or ord(character) < 32 or ord(character) == 127
                    for character in value
                )
                or "://" in value
                or "/" in value
                or (
                    "*" in value
                    and (not value.startswith("*.") or "*" in value[1:])
                    and value != "*"
                )
            ):
                raise ValueError("must contain host patterns without schemes or paths")
        return [value.lower() for value in values]

    @field_validator("allowed_origins")
    @classmethod
    def validate_allowed_origins(cls, values: list[str]) -> list[str]:
        normalized_origins: list[str] = []
        for value in values:
            if value != value.strip() or any(
                character.isspace() or ord(character) < 32 or ord(character) == 127
                for character in value
            ):
                raise ValueError("must contain valid HTTP origins")
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.hostname is None
                or parsed.username is not None
                or parsed.password is not None
            ):
                raise ValueError("must contain valid HTTP origins")
            if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                raise ValueError("must contain origins without paths, queries, or fragments")
            host = parsed.hostname.lower()
            rendered_host = f"[{host}]" if ":" in host else host
            try:
                port = parsed.port
            except ValueError as error:
                raise ValueError("must contain valid HTTP origins") from error
            rendered_port = f":{port}" if port is not None else ""
            normalized_origins.append(f"{parsed.scheme.lower()}://{rendered_host}{rendered_port}")
        return normalized_origins

    @model_validator(mode="after")
    def resolve_and_validate_paths(self) -> Self:
        self.data_root = self._resolve_project_path(self.data_root)
        self.database_path = self._resolve_data_path(self.database_path)
        self.media_root = self._resolve_data_path(self.media_root)
        self.temp_upload_root = self._resolve_data_path(self.temp_upload_root)
        self.original_image_root = self._resolve_data_path(self.original_image_root)
        self.processed_image_root = self._resolve_data_path(self.processed_image_root)
        self.thumbnail_root = self._resolve_data_path(self.thumbnail_root)
        self.outfit_preview_root = self._resolve_data_path(self.outfit_preview_root)
        self.backup_root = self._resolve_data_path(self.backup_root)
        self.frontend_build_path = self._resolve_project_path(self.frontend_build_path)

        for path in (
            self.database_path,
            self.media_root,
            self.temp_upload_root,
            self.original_image_root,
            self.processed_image_root,
            self.thumbnail_root,
            self.outfit_preview_root,
            self.backup_root,
        ):
            if not _is_within(path, self.data_root):
                raise ValueError("writable paths must remain beneath data_root")

        public_media_directories = (
            self.original_image_root,
            self.processed_image_root,
            self.thumbnail_root,
            self.outfit_preview_root,
        )
        for path in public_media_directories:
            if not _is_within(path, self.media_root):
                raise ValueError("image and preview paths must remain beneath media_root")
        for index, first in enumerate(public_media_directories):
            for second in public_media_directories[index + 1 :]:
                if _is_within(first, second) or _is_within(second, first):
                    raise ValueError("image and preview directories must not overlap")

        storage_directories = (self.media_root, self.temp_upload_root, self.backup_root)
        for index, first in enumerate(storage_directories):
            for second in storage_directories[index + 1 :]:
                if _is_within(first, second) or _is_within(second, first):
                    raise ValueError("media, temporary, and backup directories must not overlap")

        for directory in storage_directories:
            if _is_within(self.database_path, directory) or _is_within(
                directory, self.database_path
            ):
                raise ValueError("database_path must not overlap runtime storage directories")

        if _is_within(self.frontend_build_path, self.data_root) or _is_within(
            self.data_root, self.frontend_build_path
        ):
            raise ValueError("frontend_build_path and data_root must not overlap")

        if self.environment in {Environment.TESTING, Environment.PRODUCTION} and _is_within(
            self.data_root, REPOSITORY_ROOT
        ):
            raise ValueError("testing and production data must live outside the source tree")
        return self

    @staticmethod
    def _resolve_project_path(path: Path) -> Path:
        if path.is_absolute():
            return path.resolve()
        return (BACKEND_ROOT / path).resolve()

    def _resolve_data_path(self, path: Path) -> Path:
        if path.is_absolute():
            return path.resolve()
        return (self.data_root / path).resolve()

    @property
    def required_directories(self) -> tuple[Path, ...]:
        return tuple(
            dict.fromkeys(
                (
                    self.data_root,
                    self.database_path.parent,
                    self.media_root,
                    self.temp_upload_root,
                    self.original_image_root,
                    self.processed_image_root,
                    self.thumbnail_root,
                    self.outfit_preview_root,
                    self.backup_root,
                )
            )
        )
