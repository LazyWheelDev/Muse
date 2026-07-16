import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  jsonResponse,
  rawClothingDetail,
  rawClothingSummary,
  rawImage,
  rawThumbnail,
} from '../test/clothingFixtures';
import { rawOutfitClothingReference, rawOutfitDetail, rawOutfitItem } from '../test/outfitFixtures';
import { renderApp } from '../test/renderApp';
import { decodeClothingPage } from '../features/clothing/decoders';
import { clothingKeys } from '../features/clothing/queries';

const rawCutout = {
  ...rawImage,
  id: 14,
  image_kind: 'cutout',
  is_primary: false,
  content_url: '/api/v1/media/garments/cutouts/group-1.webp',
} as const;

const rawPendingClothingSummary = {
  ...rawClothingSummary,
  image_processing_state: 'processing',
} as const;

const rawCompletedCutoutSummary = {
  ...rawClothingSummary,
  image_processing_state: 'completed',
  primary_image: rawCutout,
  display_image: rawCutout,
} as const;

const rawJacketImage = {
  ...rawImage,
  id: 20,
  image_group_id: 'group-2',
  content_url: '/api/v1/media/normalized/group-2.webp',
} as const;

const rawJacketThumbnail = {
  ...rawThumbnail,
  id: 21,
  image_group_id: 'group-2',
  content_url: '/api/v1/media/thumbnails/group-2.webp',
} as const;

const rawJacketSummary = {
  ...rawClothingSummary,
  id: 2,
  name: 'Linen Jacket',
  garment_category: 'outerwear',
  primary_image: rawJacketImage,
  display_image: rawJacketImage,
  thumbnail_image: rawJacketThumbnail,
} as const;

const rawJacketReference = {
  ...rawOutfitClothingReference,
  id: 2,
  name: 'Linen Jacket',
  garment_category: 'outerwear',
  primary_image: rawJacketImage,
  display_image: rawJacketImage,
  thumbnail_image: rawJacketThumbnail,
  image_candidates: [rawJacketImage],
} as const;

const rawPantsImage = {
  ...rawImage,
  id: 30,
  image_group_id: 'group-3',
  content_url: '/api/v1/media/normalized/group-3.webp',
} as const;

const rawPantsThumbnail = {
  ...rawThumbnail,
  id: 31,
  image_group_id: 'group-3',
  content_url: '/api/v1/media/thumbnails/group-3.webp',
} as const;

const rawPantsSummary = {
  ...rawClothingSummary,
  id: 3,
  name: 'Linen Trousers',
  garment_category: 'pants',
  default_body_zone: 'lower_body',
  primary_image: rawPantsImage,
  display_image: rawPantsImage,
  thumbnail_image: rawPantsThumbnail,
} as const;

const rawPantsReference = {
  ...rawOutfitClothingReference,
  id: 3,
  name: 'Linen Trousers',
  garment_category: 'pants',
  default_body_zone: 'lower_body',
  primary_image: rawPantsImage,
  display_image: rawPantsImage,
  thumbnail_image: rawPantsThumbnail,
  image_candidates: [rawPantsImage],
} as const;

const rawDeletedImage = {
  ...rawImage,
  id: 40,
  image_group_id: 'group-4',
  content_url: '/api/v1/media/normalized/group-4.webp',
} as const;

const rawDeletedReference = {
  ...rawOutfitClothingReference,
  id: 4,
  name: 'Archived Silk Top',
  deleted_at: '2026-07-15T13:00:00Z',
  primary_image: rawDeletedImage,
  display_image: rawDeletedImage,
  thumbnail_image: null,
  image_candidates: [rawDeletedImage],
} as const;

const rawOutfitWithDeletedGarment = {
  ...rawOutfitDetail,
  item_count: 2,
  items: [
    {
      ...rawOutfitItem,
      id: 102,
      clothing_item_id: 4,
      clothing_item_status: 'deleted',
      clothing_item: rawDeletedReference,
      layer_index: 0,
    },
    { ...rawOutfitItem, layer_index: 1 },
  ],
} as const;

