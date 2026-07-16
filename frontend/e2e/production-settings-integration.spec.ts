import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

const testGarmentImage = new PNG({ width: 240, height: 320 });
for (let y = 0; y < testGarmentImage.height; y += 1) {
  for (let x = 0; x < testGarmentImage.width; x += 1) {
    const offset = (y * testGarmentImage.width + x) * 4;
    const garment = x >= 48 && x < 192 && y >= 40 && y < 280;
    testGarmentImage.data[offset] = garment ? 91 : 248;
    testGarmentImage.data[offset + 1] = garment ? 58 : 244;
    testGarmentImage.data[offset + 2] = garment ? 46 : 235;
    testGarmentImage.data[offset + 3] = 255;
  }
}
const testGarmentPng = PNG.sync.write(testGarmentImage);

interface RuntimeContract {
  executable: string;
  pythonExecutable: string;
  runtimeRoot: string;
  dataRoot: string;
  mainOrigin: string;
  phoneOrigin: string;
  serviceEnvironment: NodeJS.ProcessEnv;
  services: Partial<Record<ServiceName, ChildProcess>>;
}

type ServiceName = 'main' | 'phone';

interface ImportedGarment {
  id: number;
  name: string;
  image_processing_state: string;
  images: Array<{ image_kind: string; content_url: string }>;
}

interface SavedOutfit {
  id: number;
  name: string;
  preview_url: string | null;
}

interface BackupSummary {
  id: string;
  clothing_items: number;
  outfits: number;
  media_files: number;
}

interface DatabaseAudit {
  quickCheck: string;
  foreignKeyViolations: number;
  clothingItems: number;
  outfits: number;
  images: number;
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`The P6 production test requires ${name}.`);
  return value;
}

function privateAttemptRoot(configuredRoot: string, retry: number, purpose: string): string {
  const base = resolve(configuredRoot);
  const baseMetadata = lstatSync(base);
  const currentUserId = process.getuid?.();
  if (
    !baseMetadata.isDirectory() ||
    baseMetadata.isSymbolicLink() ||
    (baseMetadata.mode & 0o077) !== 0 ||
    (currentUserId !== undefined && baseMetadata.uid !== currentUserId)
  ) {
    throw new Error(`The P6 E2E ${purpose} root must be a private directory owned by this user.`);
  }

  const canonicalBase = realpathSync(base);
  const parentMetadata = lstatSync(dirname(canonicalBase));
  const ownerPrivateParent =
    currentUserId !== undefined &&
    parentMetadata.uid === currentUserId &&
    (parentMetadata.mode & 0o022) === 0;
  const rootStickyParent = parentMetadata.uid === 0 && (parentMetadata.mode & 0o1000) !== 0;
  if (!ownerPrivateParent && !rootStickyParent) {
    throw new Error(`The P6 E2E ${purpose} root must have a trusted parent directory.`);
  }

  const attemptRoot = join(canonicalBase, `playwright-attempt-${retry}-${process.pid}`);
  mkdirSync(attemptRoot, { mode: 0o700 });
  return realpathSync(attemptRoot);
}

