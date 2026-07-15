import { expect, test } from '@playwright/test';

const routeCases = [
  { path: '/', heading: 'Muse' },
  { path: '/wardrobe', heading: 'Wardrobe' },
  { path: '/outfit-builder', heading: 'Outfit Builder' },
  { path: '/saved-outfits', heading: 'Saved Outfits' },
  { path: '/settings', heading: 'Settings' },
] as const;

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
      await page.goto(route.path);
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