const rawSavedJacketOutfit = {
  ...rawOutfitDetail,
  name: 'Jacket Look',
  items: [
    {
      ...rawOutfitItem,
      clothing_item_id: 2,
      clothing_item: rawJacketReference,
    },
  ],
} as const;

const rawIncomingOutfit = {
  ...rawOutfitDetail,
  id: 21,
  name: 'Office Look',
} as const;

interface OutfitWriteItem {
  clothing_item_id: number;
  body_zone: string;
  position_x: number;
  position_y: number;
  scale: number;
  rotation: number;
  layer_index: number;
}

interface OutfitWritePayload {
  name: string;
  items: OutfitWriteItem[];
}

interface PersistedBuilderPlacement {
  clothing_item_id: number;
  position_x: number;
  position_y: number;
  scale: number;
  rotation: number;
  layer_index: number;
  clothing_item: {
    image_candidates: Array<{ image_kind: string; content_url: string }>;
  };
}

interface PersistedBuilderState {
  mode: string;
  active_clothing_item_id: number | null;
  placements: PersistedBuilderPlacement[];
}

function persistedBuilderState(): PersistedBuilderState {
  const serialized = window.sessionStorage.getItem('muse.outfit-builder.v1');
  if (serialized === null) {
    throw new Error('Expected Outfit Builder state to be persisted.');
  }
  return (JSON.parse(serialized) as { state: PersistedBuilderState }).state;
}

function placementState(placement: PersistedBuilderPlacement) {
  return {
    clothing_item_id: placement.clothing_item_id,
    position_x: placement.position_x,
    position_y: placement.position_y,
    scale: placement.scale,
    rotation: placement.rotation,
    layer_index: placement.layer_index,
  };
}

interface FetchBehavior {
  clothingItems?: readonly unknown[];
  clothingListError?: boolean;
  clothingDetail?: unknown;
  outfitDetail?: unknown;
  outfitDetails?: Readonly<Record<number, unknown>>;
  outfitTotal?: number;
  createError?: boolean;
  createId?: number;
  updateError?: boolean;
  deleteError?: boolean;
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function requestPayload(init: RequestInit | undefined): OutfitWritePayload {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }
  return JSON.parse(init.body) as OutfitWritePayload;
}

function referenceFor(clothingItemId: number) {
  if (clothingItemId === 2) {
    return rawJacketReference;
  }
  if (clothingItemId === 3) {
    return rawPantsReference;
  }
  if (clothingItemId === 4) {
    return rawDeletedReference;
  }
  return rawOutfitClothingReference;
}

function detailFromPayload(outfitId: number, payload: OutfitWritePayload) {
  return {
    id: outfitId,
    name: payload.name,
    item_count: payload.items.length,
    preview_url: null,
    preview_width: null,
    preview_height: null,
    created_at: '2026-07-15T12:00:00Z',
    updated_at: '2026-07-15T13:00:00Z',
    deleted_at: null,
    items: payload.items.map((item, index) => ({
      ...rawOutfitItem,
      id: 1_000 + index,
      clothing_item_id: item.clothing_item_id,
      clothing_item: referenceFor(item.clothing_item_id),
      body_zone: item.body_zone,
      position_x: item.position_x,
      position_y: item.position_y,
      scale: item.scale,
      rotation: item.rotation,
      layer_index: item.layer_index,
      updated_at: '2026-07-15T13:00:00Z',
    })),
  };
}

function errorResponse(message: string): Response {
  return jsonResponse(
    { error: { code: 'local_service_error', message, request_id: 'request-outfit-test' } },
    503,
  );
}

