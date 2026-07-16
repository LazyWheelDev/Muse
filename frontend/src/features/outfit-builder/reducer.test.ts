import { describe, expect, it } from 'vitest';

import { decodeClothingPage } from '../clothing/decoders';
import type { BodyZone, ClothingItemSummary, GarmentCategory } from '../clothing/model';
import { decodeOutfitDetail } from '../outfits/decoders';
import type { OutfitDetail } from '../outfits/model';
import { rawClothingPage } from '../../test/clothingFixtures';
import {
  rawOutfitClothingReference,
  rawOutfitDetail,
  rawOutfitItem,
} from '../../test/outfitFixtures';
import {
  builderGarmentFromClothingItem,
  getOutfitPlacementFrame,
  OUTFIT_WORKSPACE_HEIGHT,
  OUTFIT_WORKSPACE_WIDTH,
  outfitPlacementKey,
  selectActiveOutfitPlacement,
  selectOutfitBuilderIsDirty,
  serializeOutfitBuilderCreate,
} from './model';
import type { BuilderGarment, OutfitBuilderState, OutfitPlacement } from './model';
import {
  createInitialOutfitBuilderState,
  outfitBuilderAction,
  outfitBuilderReducer,
} from './reducer';
import type { OutfitBuilderAction } from './reducer';

const baseClothingItem = decodeClothingPage(rawClothingPage).items[0];

if (baseClothingItem === undefined) {
  throw new Error('The clothing fixture must include one item.');
}

const clothingFixture: ClothingItemSummary = baseClothingItem;

function garment(
  id: number,
  garmentCategory: GarmentCategory,
  defaultBodyZone: BodyZone,
): BuilderGarment {
  return builderGarmentFromClothingItem({
    ...clothingFixture,
    id,
    name: `${garmentCategory}-${id}`,
    garmentCategory,
    defaultBodyZone,
  });
}

function reduce(
  state: OutfitBuilderState,
  ...actions: readonly OutfitBuilderAction[]
): OutfitBuilderState {
  return actions.reduce(outfitBuilderReducer, state);
}

function placementWithoutMedia(placement: OutfitPlacement) {
  return {
    key: placement.key,
    clothingItemId: placement.clothingItemId,
    clothingItemStatus: placement.clothingItemStatus,
    bodyZone: placement.bodyZone,
    positionX: placement.positionX,
    positionY: placement.positionY,
    scale: placement.scale,
    rotation: placement.rotation,
    layerIndex: placement.layerIndex,
  };
}

function twoItemOutfit(): OutfitDetail {
  const outerwearReference = {
    ...rawOutfitClothingReference,
    id: 2,
    name: 'Linen Jacket',
    garment_category: 'outerwear',
    default_body_zone: 'upper_body',
  };
  return decodeOutfitDetail({
    ...rawOutfitDetail,
    item_count: 2,
    items: [
      { ...rawOutfitItem, id: 5001, layer_index: 20 },
      {
        ...rawOutfitItem,
        id: 9999,
        clothing_item_id: 2,
        clothing_item: outerwearReference,
        layer_index: 80,
      },
    ],
  });
}

