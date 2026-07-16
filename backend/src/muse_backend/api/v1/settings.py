import shutil
import socket
from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response, status
from starlette.responses import FileResponse

from muse_backend import __version__
from muse_backend.api.dependencies import DatabaseDependency, SessionDependency, SettingsDependency
from muse_backend.database.migrations import migration_status
from muse_backend.domain.exceptions import MuseError
from muse_backend.frontend import frontend_build_available
from muse_backend.platform.local import LocalPlatformAdapter
from muse_backend.schemas.settings import (
    ApplicationPreferencesUpdate,
    BackupList,
    BackupSummary,
    CapabilityStatus,
    CleanupRequest,
    CleanupResponse,
    CreateBackupRequest,
    DeleteBackupRequest,
    DeviceActionRequest,
    DeviceActionResponse,
    DeviceCapabilities,
    DeviceStatus,
    MaintenanceStatus,
    NetworkStatus,
    SettingsResponse,
    StageDeleteAllRequest,
    StagedMaintenanceResponse,
    StageRestoreRequest,
    StorageSummary,
)
from muse_backend.services.application_settings import ApplicationSettingsService
from muse_backend.services.background_processing import reconcile_temporary_imports
from muse_backend.services.backups import BackupService
from muse_backend.services.device_control import DeviceAction, DeviceControlService
from muse_backend.services.import_admission import InterprocessImportLock
from muse_backend.services.lan_address import discover_lan_interface, resolve_lan_endpoint
from muse_backend.services.phone_upload_listener import PhoneUploadListenerProbe
from muse_backend.services.phone_upload_sessions import PhoneUploadSessionService
from muse_backend.services.storage_summary import storage_summary
from muse_backend.storage.local import LocalStorageService

router = APIRouter(prefix="/settings", tags=["settings"])


def _response(session: SessionDependency, settings: SettingsDependency) -> SettingsResponse:
    return SettingsResponse(
        preferences=ApplicationSettingsService(session).get(),
        last_successful_backup=BackupService(settings).latest(),
    )


@router.get("", response_model=SettingsResponse)
def get_application_settings(
    session: SessionDependency,
    settings: SettingsDependency,
) -> SettingsResponse:
    return _response(session, settings)


@router.patch("", response_model=SettingsResponse)
def update_application_settings(
    update: ApplicationPreferencesUpdate,
    session: SessionDependency,
    settings: SettingsDependency,
) -> SettingsResponse:
    ApplicationSettingsService(session).update(update)
    return _response(session, settings)


@router.get("/network-status", response_model=NetworkStatus)
def network_status(settings: SettingsDependency) -> NetworkStatus:
    interface_name, discovered = discover_lan_interface()
    hostname = socket.gethostname().strip()[:120] or "muse"
    if not settings.phone_upload_enabled:
        return NetworkStatus(
            status="available" if discovered else "unknown",
            local_network_address=discovered,
            phone_upload_available=False,
            message="Phone upload is not enabled on this device.",
            hostname=hostname,
            preferred_address=discovered,
            active_interface=interface_name,
            advertised_phone_upload_address=None,
            connectivity="local_only" if discovered else "address_unavailable",
            listener_status="disabled",
        )
    try:
        endpoint = resolve_lan_endpoint(settings)
    except MuseError:
        return NetworkStatus(
            status="unavailable",
            local_network_address=discovered,
            phone_upload_available=False,
            message="Muse could not find the configured local upload network.",
            hostname=hostname,
            preferred_address=discovered,
            active_interface=interface_name,
            advertised_phone_upload_address=None,
            connectivity="address_unavailable",
            listener_status="unavailable",
        )
    address = endpoint.fallback_ipv4 or (
        endpoint.primary_host if endpoint.primary_host.replace(".", "").isdecimal() else discovered
    )
    listener_ready = PhoneUploadListenerProbe(settings).check().value == "ready"
    advertised = f"http://{endpoint.primary_host}:{endpoint.port}"
    return NetworkStatus(
        status="available" if listener_ready else "unavailable",
        local_network_address=address,
        phone_upload_available=listener_ready,
        message=None if listener_ready else "The local phone upload listener is unavailable.",
        hostname=hostname,
        preferred_address=address,
        active_interface=interface_name,
        advertised_phone_upload_address=advertised,
        connectivity="local_only" if listener_ready else "listener_unavailable",
        listener_status="ready" if listener_ready else "unavailable",
    )


@router.get("/storage-summary", response_model=StorageSummary)
def get_storage_summary(
    session: SessionDependency,
    settings: SettingsDependency,
) -> StorageSummary:
    return storage_summary(session, settings)


@router.get("/capabilities", response_model=DeviceCapabilities)
def get_capabilities(settings: SettingsDependency) -> DeviceCapabilities:
    device_control = DeviceControlService(settings).capability()
    unvalidated_hardware_reason = "Requires validation on the installed display hardware."
    return DeviceCapabilities(
        wifi_management=CapabilityStatus(
            available=False,
            state="requires_deployment_configuration",
            reason="Network management is intentionally outside the Muse web application.",
        ),
        hardware_brightness=CapabilityStatus(
            available=False,
            state="requires_deployment_configuration",
            reason=unvalidated_hardware_reason,
        ),
        display_sleep=CapabilityStatus(available=True, state="available"),
        restart_application=CapabilityStatus(
            available=device_control.available,
            state=device_control.state,
            reason=device_control.reason,
        ),
        reboot_device=CapabilityStatus(
            available=device_control.available,
            state=device_control.state,
            reason=device_control.reason,
        ),
        shutdown_device=CapabilityStatus(
            available=device_control.available,
            state=device_control.state,
            reason=device_control.reason,
        ),
        backup_restore=CapabilityStatus(available=True, state="available"),
    )


