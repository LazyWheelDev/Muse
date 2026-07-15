import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeClothingPage } from '../clothing/decoders';
import { rawClothingPage } from '../../test/clothingFixtures';
import { builderGarmentFromClothingItem, selectOutfitBuilderIsDirty } from './model';
import {
  createInitialOutfitBuilderState,
  outfitBuilderAction,
  outfitBuilderReducer,
} from './reducer';
import {
  decodeOutfitBuilderSession,
  encodeOutfitBuilderSession,
  loadOutfitBuilderSession,
  OUTFIT_BUILDER_SESSION_KEY,
  OUTFIT_BUILDER_SESSION_MAX_BYTES,
  persistOutfitBuilderSession,
} from './session';

const clothingItem = decodeClothingPage(rawClothingPage).items[0];

if (clothingItem === undefined) {
  throw new Error('The clothing fixture must include one item.');
}

const top = builderGarmentFromClothingItem(clothingItem);

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('Outfit Builder session recovery', () => {
  it('round-trips one versioned bounded draft and preserves its baseline', () => {
    let state = outfitBuilderReducer(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
    );
    state = outfitBuilderReducer(state, outfitBuilderAction.rename('Local Look'));
    state = outfitBuilderReducer(state, outfitBuilderAction.markSaved(44));
    state = outfitBuilderReducer(state, outfitBuilderAction.moveTo(0.25, 0.75));
    state = outfitBuilderReducer(state, outfitBuilderAction.setOriginReturn('/wardrobe?item=1'));

    expect(persistOutfitBuilderSession(window.sessionStorage, state)).toBe(true);
    const serialized = window.sessionStorage.getItem(OUTFIT_BUILDER_SESSION_KEY);
    expect(serialized).not.toBeNull();
    expect(new TextEncoder().encode(serialized ?? '').byteLength).toBeLessThan(
      OUTFIT_BUILDER_SESSION_MAX_BYTES,
    );

    const recovered = loadOutfitBuilderSession(window.sessionStorage);
    expect(recovered).toMatchObject({
      mode: 'existing',
      outfitId: 44,
      name: 'Local Look',
      activePlacementKey: 'clothing-1',
      originReturnTo: '/wardrobe?item=1',
    });
    expect(recovered?.placements[0]).toMatchObject({ positionX: 0.25, positionY: 0.75 });
    expect(recovered === null ? null : selectOutfitBuilderIsDirty(recovered)).toBe(true);

    const restored =
      recovered === null
        ? null
        : outfitBuilderReducer(recovered, outfitBuilderAction.restoreBaseline());
    expect(restored === null ? null : selectOutfitBuilderIsDirty(restored)).toBe(false);
  });

  it('discards a tampered session containing an unsafe media URL', () => {
    const state = outfitBuilderReducer(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
    );
    const envelope = JSON.parse(encodeOutfitBuilderSession(state)) as {
      state: {
        placements: Array<{
          clothing_item: { image_candidates: Array<{ content_url: string }> };
        }>;
      };
    };
    const candidate = envelope.state.placements[0]?.clothing_item.image_candidates[0];
    if (candidate === undefined) {
      throw new Error('The session fixture must include one image candidate.');
    }
    candidate.content_url = '/api/v1/media/%252e%252e/private.db';
    window.sessionStorage.setItem(OUTFIT_BUILDER_SESSION_KEY, JSON.stringify(envelope));

    expect(loadOutfitBuilderSession(window.sessionStorage)).toBeNull();
    expect(window.sessionStorage.getItem(OUTFIT_BUILDER_SESSION_KEY)).toBeNull();
  });

  it('rejects unsupported versions and inconsistent active identifiers', () => {
    const state = outfitBuilderReducer(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
    );
    const envelope = JSON.parse(encodeOutfitBuilderSession(state)) as {
      version: number;
      state: { active_clothing_item_id: number | null };
    };

    expect(() => decodeOutfitBuilderSession({ ...envelope, version: 2 })).toThrow(/version/u);
    envelope.state.active_clothing_item_id = 999;
    expect(() => decodeOutfitBuilderSession(envelope)).toThrow(/active placement/u);
  });

  it('does not write a recovery payload beyond the explicit byte limit', () => {
    const state = outfitBuilderReducer(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
    );
    const placement = state.placements[0];
    if (placement === undefined || placement.clothingItem.displayImage === null) {
      throw new Error('The session fixture must include a display image.');
    }
    const oversizedUrl = `/api/v1/media/${'a'.repeat(OUTFIT_BUILDER_SESSION_MAX_BYTES)}`;
    const oversizedState = {
      ...state,
      placements: [
        {
          ...placement,
          clothingItem: {
            ...placement.clothingItem,
            displayImage: { ...placement.clothingItem.displayImage, contentUrl: oversizedUrl },
          },
        },
      ],
    };

    expect(persistOutfitBuilderSession(window.sessionStorage, oversizedState)).toBe(false);
    expect(window.sessionStorage.getItem(OUTFIT_BUILDER_SESSION_KEY)).toBeNull();
  });
});
