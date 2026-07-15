import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, rawClothingDetail, rawClothingPage } from '../test/clothingFixtures';
import { renderApp } from '../test/renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON string request body.');
  }
  return init.body;
}

function detailFetchMock() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const payload = JSON.parse(requestBody(init)) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({
          ...rawClothingDetail,
          name: payload.name ?? rawClothingDetail.name,
          purchase_price: payload.purchase_price ?? rawClothingDetail.purchase_price,
          purchase_currency: payload.purchase_currency ?? rawClothingDetail.purchase_currency,
          updated_at: '2026-07-15T13:00:00Z',
        }),
      );
    }
    if (requestUrl(input).includes('/clothing-items/1')) {
      return Promise.resolve(jsonResponse(rawClothingDetail));
    }
    return Promise.resolve(jsonResponse(rawClothingPage));
  });
}

describe('ClothingDetailsPage', () => {
  it('renders read-only metadata and supports edit, cancel, and save', async () => {
    const fetchMock = detailFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe/1?returnTo=%2Fwardrobe%3Fcategory%3Dtop%26item%3D1');

    expect(await screen.findByText('100% Linen')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Detected automatically')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Summer Linen Shirt');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Linen Shirt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Summer Linen Shirt');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Summer Linen Shirt')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect(JSON.parse(requestBody(patchCall?.[1]))).toEqual({ name: 'Summer Linen Shirt' });
  });

  it('propagates a validated Builder draft marker through the Details handoff', async () => {
    vi.stubGlobal('fetch', detailFetchMock());
    renderApp('/wardrobe/1?returnTo=%2Fwardrobe%3Fitem%3D1%26preserveDraft%3D1');

    expect(await screen.findByText('100% Linen')).toBeVisible();
    const builderLink = screen.getByRole('link', { name: 'Go to Outfit Builder' });
    const target = new URL(builderLink.getAttribute('href') ?? '', 'http://muse.test');
    expect(target.searchParams.get('garment')).toBe('1');
    expect(target.searchParams.get('preserveDraft')).toBe('1');
    expect(target.searchParams.get('returnTo')).toBe('/wardrobe?item=1&preserveDraft=1');
  });

  it('shows and focuses a currency validation error', async () => {
    vi.stubGlobal('fetch', detailFetchMock());
    const user = userEvent.setup();
    renderApp('/wardrobe/1');
    await screen.findByText('100% Linen');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const currency = screen.getByRole('textbox', { name: 'Purchase currency' });
    await user.clear(currency);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use a three-letter currency code.')).toBeVisible();
    await waitFor(() => expect(currency).toHaveFocus());
  });

  it('protects unsaved changes and restores the exact Wardrobe context on discard', async () => {
    vi.stubGlobal('fetch', detailFetchMock());
    const user = userEvent.setup();
    const { router } = renderApp(
      '/wardrobe/1?returnTo=%2Fwardrobe%3Fcategory%3Dtop%26item%3D1%26view%3Dgrid',
    );
    await screen.findByText('100% Linen');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Brand' }), ' Atelier');
    await user.click(screen.getByRole('link', { name: 'Back to Wardrobe' }));

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/wardrobe'));
    expect(router.state.location.search).toBe('?category=top&item=1&view=grid');
  });

  it.each([
    [404, 'Garment not found'],
    [503, 'Muse could not load this garment.'],
  ] as const)('shows a recoverable API state for %s', async (status, heading) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: status === 404 ? 'clothing_item_not_found' : 'service_unavailable',
              message: 'Safe local message.',
              request_id: 'request-1',
            },
          },
          status,
        ),
      ),
    );
    renderApp('/wardrobe/99');
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('soft-deletes only after explicit confirmation', async () => {
    let deleted = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (requestUrl(input).includes('/clothing-items/1')) {
        return Promise.resolve(jsonResponse(rawClothingDetail));
      }
      return Promise.resolve(jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe/1');
    await screen.findByText('100% Linen');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Delete garment' }));
    await waitFor(() => expect(deleted).toBe(true));
  });
});