@router.post("/device-actions/{action}", response_model=DeviceActionResponse, status_code=202)
def schedule_device_action(
    action: DeviceAction,
    request_body: DeviceActionRequest,
    settings: SettingsDependency,
) -> DeviceActionResponse:
    confirmations = {
        DeviceAction.RESTART_APPLICATION: "RESTART MUSE",
        DeviceAction.REBOOT_DEVICE: "RESTART DEVICE",
        DeviceAction.SHUTDOWN_DEVICE: "SHUT DOWN DEVICE",
    }
    if request_body.confirmation != confirmations[action]:
        raise MuseError(
            status_code=422,
            code="device_action_confirmation_invalid",
            message="The device action confirmation did not match the requested action.",
        )
    try:
        DeviceControlService(settings).schedule(action)
    except RuntimeError as error:
        raise MuseError(
            status_code=503,
            code="device_control_unavailable",
            message="The constrained device action could not be scheduled.",
        ) from error
    return DeviceActionResponse(action=action.value)


@router.get("/device-status", response_model=DeviceStatus)
def get_device_status(
    request: Request,
    session: SessionDependency,
    settings: SettingsDependency,
    database: DatabaseDependency,
) -> DeviceStatus:
    preferences = ApplicationSettingsService(session).get()
    platform_adapter = LocalPlatformAdapter()
    memory = platform_adapter.memory()
    thermal = platform_adapter.thermal()
    disk = shutil.disk_usage(settings.data_root)
    try:
        migrations_current = migration_status(settings, database).is_current
    except Exception:
        migrations_current = False
    frontend_ready = not settings.serve_frontend or frontend_build_available(
        settings.frontend_build_path
    )
    storage_ready = (
        bool(request.app.state.storage_initialized) and request.app.state.storage.writable()
    )
    listener = (
        PhoneUploadListenerProbe(settings).check().value
        if settings.phone_upload_enabled
        else "disabled"
    )
    return DeviceStatus(
        device_name=preferences.device_name,
        app_version=__version__,
        operating_system=platform_adapter.operating_system(),
        architecture=platform_adapter.architecture(),
        python_version=platform_adapter.python_version(),
        memory_total_bytes=memory.total_bytes,
        memory_available_bytes=memory.available_bytes,
        storage_total_bytes=disk.total,
        storage_free_bytes=disk.free,
        temperature_celsius=thermal.temperature_celsius,
        throttling_status=thermal.status,
        uptime_seconds=platform_adapter.uptime_seconds(),
        started_at=request.app.state.started_at,
        current_time=datetime.now(UTC),
        migrations_current=migrations_current,
        operating_mode=settings.environment.value,
        main_readiness=(
            "ready" if migrations_current and storage_ready and frontend_ready else "not_ready"
        ),
        listener_readiness=listener,
        frontend_build_available=frontend_ready,
        backend_version=__version__,
        last_successful_backup=BackupService(settings).latest(),
    )


@router.get("/backups", response_model=BackupList)
def list_backups(settings: SettingsDependency) -> BackupList:
    return BackupService(settings).list_backups()


@router.get("/maintenance-status", response_model=MaintenanceStatus)
def get_maintenance_status(settings: SettingsDependency) -> MaintenanceStatus:
    return BackupService(settings).maintenance_status()


@router.post(
    "/backups",
    response_model=BackupSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_backup(
    request_body: CreateBackupRequest,
    settings: SettingsDependency,
) -> BackupSummary:
    del request_body
    with InterprocessImportLock(settings).acquire(blocking=False):
        return BackupService(settings).create()


@router.get("/backups/{backup_id}/download", response_class=FileResponse)
def download_backup(backup_id: str, settings: SettingsDependency) -> FileResponse:
    path = BackupService(settings).validated_path(backup_id)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"muse-backup-{backup_id}.zip",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/backups/{backup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_backup(
    backup_id: str,
    request_body: DeleteBackupRequest,
    settings: SettingsDependency,
) -> Response:
    del request_body
    BackupService(settings).delete(backup_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/backups/{backup_id}/stage-restore",
    response_model=StagedMaintenanceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def stage_restore(
    backup_id: str,
    request_body: StageRestoreRequest,
    settings: SettingsDependency,
) -> StagedMaintenanceResponse:
    del request_body
    with InterprocessImportLock(settings).acquire(blocking=False):
        return BackupService(settings).stage_restore(backup_id)


@router.post(
    "/data-deletion/stage",
    response_model=StagedMaintenanceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def stage_delete_all(
    request_body: StageDeleteAllRequest,
    settings: SettingsDependency,
) -> StagedMaintenanceResponse:
    del request_body
    with InterprocessImportLock(settings).acquire(blocking=False):
        return BackupService(settings).stage_delete_all()


@router.post("/cleanup", response_model=CleanupResponse)
def cleanup_local_data(
    request_body: CleanupRequest,
    request: Request,
    settings: SettingsDependency,
) -> CleanupResponse:
    del request_body
    storage: LocalStorageService = request.app.state.storage
    sessions: PhoneUploadSessionService = request.app.state.phone_upload_sessions
    with InterprocessImportLock(settings).acquire(blocking=False):
        phone_count = sessions.cleanup()
        temporary_count = reconcile_temporary_imports(
            settings=settings,
            storage=storage,
            database=request.app.state.database,
            limit=settings.maintenance_cleanup_batch_size,
        )
        maintenance_count = BackupService(settings).cleanup_staging(
            limit=settings.maintenance_cleanup_batch_size
        )
    return CleanupResponse(
        phone_upload_sessions=phone_count,
        temporary_imports=temporary_count,
        maintenance_entries=maintenance_count,
    )
