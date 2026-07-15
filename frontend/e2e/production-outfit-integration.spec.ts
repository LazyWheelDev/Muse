import { expect, test } from '@playwright/test';
import type { Locator, Page, Response } from '@playwright/test';

const garmentImages = [
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAACQCAYAAAD3Cm4hAAABTElEQVR42u3X0bGDIBBAUaA9P52xSGf8tD5ThOCG5dwGXtgDm5dSJEmSJK1W/fKPXcf2zDKY/bxrCoCZhh6BUQ0+FqIZfuy5qsHHvoZm+LHnbUWhNbc/9tzN8GPPbwXNvIJWv/095uAFZPgSVgCA9dNnHl6AFQRAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAIwAAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABAKCPAfbzrsb3fh5egBUEoFhDMevHC8iwglZ/BW/P3/7hQ6w6fCso039Bq72CXucdMrTr2B6DD1xBWV/DiHMNH1SG1zDyQn16U2fC8CNTkiRJifsBsL5M/LEKz3AAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAACQCAYAAAD3Cm4hAAABSklEQVR42u3XwYHDIAwAQaBKf9wLvfjjLp0iDFYQsw1c0IByKUWSJEnSbtUv/9jZ72eVwVz9qCkAVhp6BEY1+FiIZvix56oGH/samuHHnrcVhdbc/thzN8OPPb8VtPIK2v32j5iDF5DhS1gBANbPmHl4AVYQAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAAwAgAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAPga4+lGN7/08vAArCECxhmLWjxeQYQXt/grenr/9w4fYdfhWUKb/gnZ7BaPOO2VoZ78fgw9cQVlfw4xzTR9Uhtcw80J9elNXwvAjU5IkSYn7Aa9UTPyEi61bAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAACQCAYAAAD3Cm4hAAABTElEQVR42u3XAaHDIAxAQUBiZdRANdRAZdRiJ6LQjHDPwB85yP5KkSRJkrRa9cs/duzbM8tgzuuuKQBmGnoERjX4WIhm+LHnqgYf+xqa4ceetxWF1tz+2HM3w489vxU08wpa/fb3mIMXkOFLWAEA1k+feXgBVhAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAAADACAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIA+Bjivuxrf+3l4AVYQgGINxawfLyDDClr9Fbw9f/uHD7Hq8K2gTP8FrfYKep13yNCOfXsMPnAFZX0NI841fFAZXsPIC/XpTZ0Jw49MSZIkJe4HthdM/Kv4ZLsAAAAASUVORK5CYII=',
] as const;

interface ImportedGarment {
  id: number;
  name: string;
  default_body_zone: string | null;
}

interface OutfitItemResponse {
  clothing_item_id: number;
  position_x: number;
  position_y: number;
  scale: number;
  rotation: number;
  layer_index: number;
}

interface OutfitResponse {
  id: number;
  name: string;
  preview_url: string | null;
  preview_width: number | null;
  preview_height: number | null;
  items: OutfitItemResponse[];
}

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

async function expectThreeColumnSavedGrid(page: Page) {
  const grid = page.getByRole('list', { name: 'Saved outfits' });
  await expect(grid).toBeVisible();
  const columnCount = await grid.evaluate(
    (element) =>
      window.getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
  );
  expect(columnCount).toBe(3);
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds, 'The touch target must have measurable bounds.').not.toBeNull();
  expect(bounds?.width).toBeGreaterThanOrEqual(56);
  expect(bounds?.height).toBeGreaterThanOrEqual(56);
}

async function expectSilhouetteMatchesLogicalWorkspace(page: Page) {
  const canvas = page.getByRole('img', { name: /Outfit workspace with/u });
  const workspace = canvas.locator('..');
  const silhouette = workspace.locator('img[aria-hidden="true"]');
  const [workspaceBounds, silhouetteBounds] = await Promise.all([
    workspace.boundingBox(),
    silhouette.boundingBox(),
  ]);
  expect(workspaceBounds).not.toBeNull();
  expect(silhouetteBounds).not.toBeNull();
  expect(silhouetteBounds?.width).toBeCloseTo(workspaceBounds?.width ?? 0, 0);
  expect(silhouetteBounds?.height).toBeCloseTo(workspaceBounds?.height ?? 0, 0);
}

function isSuccessfulApiResponse(response: Response, method: string, pathname: string): boolean {
  const request = response.request();
  return (
    request.method() === method && new URL(response.url()).pathname === pathname && response.ok()
  );
}

