/// <reference types="node" />

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/clothingFixtures';
import { rawOutfitDetail, rawOutfitSummary } from '../test/outfitFixtures';
import { renderApp } from '../test/renderApp';

const rawOfficeOutfit = {
  ...rawOutfitSummary,
  id: 21,
  name: 'Office Layers',
  item_count: 2,
  preview_url: null,
  preview_width: null,
  preview_height: null,
} as const;

const rawWeekendOutfit = {
  ...rawOutfitSummary,
  id: 22,
  name: 'Weekend Edit',
  item_count: 3,
  preview_url: '/api/v1/media/outfits/previews/outfit-22.webp',
} as const;

const threeOutfits = [rawOutfitSummary, rawOfficeOutfit, rawWeekendOutfit] as const;
const savedOutfitsCss = readFileSync(
  resolve(process.cwd(), 'src/pages/SavedOutfitsPage.module.css'),
  'utf8',
);

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function savedOutfitsFetchMock(
  options: { failListTimes?: number; outfits?: readonly unknown[] } = {},
) {
  let listAttempts = 0;
  const outfits = options.outfits ?? threeOutfits;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(input), 'http://muse.test');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/v1/outfits' && method === 'GET') {
      listAttempts += 1;
      if (listAttempts <= (options.failListTimes ?? 0)) {
        return Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'local_service_error',
                message: 'The local outfit service is unavailable.',
              },
            },
            503,
          ),
        );
      }
      const limit = Number(url.searchParams.get('limit'));
      return Promise.resolve(
        jsonResponse({
          items: limit === 100 ? outfits : [],
          total: outfits.length,
          limit,
          offset: Number(url.searchParams.get('offset')),
        }),
      );
    }
    if (/^\/api\/v1\/outfits\/\d+$/u.test(url.pathname) && method === 'GET') {
      const outfitId = Number(url.pathname.split('/').at(-1));
      const summary = threeOutfits.find((candidate) => candidate.id === outfitId);
      return Promise.resolve(
        jsonResponse({
          ...rawOutfitDetail,
          id: outfitId,
          name: summary?.name ?? rawOutfitDetail.name,
          preview_url: summary?.preview_url ?? rawOutfitDetail.preview_url,
          preview_width: summary?.preview_url === null ? null : (summary?.preview_width ?? 600),
          preview_height: summary?.preview_url === null ? null : (summary?.preview_height ?? 750),
        }),
      );
    }
    if (url.pathname === '/api/v1/clothing-items') {
      return Promise.resolve(jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }));
    }
    throw new Error(`Unexpected Muse API request: ${method} ${url.pathname}${url.search}`);
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('SavedOutfitsPage', () => {
  it('renders saved data as the approved three-column card grid with accessible garment counts', async () => {
    vi.stubGlobal('fetch', savedOutfitsFetchMock());
    renderApp('/saved-outfits');

    const grid = await screen.findByRole('list', { name: 'Saved outfits' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(3);
    expect(grid.className).toContain('outfitGrid');
    expect(savedOutfitsCss).toMatch(
      /\.outfitGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/su,
    );
    expect(
      screen.getByRole('link', {
        name: 'Open Summer Look in Outfit Builder, 1 garment',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: 'Open Office Layers in Outfit Builder, 2 garments',
      }),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: 'Summer Look outfit preview' })).toHaveAttribute(
      'loading',
      'eager',
    );
  });

  it('opens a card in Outfit Builder with its Saved Outfits return context', async () => {
    vi.stubGlobal('fetch', savedOutfitsFetchMock());
    const user = userEvent.setup();
    const { router } = renderApp('/saved-outfits');

    await user.click(
      await screen.findByRole('link', {
        name: /Open Summer Look in Outfit Builder/u,
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/outfit-builder'));
    expect(router.state.location.search).toBe('?outfitId=20&returnTo=%2Fsaved-outfits');
  });

  it('uses a local fallback for missing previews and for preview images that fail to load', async () => {
    vi.stubGlobal('fetch', savedOutfitsFetchMock());
    renderApp('/saved-outfits');

    expect(await screen.findByLabelText('Office Layers preview unavailable')).toBeVisible();
    fireEvent.error(screen.getByRole('img', { name: 'Summer Look outfit preview' }));
    expect(screen.getByLabelText('Summer Look preview unavailable')).toBeVisible();
    expect(screen.getAllByText('Preview unavailable')).toHaveLength(2);
  });

  it('renders an empty state that links directly to Outfit Builder', async () => {
    vi.stubGlobal('fetch', savedOutfitsFetchMock({ outfits: [] }));
    const user = userEvent.setup();
    const { router } = renderApp('/saved-outfits');

    expect(await screen.findByRole('heading', { name: 'No saved outfits yet.' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Open Outfit Builder' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/outfit-builder'));
  });

  it('shows a recoverable local-service error and retries without losing navigation', async () => {
    vi.stubGlobal('fetch', savedOutfitsFetchMock({ failListTimes: 1 }));
    const user = userEvent.setup();
    renderApp('/saved-outfits');

    expect(
      await screen.findByRole('heading', { name: 'Muse could not load your saved outfits.' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to Home' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Saved outfits' })).toBeVisible();
  });
});
