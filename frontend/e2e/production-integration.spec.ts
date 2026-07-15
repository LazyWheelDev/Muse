import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const testGarmentPng = Buffer.from(
  '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',
  'base64',
);

async function expectNoHorizontalOverflow(page: Page) {
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

async function expectKioskViewportFit(page: Page) {
  const dimensions = await page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return {
      scrollY: window.scrollY,
      documentClientHeight: scroller.clientHeight,
      documentScrollHeight: scroller.scrollHeight,
      bodyClientHeight: document.body.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
    };
  });

  expect(dimensions.scrollY).toBe(0);
  expect(dimensions.documentScrollHeight).toBeLessThanOrEqual(dimensions.documentClientHeight);
  expect(dimensions.bodyScrollHeight).toBeLessThanOrEqual(dimensions.bodyClientHeight);
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, 'The touch target must have measurable bounds.').not.toBeNull();
  expect(bounds?.width).toBeGreaterThanOrEqual(56);
  expect(bounds?.height).toBeGreaterThanOrEqual(56);
}

test('a garment persists through the complete local production workflow', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    'This contract requires PLAYWRIGHT_BASE_URL to target a running FastAPI production host.',
  );
  test.setTimeout(60_000);

  const configuredBaseUrl = testInfo.project.use.baseURL;
  if (typeof configuredBaseUrl !== 'string') {
    throw new Error('Playwright requires a configured baseURL.');
  }

  const applicationOrigin = new URL(configuredBaseUrl).origin;
  const externalRequests: string[] = [];
  const mediaRequestPaths: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== applicationOrigin) {
      externalRequests.push(request.url());
    } else if (requestUrl.pathname.startsWith('/api/v1/media/')) {
      mediaRequestPaths.push(requestUrl.pathname);
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

  await test.step('start from an empty Wardrobe', async () => {
    const response = await page.goto('/wardrobe');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your wardrobe is empty.' })).toBeVisible();
    await expectTouchTarget(page.getByRole('link', { name: 'Add Garment' }));
    await expectNoHorizontalOverflow(page);
  });

  await test.step('select, preview, and import a real PNG', async () => {
    await page.getByRole('link', { name: 'Add Garment' }).click();
    await expect(page).toHaveURL(/\/wardrobe\/add/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Add Garment' })).toBeVisible();
    await page.getByRole('link', { name: /Upload on this device/u }).click();
    await expect(page).toHaveURL(/\/wardrobe\/add\/device/u);
    await expectNoHorizontalOverflow(page);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'muse-e2e-linen-shirt.png',
      mimeType: 'image/png',
      buffer: testGarmentPng,
    });
    await expect(page.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).fill('E2E Linen Shirt');
    await page.getByRole('textbox', { name: 'Brand' }).fill('Muse Test Atelier');
    await page.getByLabel('Category').selectOption('top');
    await expect(page.getByLabel('Default body zone')).toHaveValue('upper_body');
    await expectTouchTarget(page.getByRole('button', { name: 'Import garment' }));
    await page.getByRole('button', { name: 'Import garment' }).click();

    await expect(page).toHaveURL(/\/wardrobe\?.*item=\d+/u, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'E2E Linen Shirt' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'E2E Linen Shirt' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectKioskViewportFit(page);
  });

  await test.step('exercise fullscreen and grid views at kiosk size', async () => {
    await expectTouchTarget(page.getByRole('button', { name: 'Open garment fullscreen' }));
    await page.getByRole('button', { name: 'Open garment fullscreen' }).click();
    await expect(page.getByRole('dialog', { name: 'E2E Linen Shirt' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Reduce view' }).click();

    await page.getByRole('button', { name: 'All' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'E2E Linen Shirt' })).toBeVisible();
    await expectTouchTarget(page.getByRole('button', { name: 'Grid View' }));
    await page.getByRole('button', { name: 'Grid View' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'All garments' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'E2E Linen Shirt' })).toHaveAttribute(
      'loading',
      'lazy',
    );
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: /E2E Linen Shirt/u }).click();
    await expectKioskViewportFit(page);
  });

  await test.step('edit Details and prove persistence after a full reload', async () => {
    await expectTouchTarget(page.getByRole('button', { name: 'Info' }));
    await page.getByRole('button', { name: 'Info' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    await expect(page.getByText('Muse Test Atelier')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectKioskViewportFit(page);

    await expectTouchTarget(page.getByRole('button', { name: 'Edit' }));
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Brand' }).fill('Persisted Local Atelier');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await expect(page.getByText('Persisted Local Atelier')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    await expect(page.getByText('Persisted Local Atelier')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectKioskViewportFit(page);
  });

  await test.step('soft-delete with confirmation and return to the empty Wardrobe', async () => {
    await expectTouchTarget(page.getByRole('button', { name: 'Delete' }));
    await page.getByRole('button', { name: 'Delete' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete E2E Linen Shirt?' });
    await expect(confirmation).toContainText('Saved outfits may still retain a reference');
    await confirmation.getByRole('button', { name: 'Delete garment' }).click();

    await expect(page).toHaveURL(/\/wardrobe(?:\?|$)/u);
    await expect(page.getByRole('heading', { name: 'Your wardrobe is empty.' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(externalRequests).toEqual([]);
  expect(mediaRequestPaths.some((path) => path.includes('/garments/thumbnails/'))).toBe(true);
  expect(
    mediaRequestPaths.some(
      (path) => path.includes('/garments/processed/') || path.includes('/garments/cutouts/'),
    ),
  ).toBe(true);
  expect(mediaRequestPaths.some((path) => path.includes('/garments/original'))).toBe(false);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