describe('Outfit Builder reducer', () => {
  it('uses the locked logical workspace and body-zone base geometry', () => {
    const top = garment(1, 'top', 'upper_body');
    const state = reduce(createInitialOutfitBuilderState(), outfitBuilderAction.add(top));
    const placement = state.placements[0];

    expect(OUTFIT_WORKSPACE_WIDTH).toBe(640);
    expect(OUTFIT_WORKSPACE_HEIGHT).toBe(800);
    expect(placement).toMatchObject({ positionX: 0.5, positionY: 0.37, scale: 1 });
    expect(placement === undefined ? null : getOutfitPlacementFrame(placement)).toMatchObject({
      centerX: 320,
      centerY: 296,
      width: 320,
      height: 320,
    });
  });

  it('allows distinct garments in the same zone while duplicate adds only activate', () => {
    const first = garment(1, 'top', 'upper_body');
    const second = garment(2, 'outerwear', 'upper_body');
    const state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(first, 'upper_body'),
      outfitBuilderAction.add(second, 'upper_body'),
      outfitBuilderAction.add(first, 'upper_body'),
    );

    expect(state.placements).toHaveLength(2);
    expect(state.placements.map((placement) => placement.bodyZone)).toEqual([
      'upper_body',
      'upper_body',
    ]);
    expect(state.activePlacementKey).toBe(outfitPlacementKey(1));
  });

  it('uses default ranks for insertion without disturbing existing manual relative order', () => {
    const outerwear = garment(1, 'outerwear', 'upper_body');
    const pants = garment(2, 'pants', 'lower_body');
    const top = garment(3, 'top', 'upper_body');
    const hat = garment(4, 'hat', 'head');

    let state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(outerwear),
      outfitBuilderAction.add(pants),
      outfitBuilderAction.add(top),
    );
    expect(state.placements.map((placement) => placement.clothingItem.garmentCategory)).toEqual([
      'pants',
      'top',
      'outerwear',
    ]);

    state = reduce(state, outfitBuilderAction.moveLayer('forward'), outfitBuilderAction.add(hat));
    expect(state.placements.map((placement) => placement.clothingItemId)).toEqual([2, 4, 1, 3]);
    expect(state.placements.map((placement) => placement.layerIndex)).toEqual([0, 1, 2, 3]);

    state = reduce(state, outfitBuilderAction.activate(3), outfitBuilderAction.reset());
    expect(state.placements.map((placement) => placement.clothingItemId)).toEqual([2, 3, 4, 1]);
    expect(selectActiveOutfitPlacement(state)).toMatchObject({
      layerIndex: 1,
      positionX: 0.5,
      positionY: 0.37,
      rotation: 0,
      scale: 1,
    });
  });

  it('moves by locked steps and clamps both command and direct canvas positions', () => {
    const top = garment(1, 'top', 'upper_body');
    let state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
      outfitBuilderAction.moveTo(-4, 9),
      outfitBuilderAction.move('right'),
      outfitBuilderAction.move('up'),
    );
    expect(selectActiveOutfitPlacement(state)).toMatchObject({
      positionX: 0.025,
      positionY: 0.975,
    });

    state = reduce(state, outfitBuilderAction.moveTo(0.123_456_789, 0.987_654_321));
    expect(selectActiveOutfitPlacement(state)).toMatchObject({
      positionX: 0.123457,
      positionY: 0.987654,
    });

    const unchanged = outfitBuilderReducer(state, outfitBuilderAction.moveTo(Number.NaN, 0.5));
    expect(unchanged).toBe(state);
  });

  it('clamps proportional scale and rotation and resets the complete active transform', () => {
    const top = garment(1, 'top', 'upper_body');
    let state = reduce(createInitialOutfitBuilderState(), outfitBuilderAction.add(top));
    for (let index = 0; index < 100; index += 1) {
      state = outfitBuilderReducer(state, outfitBuilderAction.resize('increase'));
      state = outfitBuilderReducer(state, outfitBuilderAction.rotate('right'));
    }
    expect(selectActiveOutfitPlacement(state)).toMatchObject({ scale: 4, rotation: 180 });

    for (let index = 0; index < 100; index += 1) {
      state = outfitBuilderReducer(state, outfitBuilderAction.resize('decrease'));
      state = outfitBuilderReducer(state, outfitBuilderAction.rotate('left'));
    }
    expect(selectActiveOutfitPlacement(state)).toMatchObject({ scale: 0.1, rotation: -180 });

    state = outfitBuilderReducer(state, outfitBuilderAction.reset());
    expect(selectActiveOutfitPlacement(state)).toMatchObject({
      positionX: 0.5,
      positionY: 0.37,
      scale: 1,
      rotation: 0,
    });
  });

  it('hydrates saved data with stable clothing keys and serializes normalized layers', () => {
    const outfit = twoItemOutfit();
    const state = outfitBuilderReducer(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.hydrate(outfit, '/saved-outfits'),
    );

    expect(state.mode).toBe('existing');
    expect(state.outfitId).toBe(20);
    expect(state.placements.map((placement) => placement.key)).toEqual([
      'clothing-1',
      'clothing-2',
    ]);
    expect(state.placements.map((placement) => placement.layerIndex)).toEqual([0, 1]);
    expect(selectOutfitBuilderIsDirty(state)).toBe(false);
    expect(serializeOutfitBuilderCreate(state).items).toEqual([
      expect.objectContaining({ clothing_item_id: 1, layer_index: 0 }),
      expect.objectContaining({ clothing_item_id: 2, layer_index: 1 }),
    ]);
  });

  it('derives dirty state, marks a baseline, restores it, and starts a truly new draft', () => {
    const top = garment(1, 'top', 'upper_body');
    let state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(top),
      outfitBuilderAction.rename('  Casual Monday  '),
    );
    expect(selectOutfitBuilderIsDirty(state)).toBe(true);
    expect(serializeOutfitBuilderCreate(state).name).toBe('Casual Monday');

    state = outfitBuilderReducer(state, outfitBuilderAction.markSaved(42));
    expect(selectOutfitBuilderIsDirty(state)).toBe(false);
    state = reduce(state, outfitBuilderAction.move('left'), outfitBuilderAction.rename('Changed'));
    expect(selectOutfitBuilderIsDirty(state)).toBe(true);
    state = outfitBuilderReducer(state, outfitBuilderAction.restoreBaseline());
    expect(selectOutfitBuilderIsDirty(state)).toBe(false);
    expect(state.name).toBe('  Casual Monday  ');

    state = outfitBuilderReducer(state, outfitBuilderAction.startNew('/saved-outfits'));
    expect(state).toMatchObject({
      mode: 'new',
      outfitId: null,
      name: '',
      placements: [],
      originReturnTo: '/saved-outfits',
    });
    expect(selectOutfitBuilderIsDirty(state)).toBe(false);
  });

  it('replaces the active garment without duplicating an already placed garment', () => {
    const first = garment(1, 'top', 'upper_body');
    const second = garment(2, 'outerwear', 'upper_body');
    const third = garment(3, 'dress', 'full_body');
    let state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(first),
      outfitBuilderAction.add(second),
      outfitBuilderAction.activate(1),
      outfitBuilderAction.replace(second),
    );
    expect(state.placements.map((placement) => placement.clothingItemId)).toEqual([1, 2]);
    expect(state.activePlacementKey).toBe('clothing-2');

    state = reduce(
      state,
      outfitBuilderAction.activate(1),
      outfitBuilderAction.moveTo(0.2, 0.3),
      outfitBuilderAction.replace(third),
    );
    expect(state.placements.map((placement) => placement.clothingItemId).sort()).toEqual([2, 3]);
    expect(selectActiveOutfitPlacement(state)).toMatchObject({
      clothingItemId: 3,
      bodyZone: 'upper_body',
      positionX: 0.2,
      positionY: 0.3,
    });
  });

  it('syncs a later cutout without changing transforms, layers, selection, duplicates, or draft state', () => {
    const normalized = clothingFixture.displayImage;
    if (normalized === null) {
      throw new Error('The clothing fixture requires a normalized image.');
    }
    const first = garment(1, 'top', 'upper_body');
    const second = garment(2, 'outerwear', 'upper_body');
    const cutout = {
      ...normalized,
      id: 901,
      imageKind: 'cutout' as const,
      contentUrl: '/api/v1/media/garments/cutouts/linen-shirt.webp',
    };
    const refreshed = builderGarmentFromClothingItem({
      ...clothingFixture,
      displayImage: cutout,
    });
    let state = reduce(
      createInitialOutfitBuilderState(),
      outfitBuilderAction.add(first),
      outfitBuilderAction.add(second),
      outfitBuilderAction.activate(1),
      outfitBuilderAction.moveTo(0.23, 0.41),
      outfitBuilderAction.resize('increase'),
      outfitBuilderAction.rotate('right'),
      outfitBuilderAction.moveLayer('forward'),
      outfitBuilderAction.rename('Layered draft'),
      outfitBuilderAction.markSaved(42),
      outfitBuilderAction.move('left'),
    );
    const placementsBefore = state.placements.map(placementWithoutMedia);
    const baselineBefore = state.baseline.placements.map(placementWithoutMedia);
    const activeBefore = state.activePlacementKey;

    expect(selectOutfitBuilderIsDirty(state)).toBe(true);
    state = outfitBuilderReducer(state, outfitBuilderAction.syncMedia(refreshed));

    expect(state.placements.map(placementWithoutMedia)).toEqual(placementsBefore);
    expect(state.baseline.placements.map(placementWithoutMedia)).toEqual(baselineBefore);
    expect(state.placements).toHaveLength(2);
    expect(new Set(state.placements.map((placement) => placement.clothingItemId)).size).toBe(2);
    expect(state.activePlacementKey).toBe(activeBefore);
    expect(selectOutfitBuilderIsDirty(state)).toBe(true);
    expect(
      state.placements.find((placement) => placement.clothingItemId === 1)?.clothingItem
        .imageCandidates,
    ).toEqual([cutout, normalized]);
    expect(
      state.baseline.placements.find((placement) => placement.clothingItemId === 1)?.clothingItem
        .imageCandidates[0],
    ).toEqual(cutout);
  });
});
