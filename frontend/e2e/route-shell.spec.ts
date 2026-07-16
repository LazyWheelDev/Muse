import { expect, test } from '@playwright/test';

const routeCases = [
  { path: '/', heading: 'Muse' },
  { path: '/wardrobe', heading: 'Wardrobe' },
  { path: '/outfit-builder', heading: 'Outfit Builder' },
  { path: '/saved-outfits', heading: 'Saved Outfits' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings/network', heading: 'W & N' },
  { path: '/settings/display', heading: 'Display' },
  { path: '/settings/data', heading: 'Data' },
  { path: '/settings/device', heading: 'Device' },
  { path: '/settings/about', heading: 'About Muse' },
] as const;

const settingsPreferences = {
  device_name: 'Muse',
  interface_brightness_percent: 100,
  screen_timeout_minutes: 10,
  reduced_motion: false,
  splash_mode: 'full',
};

const unavailableCapability = {
  available: false,
  state: 'requires_deployment_configuration',
  reason: 'Requires deployment configuration.',
};

const settingsResponses: Record<string, unknown> = {
  '/api/v1/settings': {
    preferences: settingsPreferences,
    last_successful_backup: null,
  },
  '/api/v1/settings/network-status': {
    status: 'available',
    hostname: 'muse',
    preferred_address: '192.168.1.50',
    active_interface: 'eth0',
    local_network_address: '192.168.1.50',
    phone_upload_available: true,
    advertised_phone_upload_address: 'http://192.168.1.50:8001',
    connectivity: 'local_only',
    listener_status: 'ready',
    internet_status: 'not_checked',
    message: null,
  },
  '/api/v1/settings/storage-summary': {
    clothing_items: 0,
    soft_deleted_clothing_items: 0,
    outfits: 0,
    media_files: 0,
    media_bytes: 0,
    image_bytes: 0,
    outfit_preview_bytes: 0,
    database_bytes: 4096,
    backup_count: 0,
    backup_bytes: 0,
    disk_total_bytes: 64_000_000_000,
    disk_free_bytes: 48_000_000_000,
    calculated_at: '2026-07-16T12:00:00Z',
  },
  '/api/v1/settings/device-status': {
    device_name: 'Muse',
    app_version: 'Muse 0.1.0',
    operating_system: 'Raspberry Pi OS',
    architecture: 'aarch64',
    python_version: '3.13.0',
    memory_total_bytes: 8_000_000_000,
    memory_available_bytes: 6_000_000_000,
    storage_total_bytes: 64_000_000_000,
    storage_free_bytes: 48_000_000_000,
    temperature_celsius: null,
    throttling_status: 'not_checked',
    uptime_seconds: 600,
    started_at: '2026-07-16T11:50:00Z',
    current_time: '2026-07-16T12:00:00Z',
    migrations_current: true,
    internet_status: 'not_checked',
    operating_mode: 'testing',
    main_readiness: 'ready',
    listener_readiness: 'ready',
    frontend_build_available: true,
    backend_version: '0.1.0',
    last_successful_backup: null,
  },
  '/api/v1/settings/capabilities': {
    wifi_management: unavailableCapability,
    hardware_brightness: unavailableCapability,
    display_sleep: { available: true, state: 'available', reason: null },
    restart_application: unavailableCapability,
    reboot_device: unavailableCapability,
    shutdown_device: unavailableCapability,
    backup_restore: { available: true, state: 'available', reason: null },
  },
  '/api/v1/settings/backups': { items: [], total: 0 },
  '/api/v1/settings/maintenance-status': {
    status: 'none',
    operation_type: null,
    operation_id: null,
  },
};

test('the Muse route shell fits the 1280 × 800 kiosk viewport without horizontal overflow', async ({
  page,
}, testInfo) => {
  const configuredBaseUrl = testInfo.project.use.baseURL;

  if (typeof configuredBaseUrl !== 'string') {
    throw new Error('Playwright requires a configured baseURL.');
  }

  const applicationOrigin = new URL(configuredBaseUrl).origin;
  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('request', (request) => {
    const requestUrl = new URL(request.url());

    if (requestUrl.origin !== applicationOrigin) {
      externalRequests.push(request.url());
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.route('**/api/v1/readiness', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        checks: {
          database: { status: 'ok' },
          migrations: { status: 'ok' },
          storage: { status: 'ok' },
        },
      }),
    });
  });
  await page.route(/\/api\/v1\/settings(?:\/[^?#]*)?(?:\?.*)?$/u, async (route) => {
    const requestPath = new URL(route.request().url()).pathname;
    const response = settingsResponses[requestPath];
    await route.fulfill({
      status: response === undefined ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(response ?? { error: 'not_found' }),
    });
  });
  await page.route('**/api/v1/clothing-items*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });
  await page.route('**/api/v1/outfits*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const limit = Number(requestUrl.searchParams.get('limit') ?? '24');
    const offset = Number(requestUrl.searchParams.get('offset') ?? '0');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, limit, offset }),
    });
  });

  for (const route of routeCases) {
    await test.step(route.path, async () => {
      await page.goto(`${route.path}?splash=skip`);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const localFontsLoaded = await page.evaluate(() => ({
        inter: document.fonts.check('16px "Inter Variable"'),
        playfair: document.fonts.check('16px "Playfair Display Variable"'),
      }));

      const dimensions = await page.evaluate(() => {
        const scroller = document.scrollingElement ?? document.documentElement;

        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentClientWidth: scroller.clientWidth,
          documentScrollWidth: scroller.scrollWidth,
          bodyClientWidth: document.body.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      });

      expect(dimensions.viewportWidth).toBe(1280);
      expect(dimensions.viewportHeight).toBe(800);
      expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
      expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
      expect(localFontsLoaded).toEqual({ inter: true, playfair: true });
    });
  }

  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
