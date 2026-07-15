import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

// Never let Playwright's AI failure snapshot persist a visible one-time URL.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

const testGarmentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAACQCAYAAAD3Cm4hAAABTElEQVR42u3X0bGDIBBAUaA9P52xSGf8tD5ThOCG5dwGXtgDm5dSJEmSJK1W/fKPXcf2zDKY/bxrCoCZhh6BUQ0+FqIZfuy5qsHHvoZm+LHnbUWhNbc/9tzN8GPPbwXNvIJWv/095uAFZPgSVgCA9dNnHl6AFQRAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAIwAAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABAKCPAfbzrsb3fh5egBUEoFhDMevHC8iwglZ/BW/P3/7hQ6w6fCso039Bq72CXucdMrTr2B6DD1xBWV/DiHMNH1SG1zDyQn16U2fC8CNTkiRJifsBsL5M/LEKz3AAAAAASUVORK5CYII=',
  'base64',
);

interface RuntimeContract {
  executable: string;
  mainPidFile: string;
  phonePidFile: string;
  dataRoot: string;
  serviceEnvironment: NodeJS.ProcessEnv;
}

interface UploadResult {
  clothingItemId: number;
}

interface GarmentDetail {
  name: string;
  brand: string | null;
  imageKinds: string[];
  displayUrl: string;
  originalUrl: string;
}

interface BrowserEvidence {
  externalOrigins: Set<string>;
  secretInNetworkUrl: boolean;
  consoleErrors: string[];
  pageErrors: string[];
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`The P4 production test requires ${name}.`);
  }
  return value;
}

function runtimeContract(retry: number): RuntimeContract {
  const executable = requiredEnvironment('MUSE_BACKEND_EXECUTABLE');
  const mainPidFile = requiredEnvironment('MUSE_MAIN_PID_FILE');
  const phonePidFile = requiredEnvironment('MUSE_PHONE_PID_FILE');
  const dataRoot = join(
    requiredEnvironment('MUSE_PHONE_E2E_DATA_ROOT'),
    `playwright-attempt-${retry}`,
  );
  return {
    executable,
    mainPidFile,
    phonePidFile,
    dataRoot,
    serviceEnvironment: {
      ...process.env,
      MUSE_DATA_ROOT: dataRoot,
      PATH: `${dirname(executable)}:/usr/bin:/bin`,
    },
  };
}

function processId(pidFile: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(pidFile, 'utf8').trim();
  } catch {
    return null;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error('A Muse test service PID file is invalid.');
  }
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error('A Muse test service PID is unsafe.');
  }
  return pid;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

async function stopService(pidFile: string): Promise<void> {
  const pid = processId(pidFile);
  if (pid === null || !isRunning(pid)) {
    return;
  }
  process.kill(pid, 'SIGTERM');
  await expect
    .poll(() => isRunning(pid), {
      message: 'Muse test service must stop cleanly before restart.',
      timeout: 15_000,
      intervals: [100, 200, 500],
    })
    .toBe(false);
}

function migration(contract: RuntimeContract): void {
  const result = spawnSync(contract.executable, ['migrate'], {
    env: contract.serviceEnvironment,
    stdio: 'ignore',
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('The isolated P4 database migration failed.');
  }
}

function logPath(pidFile: string): string {
  return pidFile.endsWith('.pid') ? `${pidFile.slice(0, -4)}.log` : `${pidFile}.log`;
}

function startService(contract: RuntimeContract, pidFile: string, arguments_: string[]): void {
  const logDescriptor = openSync(logPath(pidFile), 'a', 0o600);
  const child = spawn(contract.executable, arguments_, {
    env: contract.serviceEnvironment,
    detached: false,
    stdio: ['ignore', logDescriptor, logDescriptor],
  });
  closeSync(logDescriptor);
  if (child.pid === undefined) {
    throw new Error('A Muse test service could not be started.');
  }
  writeFileSync(pidFile, `${child.pid}\n`, { encoding: 'utf8', mode: 0o600 });
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
        message: 'Muse test service must become ready after restart.',
        timeout: 30_000,
        intervals: [100, 250, 500, 1_000],
      },
    )
    .toBe(expectedStatus);
}