function runtimeContract(retry: number): RuntimeContract {
  const executable = resolve(requiredEnvironment('MUSE_BACKEND_EXECUTABLE'));
  const mainOrigin = new URL(requiredEnvironment('PLAYWRIGHT_BASE_URL')).origin;
  const phoneOrigin = new URL(requiredEnvironment('PLAYWRIGHT_PHONE_UPLOAD_BASE_URL')).origin;
  const dataRoot = privateAttemptRoot(requiredEnvironment('MUSE_P6_E2E_DATA_ROOT'), retry, 'data');
  const runtimeRoot = privateAttemptRoot(
    requiredEnvironment('MUSE_P6_E2E_RUNTIME_ROOT'),
    retry,
    'runtime',
  );
  const frontendRoot = process.cwd();
  const mainUrl = new URL(mainOrigin);
  const phoneUrl = new URL(phoneOrigin);
  if (mainUrl.hostname !== '127.0.0.1' || phoneUrl.hostname !== '127.0.0.1') {
    throw new Error('The destructive P6 production test accepts loopback origins only.');
  }
  return {
    executable,
    pythonExecutable: join(dirname(executable), 'python'),
    runtimeRoot,
    dataRoot,
    mainOrigin,
    phoneOrigin,
    services: {},
    serviceEnvironment: {
      ...process.env,
      PATH: `${dirname(executable)}:/usr/bin:/bin`,
      MUSE_ENVIRONMENT: 'production',
      MUSE_DATA_ROOT: dataRoot,
      MUSE_SERVE_FRONTEND: 'true',
      MUSE_FRONTEND_BUILD_PATH: join(frontendRoot, 'dist'),
      MUSE_TRUSTED_HOSTS: '["127.0.0.1","localhost"]',
      MUSE_ALLOWED_ORIGINS: '[]',
      MUSE_PHONE_UPLOAD_ENABLED: 'true',
      MUSE_PHONE_UPLOAD_BIND_HOST: '127.0.0.1',
      MUSE_PHONE_UPLOAD_PORT: phoneUrl.port || '80',
      MUSE_PHONE_UPLOAD_TRUSTED_HOSTS: '["127.0.0.1","localhost"]',
      MUSE_PHONE_UPLOAD_FRONTEND_BUILD_PATH: join(frontendRoot, 'dist-phone'),
    },
  };
}

function runtimeFile(contract: RuntimeContract, service: ServiceName, suffix: 'log' | 'pid') {
  return join(contract.runtimeRoot, `${service}.${suffix}`);
}