async function importGarment(
  page: Page,
  { name, category, image }: { name: string; category: string; image: string },
): Promise<ImportedGarment> {
  const navigation = await page.goto('/wardrobe/add/device');
  expect(navigation?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Add Garment' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('img', { name: 'Selected garment preview' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByLabel('Category').selectOption(category);

  const responsePromise = page.waitForResponse((response) =>
    isSuccessfulApiResponse(response, 'POST', '/api/v1/clothing-items/import'),
  );
  await page.getByRole('button', { name: 'Import garment' }).click();
  const response = await responsePromise;
  const garment = (await response.json()) as ImportedGarment;

  await expect(page).toHaveURL(new RegExp(`/wardrobe\\?.*item=${garment.id}(?:&|$)`, 'u'), {
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  return garment;
}

async function expectSavedPreview(page: Page, name: string, expectedUrl: string): Promise<void> {
  const preview = page.getByRole('img', { name: `${name} outfit preview` });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', expectedUrl);
  await expect
    .poll(() =>
      preview.evaluate((element) => {
        const image = element as HTMLImageElement;
        return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
      }),
    )
    .toEqual({ complete: true, width: 600, height: 750 });
}

test('the production P5 outfit workflow persists previews, updates, copies, and deletion', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    'This contract requires PLAYWRIGHT_BASE_URL to target a running FastAPI production host.',
  );
  test.setTimeout(120_000);

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
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const suffix = `${Date.now().toString(36)}-${testInfo.retry}`;
  const topName = `P5 Linen Top ${suffix}`;
  const outerwearName = `P5 Soft Jacket ${suffix}`;
  const pantsName = `P5 Tailored Pants ${suffix}`;
  const firstOutfitName = `P5 Layered Look ${suffix}`;
  const updatedOutfitName = `P5 Updated Look ${suffix}`;
  const copiedOutfitName = `P5 Copied Look ${suffix}`;

  const { top, pants } =
    await test.step('import three local garments including two upper-body candidates', async () => {
      const top = await importGarment(page, {
        name: topName,
        category: 'top',
        image: garmentImages[0],
      });
      const outerwear = await importGarment(page, {
        name: outerwearName,
        category: 'outerwear',
        image: garmentImages[1],
      });
      const pants = await importGarment(page, {
        name: pantsName,
        category: 'pants',
        image: garmentImages[2],
      });

      expect(top.default_body_zone).toBe('upper_body');
      expect(outerwear.default_body_zone).toBe('upper_body');
      expect(pants.default_body_zone).toBe('lower_body');
      return { top, pants };
    });

  const created = await test.step('build, transform, layer, and save one outfit', async () => {
    await page.goto('/outfit-builder');
    await expect(page.getByRole('heading', { level: 1, name: 'Outfit Builder' })).toBeVisible();

    await page.getByRole('button', { name: 'Top', exact: true }).click();
    let picker = page.getByRole('dialog', { name: 'Choose Top' });
    await expect(picker.getByRole('button', { name: `Add ${topName}` })).toBeVisible();
    await expect(picker.getByRole('button', { name: `Add ${outerwearName}` })).toBeVisible();
    await picker.getByRole('button', { name: `Add ${topName}` }).click();

    await page.getByRole('button', { name: 'Top', exact: true }).click();
    picker = page.getByRole('dialog', { name: 'Choose Top' });
    await picker.getByRole('button', { name: `Add ${outerwearName}` }).click();

    await page.getByRole('button', { name: 'Pants', exact: true }).click();
    picker = page.getByRole('dialog', { name: 'Choose Pants' });
    await picker.getByRole('button', { name: `Add ${pantsName}` }).click();

    await expect(
      page.getByRole('img', { name: /Outfit workspace with 3 garments/u }),
    ).toBeVisible();
    await expectSilhouetteMatchesLogicalWorkspace(page);
    await expectTouchTarget(page.getByRole('button', { name: 'Top', exact: true }));
    await expectTouchTarget(page.getByRole('button', { name: 'Move garment right' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Increase garment size' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Rotate garment right' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Move garment forward' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Save Outfit', exact: true }));
    await page.getByRole('button', { name: 'Move garment right' }).click();
    await page.getByRole('button', { name: 'Move garment down' }).click();
    await page.getByRole('button', { name: 'Increase garment size' }).click();
    await page.getByRole('button', { name: 'Rotate garment right' }).click();
    await page.getByRole('button', { name: 'Move garment forward' }).click();

    await page.getByRole('button', { name: 'Save Outfit', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save Outfit' });
    await saveDialog.getByRole('textbox', { name: 'Outfit name' }).fill(firstOutfitName);
    const createPromise = page.waitForResponse((response) =>
      isSuccessfulApiResponse(response, 'POST', '/api/v1/outfits'),
    );
    await saveDialog.getByRole('button', { name: 'Save Outfit', exact: true }).click();
    const created = (await (await createPromise).json()) as OutfitResponse;

    expect(created.name).toBe(firstOutfitName);
    expect(created.preview_url).not.toBeNull();
    expect(created.preview_width).toBe(600);
    expect(created.preview_height).toBe(750);
    expect(created.items).toHaveLength(3);
    const persistedPants = created.items.find((item) => item.clothing_item_id === pants.id);
    expect(persistedPants).toMatchObject({
      position_x: 0.525,
      position_y: 0.665,
      scale: 1.1,
      rotation: 5,
      layer_index: 1,
    });
    expect(created.items.find((item) => item.clothing_item_id === top.id)?.layer_index).toBe(0);
    await expect(page).toHaveURL(new RegExp(`outfitId=${created.id}(?:&|$)`, 'u'));
    await expectNoHorizontalOverflow(page);
    return created;
  });

  if (created.preview_url === null) {
    throw new Error('The saved outfit did not expose its generated preview.');
  }
  const initialPreviewUrl = created.preview_url;

  await test.step('verify the three-column Saved Outfits grid and reload its preview', async () => {
    await page.goto('/saved-outfits');
    await expect(page.getByRole('heading', { level: 1, name: 'Saved Outfits' })).toBeVisible();
    await expectThreeColumnSavedGrid(page);
    await expectSavedPreview(page, firstOutfitName, initialPreviewUrl);
    await expectTouchTarget(
      page.getByRole('link', { name: `Open ${firstOutfitName} in Outfit Builder` }),
    );
    await expectNoHorizontalOverflow(page);

    await page.reload();
    await expectThreeColumnSavedGrid(page);
    await expectSavedPreview(page, firstOutfitName, initialPreviewUrl);
    await expectNoHorizontalOverflow(page);
  });

  const updated =
    await test.step('reopen persisted state, update it, and receive a new preview', async () => {
      await page.getByRole('link', { name: `Open ${firstOutfitName} in Outfit Builder` }).click();
      await expect(page).toHaveURL(new RegExp(`outfitId=${created.id}(?:&|$)`, 'u'));
      await expect(
        page.getByRole('img', { name: /Outfit workspace with 3 garments/u }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Saved', exact: true }).click();
      const itemsDialog = page.getByRole('dialog', { name: 'Outfit items' });
      await expect(itemsDialog).toContainText(topName);
      await expect(itemsDialog).toContainText(outerwearName);
      await expect(itemsDialog).toContainText(pantsName);
      await itemsDialog.getByRole('button', { name: 'Close' }).click();

      await page.getByRole('button', { name: 'Move garment left' }).click();
      await page.getByRole('button', { name: 'Save Outfit', exact: true }).click();
      const updateDialog = page.getByRole('dialog', { name: 'Save changes' });
      await updateDialog.getByRole('textbox', { name: 'Outfit name' }).fill(updatedOutfitName);
      const updatePromise = page.waitForResponse((response) =>
        isSuccessfulApiResponse(response, 'PATCH', `/api/v1/outfits/${created.id}`),
      );
      await updateDialog.getByRole('button', { name: 'Update Outfit' }).click();
      const updated = (await (await updatePromise).json()) as OutfitResponse;

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(updatedOutfitName);
      expect(updated.preview_url).not.toBe(initialPreviewUrl);
      await expect(page.getByRole('status')).toContainText(`${updatedOutfitName} was updated.`);
      return updated;
    });

  const copied = await test.step('save the modified look as a new outfit', async () => {
    await page.getByRole('button', { name: 'Rotate garment left' }).click();
    await page.getByRole('button', { name: 'Save Outfit', exact: true }).click();
    const copyDialog = page.getByRole('dialog', { name: 'Save changes' });
    await copyDialog.getByRole('textbox', { name: 'Outfit name' }).fill(copiedOutfitName);
    const copyPromise = page.waitForResponse((response) =>
      isSuccessfulApiResponse(response, 'POST', '/api/v1/outfits'),
    );
    await copyDialog.getByRole('button', { name: 'Save as New Outfit' }).click();
    const copied = (await (await copyPromise).json()) as OutfitResponse;

    expect(copied.id).not.toBe(updated.id);
    expect(copied.name).toBe(copiedOutfitName);
    expect(copied.preview_url).not.toBeNull();
    await expect(page).toHaveURL(new RegExp(`outfitId=${copied.id}(?:&|$)`, 'u'));
    return copied;
  });

  await test.step('delete one saved outfit without deleting any garments', async () => {
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Outfit items' })
      .getByRole('button', { name: 'Delete saved outfit' })
      .click();
    const confirmation = page.getByRole('dialog', { name: `Delete ${copiedOutfitName}?` });
    await expect(confirmation).toContainText(
      'Every garment and clothing image will remain in Wardrobe.',
    );
    const deletePromise = page.waitForResponse((response) =>
      isSuccessfulApiResponse(response, 'DELETE', `/api/v1/outfits/${copied.id}`),
    );
    await confirmation.getByRole('button', { name: 'Delete outfit' }).click();
    await deletePromise;

    await expect(page).toHaveURL(/\/saved-outfits$/u);
    await expect(
      page.getByRole('link', { name: `Open ${copiedOutfitName} in Outfit Builder` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: `Open ${updatedOutfitName} in Outfit Builder` }),
    ).toBeVisible();
    await expectThreeColumnSavedGrid(page);
    await expectNoHorizontalOverflow(page);

    await page.goto('/wardrobe');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Grid View' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'All garments' })).toBeVisible();
    await expect(page.getByRole('img', { name: topName })).toBeVisible();
    await expect(page.getByRole('img', { name: outerwearName })).toBeVisible();
    await expect(page.getByRole('img', { name: pantsName })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(externalRequests).toEqual([]);
  expect(mediaRequestPaths.some((path) => path.includes('/outfits/previews/'))).toBe(true);
  expect(mediaRequestPaths.some((path) => path.includes('/garments/original/'))).toBe(false);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