async function startMainService(
  contract: RuntimeContract,
  request: APIRequestContext,
  mainOrigin: string,
): Promise<void> {
  startService(contract, contract.mainPidFile, ['serve', '--host', '127.0.0.1', '--port', '8000']);
  await Promise.all([
    waitForStatus(request, `${mainOrigin}/api/v1/health`),
    waitForStatus(request, `${mainOrigin}/api/v1/readiness`),
  ]);
}

async function startPhoneService(
  contract: RuntimeContract,
  request: APIRequestContext,
  phoneOrigin: string,
): Promise<void> {
  startService(contract, contract.phonePidFile, ['serve-phone-upload']);
  await waitForStatus(request, `${phoneOrigin}/listener-status`);
}

async function restartServices(
  contract: RuntimeContract,
  request: APIRequestContext,
  mainOrigin: string,
  phoneOrigin: string,
): Promise<void> {
  await Promise.all([stopService(contract.mainPidFile), stopService(contract.phonePidFile)]);
  await Promise.all([
    startMainService(contract, request, mainOrigin),
    startPhoneService(contract, request, phoneOrigin),
  ]);
}

function evidenceFor(page: Page, allowedOrigins: Set<string>): BrowserEvidence {
  const evidence: BrowserEvidence = {
    externalOrigins: new Set(),
    secretInNetworkUrl: false,
    consoleErrors: [],
    pageErrors: [],
  };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!allowedOrigins.has(url.origin)) {
      evidence.externalOrigins.add(url.origin);
    }
    if (url.hash.includes('token=')) {
      evidence.secretInNetworkUrl = true;
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      evidence.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  return evidence;
}

async function expectNoHorizontalOverflow(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
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
  expect(dimensions.viewportWidth).toBe(viewport.width);
  expect(dimensions.viewportHeight).toBe(viewport.height);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, 'The touch target must have measurable bounds.').not.toBeNull();
  expect(bounds?.width).toBeGreaterThanOrEqual(56);
  expect(bounds?.height).toBeGreaterThanOrEqual(56);
}

async function decodeDisplayedQr(page: Page): Promise<string> {
  const qrImage = page.getByRole('img', {
    name: 'QR code for adding a garment from your phone',
  });
  const image = PNG.sync.read(await qrImage.screenshot({ animations: 'disabled' }));
  const decoded = jsQR(Uint8ClampedArray.from(image.data), image.width, image.height);
  if (decoded === null || decoded.data.length > 2_048) {
    throw new Error('The displayed phone-upload QR code could not be decoded safely.');
  }
  return decoded.data;
}

function parseQrPayload(payload: string): URL {
  try {
    return new URL(payload);
  } catch {
    throw new Error('The displayed phone-upload QR payload is not a valid URL.');
  }
}

async function openQrPayloadWithoutReportingSecret(page: Page, payload: string): Promise<void> {
  const parsed = parseQrPayload(payload);
  const fragment = parsed.hash.slice(1);
  await page.addInitScript((oneTimeFragment) => {
    const handoffMarker = 'muse.e2e.qr-handoff.v1';
    if (
      window.location.pathname === '/u/' &&
      window.sessionStorage.getItem(handoffMarker) !== '1'
    ) {
      window.sessionStorage.setItem(handoffMarker, '1');
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#${oneTimeFragment}`,
      );
    }
  }, fragment);
  await page.goto(`${parsed.origin}${parsed.pathname}`);
}

function decodeUploadResult(value: unknown): UploadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The phone upload returned an invalid completion response.');
  }
  const result = value as Record<string, unknown>;
  if (result.status !== 'completed' || !Number.isSafeInteger(result.clothing_item_id)) {
    throw new Error('The phone upload did not return a committed garment.');
  }
  const clothingItemId = Number(result.clothing_item_id);
  if (clothingItemId <= 0) {
    throw new Error('The phone upload returned an invalid garment identifier.');
  }
  return { clothingItemId };
}

