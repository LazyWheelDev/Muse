from datetime import datetime
from typing import Literal

from pydantic import Field

from muse_backend.schemas.common import ApiSchema

ScreenTimeoutMinutes = Literal[0, 5, 10, 15, 30]
SplashMode = Literal["full", "reduced"]


class ApplicationPreferences(ApiSchema):
    device_name: str = Field(min_length=1, max_length=48, pattern=r"^[^\x00-\x1f\x7f]+$")
    interface_brightness_percent: int = Field(ge=20, le=100)
    screen_timeout_minutes: ScreenTimeoutMinutes
    reduced_motion: bool
    splash_mode: SplashMode


class ApplicationPreferencesUpdate(ApiSchema):
    device_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=48,
        pattern=r"^[^\x00-\x1f\x7f]+$",
    )
    interface_brightness_percent: int | None = Field(default=None, ge=20, le=100)
    screen_timeout_minutes: ScreenTimeoutMinutes | None = None
    reduced_motion: bool | None = None
    splash_mode: SplashMode | None = None


class BackupSummary(ApiSchema):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    created_at: datetime
    archive_bytes: int = Field(ge=1)
    clothing_items: int = Field(ge=0)
    outfits: int = Field(ge=0)
    media_files: int = Field(ge=0)


class SettingsResponse(ApiSchema):
    preferences: ApplicationPreferences
    last_successful_backup: BackupSummary | None


class NetworkStatus(ApiSchema):
    status: Literal["available", "unavailable", "unknown"]
    local_network_address: str | None
    phone_upload_available: bool
    message: str | None
    hostname: str
    preferred_address: str | None
    active_interface: str | None
    advertised_phone_upload_address: str | None
    connectivity: Literal[
        "connected",
        "local_only",
        "offline",
        "checking",
        "listener_unavailable",
        "address_unavailable",
    ]
    listener_status: Literal["ready", "unavailable", "disabled"]
    internet_status: Literal["not_checked"] = "not_checked"


class StorageSummary(ApiSchema):
    clothing_items: int = Field(ge=0)
    soft_deleted_clothing_items: int = Field(ge=0)
    outfits: int = Field(ge=0)
    media_files: int = Field(ge=0)
    media_bytes: int = Field(ge=0)
    image_bytes: int = Field(ge=0)
    outfit_preview_bytes: int = Field(ge=0)
    database_bytes: int = Field(ge=0)
    backup_count: int = Field(ge=0)
    backup_bytes: int = Field(ge=0)
    disk_total_bytes: int = Field(ge=0)
    disk_free_bytes: int = Field(ge=0)
    calculated_at: datetime


class CapabilityStatus(ApiSchema):
    available: bool
    state: Literal[
        "available",
        "unavailable",
        "unsupported",
        "disabled",
        "requires_deployment_configuration",
    ]
    reason: str | None = None


class DeviceCapabilities(ApiSchema):
    wifi_management: CapabilityStatus
    hardware_brightness: CapabilityStatus
    display_sleep: CapabilityStatus
    restart_application: CapabilityStatus
    reboot_device: CapabilityStatus
    shutdown_device: CapabilityStatus
    backup_restore: CapabilityStatus


class DeviceStatus(ApiSchema):
    device_name: str
    app_version: str
    operating_system: str
    architecture: str
    python_version: str
    memory_total_bytes: int | None
    memory_available_bytes: int | None
    storage_total_bytes: int
    storage_free_bytes: int
    temperature_celsius: float | None
    throttling_status: Literal["not_checked", "normal", "warning", "unavailable"]
    uptime_seconds: int | None
    started_at: datetime
    current_time: datetime
    migrations_current: bool
    internet_status: Literal["not_checked"] = "not_checked"
    operating_mode: Literal["development", "testing", "production"]
    main_readiness: Literal["ready", "not_ready"]
    listener_readiness: Literal["ready", "unavailable", "disabled"]
    frontend_build_available: bool
    backend_version: str
    last_successful_backup: BackupSummary | None


class BackupList(ApiSchema):
    items: list[BackupSummary]
    total: int = Field(ge=0)


class CreateBackupRequest(ApiSchema):
    confirmation: Literal["CREATE BACKUP"]


class DeleteBackupRequest(ApiSchema):
    confirmation: Literal["DELETE BACKUP"]


class CleanupRequest(ApiSchema):
    confirmation: Literal["CLEAN UP"]


class StageRestoreRequest(ApiSchema):
    confirmation: Literal["RESTORE"]


class StageDeleteAllRequest(ApiSchema):
    confirmation: Literal["DELETE ALL MUSE DATA"]
    acknowledge_backup_loss: Literal[True]


class StagedMaintenanceResponse(ApiSchema):
    operation_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    status: Literal["staged_restart_required"] = "staged_restart_required"
    safety_backup_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class CleanupResponse(ApiSchema):
    phone_upload_sessions: int = Field(ge=0)
    temporary_imports: int = Field(ge=0)
    maintenance_entries: int = Field(ge=0)


class MaintenanceStatus(ApiSchema):
    status: Literal["none", "staged_restart_required"]
    operation_type: Literal["restore", "delete_all"] | None
    operation_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
