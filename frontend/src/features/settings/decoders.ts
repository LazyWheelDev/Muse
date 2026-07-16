import {
  screenTimeoutMinutes,
  splashModes,
  type ApplicationPreferences,
  type BackupList,
  type BackupSummary,
  type CapabilityStatus,
  type CleanupResponse,
  type DeviceCapabilities,
  type DeviceActionResponse,
  type DeviceStatus,
  type NetworkStatus,
  type MaintenanceStatus,
  type SettingsResponse,
  type StagedMaintenanceResponse,
  type StorageSummary,
  type ThrottlingStatus,
} from './model';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be boolean.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) {
    throw new Error(`${label} is unsupported.`);
  }
  return value as T;
}

function dateTime(value: unknown, label: string): string {
  const text = string(value, label, 64);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a date-time.`);
  return text;
}

export function decodeApplicationPreferences(value: unknown): ApplicationPreferences {
  const source = record(value, 'preferences');
  const brightness = integer(source.interface_brightness_percent, 'interface_brightness_percent');
  if (brightness < 20 || brightness > 100) throw new Error('brightness is outside safe bounds.');
  return {
    deviceName: string(source.device_name, 'device_name', 48),
    interfaceBrightnessPercent: brightness,
    screenTimeoutMinutes: oneOf(
      source.screen_timeout_minutes,
      screenTimeoutMinutes,
      'screen_timeout_minutes',
    ),
    reducedMotion: boolean(source.reduced_motion, 'reduced_motion'),
    splashMode: oneOf(source.splash_mode, splashModes, 'splash_mode'),
  };
}

export function decodeBackupSummary(value: unknown): BackupSummary {
  const source = record(value, 'backup');
  const id = string(source.id, 'backup.id', 32);
  if (!/^[0-9a-f]{32}$/u.test(id)) throw new Error('backup.id is invalid.');
  return {
    id,
    createdAt: dateTime(source.created_at, 'backup.created_at'),
    archiveBytes: integer(source.archive_bytes, 'backup.archive_bytes'),
    clothingItems: integer(source.clothing_items, 'backup.clothing_items'),
    outfits: integer(source.outfits, 'backup.outfits'),
    mediaFiles: integer(source.media_files, 'backup.media_files'),
  };
}

export function decodeSettingsResponse(value: unknown): SettingsResponse {
  const source = record(value, 'settings');
  return {
    preferences: decodeApplicationPreferences(source.preferences),
    lastSuccessfulBackup:
      source.last_successful_backup === null
        ? null
        : decodeBackupSummary(source.last_successful_backup),
  };
}

export function decodeNetworkStatus(value: unknown): NetworkStatus {
  const source = record(value, 'network status');
  return {
    status: oneOf(source.status, ['available', 'unavailable', 'unknown'], 'network status'),
    hostname: string(source.hostname, 'hostname', 253),
    preferredAddress: nullableString(source.preferred_address, 'preferred_address'),
    activeInterface: nullableString(source.active_interface, 'active_interface'),
    localNetworkAddress: nullableString(source.local_network_address, 'local_network_address'),
    phoneUploadAvailable: boolean(source.phone_upload_available, 'phone_upload_available'),
    advertisedPhoneUploadAddress: nullableString(
      source.advertised_phone_upload_address,
      'advertised_phone_upload_address',
    ),
    connectivity: oneOf(
      source.connectivity,
      [
        'connected',
        'local_only',
        'offline',
        'checking',
        'listener_unavailable',
        'address_unavailable',
      ],
      'connectivity',
    ),
    listenerStatus: oneOf(
      source.listener_status,
      ['ready', 'unavailable', 'disabled'],
      'listener_status',
    ),
    internetStatus: oneOf(source.internet_status, ['not_checked'], 'internet_status'),
    message: nullableString(source.message, 'message'),
  };
}

export function decodeStorageSummary(value: unknown): StorageSummary {
  const source = record(value, 'storage summary');
  return {
    clothingItems: integer(source.clothing_items, 'clothing_items'),
    softDeletedClothingItems: integer(
      source.soft_deleted_clothing_items,
      'soft_deleted_clothing_items',
    ),
    outfits: integer(source.outfits, 'outfits'),
    mediaFiles: integer(source.media_files, 'media_files'),
    mediaBytes: integer(source.media_bytes, 'media_bytes'),
    imageBytes: integer(source.image_bytes, 'image_bytes'),
    outfitPreviewBytes: integer(source.outfit_preview_bytes, 'outfit_preview_bytes'),
    databaseBytes: integer(source.database_bytes, 'database_bytes'),
    backupCount: integer(source.backup_count, 'backup_count'),
    backupBytes: integer(source.backup_bytes, 'backup_bytes'),
    diskTotalBytes: integer(source.disk_total_bytes, 'disk_total_bytes'),
    diskFreeBytes: integer(source.disk_free_bytes, 'disk_free_bytes'),
    calculatedAt: dateTime(source.calculated_at, 'calculated_at'),
  };
}

function decodeCapability(value: unknown, label: string): CapabilityStatus {
  const source = record(value, label);
  return {
    available: boolean(source.available, `${label}.available`),
    state: oneOf(
      source.state,
      ['available', 'unavailable', 'unsupported', 'disabled', 'requires_deployment_configuration'],
      `${label}.state`,
    ),
    reason: nullableString(source.reason, `${label}.reason`),
  };
}

export function decodeCapabilities(value: unknown): DeviceCapabilities {
  const source = record(value, 'capabilities');
  return {
    wifiManagement: decodeCapability(source.wifi_management, 'wifi_management'),
    hardwareBrightness: decodeCapability(source.hardware_brightness, 'hardware_brightness'),
    displaySleep: decodeCapability(source.display_sleep, 'display_sleep'),
    restartApplication: decodeCapability(source.restart_application, 'restart_application'),
    rebootDevice: decodeCapability(source.reboot_device, 'reboot_device'),
    shutdownDevice: decodeCapability(source.shutdown_device, 'shutdown_device'),
    backupRestore: decodeCapability(source.backup_restore, 'backup_restore'),
  };
}

export function decodeDeviceAction(value: unknown): DeviceActionResponse {
  const source = record(value, 'device action');
  return {
    action: oneOf(
      source.action,
      ['restart_application', 'reboot_device', 'shutdown_device'],
      'action',
    ),
    status: oneOf(source.status, ['scheduled'], 'status'),
  };
}

export function decodeDeviceStatus(value: unknown): DeviceStatus {
  const source = record(value, 'device status');
  return {
    deviceName: string(source.device_name, 'device_name', 48),
    appVersion: string(source.app_version, 'app_version', 64),
    operatingSystem: string(source.operating_system, 'operating_system', 160),
    architecture: string(source.architecture, 'architecture', 64),
    pythonVersion: string(source.python_version, 'python_version', 64),
    memoryTotalBytes: nullableInteger(source.memory_total_bytes, 'memory_total_bytes'),
    memoryAvailableBytes: nullableInteger(source.memory_available_bytes, 'memory_available_bytes'),
    storageTotalBytes: integer(source.storage_total_bytes, 'storage_total_bytes'),
    storageFreeBytes: integer(source.storage_free_bytes, 'storage_free_bytes'),
    temperatureCelsius: nullableNumber(source.temperature_celsius, 'temperature_celsius'),
    throttlingStatus: oneOf<ThrottlingStatus>(
      source.throttling_status,
      ['not_checked', 'normal', 'warning', 'unavailable'],
      'throttling_status',
    ),
    uptimeSeconds: nullableInteger(source.uptime_seconds, 'uptime_seconds'),
    startedAt: dateTime(source.started_at, 'started_at'),
    currentTime: dateTime(source.current_time, 'current_time'),
    migrationsCurrent: boolean(source.migrations_current, 'migrations_current'),
    internetStatus: oneOf(source.internet_status, ['not_checked'], 'internet_status'),
    operatingMode: oneOf(
      source.operating_mode,
      ['development', 'testing', 'production'],
      'operating_mode',
    ),
    mainReadiness: oneOf(source.main_readiness, ['ready', 'not_ready'], 'main_readiness'),
    listenerReadiness: oneOf(
      source.listener_readiness,
      ['ready', 'unavailable', 'disabled'],
      'listener_readiness',
    ),
    frontendBuildAvailable: boolean(source.frontend_build_available, 'frontend_build_available'),
    backendVersion: string(source.backend_version, 'backend_version', 64),
    lastSuccessfulBackup:
      source.last_successful_backup === null
        ? null
        : decodeBackupSummary(source.last_successful_backup),
  };
}

export function decodeBackupList(value: unknown): BackupList {
  const source = record(value, 'backup list');
  if (!Array.isArray(source.items)) throw new Error('backup list items must be an array.');
  const items = source.items.map(decodeBackupSummary);
  const total = integer(source.total, 'backup total');
  if (items.length > total) throw new Error('backup list total is inconsistent.');
  return { items, total };
}

export function decodeStagedMaintenance(value: unknown): StagedMaintenanceResponse {
  const source = record(value, 'staged maintenance');
  const operationId = string(source.operation_id, 'operation_id', 32);
  const safetyBackupId = string(source.safety_backup_id, 'safety_backup_id', 32);
  if (!/^[0-9a-f]{32}$/u.test(operationId) || !/^[0-9a-f]{32}$/u.test(safetyBackupId)) {
    throw new Error('staged maintenance identifiers are invalid.');
  }
  return {
    operationId,
    status: oneOf(source.status, ['staged_restart_required'], 'maintenance status'),
    safetyBackupId,
  };
}

export function decodeCleanup(value: unknown): CleanupResponse {
  const source = record(value, 'cleanup');
  return {
    phoneUploadSessions: integer(source.phone_upload_sessions, 'phone_upload_sessions'),
    temporaryImports: integer(source.temporary_imports, 'temporary_imports'),
    maintenanceEntries: integer(source.maintenance_entries, 'maintenance_entries'),
  };
}

export function decodeMaintenanceStatus(value: unknown): MaintenanceStatus {
  const source = record(value, 'maintenance status');
  const status = oneOf(source.status, ['none', 'staged_restart_required'], 'maintenance status');
  const operationType =
    source.operation_type === null
      ? null
      : oneOf(source.operation_type, ['restore', 'delete_all'], 'operation_type');
  const operationId =
    source.operation_id === null ? null : string(source.operation_id, 'operation_id', 32);
  if (operationId !== null && !/^[0-9a-f]{32}$/u.test(operationId)) {
    throw new Error('operation_id is invalid.');
  }
  if ((status === 'none') !== (operationType === null && operationId === null)) {
    throw new Error('maintenance status fields are inconsistent.');
  }
  return { status, operationType, operationId };
}
