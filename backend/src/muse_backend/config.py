from enum import StrEnum
from ipaddress import IPv4Address
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


def _default_phone_frontend_build_path() -> Path:
    return REPOSITORY_ROOT / "frontend" / "dist-phone"


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
    temp_preview_root: Path = Path("tmp/previews")
    original_image_root: Path = Path("media/garments/original")
    processed_image_root: Path = Path("media/garments/processed")
    thumbnail_root: Path = Path("media/garments/thumbnails")
    cutout_image_root: Path = Path("media/garments/cutouts")
    outfit_preview_root: Path = Path("media/outfits/previews")
    backup_root: Path = Path("backups")
    lock_root: Path = Path(".locks")
    max_upload_size_bytes: int = Field(default=25 * 1024 * 1024, ge=1024, le=500 * 1024 * 1024)
    max_import_overhead_bytes: int = Field(default=64 * 1024, ge=4096, le=1024 * 1024)
    upload_chunk_size_bytes: int = Field(default=256 * 1024, ge=16 * 1024, le=1024 * 1024)
    max_image_pixels: int = Field(default=24_000_000, ge=1_000_000, le=100_000_000)
    max_image_dimension: int = Field(default=12_000, ge=512, le=100_000)
    normalized_image_max_dimension: int = Field(default=1600, ge=512, le=4096)
    thumbnail_max_dimension: int = Field(default=384, ge=128, le=1024)
    normalized_webp_quality: int = Field(default=85, ge=1, le=100)
    thumbnail_webp_quality: int = Field(default=80, ge=1, le=100)
    background_processing_enabled: bool = True
    background_processing_max_attempts: int = Field(default=2, ge=1, le=10)
    background_worker_poll_seconds: float = Field(default=0.5, ge=0.05, le=60.0)
    background_shutdown_timeout_seconds: float = Field(default=10.0, ge=0.1, le=120.0)
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
    phone_upload_enabled: bool = False
    phone_upload_bind_host: IPv4Address = IPv4Address("127.0.0.1")
    phone_upload_port: int = Field(default=8787, ge=1, le=65_535)
    phone_upload_advertised_host: str | None = None
    phone_upload_advertised_ipv4: IPv4Address | None = None
    phone_upload_trusted_hosts: list[str] = Field(
        default_factory=lambda: ["127.0.0.1", "localhost", "testserver"]
    )
    phone_upload_frontend_build_path: Path = Field(
        default_factory=_default_phone_frontend_build_path
    )
    phone_upload_session_ttl_seconds: int = Field(default=600, ge=60, le=3600)
    phone_upload_max_attempts: int = Field(default=3, ge=1, le=10)
    phone_upload_receive_timeout_seconds: float = Field(default=120.0, ge=5.0, le=600.0)
    phone_upload_cleanup_interval_seconds: float = Field(default=300.0, ge=30.0, le=3600.0)
    phone_upload_retention_seconds: int = Field(default=86_400, ge=300, le=2_592_000)
    phone_upload_cleanup_batch_size: int = Field(default=100, ge=1, le=1000)
    phone_upload_rate_limit_requests: int = Field(default=60, ge=5, le=1000)
    phone_upload_rate_limit_window_seconds: float = Field(default=60.0, ge=1.0, le=3600.0)
    phone_upload_rate_limit_clients: int = Field(default=256, ge=16, le=4096)

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

    @field_validator("phone_upload_trusted_hosts")
    @classmethod
    def validate_phone_upload_trusted_hosts(cls, values: list[str]) -> list[str]:
        normalized = cls.validate_trusted_hosts(values)
        if any("*" in value for value in normalized):
            raise ValueError("must contain exact phone-upload hosts without wildcards")
        return normalized

    @field_validator("phone_upload_advertised_host")
    @classmethod
    def validate_phone_upload_advertised_host(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower().removesuffix(".")
        if (
            not normalized
            or value != value.strip()
            or not normalized.isascii()
            or len(normalized) > 253
            or "://" in normalized
            or "/" in normalized
            or any(character.isspace() or ord(character) < 32 for character in normalized)
        ):
            raise ValueError("must be a hostname or IPv4 address without a scheme or path")
        try:
            IPv4Address(normalized)
            return normalized
        except ValueError:
            labels = normalized.split(".")
            if any(
                not label
                or len(label) > 63
                or label[0] not in "abcdefghijklmnopqrstuvwxyz0123456789"
                or label[-1] not in "abcdefghijklmnopqrstuvwxyz0123456789"
                or any(
                    character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in label
                )
                for label in labels
            ):
                raise ValueError(
                    "must be a hostname or IPv4 address without a scheme or path"
                ) from None
        return normalized

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
        self.temp_preview_root = self._resolve_data_path(self.temp_preview_root)
        self.original_image_root = self._resolve_data_path(self.original_image_root)
        self.processed_image_root = self._resolve_data_path(self.processed_image_root)
        self.thumbnail_root = self._resolve_data_path(self.thumbnail_root)
        self.cutout_image_root = self._resolve_data_path(self.cutout_image_root)
        self.outfit_preview_root = self._resolve_data_path(self.outfit_preview_root)
        self.backup_root = self._resolve_data_path(self.backup_root)
        self.lock_root = self._resolve_data_path(self.lock_root)
        self.frontend_build_path = self._resolve_project_path(self.frontend_build_path)
        self.phone_upload_frontend_build_path = self._resolve_project_path(
            self.phone_upload_frontend_build_path
        )

        for path in (
            self.database_path,
            self.media_root,
            self.temp_upload_root,
            self.temp_preview_root,
            self.original_image_root,
            self.processed_image_root,
            self.thumbnail_root,
            self.cutout_image_root,
            self.outfit_preview_root,
            self.backup_root,
            self.lock_root,
        ):
            if not _is_within(path, self.data_root):
                raise ValueError("writable paths must remain beneath data_root")

        public_media_directories = (
            self.original_image_root,
            self.processed_image_root,
            self.thumbnail_root,
            self.cutout_image_root,
            self.outfit_preview_root,
        )
        for path in public_media_directories:
            if not _is_within(path, self.media_root):
                raise ValueError("image and preview paths must remain beneath media_root")
        for index, first in enumerate(public_media_directories):
            for second in public_media_directories[index + 1 :]:
                if _is_within(first, second) or _is_within(second, first):
                    raise ValueError("image and preview directories must not overlap")

        storage_directories = (
            self.media_root,
            self.temp_upload_root,
            self.temp_preview_root,
            self.backup_root,
            self.lock_root,
        )
        for index, first in enumerate(storage_directories):
            for second in storage_directories[index + 1 :]:
                if _is_within(first, second) or _is_within(second, first):
                    raise ValueError(
                        "media, temporary, preview staging, and backup directories must not overlap"
                    )

        for directory in storage_directories:
            if _is_within(self.database_path, directory) or _is_within(
                directory, self.database_path
            ):
                raise ValueError("database_path must not overlap runtime storage directories")

        if _is_within(self.frontend_build_path, self.data_root) or _is_within(
            self.data_root, self.frontend_build_path
        ):
            raise ValueError("frontend_build_path and data_root must not overlap")
        if _is_within(self.phone_upload_frontend_build_path, self.data_root) or _is_within(
            self.data_root, self.phone_upload_frontend_build_path
        ):
            raise ValueError("phone_upload_frontend_build_path and data_root must not overlap")
        if _is_within(
            self.phone_upload_frontend_build_path, self.frontend_build_path
        ) or _is_within(self.frontend_build_path, self.phone_upload_frontend_build_path):
            raise ValueError("main and phone-upload frontend builds must not overlap")
        if self.phone_upload_bind_host.is_unspecified:
            raise ValueError("phone_upload_bind_host must select one exact IPv4 interface")
        if self.phone_upload_enabled:
            if self.phone_upload_bind_host.is_loopback and (
                self.phone_upload_advertised_host is not None
                or self.phone_upload_advertised_ipv4 is not None
            ):
                raise ValueError(
                    "a loopback phone_upload_bind_host cannot advertise a LAN endpoint"
                )
            if not self.phone_upload_bind_host.is_loopback and (
                not self.phone_upload_bind_host.is_private
                or self.phone_upload_bind_host.is_link_local
                or self.phone_upload_bind_host.is_multicast
                or self.phone_upload_bind_host.is_reserved
            ):
                raise ValueError(
                    "phone_upload_bind_host must be loopback or one private LAN IPv4 address"
                )
            if (
                self.phone_upload_advertised_ipv4 is not None
                and self.phone_upload_advertised_ipv4 != self.phone_upload_bind_host
            ):
                raise ValueError(
                    "phone_upload_advertised_ipv4 must match the exact listener bind address"
                )
            if self.phone_upload_advertised_host is not None:
                try:
                    advertised_host_ipv4 = IPv4Address(self.phone_upload_advertised_host)
                except ValueError:
                    advertised_host_ipv4 = None
                if (
                    advertised_host_ipv4 is not None
                    and advertised_host_ipv4 != self.phone_upload_bind_host
                ):
                    raise ValueError(
                        "phone_upload_advertised_host as IPv4 must match the exact listener "
                        "bind address"
                    )
            required_phone_hosts = {str(self.phone_upload_bind_host)}
            if self.phone_upload_advertised_host is not None:
                required_phone_hosts.add(self.phone_upload_advertised_host)
            if self.phone_upload_advertised_ipv4 is not None:
                required_phone_hosts.add(str(self.phone_upload_advertised_ipv4))
            missing_hosts = required_phone_hosts.difference(self.phone_upload_trusted_hosts)
            if missing_hosts:
                raise ValueError(
                    "phone_upload_trusted_hosts must contain every configured bind and advertised host"
                )

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
                    self.temp_preview_root,
                    self.original_image_root,
                    self.processed_image_root,
                    self.thumbnail_root,
                    self.cutout_image_root,
                    self.outfit_preview_root,
                    self.backup_root,
                    self.lock_root,
                )
            )
        )

    @property
    def import_lock_path(self) -> Path:
        return self.lock_root / "garment-import.lock"