function decodeGarmentDetail(value: unknown): GarmentDetail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Muse returned an invalid garment detail.');
  }
  const detail = value as Record<string, unknown>;
  if (
    typeof detail.name !== 'string' ||
    (detail.brand !== null && typeof detail.brand !== 'string') ||
    !Array.isArray(detail.images)
  ) {
    throw new Error('Muse returned an incomplete garment detail.');
  }
  const images = detail.images.filter(
    (image): image is Record<string, unknown> =>
      typeof image === 'object' && image !== null && !Array.isArray(image),
  );
  const imageKinds = images
    .map((image) => image.image_kind)
    .filter((kind): kind is string => typeof kind === 'string');
  const display = images.find(
    (image) => image.image_kind === 'normalized' && typeof image.content_url === 'string',
  );
  if (display === undefined || typeof display.content_url !== 'string') {
    throw new Error('Muse did not persist a normalized garment image.');
  }
  const original = images.find(
    (image) => image.image_kind === 'original' && typeof image.content_url === 'string',
  );
  if (original === undefined || typeof original.content_url !== 'string') {
    throw new Error('Muse did not preserve the original garment image.');
  }
  return {
    name: detail.name,
    brand: detail.brand,
    imageKinds,
    displayUrl: display.content_url,
    originalUrl: original.content_url,
  };
}

async function expectRejectedMultipartReplay(payload: string, phoneOrigin: string): Promise<void> {
  const parsed = parseQrPayload(payload);
  const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
  if (parsed.origin !== phoneOrigin || token === null || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new Error('The replay test did not receive a valid local upload credential.');
  }
  const multipart = new FormData();
  multipart.append(
    'metadata',
    JSON.stringify({
      name: 'Replay must not import',
      garment_category: 'top',
      default_body_zone: 'upper_body',
    }),
  );
  multipart.append('image', new Blob([testGarmentPng], { type: 'image/png' }), 'garment.png');
  const response = await fetch(`${phoneOrigin}/phone-api/v1/upload`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Origin: phoneOrigin,
      'X-Muse-Upload-Token': token,
    },
    body: multipart,
  });
  expect(response.status).toBe(409);
  const body = (await response.json()) as unknown;
  let code: unknown = null;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error;
    if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
      code = (error as Record<string, unknown>).code;
    }
  }
  expect(code).toBe('phone_upload_session_used');
}

async function readGarment(
  request: APIRequestContext,
  mainOrigin: string,
  itemId: number,
): Promise<GarmentDetail> {
  const response = await request.get(`${mainOrigin}/api/v1/clothing-items/${itemId}`);
  expect(response.status()).toBe(200);
  const detail = decodeGarmentDetail(await response.json());
  await response.dispose();
  return detail;
}

async function expectUsedCode(
  browser: Browser,
  payload: string,
  allowedOrigins: Set<string>,
): Promise<BrowserEvidence> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const evidence = evidenceFor(page, allowedOrigins);
  await openQrPayloadWithoutReportingSecret(page, payload);
  await expect(page.getByRole('heading', { name: 'Code already used' })).toBeVisible();
  await expectNoHorizontalOverflow(page, { width: 390, height: 844 });
  await context.close();
  return evidence;
}

