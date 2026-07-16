import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  backupDownloadUrl,
  deleteBackup,
  stageBackupRestore,
  stageDeleteAllData,
  updateSettings,
} from './settingsClient';

const rawSettings = {
  preferences: {
    device_name: 'Muse',
    interface_brightness_percent: 75,
    screen_timeout_minutes: 15,
    reduced_motion: true,
    splash_mode: 'reduced',
  },
  last_successful_backup: null,
};

const rawStagedMaintenance = {
  operation_id: 'a'.repeat(32),
  status: 'staged_restart_required',
  safety_backup_id: 'b'.repeat(32),
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a root-relative request URL.');
  return value;
}

function requestJsonBody(init: unknown): unknown {
  if (
    typeof init !== 'object' ||
    init === null ||
    !('body' in init) ||
    typeof init.body !== 'string'
  ) {
    throw new Error('Expected a JSON request body.');
  }
  return JSON.parse(init.body) as unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settingsClient', () => {
  it('encodes a typed partial preferences update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rawSettings));
    vi.stubGlobal('fetch', fetchMock);

    await updateSettings({
      deviceName: 'Muse',
      interfaceBrightnessPercent: 75,
      screenTimeoutMinutes: 15,
      reducedMotion: true,
      splashMode: 'reduced',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/settings');
    expect(init.method).toBe('PATCH');
    expect(requestJsonBody(init)).toEqual({
      device_name: 'Muse',
      interface_brightness_percent: 75,
      screen_timeout_minutes: 15,
      reduced_motion: true,
      splash_mode: 'reduced',
    });
  });

  it('sends the exact destructive-operation confirmations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(rawStagedMaintenance))
      .mockResolvedValueOnce(jsonResponse(rawStagedMaintenance))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const backupId = 'c'.repeat(32);

    await stageBackupRestore(backupId);
    await stageDeleteAllData();
    await deleteBackup(backupId);

    expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
      `/api/v1/settings/backups/${backupId}/stage-restore`,
      '/api/v1/settings/data-deletion/stage',
      `/api/v1/settings/backups/${backupId}`,
    ]);
    expect(requestJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      confirmation: 'RESTORE',
    });
    expect(requestJsonBody(fetchMock.mock.calls[1]?.[1])).toEqual({
      confirmation: 'DELETE ALL MUSE DATA',
      acknowledge_backup_loss: true,
    });
    expect(requestJsonBody(fetchMock.mock.calls[2]?.[1])).toEqual({
      confirmation: 'DELETE BACKUP',
    });
  });

  it('rejects an invalid backup id before any request is made', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(stageBackupRestore('../wardrobe')).rejects.toThrow('Invalid backup id');
    expect(() => backupDownloadUrl('../wardrobe')).toThrow('Invalid backup id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