function removeOwnedPidFile(contract: RuntimeContract, service: ServiceName): void {
  const pidFile = runtimeFile(contract, service, 'pid');
  try {
    const metadata = lstatSync(pidFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('A Muse P6 service PID path is not a regular file.');
    }
    rmSync(pidFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function stopService(contract: RuntimeContract, service: ServiceName): Promise<void> {
  const child = contract.services[service];
  if (child === undefined) return;
  if (child.exitCode === null && child.signalCode === null) {
    if (!child.kill('SIGTERM')) {
      throw new Error('The owned Muse P6 service could not be signalled.');
    }
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        message: 'The disposable Muse P6 service must stop before offline maintenance.',
        timeout: 15_000,
        intervals: [100, 250, 500],
      })
      .toBe(true);
  }
  delete contract.services[service];
  removeOwnedPidFile(contract, service);
}

async function stopServices(contract: RuntimeContract): Promise<void> {
  await Promise.all([stopService(contract, 'main'), stopService(contract, 'phone')]);
}

function startService(contract: RuntimeContract, service: ServiceName, arguments_: string[]): void {
  const descriptor = openSync(
    runtimeFile(contract, service, 'log'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  );
  const child = spawn(contract.executable, arguments_, {
    env: contract.serviceEnvironment,
    stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  if (child.pid === undefined) throw new Error('A disposable Muse P6 service could not start.');
  let pidDescriptor: number | undefined;
  try {
    pidDescriptor = openSync(
      runtimeFile(contract, service, 'pid'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(pidDescriptor, `${child.pid}\n`, { encoding: 'utf8' });
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  } finally {
    if (pidDescriptor !== undefined) closeSync(pidDescriptor);
  }
  contract.services[service] = child;
  child.unref();
}

async function waitForStatus(
  request: APIRequestContext,
  url: string,
  expectedStatus = 200,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await request.get(url, { timeout: 1_000 });
          const status = response.status();
          await response.dispose();
          return status;
        } catch {
          return 0;
        }
      },
      {
        message: 'The disposable Muse P6 service must reach its expected status.',
        timeout: 30_000,
        intervals: [100, 250, 500, 1_000],
      },
    )
    .toBe(expectedStatus);
}

function runCommand(
  contract: RuntimeContract,
  arguments_: string[],
  expectedSuccess: boolean,
): void {
  const result = spawnSync(contract.executable, arguments_, {
    env: contract.serviceEnvironment,
    encoding: 'utf8',
  });
  if (result.error !== undefined) throw result.error;
  if ((result.status === 0) !== expectedSuccess) {
    throw new Error(
      expectedSuccess
        ? `Muse command ${arguments_[0]} failed.`
        : `Muse command ${arguments_[0]} unexpectedly succeeded.`,
    );
  }
}

function migrate(contract: RuntimeContract): void {
  runCommand(contract, ['migrate'], true);
  runCommand(contract, ['migration-status'], true);
  runCommand(contract, ['migration-check'], true);
}

async function startServices(contract: RuntimeContract, request: APIRequestContext): Promise<void> {
  const mainPort = new URL(contract.mainOrigin).port || '80';
  startService(contract, 'main', ['serve', '--host', '127.0.0.1', '--port', mainPort]);
  startService(contract, 'phone', ['serve-phone-upload']);
  await Promise.all([
    waitForStatus(request, `${contract.mainOrigin}/api/v1/health`),
    waitForStatus(request, `${contract.mainOrigin}/api/v1/readiness`),
    waitForStatus(request, `${contract.phoneOrigin}/listener-status`),
  ]);
}

function applyStagedMaintenance(contract: RuntimeContract, expectedSuccess: boolean): void {
  runCommand(
    contract,
    ['apply-staged-maintenance', '--confirm', 'APPLY STAGED MUSE MAINTENANCE'],
    expectedSuccess,
  );
}

function auditDatabase(contract: RuntimeContract): DatabaseAudit {
  const script = String.raw`
import json
import sqlite3
from muse_backend.config import Settings

with sqlite3.connect(Settings().database_path) as connection:
    result = {
        "quickCheck": connection.execute("PRAGMA quick_check").fetchone()[0],
        "foreignKeyViolations": len(connection.execute("PRAGMA foreign_key_check").fetchall()),
        "clothingItems": connection.execute("SELECT count(*) FROM clothing_items").fetchone()[0],
        "outfits": connection.execute("SELECT count(*) FROM outfits").fetchone()[0],
        "images": connection.execute("SELECT count(*) FROM clothing_images").fetchone()[0],
    }
print(json.dumps(result))
`;
  const result = spawnSync(contract.pythonExecutable, ['-c', script], {
    env: contract.serviceEnvironment,
    encoding: 'utf8',
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('The P6 SQLite integrity audit failed.');
  }
  return JSON.parse(result.stdout) as DatabaseAudit;
}

async function expectStatus(response: APIResponse, expected: number, label: string): Promise<void> {
  const status = response.status();
  await response.dispose();
  expect(status, `${label} returned status ${status}.`).toBe(expected);
}

async function jsonResponse<T>(response: APIResponse, expected: number, label: string): Promise<T> {
  const status = response.status();
  if (status !== expected) {
    const responseBody = (await response.text()).slice(0, 500);
    await response.dispose();
    throw new Error(`${label} returned status ${status}: ${responseBody}`);
  }
  const body = (await response.json()) as T;
  await response.dispose();
  return body;
}

function settingsHeaders(origin: string): Record<string, string> {
  return { Origin: origin, 'Content-Type': 'application/json' };
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
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
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, 'The Settings touch target must have measurable bounds.').not.toBeNull();
  expect(bounds?.width).toBeGreaterThanOrEqual(56);
  expect(bounds?.height).toBeGreaterThanOrEqual(56);
}

async function assertListenerIsolation(
  request: APIRequestContext,
  phoneOrigin: string,
): Promise<void> {
  for (const path of [
    '/',
    '/settings',
    '/api/v1/health',
    '/api/v1/clothing-items',
    '/api/v1/outfits',
    '/api/v1/settings',
    '/api/v1/settings/backups',
    '/api/v1/settings/device-status',
    '/api/v1/settings/maintenance-status',
    '/api/docs',
    '/api/openapi.json',
  ]) {
    await expectStatus(await request.get(`${phoneOrigin}${path}`), 404, `LAN isolation ${path}`);
  }
}

test('P6 production startup, Settings, restore, and delete-all remain local and safe', async ({
  page,
  request,
}, testInfo) => {
  const required = [
    'PLAYWRIGHT_BASE_URL',
    'PLAYWRIGHT_PHONE_UPLOAD_BASE_URL',
    'MUSE_BACKEND_EXECUTABLE',
    'MUSE_P6_E2E_RUNTIME_ROOT',
    'MUSE_P6_E2E_DATA_ROOT',
  ];
  test.skip(
    required.some((name) => !process.env[name]?.trim()),
    `This destructive contract requires ${required.join(', ')}.`,
  );
  test.setTimeout(240_000);

  const contract = runtimeContract(testInfo.retry);
  const externalRequests = new Set<string>();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (url.origin !== contract.mainOrigin) externalRequests.add(url.origin);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await stopServices(contract);
  migrate(contract);

  try {
    await startServices(contract, request);
    await test.step('observe readiness-aware startup and exercise every Settings section', async () => {
      const navigation = await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(navigation?.status()).toBe(200);
      const splash = page.locator('[data-startup-state="intro"]');
      await expect(splash).toBeVisible();
      await expect(splash).toHaveAttribute('data-splash-playback', 'full');
      await expect(splash).toContainText('Your wardrobe, reimagined.');
      await expect(page.getByRole('heading', { level: 1, name: 'Muse' })).toBeVisible({
        timeout: 12_000,
      });
      await expectNoHorizontalOverflow(page);

      await page.getByRole('link', { name: 'Open Settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      for (const label of [
        'Open Wi-Fi and Network settings',
        'Open Display settings',
        'Open Data settings',
        'Open Device settings',
        'Open About Muse',
      ]) {
        await expectTouchTarget(page.getByRole('link', { name: label }));
      }
      await expectTouchTarget(page.getByRole('button', { name: 'Open power options' }));
      await expectNoHorizontalOverflow(page);

      await page.getByRole('link', { name: 'Open Wi-Fi and Network settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'W & N' })).toBeVisible();
      await expect(page.getByText('Phone upload', { exact: true })).toBeVisible();
      await expect(page.getByText('Available', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to Settings' }).click();

      await page.getByRole('link', { name: 'Open Display settings' }).click();
      const reducedMotion = page.getByRole('switch', { name: 'Reduced Motion' });
      await expectTouchTarget(reducedMotion);
      await expect(reducedMotion).toHaveAttribute('aria-checked', 'false');
      const settingsSaved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === '/api/v1/settings',
      );
      await reducedMotion.click();
      expect((await settingsSaved).status()).toBe(200);
      await expect(reducedMotion).toHaveAttribute('aria-checked', 'true');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: 'Display' })).toBeVisible({
        timeout: 12_000,
      });
      await expect(page.getByRole('switch', { name: 'Reduced Motion' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to Settings' }).click();

      await page.getByRole('link', { name: 'Open Data settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible();
      await page.getByRole('button', { name: 'Create backup' }).click();
      await expect(page.getByRole('list', { name: 'Local backups' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByRole('list', { name: 'Local backups' }).getByRole('listitem'),
      ).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to Settings' }).click();

      await page.getByRole('link', { name: 'Open Device settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Device' })).toBeVisible();
      await expect(page.getByText('Muse is ready')).toBeVisible();
      await expect(page.getByText('Requires deployment configuration').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to Settings' }).click();

      await page.getByRole('link', { name: 'Open About Muse' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'About Muse' })).toBeVisible();
      await expect(page.getByText('Your wardrobe, reimagined.')).toBeVisible();
      await expect(
        page.getByText(/stores your wardrobe, images, outfits, and preferences locally/u),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to Settings' }).click();

      await page.getByRole('button', { name: 'Open power options' }).click();
      const powerDialog = page.getByRole('dialog', { name: 'Power options' });
      await expect(powerDialog.getByRole('button', { name: 'Restart Muse' })).toBeDisabled();
      await expect(powerDialog.getByRole('button', { name: 'Restart Device' })).toBeDisabled();
      await expect(powerDialog.getByRole('button', { name: 'Shut Down' })).toBeDisabled();
      await powerDialog.getByRole('button', { name: 'Sleep Display' }).click();
      const sleepOverlay = page.getByRole('button', { name: 'Wake Muse display' });
      await expect(sleepOverlay).toBeVisible();
      await expect(page).toHaveURL(/\/settings$/u);
      await sleepOverlay.click();
      await expect(sleepOverlay).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    const garment = await test.step('create a garment, outfit, and restorable backup', async () => {
      const imported = await jsonResponse<ImportedGarment>(
        await request.post(`${contract.mainOrigin}/api/v1/clothing-items/import`, {
          headers: { 'Idempotency-Key': `p6-restore-${testInfo.retry}` },
          multipart: {
            metadata: JSON.stringify({
              name: 'P6 Restored Garment',
              garment_category: 'top',
              default_body_zone: 'upper_body',
              brand: 'Muse Verification',
            }),
            image: {
              name: 'p6-restored-garment.png',
              mimeType: 'image/png',
              buffer: testGarmentPng,
            },
          },
        }),
        201,
        'garment import',
      );
      expect(imported.name).toBe('P6 Restored Garment');
      expect(imported.images.some((image) => image.image_kind === 'original')).toBe(true);

      const outfit = await jsonResponse<SavedOutfit>(
        await request.post(`${contract.mainOrigin}/api/v1/outfits`, {
          data: {
            name: 'P6 Restored Outfit',
            items: [
              {
                clothing_item_id: imported.id,
                body_zone: 'upper_body',
                position_x: 0.5,
                position_y: 0.42,
                scale: 1,
                rotation: 0,
                layer_index: 0,
              },
            ],
          },
        }),
        201,
        'outfit creation',
      );
      expect(outfit.preview_url).not.toBeNull();

      await expect
        .poll(
          async () => {
            const response = await request.get(
              `${contract.mainOrigin}/api/v1/clothing-items/${imported.id}`,
            );
            if (!response.ok()) {
              await response.dispose();
              return 'unavailable';
            }
            const detail = (await response.json()) as ImportedGarment;
            await response.dispose();
            return detail.image_processing_state;
          },
          {
            message: 'Background processing must release the import gate before backup.',
            timeout: 20_000,
            intervals: [100, 250, 500],
          },
        )
        .toMatch(/^(?:completed|completed_with_fallback)$/u);

      const backup = await jsonResponse<BackupSummary>(
        await request.post(`${contract.mainOrigin}/api/v1/settings/backups`, {
          headers: settingsHeaders(contract.mainOrigin),
          data: { confirmation: 'CREATE BACKUP' },
        }),
        201,
        'backup creation',
      );
      expect(backup).toMatchObject({ clothing_items: 1, outfits: 1 });
      expect(backup.media_files).toBeGreaterThanOrEqual(4);
      return { imported, outfit, backup };
    });

    await test.step('restore the backup only through the stopped-service contract', async () => {
      await expectStatus(
        await request.delete(`${contract.mainOrigin}/api/v1/outfits/${garment.outfit.id}`),
        204,
        'outfit mutation',
      );
      await expectStatus(
        await request.delete(`${contract.mainOrigin}/api/v1/clothing-items/${garment.imported.id}`),
        204,
        'garment mutation',
      );
      const staged = await jsonResponse<{ status: string }>(
        await request.post(
          `${contract.mainOrigin}/api/v1/settings/backups/${garment.backup.id}/stage-restore`,
          {
            headers: settingsHeaders(contract.mainOrigin),
            data: { confirmation: 'RESTORE' },
          },
        ),
        202,
        'restore staging',
      );
      expect(staged.status).toBe('staged_restart_required');
      applyStagedMaintenance(contract, false);

      await stopServices(contract);
      applyStagedMaintenance(contract, true);
      await startServices(contract, request);

      const restoredGarment = await jsonResponse<ImportedGarment>(
        await request.get(`${contract.mainOrigin}/api/v1/clothing-items/${garment.imported.id}`),
        200,
        'restored garment',
      );
      const restoredOutfit = await jsonResponse<SavedOutfit>(
        await request.get(`${contract.mainOrigin}/api/v1/outfits/${garment.outfit.id}`),
        200,
        'restored outfit',
      );
      expect(restoredGarment.name).toBe('P6 Restored Garment');
      expect(restoredOutfit.name).toBe('P6 Restored Outfit');
      for (const image of restoredGarment.images) {
        await expectStatus(
          await request.get(`${contract.mainOrigin}${image.content_url}`),
          200,
          `restored ${image.image_kind} media`,
        );
      }
      if (restoredOutfit.preview_url === null)
        throw new Error('The restored outfit lost its preview.');
      await expectStatus(
        await request.get(`${contract.mainOrigin}${restoredOutfit.preview_url}`),
        200,
        'restored outfit preview',
      );
      expect(auditDatabase(contract)).toMatchObject({
        quickCheck: 'ok',
        foreignKeyViolations: 0,
        clothingItems: 1,
        outfits: 1,
      });
      await waitForStatus(request, `${contract.mainOrigin}/api/v1/readiness`);
    });

    await test.step('require two UI confirmation stages before delete-all', async () => {
      await page.goto('/settings/data');
      await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible({
        timeout: 12_000,
      });
      await page.getByRole('button', { name: 'Delete all Muse data' }).click();
      const firstConfirmation = page.getByRole('dialog', { name: 'Delete all Muse data?' });
      await expect(firstConfirmation).toBeVisible();
      await expect(firstConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await firstConfirmation
        .getByRole('button', { name: 'Continue to final confirmation' })
        .click();

      const finalConfirmation = page.getByRole('dialog', { name: 'Final deletion confirmation' });
      await expect(finalConfirmation).toBeVisible();
      await expect(finalConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await finalConfirmation
        .getByRole('textbox', { name: 'Type DELETE ALL MUSE DATA to continue' })
        .fill('DELETE ALL MUSE DATA');
      await finalConfirmation
        .getByRole('checkbox', { name: /local backups on this device are included/u })
        .check();
      await finalConfirmation.getByRole('button', { name: 'Stage data deletion' }).click();
      await expect(page.getByText('Safe restart required')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    await test.step('activate delete-all offline and retain a healthy restricted boundary', async () => {
      applyStagedMaintenance(contract, false);
      await stopServices(contract);
      applyStagedMaintenance(contract, true);
      await startServices(contract, request);

      const clothing = await jsonResponse<{ total: number }>(
        await request.get(`${contract.mainOrigin}/api/v1/clothing-items`),
        200,
        'empty garment collection',
      );
      const outfits = await jsonResponse<{ total: number }>(
        await request.get(`${contract.mainOrigin}/api/v1/outfits`),
        200,
        'empty outfit collection',
      );
      const backups = await jsonResponse<{ total: number }>(
        await request.get(`${contract.mainOrigin}/api/v1/settings/backups`),
        200,
        'empty backup collection',
      );
      const settings = await jsonResponse<{ preferences: { reduced_motion: boolean } }>(
        await request.get(`${contract.mainOrigin}/api/v1/settings`),
        200,
        'reset preferences',
      );
      const maintenance = await jsonResponse<{ status: string }>(
        await request.get(`${contract.mainOrigin}/api/v1/settings/maintenance-status`),
        200,
        'maintenance completion status',
      );
      expect({ clothing: clothing.total, outfits: outfits.total, backups: backups.total }).toEqual({
        clothing: 0,
        outfits: 0,
        backups: 0,
      });
      expect(settings.preferences.reduced_motion).toBe(false);
      expect(maintenance.status).toBe('none');
      expect(auditDatabase(contract)).toMatchObject({
        quickCheck: 'ok',
        foreignKeyViolations: 0,
        clothingItems: 0,
        outfits: 0,
        images: 0,
      });
      await assertListenerIsolation(request, contract.phoneOrigin);
      await waitForStatus(request, `${contract.mainOrigin}/api/v1/readiness`);
    });

    expect([...externalRequests]).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await stopServices(contract);
  }
});
