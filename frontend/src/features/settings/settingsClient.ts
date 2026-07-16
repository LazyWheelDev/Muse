import { createApiUrl } from '../../api/config';
import { requestJson, requestVoid } from '../../api/request';
import {
  decodeBackupList,
  decodeBackupSummary,
  decodeCapabilities,
  decodeCleanup,
  decodeDeviceStatus,
  decodeDeviceAction,
  decodeNetworkStatus,
  decodeMaintenanceStatus,
  decodeSettingsResponse,
  decodeStagedMaintenance,
  decodeStorageSummary,
} from './decoders';
import type {
  ApplicationPreferencesUpdate,
  BackupList,
  BackupSummary,
  CleanupResponse,
  DeviceCapabilities,
  DeviceStatus,
  DeviceAction,
  DeviceActionResponse,
  NetworkStatus,
  MaintenanceStatus,
  SettingsResponse,
  StagedMaintenanceResponse,
  StorageSummary,
} from './model';

function jsonBody(value: unknown): { body: string; headers: Record<string, string> } {
  return {
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/json' },
  };
}

function signalOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function encodePreferences(update: ApplicationPreferencesUpdate): Record<string, unknown> {
  return {
    ...(update.deviceName === undefined ? {} : { device_name: update.deviceName }),
    ...(update.interfaceBrightnessPercent === undefined
      ? {}
      : { interface_brightness_percent: update.interfaceBrightnessPercent }),
    ...(update.screenTimeoutMinutes === undefined
      ? {}
      : { screen_timeout_minutes: update.screenTimeoutMinutes }),
    ...(update.reducedMotion === undefined ? {} : { reduced_motion: update.reducedMotion }),
    ...(update.splashMode === undefined ? {} : { splash_mode: update.splashMode }),
  };
}

export function getSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  return requestJson('/settings', decodeSettingsResponse, signalOptions(signal));
}

export function updateSettings(update: ApplicationPreferencesUpdate): Promise<SettingsResponse> {
  return requestJson('/settings', decodeSettingsResponse, {
    method: 'PATCH',
    ...jsonBody(encodePreferences(update)),
  });
}

export function getNetworkStatus(signal?: AbortSignal): Promise<NetworkStatus> {
  return requestJson('/settings/network-status', decodeNetworkStatus, signalOptions(signal));
}

export function getStorageSummary(signal?: AbortSignal): Promise<StorageSummary> {
  return requestJson('/settings/storage-summary', decodeStorageSummary, signalOptions(signal));
}

export function getDeviceStatus(signal?: AbortSignal): Promise<DeviceStatus> {
  return requestJson('/settings/device-status', decodeDeviceStatus, signalOptions(signal));
}

export function getCapabilities(signal?: AbortSignal): Promise<DeviceCapabilities> {
  return requestJson('/settings/capabilities', decodeCapabilities, signalOptions(signal));
}

export function scheduleDeviceAction(action: DeviceAction): Promise<DeviceActionResponse> {
  const confirmations: Record<DeviceAction, string> = {
    restart_application: 'RESTART MUSE',
    reboot_device: 'RESTART DEVICE',
    shutdown_device: 'SHUT DOWN DEVICE',
  };
  return requestJson(`/settings/device-actions/${action}` as const, decodeDeviceAction, {
    method: 'POST',
    ...jsonBody({ confirmation: confirmations[action] }),
  });
}

export function getBackups(signal?: AbortSignal): Promise<BackupList> {
  return requestJson('/settings/backups', decodeBackupList, signalOptions(signal));
}

export function getMaintenanceStatus(signal?: AbortSignal): Promise<MaintenanceStatus> {
  return requestJson(
    '/settings/maintenance-status',
    decodeMaintenanceStatus,
    signalOptions(signal),
  );
}

export function createBackup(): Promise<BackupSummary> {
  return requestJson('/settings/backups', decodeBackupSummary, {
    method: 'POST',
    ...jsonBody({ confirmation: 'CREATE BACKUP' }),
  });
}

export function deleteBackup(backupId: string): Promise<void> {
  if (!/^[0-9a-f]{32}$/u.test(backupId)) return Promise.reject(new Error('Invalid backup id.'));
  return requestVoid(`/settings/backups/${backupId}` as const, {
    method: 'DELETE',
    ...jsonBody({ confirmation: 'DELETE BACKUP' }),
  });
}

export function backupDownloadUrl(backupId: string): string {
  if (!/^[0-9a-f]{32}$/u.test(backupId)) throw new Error('Invalid backup id.');
  return createApiUrl(`/settings/backups/${backupId}/download`);
}

export function stageBackupRestore(backupId: string): Promise<StagedMaintenanceResponse> {
  if (!/^[0-9a-f]{32}$/u.test(backupId)) return Promise.reject(new Error('Invalid backup id.'));
  return requestJson(
    `/settings/backups/${backupId}/stage-restore` as const,
    decodeStagedMaintenance,
    { method: 'POST', ...jsonBody({ confirmation: 'RESTORE' }) },
  );
}

export function stageDeleteAllData(): Promise<StagedMaintenanceResponse> {
  return requestJson('/settings/data-deletion/stage', decodeStagedMaintenance, {
    method: 'POST',
    ...jsonBody({
      confirmation: 'DELETE ALL MUSE DATA',
      acknowledge_backup_loss: true,
    }),
  });
}

export function cleanupTemporaryData(): Promise<CleanupResponse> {
  return requestJson('/settings/cleanup', decodeCleanup, {
    method: 'POST',
    ...jsonBody({ confirmation: 'CLEAN UP' }),
  });
}
