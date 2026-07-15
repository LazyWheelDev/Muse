import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  jsonResponse,
  rawClothingDetail,
  rawClothingPage,
  rawClothingSummary,
  rawImage,
  rawThumbnail,
} from '../test/clothingFixtures';
import { renderApp } from '../test/renderApp';

const secondSummary = {
  ...rawClothingSummary,
  id: 2,
  name: 'Wool Coat',
  garment_category: 'outerwear',
  primary_image: {
    ...rawImage,
    id: 20,
    image_group_id: 'group-2',
    content_url: '/api/v1/media/normalized/group-2.webp',
  },
  display_image: {
    ...rawImage,
    id: 20,
    image_group_id: 'group-2',
    content_url: '/api/v1/media/normalized/group-2.webp',
  },
  thumbnail_image: {
    ...rawThumbnail,
    id: 21,
    image_group_id: 'group-2',
    content_url: '/api/v1/media/thumbnails/group-2.webp',
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

describe('WardrobePage', () => {
  it('navigates garments, opens the grid, and preserves Details return context', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/clothing-items/1')) {
        return Promise.resolve(jsonResponse(rawClothingDetail));
      }
      return Promise.resolve(
        jsonResponse({ ...rawClothingPage, items: [rawClothingSummary, secondSummary], total: 2 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp('/wardrobe?item=1');

    expect(await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next garment' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Wool Coat' })).toBeVisible();
    expect(router.state.location.search).toContain('item=2');

    await user.click(screen.getByRole('button', { name: 'Grid View' }));
    expect(screen.getByRole('heading', { level: 2, name: 'All garments' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Linen Shirt' })).toHaveAttribute('loading', 'lazy');
    await user.click(screen.getByRole('button', { name: /Linen Shirt/u }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Info' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Wardrobe' })).toHaveAttribute(
      'href',
      '/wardrobe?item=1',
    );
  });

  it('requests the real category enum while presenting the approved Shirt label', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe');
    await screen.findByText('Your wardrobe is empty.');
    await user.click(screen.getByRole('button', { name: 'Shirt' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('garment_category=top'),
        expect.anything(),
      ),
    );
  });

  it('shows a recoverable backend-unavailable state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const user = userEvent.setup();
    renderApp('/wardrobe');
    expect(
      await screen.findByRole('heading', { name: 'Muse could not load your wardrobe.' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to Home' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
  });

  it('soft-deletes only after confirmation and returns to the empty state', async () => {
    let deleted = false;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        jsonResponse(deleted ? { items: [], total: 0, limit: 100, offset: 0 } : rawClothingPage),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe?item=1');
    await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Saved outfits may still retain a reference/u)).toBeVisible();
    expect(deleted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Delete garment' }));
    expect(await screen.findByText('Your wardrobe is empty.')).toBeVisible();
    expect(deleted).toBe(true);
  });
});