function outfitFetchMock(behavior: FetchBehavior = {}) {
  const clothingItems = behavior.clothingItems ?? [rawClothingSummary];
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(input), 'http://muse.test');
    const method = init?.method ?? 'GET';

    if (url.pathname === '/api/v1/clothing-items') {
      if (behavior.clothingListError === true) {
        return Promise.resolve(errorResponse('The local wardrobe is temporarily unavailable.'));
      }
      return Promise.resolve(
        jsonResponse({
          items: clothingItems,
          total: clothingItems.length,
          limit: 100,
          offset: 0,
        }),
      );
    }
    if (/^\/api\/v1\/clothing-items\/\d+$/u.test(url.pathname)) {
      return Promise.resolve(jsonResponse(behavior.clothingDetail ?? rawClothingDetail));
    }
    if (url.pathname === '/api/v1/outfits' && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          items: [],
          total: behavior.outfitTotal ?? 0,
          limit: Number(url.searchParams.get('limit')),
          offset: Number(url.searchParams.get('offset')),
        }),
      );
    }
    if (url.pathname === '/api/v1/outfits' && method === 'POST') {
      if (behavior.createError === true) {
        return Promise.resolve(errorResponse('The outfit could not be written to local storage.'));
      }
      const payload = requestPayload(init);
      return Promise.resolve(
        jsonResponse(detailFromPayload(behavior.createId ?? 31, payload), 201),
      );
    }
    if (/^\/api\/v1\/outfits\/\d+$/u.test(url.pathname) && method === 'GET') {
      const outfitId = Number(url.pathname.split('/').at(-1));
      return Promise.resolve(
        jsonResponse(
          behavior.outfitDetails?.[outfitId] ?? behavior.outfitDetail ?? rawOutfitDetail,
        ),
      );
    }
    if (/^\/api\/v1\/outfits\/\d+$/u.test(url.pathname) && method === 'PATCH') {
      if (behavior.updateError === true) {
        return Promise.resolve(errorResponse('The saved outfit could not be updated.'));
      }
      return Promise.resolve(jsonResponse(detailFromPayload(20, requestPayload(init))));
    }
    if (/^\/api\/v1\/outfits\/\d+$/u.test(url.pathname) && method === 'DELETE') {
      return Promise.resolve(
        behavior.deleteError === true
          ? errorResponse('The saved outfit could not be deleted.')
          : new Response(null, { status: 204 }),
      );
    }
    throw new Error(`Unexpected Muse API request: ${method} ${url.pathname}${url.search}`);
  });
}

function writeCall(fetchMock: ReturnType<typeof outfitFetchMock>, method: 'POST' | 'PATCH') {
  return fetchMock.mock.calls.find(([, init]) => init?.method === method);
}

async function addGarment(user: ReturnType<typeof userEvent.setup>, name = 'Linen Shirt') {
  await user.click(screen.getByRole('button', { name: 'Top' }));
  await user.click(await screen.findByRole('button', { name: `Add ${name}` }));
}

