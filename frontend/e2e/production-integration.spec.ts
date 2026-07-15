import { expect, test } from '@playwright/test';

test('FastAPI serves the route shell and the typed diagnostics client communicates same-origin', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    'This contract requires PLAYWRIGHT_BASE_URL to target a running FastAPI production host.',
  );

  const configuredBaseUrl = testInfo.project.use.baseURL;

  if (typeof configuredBaseUrl !== 'string') {
    throw new Error('Playwright requires a configured baseURL.');
  }

  const applicationOrigin = new URL(configuredBaseUrl).origin;
  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('request', (request) => {
    if (new URL(request.url()).origin !== applicationOrigin) {
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

  const healthResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/health',
  );
  const wardrobeResponse = await page.goto('/wardrobe?diagnostics=1');

  expect(wardrobeResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Local service: connected');

  const healthResponse = await healthResponsePromise;
  expect(healthResponse.status()).toBe(200);
  await expect(healthResponse.json()).resolves.toMatchObject({
    status: 'ok',
    service: 'muse-backend',
  });

  const savedOutfitsResponse = await page.goto('/saved-outfits');
  expect(savedOutfitsResponse?.status()).toBe(200);
  expect(savedOutfitsResponse?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { level: 1, name: 'Saved Outfits' })).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
