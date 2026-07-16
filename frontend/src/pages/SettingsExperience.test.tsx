import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/clothingFixtures';
import { renderApp } from '../test/renderApp';

const unavailableCapability = {
  available: false,
  state: 'requires_deployment_configuration',
  reason: 'Requires Raspberry Pi deployment configuration.',
};

const capabilities = {
  wifi_management: unavailableCapability,
  hardware_brightness: unavailableCapability,
  display_sleep: { available: true, state: 'available', reason: null },
  restart_application: unavailableCapability,
  reboot_device: unavailableCapability,
  shutdown_device: unavailableCapability,
  backup_restore: { available: true, state: 'available', reason: null },
};

const deviceStatus = {
  device_name: 'Muse',
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
  last_successful_backup: null,
};

const storageSummary = {
  clothing_items: 4,
  soft_deleted_clothing_items: 1,
  outfits: 2,
  media_files: 8,
  media_bytes: 100_000,
  image_bytes: 80_000,
  outfit_preview_bytes: 20_000,
  database_bytes: 4096,
  backup_count: 0,
  backup_bytes: 0,
  disk_total_bytes: 64_000_000_000,
  disk_free_bytes: 48_000_000_000,
  calculated_at: '2026-07-16T08:00:00Z',
};

function requestPath(input: RequestInfo | URL): string {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(value, 'http://muse.local').pathname;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  const value = JSON.parse(init.body) as unknown;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function installSettingsApi() {
  const requests: Array<{ path: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = requestPath(input);
    requests.push({ path, init });

    if (path === '/api/v1/settings' && init?.method === 'PATCH') {
      const update = requestBody(init);
      return Promise.resolve(
        jsonResponse({
          preferences: {
            device_name: update.device_name ?? 'Muse',
            interface_brightness_percent: update.interface_brightness_percent ?? 100,
            screen_timeout_minutes: update.screen_timeout_minutes ?? 10,
            reduced_motion: update.reduced_motion ?? false,
            splash_mode: update.splash_mode ?? 'full',
          },
          last_successful_backup: null,
        }),
      );
    }
    if (path === '/api/v1/settings/capabilities')
      return Promise.resolve(jsonResponse(capabilities));
    if (path === '/api/v1/settings/device-status')
      return Promise.resolve(jsonResponse(deviceStatus));
    if (path === '/api/v1/settings/storage-summary')
      return Promise.resolve(jsonResponse(storageSummary));
    if (path === '/api/v1/settings/backups')
      return Promise.resolve(jsonResponse({ items: [], total: 0 }));
    if (path === '/api/v1/settings/maintenance-status') {
      return Promise.resolve(
        jsonResponse({ status: 'none', operation_type: null, operation_id: null }),
      );
    }
    if (path === '/api/v1/settings/data-deletion/stage') {
      return Promise.resolve(
        jsonResponse({
          operation_id: 'a'.repeat(32),
          status: 'staged_restart_required',
          safety_backup_id: 'b'.repeat(32),
        }),
      );
    }
    if (path === '/api/v1/settings/network-status') {
      return Promise.resolve(
        jsonResponse({
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
          message: 'private platform diagnostic',
        }),
      );
    }
    throw new Error(`Unexpected local API request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('Settings product experience', () => {
  it('renders the approved Settings landing hierarchy and exposes only supported power behavior', async () => {
    installSettingsApi();
    const user = userEvent.setup();

    renderApp('/settings');

    expect(screen.getByRole('link', { name: 'Open Wi-Fi and Network settings' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Display settings' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Data settings' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Device settings' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open About Muse' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open power options' }));
    const dialog = screen.getByRole('dialog', { name: 'Power options' });
    expect(within(dialog).getByRole('button', { name: 'Sleep Display' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Restart Muse' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Restart Device' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Shut Down' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Sleep Display' }));
    expect(screen.getByRole('button', { name: 'Wake Muse display' })).toBeVisible();
  });

  it('validates and persists the bounded friendly device name without claiming a hostname change', async () => {
    const { requests } = installSettingsApi();
    const user = userEvent.setup();

    renderApp('/settings/device');
    const field = await screen.findByRole('textbox', { name: 'Device name' });
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 48 characters');

    await user.type(field, 'Hall Muse');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ path, init }) =>
            path === '/api/v1/settings' && requestBody(init).device_name === 'Hall Muse',
        ),
      ).toBe(true);
    });
    expect(screen.getByText(/does not rename the network host/u)).toBeVisible();
  });

  it('previews and persists display brightness and reduced motion', async () => {
    const { requests } = installSettingsApi();
    const user = userEvent.setup();

    renderApp('/settings/display');
    const brightness = await screen.findByRole('slider', { name: 'Interface brightness' });
    fireEvent.change(brightness, { target: { value: '70' } });
    fireEvent.pointerUp(brightness);

    await waitFor(() => {
      expect(
        requests.some(({ init }) => requestBody(init).interface_brightness_percent === 70),
      ).toBe(true);
    });

    await user.click(screen.getByRole('switch', { name: 'Reduced Motion' }));
    await waitFor(() => {
      expect(requests.some(({ init }) => requestBody(init).reduced_motion === true)).toBe(true);
    });
    expect(document.documentElement).toHaveAttribute('data-muse-reduced-motion', 'true');
  });

  it('requires two distinct confirmations before staging deletion of all Muse data', async () => {
    const { requests } = installSettingsApi();
    const user = userEvent.setup();

    renderApp('/settings/data');
    await screen.findByRole('heading', { name: 'Local storage' });
    await user.click(screen.getByRole('button', { name: 'Delete all Muse data' }));

    const firstDialog = screen.getByRole('dialog', { name: 'Delete all Muse data?' });
    expect(within(firstDialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(firstDialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(
      within(firstDialog).getByRole('button', { name: 'Continue to final confirmation' }),
    );

    const finalDialog = screen.getByRole('dialog', { name: 'Final deletion confirmation' });
    expect(within(finalDialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(finalDialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const stageButton = within(finalDialog).getByRole('button', { name: 'Stage data deletion' });
    expect(stageButton).toBeDisabled();
    await user.type(
      within(finalDialog).getByRole('textbox', { name: 'Type DELETE ALL MUSE DATA to continue' }),
      'DELETE ALL MUSE DATA',
    );
    await user.click(
      within(finalDialog).getByRole('checkbox', {
        name: 'I understand that local backups on this device are included.',
      }),
    );
    expect(stageButton).toBeEnabled();
    await user.click(stageButton);

    expect(await screen.findByText('Safe restart required')).toBeVisible();
    const stagedRequest = requests.find(
      ({ path }) => path === '/api/v1/settings/data-deletion/stage',
    );
    expect(requestBody(stagedRequest?.init)).toEqual({
      confirmation: 'DELETE ALL MUSE DATA',
      acknowledge_backup_loss: true,
    });
  });

  it('shows safe local network status without rendering raw platform diagnostics', async () => {
    installSettingsApi();

    renderApp('/settings/network');

    expect(await screen.findByText('Local network only')).toBeVisible();
    expect(screen.getByText('192.168.1.25')).toBeVisible();
    expect(screen.getByText('192.168.1.25:8081')).toBeVisible();
    expect(screen.queryByText('private platform diagnostic')).not.toBeInTheDocument();
    expect(screen.getByText('Muse works with or without Internet access.')).toBeVisible();
  });
});