test('a decoded local QR imports one garment once and survives both service restarts', async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    'This contract requires a running production Muse host.',
  );
  test.setTimeout(150_000);

  const configuredBaseUrl = testInfo.project.use.baseURL;
  if (typeof configuredBaseUrl !== 'string') {
    throw new Error('Playwright requires a configured baseURL.');
  }
  const mainOrigin = new URL(configuredBaseUrl).origin;
  const phoneOrigin = new URL(requiredEnvironment('PLAYWRIGHT_PHONE_UPLOAD_BASE_URL')).origin;
  if (mainOrigin !== 'http://127.0.0.1:8000' || phoneOrigin !== 'http://127.0.0.1:8787') {
    throw new Error('The P4 production harness requires isolated loopback test listeners.');
  }
  const contract = runtimeContract(testInfo.retry);
  const deviceOrigins = new Set([mainOrigin]);
  const phoneOrigins = new Set([phoneOrigin]);
  const deviceEvidence = evidenceFor(page, deviceOrigins);

  await test.step('restart onto the isolated migrated database and verify empty Wardrobe', async () => {
    await Promise.all([stopService(contract.mainPidFile), stopService(contract.phonePidFile)]);
    migration(contract);
    await startMainService(contract, request, mainOrigin);

    const response = await page.goto('/wardrobe');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Your wardrobe is empty.' })).toBeVisible();
    await expectNoHorizontalOverflow(page, { width: 1280, height: 800 });
  });

  let qrPayload = '';
  await test.step('withhold QR credentials while the restricted listener is offline', async () => {
    await page.getByRole('link', { name: 'Add Garment' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Add Garment' })).toBeVisible();
    await expectTouchTarget(page.getByRole('link', { name: /Upload on this device/u }));
    await expectTouchTarget(page.getByRole('link', { name: /Upload from phone/u }));
    const unavailableCreation = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.origin === mainOrigin &&
        url.pathname === '/api/v1/phone-upload-sessions'
      );
    });
    await page.getByRole('link', { name: /Upload from phone/u }).click();
    expect((await unavailableCreation).status()).toBe(503);

    await expect(page.getByText('Phone upload unavailable')).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'QR code for adding a garment from your phone' }),
    ).toHaveCount(0);
    await expect(page.locator('code')).toHaveCount(0);
    await expectTouchTarget(page.getByRole('button', { name: 'Retry connection' }));
    await expectNoHorizontalOverflow(page, { width: 1280, height: 800 });

    const unexpectedConsoleErrors = deviceEvidence.consoleErrors.filter(
      (message) => !message.includes('status of 503 (Service Unavailable)'),
    );
    expect(unexpectedConsoleErrors).toEqual([]);
    deviceEvidence.consoleErrors.length = 0;
  });

  await test.step('start the restricted listener and create the actual one-time QR on retry', async () => {
    await startPhoneService(contract, request, phoneOrigin);
    await page.getByRole('button', { name: 'Retry connection' }).click();

    await expect(page.getByText('Waiting for phone')).toBeVisible();
    await expect(page.getByText('Phone upload available')).toBeVisible();
    await expect(page.getByText(/Code expires in/u)).toBeVisible();
    await expectTouchTarget(page.getByRole('button', { name: 'Cancel session' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Generate new code' }));
    await expectNoHorizontalOverflow(page, { width: 1280, height: 800 });

    qrPayload = await decodeDisplayedQr(page);
    const readableUrl = (await page.locator('code').first().textContent())?.trim() ?? '';
    expect(qrPayload === readableUrl, 'QR payload must exactly equal the readable URL.').toBe(true);
    const parsed = parseQrPayload(qrPayload);
    expect(parsed.origin).toBe(phoneOrigin);
    expect(parsed.pathname).toBe('/u/');
    expect(/^#token=[A-Za-z0-9_-]{43}$/u.test(parsed.hash)).toBe(true);
  });

  await test.step('retain the same QR while the listener stops and recovers', async () => {
    await stopService(contract.phonePidFile);
    await expect(page.getByText('Phone upload unavailable')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(
        'Muse cannot currently reach phone upload. It will retry automatically, and this code remains valid until it expires.',
      ),
    ).toBeVisible();
    const offlineQrPayload = await decodeDisplayedQr(page);
    expect(
      offlineQrPayload === qrPayload,
      'Listener outage must not rotate the one-time code.',
    ).toBe(true);

    await startPhoneService(contract, request, phoneOrigin);
    await expect(page.getByText('Phone upload available')).toBeVisible({ timeout: 10_000 });
    const recoveredQrPayload = await decodeDisplayedQr(page);
    expect(
      recoveredQrPayload === qrPayload,
      'Listener recovery must preserve the existing one-time code.',
    ).toBe(true);
    await page.locator('code').evaluateAll((elements) => {
      for (const element of elements) {
        element.textContent = '[one-time local URL verified]';
        element.setAttribute('aria-hidden', 'true');
      }
    });
  });

  const phoneContext: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phonePage = await phoneContext.newPage();
  const phoneEvidence = evidenceFor(phonePage, phoneOrigins);
  let clothingItemId = 0;

  await test.step('open the local mobile page and upload a real garment image and metadata', async () => {
    await openQrPayloadWithoutReportingSecret(phonePage, qrPayload);
    await expect(phonePage.getByRole('heading', { name: 'Add Garment' })).toBeVisible();
    await expect(phonePage.getByText(/same local network/u)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phone connected', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expectTouchTarget(phonePage.locator("label[for='phone-image-camera']"));
    await expectTouchTarget(phonePage.locator("label[for='phone-image-gallery']"));
    await expectNoHorizontalOverflow(phonePage, { width: 390, height: 844 });

    await phonePage.locator('#phone-image-gallery').setInputFiles({
      name: 'phone-linen-shirt.png',
      mimeType: 'image/png',
      buffer: testGarmentPng,
    });
    await expect(phonePage.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    await expectTouchTarget(phonePage.getByRole('button', { name: 'Replace' }));
    await expectTouchTarget(phonePage.getByRole('button', { name: 'Remove' }));
    await phonePage.getByRole('textbox', { name: 'Garment name' }).fill('Phone Linen Shirt');
    await phonePage.getByRole('combobox', { name: 'Category' }).selectOption('top');
    await expect(phonePage.getByText('Suggested placement: upper body')).toBeVisible();
    await phonePage.getByText('Optional details', { exact: true }).click();
    await phonePage.getByRole('textbox', { name: 'Brand' }).fill('Muse Phone Atelier');

    const uploadResponse = phonePage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.origin === phoneOrigin &&
        url.pathname === '/phone-api/v1/upload'
      );
    });
    await expectTouchTarget(phonePage.getByRole('button', { name: 'Add garment to Muse' }));
    await phonePage.getByRole('button', { name: 'Add garment to Muse' }).click();
    const completedResponse = await uploadResponse;
    expect(completedResponse.status()).toBe(201);
    clothingItemId = decodeUploadResult(await completedResponse.json()).clothingItemId;

    await expect(phonePage.getByRole('heading', { name: 'Garment added' })).toBeVisible();
    await expect(page.getByText('Import complete')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/wardrobe/${clothingItemId}(?:\\?|$)`, 'u'), {
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    await expect(page.getByText('Phone Linen Shirt')).toBeVisible();
    await expect(page.getByText('Muse Phone Atelier')).toBeVisible();
    await expectNoHorizontalOverflow(page, { width: 1280, height: 800 });
  });

  await phoneContext.close();
  const persisted = await readGarment(request, mainOrigin, clothingItemId);
  expect(persisted.name).toBe('Phone Linen Shirt');
  expect(persisted.brand).toBe('Muse Phone Atelier');
  expect(persisted.imageKinds.includes('original')).toBe(true);
  expect(persisted.imageKinds.includes('normalized')).toBe(true);
  expect(persisted.imageKinds.includes('thumbnail')).toBe(true);
  const persistedImage = await request.get(`${mainOrigin}${persisted.displayUrl}`);
  expect(persistedImage.status()).toBe(200);
  await persistedImage.dispose();
  const exactOriginal = await request.get(`${mainOrigin}${persisted.originalUrl}`);
  expect(exactOriginal.status()).toBe(200);
  expect(Buffer.compare(await exactOriginal.body(), testGarmentPng)).toBe(0);
  await exactOriginal.dispose();

  await expectRejectedMultipartReplay(qrPayload, phoneOrigin);
  const firstReplayEvidence = await test.step('reject token replay before restart', () =>
    expectUsedCode(browser, qrPayload, phoneOrigins));

  await test.step('restart both listeners and retain the garment and single-use token state', async () => {
    await restartServices(contract, request, mainOrigin, phoneOrigin);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    await expect(page.getByText('Phone Linen Shirt')).toBeVisible();
    await expect(page.getByText('Muse Phone Atelier')).toBeVisible();

    const afterRestart = await readGarment(request, mainOrigin, clothingItemId);
    expect(afterRestart).toEqual(persisted);
    const imageAfterRestart = await request.get(`${mainOrigin}${afterRestart.displayUrl}`);
    expect(imageAfterRestart.status()).toBe(200);
    await imageAfterRestart.dispose();
    const originalAfterRestart = await request.get(`${mainOrigin}${afterRestart.originalUrl}`);
    expect(originalAfterRestart.status()).toBe(200);
    expect(Buffer.compare(await originalAfterRestart.body(), testGarmentPng)).toBe(0);
    await originalAfterRestart.dispose();
  });

  await expectRejectedMultipartReplay(qrPayload, phoneOrigin);
  const secondReplayEvidence = await test.step('reject token replay after restart', () =>
    expectUsedCode(browser, qrPayload, phoneOrigins));

  const isolatedRoute = await request.get(`${phoneOrigin}/api/v1/clothing-items`);
  expect(isolatedRoute.status()).toBe(404);
  await isolatedRoute.dispose();

  for (const evidence of [
    deviceEvidence,
    phoneEvidence,
    firstReplayEvidence,
    secondReplayEvidence,
  ]) {
    expect([...evidence.externalOrigins]).toEqual([]);
    expect(evidence.secretInNetworkUrl).toBe(false);
    expect(evidence.consoleErrors).toEqual([]);
    expect(evidence.pageErrors).toEqual([]);
  }
});
