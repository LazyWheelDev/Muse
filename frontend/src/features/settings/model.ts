export const screenTimeoutMinutes = [0, 5, 10, 15, 30] as const;
export type ScreenTimeoutMinutes = (typeof screenTimeoutMinutes)[number];

export const splashModes = ['full', 'reduced'] as const;
export type SplashMode = (typeof splashModes)[number];

export interface ApplicationPreferences {
  deviceName: string;
  interfaceBrightnessPercent: number;
  screenTimeoutMinutes: ScreenTimeoutMinutes;
  reducedMotion: boolean;
  splashMode: SplashMode;
}

export type ApplicationPreferencesUpdate = Partial<ApplicationPreferences>;

export interface BackupSummary {
  id: string;
  createdAt: string;
  archiveBytes: number;
  clothingItems: number;
  outfits: number;
  mediaFiles: number;
}

export interface SettingsResponse {
  preferences: ApplicationPreferences;
  lastSuccessfulBackup: BackupSummary | null;
}

export type NetworkAvailability = 'available' | 'unavailable' | 'unknown';

export interface NetworkStatus {
  status: NetworkAvailability;
  hostname: string;
  preferredAddress: string | null;
  activeInterface: string | null;
  localNetworkAddress: string | null;
  phoneUploadAvailable: boolean;
  advertisedPhoneUploadAddress: string | null;
  connectivity:
    | 'connected'
    | 'local_only'
    | 'offline'
    | 'checking'
    | 'listener_unavailable'
    | 'address_unavailable';
  listenerStatus: 'ready' | 'unavailable' | 'disabled';
  internetStatus: 'not_checked';
  message: string | null;
}

export interface StorageSummary {
  clothingItems: number;
  softDeletedClothingItems: number;
  outfits: number;
  mediaFiles: number;
  mediaBytes: number;
  imageBytes: number;
  outfitPreviewBytes: number;
  databaseBytes: number;
  backupCount: number;
  backupBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  calculatedAt: string;
}

export interface CapabilityStatus {
  available: boolean;
  state:
    'available' | 'unavailable' | 'unsupported' | 'disabled' | 'requires_deployment_configuration';
  reason: string | null;
}

export interface DeviceCapabilities {
  wifiManagement: CapabilityStatus;
  hardwareBrightness: CapabilityStatus;
  displaySleep: CapabilityStatus;
  restartApplication: CapabilityStatus;
  rebootDevice: CapabilityStatus;
  shutdownDevice: CapabilityStatus;
  backupRestore: CapabilityStatus;
}

export type DeviceAction = 'restart_application' | 'reboot_device' | 'shutdown_device';

export interface DeviceActionResponse {
  action: DeviceAction;
  status: 'scheduled';
}

export type ThrottlingStatus = 'not_checked' | 'normal' | 'warning' | 'unavailable';

export interface DeviceStatus {
  deviceName: string;
  appVersion: string;
  operatingSystem: string;
  architecture: string;
  pythonVersion: string;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  storageTotalBytes: number;
  storageFreeBytes: number;
  temperatureCelsius: number | null;
  throttlingStatus: ThrottlingStatus;
  uptimeSeconds: number | null;
  startedAt: string;
  currentTime: string;
  migrationsCurrent: boolean;
  internetStatus: 'not_checked';
  operatingMode: 'development' | 'testing' | 'production';
  mainReadiness: 'ready' | 'not_ready';
  listenerReadiness: 'ready' | 'unavailable' | 'disabled';
  frontendBuildAvailable: boolean;
  backendVersion: string;
  lastSuccessfulBackup: BackupSummary | null;
}

export interface BackupList {
  items: BackupSummary[];
  total: number;
}

export interface StagedMaintenanceResponse {
  operationId: string;
  status: 'staged_restart_required';
  safetyBackupId: string;
}

export interface CleanupResponse {
  phoneUploadSessions: number;
  temporaryImports: number;
  maintenanceEntries: number;
}

export interface MaintenanceStatus {
  status: 'none' | 'staged_restart_required';
  operationType: 'restore' | 'delete_all' | null;
  operationId: string | null;
}

export const defaultApplicationPreferences: ApplicationPreferences = {
  deviceName: 'Muse',
  interfaceBrightnessPercent: 100,
  screenTimeoutMinutes: 10,
  reducedMotion: false,
  splashMode: 'full',
};
