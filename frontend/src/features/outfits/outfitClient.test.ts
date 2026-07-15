import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/clothingFixtures';
import { rawOutfitDetail, rawOutfitPage } from '../../test/outfitFixtures';
import { createOutfit, deleteOutfit, getOutfit, listOutfits, updateOutfit } from './outfitClient';
import type { OutfitCreatePayload } from './model';

const payload: OutfitCreatePayload = {
  name: 'Summer Look',
  items: [
    {
      clothing_item_id: 1,
      body_zone: 'upper_body',
      position_x: 0.5,
      position_y: 0.37,
      scale: 1,
      rotation: 0,
      layer_index: 0,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outfit API client', () => {
  it('lists through the same-origin API and forwards query cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rawOutfitPage));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(listOutfits({ limit: 24, offset: 0 }, controller.signal)).resolves.toMatchObject({
      total: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/outfits?limit=24&offset=0',
      expect.objectContaining({ signal: controller.signal, credentials: 'same-origin' }),
    );
  });

  it('performs create, read, and update with typed JSON bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(rawOutfitDetail)));
    vi.stubGlobal('fetch', fetchMock);

    await createOutfit(payload);
    await getOutfit(20);
    await updateOutfit(20, { name: 'Updated Look', items: payload.items });

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/v1/outfits',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/outfits/20');
    expect(fetchMock.mock.calls[2]).toEqual([
      '/api/v1/outfits/20',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Look', items: payload.items }),
      }),
    ]);
  });

  it('soft-deletes through DELETE and rejects invalid local identifiers before fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteOutfit(20)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/outfits/20',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(() => getOutfit(0)).toThrow(/positive integer/u);
    expect(() => listOutfits({ limit: 101 })).toThrow(/between 1 and 100/u);
  });
});