async function addPants(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Pants' }));
  await user.click(await screen.findByRole('button', { name: 'Add Linen Trousers' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('OutfitBuilderPage', () => {
  it('renders a usable empty builder and explains that an outfit needs a garment before save', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ clothingItems: [] }));
    const user = userEvent.setup();
    renderApp('/outfit-builder');

    expect(screen.getByRole('heading', { level: 1, name: 'Outfit Builder' })).toBeVisible();
    expect(screen.getByRole('img', { name: /Outfit workspace with 0 garments/u })).toBeVisible();
    expect(screen.getByText('Choose a category to add your first garment.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move garment up' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Add at least one garment before saving an outfit.',
    );
    await user.click(screen.getByRole('button', { name: 'Top' }));
    expect(await screen.findByText('No compatible garments are available yet.')).toBeVisible();
  });

  it('keeps an existing draft intact when the wardrobe list request fails', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ clothingListError: true }));
    const user = userEvent.setup();
    renderApp('/outfit-builder?garment=1');

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Top' }));
    expect(
      await screen.findByRole('heading', { name: 'Muse could not load your wardrobe.' }),
    ).toBeVisible();
    expect(screen.getByText('Your current outfit is preserved.')).toBeVisible();
    expect(screen.getByRole('img', { name: /Outfit workspace with 1 garment\./u })).toBeVisible();
  });

  it('accepts a Wardrobe handoff once, removes the consumed query, and preserves return context', async () => {
    vi.stubGlobal('fetch', outfitFetchMock());
    const { router } = renderApp(
      '/outfit-builder?garment=1&returnTo=%2Fwardrobe%3Fcategory%3Dtop%26item%3D1',
    );

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    await waitFor(() => expect(router.state.location.search).not.toContain('garment='));
    expect(screen.getByRole('link', { name: 'Wardrobe' })).toHaveAttribute(
      'href',
      '/wardrobe?category=top&item=1',
    );
    expect(screen.getByText('Linen Shirt')).toBeVisible();
  });

  it('uses an already available cutout immediately when a garment is added', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ clothingItems: [rawCompletedCutoutSummary] }));
    const user = userEvent.setup();
    renderApp('/outfit-builder');

    await addGarment(user);

    await waitFor(() =>
      expect(
        persistedBuilderState().placements[0]?.clothing_item.image_candidates[0],
      ).toMatchObject({
        image_kind: 'cutout',
        content_url: rawCutout.content_url,
      }),
    );
    expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeVisible();
  });

  it('keeps a pending fallback, then swaps only media when the clothing query receives a cutout', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({ clothingItems: [rawPendingClothingSummary, rawJacketSummary] }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderApp('/outfit-builder');

    await addGarment(user);
    await addGarment(user, 'Linen Jacket');
    await user.click(screen.getByRole('button', { name: 'Unsaved changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Outfit items' });
    const shirtRow = within(dialog).getByText('Linen Shirt').closest('li');
    if (shirtRow === null) {
      throw new Error('Expected the pending garment in the Builder layer list.');
    }
    await user.click(within(shirtRow).getByRole('button', { name: 'Select' }));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Move garment right' }));
    await user.click(screen.getByRole('button', { name: 'Increase garment size' }));
    await user.click(screen.getByRole('button', { name: 'Rotate garment right' }));
    await user.click(screen.getByRole('button', { name: 'Move garment forward' }));

    await waitFor(() =>
      expect(
        persistedBuilderState().placements.find(
          (placement) => placement.clothing_item_id === rawClothingSummary.id,
        )?.clothing_item.image_candidates[0]?.image_kind,
      ).toBe('normalized'),
    );
    const before = persistedBuilderState();
    const placementsBefore = before.placements.map(placementState);

    act(() => {
      queryClient.setQueryData(
        clothingKeys.list('all'),
        decodeClothingPage({
          items: [rawCompletedCutoutSummary, rawJacketSummary],
          total: 2,
          limit: 100,
          offset: 0,
        }),
      );
    });

    await waitFor(() =>
      expect(
        persistedBuilderState().placements.find(
          (placement) => placement.clothing_item_id === rawClothingSummary.id,
        )?.clothing_item.image_candidates[0],
      ).toMatchObject({ image_kind: 'cutout', content_url: rawCutout.content_url }),
    );
    const after = persistedBuilderState();
    expect(after.placements.map(placementState)).toEqual(placementsBefore);
    expect(after.placements).toHaveLength(2);
    expect(new Set(after.placements.map((placement) => placement.clothing_item_id)).size).toBe(2);
    expect(after.active_clothing_item_id).toBe(before.active_clothing_item_id);
    expect(after.mode).toBe(before.mode);
    expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeVisible();
  });

  it('reopens a saved cutout outfit with its persisted transform and layer intact', async () => {
    const reopened = {
      ...rawOutfitDetail,
      items: [
        {
          ...rawOutfitItem,
          clothing_item: {
            ...rawOutfitClothingReference,
            primary_image: rawImage,
            display_image: rawCutout,
            image_candidates: [rawCutout, rawImage],
          },
          position_x: 0.31,
          position_y: 0.46,
          scale: 1.4,
          rotation: -15,
          layer_index: 7,
        },
      ],
    } as const;
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        clothingItems: [rawCompletedCutoutSummary],
        outfitDetail: reopened,
      }),
    );
    renderApp('/outfit-builder?outfitId=20');

    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    await waitFor(() => {
      const state = persistedBuilderState();
      expect(state.placements).toHaveLength(1);
      expect(state.placements[0]).toMatchObject({
        position_x: 0.31,
        position_y: 0.46,
        scale: 1.4,
        rotation: -15,
        layer_index: 0,
      });
      expect(state.placements[0]?.clothing_item.image_candidates[0]?.image_kind).toBe('cutout');
    });
    expect(screen.getByRole('button', { name: 'Saved' })).toBeVisible();
  });

  it('adds two distinct garments to the same body zone and supports layer, reset, and remove commands', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({ clothingItems: [rawClothingSummary, rawJacketSummary] }),
    );
    const user = userEvent.setup();
    renderApp('/outfit-builder');

    await addGarment(user);
    await addGarment(user, 'Linen Jacket');
    expect(screen.getByRole('img', { name: /Outfit workspace with 2 garments/u })).toBeVisible();
    expect(screen.getByText('Layer 2 of 2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Move garment backward' }));
    expect(screen.getByText('Layer 1 of 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move garment up' }));
    await user.click(screen.getByRole('button', { name: 'Increase garment size' }));
    await user.click(screen.getByRole('button', { name: 'Rotate garment right' }));
    await user.click(screen.getByRole('button', { name: 'Unsaved changes' }));

    const dialog = screen.getByRole('dialog', { name: 'Outfit items' });
    expect(within(dialog).getByText('Linen Shirt')).toBeVisible();
    expect(within(dialog).getByText('Linen Jacket')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Reset active' }));
    expect(screen.getByText('Layer 2 of 2')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Remove active' }));
    expect(screen.getByRole('img', { name: /Outfit workspace with 1 garment\./u })).toBeVisible();
  });

  it('cycles compatible garments predictably in both directions without resetting the rest of the outfit', async () => {
    const fetchMock = outfitFetchMock({
      clothingItems: [rawClothingSummary, rawJacketSummary, rawPantsSummary],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/outfit-builder');

    await addGarment(user);
    await addPants(user);
    await user.click(screen.getByRole('button', { name: 'Move garment down' }));

    await user.click(screen.getByRole('button', { name: 'Next top garment' }));
    expect(screen.getByText('Linen Jacket')).toBeVisible();
    expect(screen.getByRole('img', { name: /Outfit workspace with 2 garments/u })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Previous top garment' }));
    expect(screen.getByText('Linen Shirt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Previous top garment' }));
    expect(screen.getByText('Linen Jacket')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Save Outfit' })).getByRole('button', {
        name: 'Save Outfit',
      }),
    );
    await waitFor(() => expect(writeCall(fetchMock, 'POST')).toBeDefined());
    expect(requestPayload(writeCall(fetchMock, 'POST')?.[1]).items).toEqual([
      {
        body_zone: 'lower_body',
        clothing_item_id: 3,
        layer_index: 0,
        position_x: 0.5,
        position_y: 0.665,
        rotation: 0,
        scale: 1,
      },
      {
        body_zone: 'upper_body',
        clothing_item_id: 2,
        layer_index: 1,
        position_x: 0.5,
        position_y: 0.37,
        rotation: 0,
        scale: 1,
      },
    ]);
  });

  it('keeps a reopened soft-deleted garment visible and removable without offering it in the active Wardrobe picker', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        clothingItems: [rawClothingSummary],
        outfitDetail: rawOutfitWithDeletedGarment,
      }),
    );
    const user = userEvent.setup();
    renderApp('/outfit-builder?outfitId=20');

    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    expect(screen.getByRole('img', { name: /Outfit workspace with 2 garments/u })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Saved' }));

    let optionsDialog = screen.getByRole('dialog', { name: 'Outfit items' });
    expect(within(optionsDialog).getByText('No longer in Wardrobe')).toBeVisible();
    const deletedRow = within(optionsDialog)
      .getByText(/Archived Silk Top/u)
      .closest('li');
    if (deletedRow === null) {
      throw new Error('Expected the deleted garment to remain in the outfit layer list.');
    }
    await user.click(within(deletedRow).getByRole('button', { name: 'Select' }));
    expect(screen.getByText('Layer 1 of 2')).toBeVisible();
    await user.click(within(optionsDialog).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Top' }));
    const pickerDialog = await screen.findByRole('dialog', { name: 'Choose Top' });
    expect(
      within(pickerDialog).getByRole('button', { name: 'Select placed Linen Shirt' }),
    ).toBeVisible();
    expect(
      within(pickerDialog).queryByRole('button', { name: 'Add Archived Silk Top' }),
    ).not.toBeInTheDocument();
    expect(
      within(pickerDialog).queryByRole('button', { name: 'Select placed Archived Silk Top' }),
    ).not.toBeInTheDocument();
    await user.click(within(pickerDialog).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Saved' }));
    optionsDialog = screen.getByRole('dialog', { name: 'Outfit items' });
    await user.click(within(optionsDialog).getByRole('button', { name: 'Remove active' }));
    expect(screen.getByRole('img', { name: /Outfit workspace with 1 garment\./u })).toBeVisible();
    expect(within(optionsDialog).queryByText('No longer in Wardrobe')).not.toBeInTheDocument();
  });

  it('creates an adjusted outfit and sends the exact transform and layer payload', async () => {
    const fetchMock = outfitFetchMock({ outfitTotal: 4 });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder');
    await addGarment(user);

    await user.click(screen.getByRole('button', { name: 'Move garment right' }));
    await user.click(screen.getByRole('button', { name: 'Move garment up' }));
    await user.click(screen.getByRole('button', { name: 'Increase garment size' }));
    await user.click(screen.getByRole('button', { name: 'Rotate garment right' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    const name = screen.getByRole('textbox', { name: 'Outfit name' });
    expect(name).toHaveValue('Look 05');
    await user.clear(name);
    await user.type(name, 'Adjusted Linen');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Save Outfit' })).getByRole('button', {
        name: 'Save Outfit',
      }),
    );

    await waitFor(() => expect(writeCall(fetchMock, 'POST')).toBeDefined());
    const postCall = writeCall(fetchMock, 'POST');
    expect(requestPayload(postCall?.[1])).toEqual({
      name: 'Adjusted Linen',
      items: [
        {
          body_zone: 'upper_body',
          clothing_item_id: 1,
          layer_index: 0,
          position_x: 0.525,
          position_y: 0.345,
          rotation: 5,
          scale: 1.1,
        },
      ],
    });
    await waitFor(() => expect(router.state.location.search).toContain('outfitId=31'));
    expect(screen.getByText('Adjusted Linen was saved.')).toBeVisible();
  });

  it('updates an existing outfit and can instead save a later edit as a new outfit', async () => {
    const fetchMock = outfitFetchMock({ outfitDetail: rawOutfitDetail, createId: 44 });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20&returnTo=%2Fsaved-outfits');

    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move garment left' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    await user.click(screen.getByRole('button', { name: 'Update Outfit' }));
    await waitFor(() => expect(writeCall(fetchMock, 'PATCH')).toBeDefined());
    expect(requestPayload(writeCall(fetchMock, 'PATCH')?.[1]).items[0]).toMatchObject({
      clothing_item_id: 1,
      position_x: 0.475,
    });
    expect(await screen.findByText('Summer Look was updated.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Rotate garment left' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    await user.click(screen.getByRole('button', { name: 'Save as New Outfit' }));
    await waitFor(() => expect(writeCall(fetchMock, 'POST')).toBeDefined());
    await waitFor(() => expect(router.state.location.search).toContain('outfitId=44'));
  });

  it('preserves the complete new draft and save form after a local save failure', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ createError: true }));
    const user = userEvent.setup();
    renderApp('/outfit-builder');
    await addGarment(user);
    await user.click(screen.getByRole('button', { name: 'Move garment down' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    const name = screen.getByRole('textbox', { name: 'Outfit name' });
    await user.clear(name);
    await user.type(name, 'Offline Draft');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Save Outfit' })).getByRole('button', {
        name: 'Save Outfit',
      }),
    );

    expect(
      await screen.findByText('The outfit could not be written to local storage.'),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Outfit name' })).toHaveValue('Offline Draft');
    expect(screen.getByRole('img', { name: /Outfit workspace with 1 garment\./u })).toBeVisible();
    expect(screen.getByText('Layer 1 of 1')).toBeVisible();
  });

  it('deletes a saved outfit only after confirmation and returns to Saved Outfits', async () => {
    const fetchMock = outfitFetchMock({ outfitDetail: rawOutfitDetail });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Saved' }));
    await user.click(screen.getByRole('button', { name: 'Delete saved outfit' }));
    expect(screen.getByRole('dialog', { name: 'Delete Summer Look?' })).toBeVisible();
    expect(writeCall(fetchMock, 'POST')).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Delete outfit' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/saved-outfits'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('starts a new draft when Home opens the plain Builder after a clean saved outfit', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ outfitDetail: rawOutfitDetail }));
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await user.click(screen.getByRole('link', { name: 'Open Outfit Builder' }));

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 0 garments/u }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Outfit items' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save Outfit' })).toBeVisible();
    await waitFor(() => expect(window.sessionStorage.getItem('muse.outfit-builder.v1')).toBeNull());
  });

  it('preserves a dirty existing draft when Home reopens the plain Builder', async () => {
    vi.stubGlobal('fetch', outfitFetchMock({ outfitDetail: rawOutfitDetail }));
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move garment right' }));

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await user.click(screen.getByRole('link', { name: 'Open Outfit Builder' }));

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('dialog', { name: 'Save changes' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Outfit name' })).toHaveValue('Summer Look');
  });

  it('starts a new draft before applying a clean Home-to-Wardrobe garment handoff', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        clothingItems: [rawClothingSummary],
        outfitDetail: rawSavedJacketOutfit,
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await user.click(screen.getByRole('link', { name: 'Open Wardrobe' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Open in Outfit Builder' }));

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    expect(screen.getByText('Linen Shirt')).toBeVisible();
    expect(screen.queryByText('Linen Jacket')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('dialog', { name: 'Save Outfit' })).toBeVisible();
  });

  it('preserves a clean saved outfit when its own picker round-trips through Wardrobe', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        clothingItems: [rawClothingSummary],
        outfitDetail: rawSavedJacketOutfit,
      }),
    );
    const user = userEvent.setup();
    renderApp('/outfit-builder?outfitId=20');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Top' }));
    const pickerDialog = await screen.findByRole('dialog', { name: 'Choose Top' });
    const wardrobeLink = within(pickerDialog).getByRole('link', { name: 'Open Wardrobe' });
    expect(wardrobeLink).toHaveAttribute('href', '/wardrobe?preserveDraft=1');
    await user.click(wardrobeLink);
    expect(await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Shirt' }));
    const openInBuilder = await screen.findByRole('link', { name: 'Open in Outfit Builder' });
    await waitFor(() => expect(openInBuilder.getAttribute('href')).toContain('preserveDraft=1'));
    await user.click(openInBuilder);

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 2 garments/u }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Unsaved changes' }));
    const optionsDialog = screen.getByRole('dialog', { name: 'Outfit items' });
    expect(within(optionsDialog).getByText('Linen Jacket')).toBeVisible();
    expect(within(optionsDialog).getByText('Linen Shirt')).toBeVisible();
    await user.click(within(optionsDialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('dialog', { name: 'Save changes' })).toBeVisible();
  });

  it('preserves a dirty existing draft during an intentional Wardrobe garment handoff', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        clothingItems: [rawClothingSummary],
        outfitDetail: rawSavedJacketOutfit,
      }),
    );
    const user = userEvent.setup();
    renderApp('/outfit-builder?outfitId=20&returnTo=%2Fwardrobe%3Fitem%3D1');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move garment right' }));

    await user.click(screen.getByRole('link', { name: 'Wardrobe' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Linen Shirt' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Open in Outfit Builder' }));

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 2 garments/u }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Unsaved changes' }));
    const optionsDialog = screen.getByRole('dialog', { name: 'Outfit items' });
    expect(within(optionsDialog).getByText('Linen Jacket')).toBeVisible();
    expect(within(optionsDialog).getByText('Linen Shirt')).toBeVisible();
    await user.click(within(optionsDialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('dialog', { name: 'Save changes' })).toBeVisible();
  });

  it('clears stale Wardrobe context when Home opens a truly new clean Builder', async () => {
    vi.stubGlobal('fetch', outfitFetchMock());
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?garment=1&returnTo=%2Fwardrobe%3Fitem%3D1');
    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Unsaved changes' }));
    const optionsDialog = screen.getByRole('dialog', { name: 'Outfit items' });
    await user.click(within(optionsDialog).getByRole('button', { name: 'Remove active' }));
    expect(screen.getByRole('img', { name: /Outfit workspace with 0 garments/u })).toBeVisible();
    await user.click(within(optionsDialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('link', { name: 'Wardrobe' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await user.click(screen.getByRole('link', { name: 'Open Outfit Builder' }));

    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 0 garments/u }),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Wardrobe' })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('muse.outfit-builder.v1')).toBeNull();
  });

  it('restores the current dirty outfit URL when Escape dismisses an incoming-outfit conflict', async () => {
    vi.stubGlobal(
      'fetch',
      outfitFetchMock({
        outfitDetails: { 20: rawOutfitDetail, 21: rawIncomingOutfit },
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder?outfitId=20&returnTo=%2Fsaved-outfits');
    expect(await screen.findByRole('button', { name: 'Saved Outfit' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move garment right' }));

    await act(async () => {
      await router.navigate('/outfit-builder?outfitId=21&returnTo=%2Fsaved-outfits');
    });
    expect(await screen.findByRole('dialog', { name: 'Open another outfit?' })).toBeVisible();
    expect(router.state.location.search).toContain('outfitId=21');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(router.state.location.search).toBe('?outfitId=20&returnTo=%2Fsaved-outfits'),
    );
    expect(screen.queryByRole('dialog', { name: 'Open another outfit?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save Outfit' }));
    expect(screen.getByRole('dialog', { name: 'Save changes' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Outfit name' })).toHaveValue('Summer Look');
  });

  it('guards unsaved navigation, can keep the draft, and can explicitly discard it', async () => {
    vi.stubGlobal('fetch', outfitFetchMock());
    const user = userEvent.setup();
    const { router } = renderApp('/outfit-builder');
    await addGarment(user);

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved outfit' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/outfit-builder');

    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(window.sessionStorage.getItem('muse.outfit-builder.v1')).not.toBeNull();

    await user.click(screen.getByRole('link', { name: 'Open Outfit Builder' }));
    expect(
      await screen.findByRole('img', { name: /Outfit workspace with 1 garment\./u }),
    ).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Return to Home' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(window.sessionStorage.getItem('muse.outfit-builder.v1')).toBeNull());
  });
});
