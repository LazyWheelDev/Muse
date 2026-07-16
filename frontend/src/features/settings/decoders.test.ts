import { describe, expect, it } from 'vitest';

import {
  decodeCapabilities,
  decodeDeviceStatus,
  decodeMaintenanceStatus,
  decodeNetworkStatus,
  decodeSettingsResponse,
  decodeStorageSummary,
} from './decoders';

const rawBackup = {
  id: 'a'.repeat(32),
  created_at: '2026-07-16T08:00:00Z',
  archive_bytes: 4096,
  clothing_items: 12,
  outfits: 3,
  media_files: 18,
};

const rawPreferences = {
  device_name: 'Bedroom Muse',
  interface_brightness_percent: 80,
  screen_timeout_minutes: 10,
  reduced_motion: false,
  splash_mode: 'full',
};

const unavailableCapability = {
  available: false,
  state: 'requires_deployment_configuration',
  reason: 'Requires kiosk deployment configuration.',
};

describe('Settings boundary decoders', () => {
  it('decodes the persisted preferences and backup contract', () => {
    expect(
      decodeSettingsResponse({
        preferences: rawPreferences,
        last_successful_backup: rawBackup,
      }),
    ).toEqual({
      preferences: {
        deviceName: 'Bedroom Muse',
        interfaceBrightnessPercent: 80,
        screenTimeoutMinutes: 10,
        reducedMotion: false,
        splashMode: 'full',
      },
      lastSuccessfulBackup: {
        id: 'a'.repeat(32),
        createdAt: '2026-07-16T08:00:00Z',
        archiveBytes: 4096,
        clothingItems: 12,
        outfits: 3,
        mediaFiles: 18,
      },
    });
  });

  it('decodes safe network and capability states without inferring Internet access', () => {
    expect(
      decodeNetworkStatus({
        status: 'available',
        hostname: 'muse',
        preferred_address: '192.168.1.25',
        active_interface: 'wlan0',
        local_network_address: '192.168.1.25',
        phone_upload_available: true,
        advertised_phone_upload_address: '192.168.1.25:8081',
        connectivity: 'local_only',
        listener_status: 'ready',
        internet_status: 'not_checked',
        message: null,
      }),
    ).toMatchObject({
      hostname: 'muse',
      connectivity: 'local_only',
      listenerStatus: 'ready',
      internetStatus: 'not_checked',
    });

    expect(
      decodeCapabilities({
        wifi_management: unavailableCapability,
        hardware_brightness: unavailableCapability,
        display_sleep: { available: true, state: 'available', reason: null },
        restart_application: unavailableCapability,
        reboot_device: unavailableCapability,
        shutdown_device: unavailableCapability,
        backup_restore: { available: true, state: 'available', reason: null },
      }),
    ).toMatchObject({
      displaySleep: { available: true },
      restartApplication: { available: false },
      backupRestore: { available: true },
    });
  });

  it('decodes bounded storage and device diagnostics', () => {
    expect(
      decodeStorageSummary({
        clothing_items: 12,
        soft_deleted_clothing_items: 2,
        outfits: 3,
        media_files: 18,
        media_bytes: 5000,
        image_bytes: 4000,
        outfit_preview_bytes: 1000,
        database_bytes: 2048,
        backup_count: 1,
        backup_bytes: 4096,
        disk_total_bytes: 64_000,
        disk_free_bytes: 48_000,
        calculated_at: '2026-07-16T08:00:00Z',
      }),
    ).toMatchObject({ clothingItems: 12, softDeletedClothingItems: 2, backupCount: 1 });

    expect(
      decodeDeviceStatus({
        device_name: 'Bedroom Muse',
        app_version: '0.1.0',
        operating_system: 'Raspberry Pi OS',
        architecture: 'aarch64',
        python_version: '3.13.5',
        memory_total_bytes: 8_000_000_000,
        memory_available_bytes: 6_000_000_000,
        storage_total_bytes: 64_000_000_000,
        storage_free_bytes: 48_000_000_000,
        temperature_celsius: 44.5,
        throttling_status: 'normal',
        uptime_seconds: 3600,
        started_at: '2026-07-16T07:00:00Z',
        current_time: '2026-07-16T08:00:00Z',
        migrations_current: true,
        internet_status: 'not_checked',
        operating_mode: 'production',
        main_readiness: 'ready',
        listener_readiness: 'ready',
        frontend_build_available: true,
        backend_version: '0.1.0',
        last_successful_backup: rawBackup,
      }),
    ).toMatchObject({
      architecture: 'aarch64',
      operatingMode: 'production',
      mainReadiness: 'ready',
      frontendBuildAvailable: true,
    });
  });

  it.each([
    [{ ...rawPreferences, device_name: '' }, 'empty device name'],
    [{ ...rawPreferences, interface_brightness_percent: 101 }, 'unsafe brightness'],
    [{ ...rawPreferences, screen_timeout_minutes: 7 }, 'unsupported timeout'],
  ])('rejects a preferences response with %s (%s)', (preferences) => {
    expect(() => decodeSettingsResponse({ preferences, last_successful_backup: null })).toThrow();
  });

  it('rejects inconsistent staged maintenance state', () => {
    expect(() =>
      decodeMaintenanceStatus({
        status: 'none',
        operation_type: 'restore',
        operation_id: 'b'.repeat(32),
      }),
    ).toThrow('inconsistent');
  });
});
