import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMuseQueryClient } from '../../app/queryClient';
import { jsonResponse } from '../../test/clothingFixtures';
import { rawOutfitDetail, rawOutfitSummary } from '../../test/outfitFixtures';
import type { OutfitCreatePayload, OutfitPage } from './model';
import { outfitKeys, useCreateOutfit, useDeleteOutfit, useUpdateOutfit } from './queries';

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

function createHarness() {
  const queryClient = createMuseQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outfit query mutations', () => {
  it('seeds detail state and prepends a newly created outfit before invalidation', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = outfitKeys.list();
    const existingPage: OutfitPage = {
      items: [
        {
          id: 21,
          name: 'Older Look',
          itemCount: 1,
          previewUrl: null,
          previewWidth: null,
          previewHeight: null,
          createdAt: '2026-07-14T12:00:00Z',
          updatedAt: '2026-07-14T12:00:00Z',
        },
      ],
      total: 1,
      limit: 24,
      offset: 0,
    };
    queryClient.setQueryData(listKey, existingPage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(rawOutfitDetail)));
    const mutation = renderHook(() => useCreateOutfit(), { wrapper });

    await act(async () => mutation.result.current.mutateAsync(payload));

    expect(queryClient.getQueryData(outfitKeys.detail(20))).toMatchObject({ name: 'Summer Look' });
    expect(queryClient.getQueryData<OutfitPage>(listKey)).toMatchObject({
      total: 2,
      items: [{ id: 20 }, { id: 21 }],
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it('moves an updated outfit to the newest position and refreshes its detail cache', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = outfitKeys.list();
    queryClient.setQueryData<OutfitPage>(listKey, {
      items: [
        {
          id: 21,
          name: 'Other Look',
          itemCount: 1,
          previewUrl: null,
          previewWidth: null,
          previewHeight: null,
          createdAt: '2026-07-14T12:00:00Z',
          updatedAt: '2026-07-14T12:00:00Z',
        },
        {
          id: 20,
          name: rawOutfitSummary.name,
          itemCount: 1,
          previewUrl: rawOutfitSummary.preview_url,
          previewWidth: 600,
          previewHeight: 750,
          createdAt: rawOutfitSummary.created_at,
          updatedAt: rawOutfitSummary.updated_at,
        },
      ],
      total: 2,
      limit: 24,
      offset: 0,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...rawOutfitDetail,
          name: 'Updated Look',
          updated_at: '2026-07-16T12:00:00Z',
        }),
      ),
    );
    const mutation = renderHook(() => useUpdateOutfit(), { wrapper });

    await act(async () =>
      mutation.result.current.mutateAsync({ outfitId: 20, payload: { name: 'Updated Look' } }),
    );

    expect(queryClient.getQueryData<OutfitPage>(listKey)?.items).toMatchObject([
      { id: 20, name: 'Updated Look' },
      { id: 21 },
    ]);
    expect(queryClient.getQueryData(outfitKeys.detail(20))).toMatchObject({
      name: 'Updated Look',
    });
  });

  it('cancels active detail work and removes a deleted outfit from every cached list', async () => {
    const { queryClient, wrapper } = createHarness();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const listKey = outfitKeys.list();
    queryClient.setQueryData(listKey, {
      items: [
        {
          id: 20,
          name: 'Summer Look',
          itemCount: 1,
          previewUrl: null,
          previewWidth: null,
          previewHeight: null,
          createdAt: '2026-07-15T12:00:00Z',
          updatedAt: '2026-07-15T12:00:00Z',
        },
      ],
      total: 1,
      limit: 24,
      offset: 0,
    } satisfies OutfitPage);
    queryClient.setQueryData(outfitKeys.detail(20), { stale: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const mutation = renderHook(() => useDeleteOutfit(), { wrapper });

    await act(async () => mutation.result.current.mutateAsync({ outfitId: 20 }));

    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: outfitKeys.detail(20),
      exact: true,
    });
    expect(queryClient.getQueryData(outfitKeys.detail(20))).toEqual({ stale: true });
    expect(queryClient.getQueryData<OutfitPage>(listKey)).toMatchObject({ items: [], total: 0 });
  });
});
