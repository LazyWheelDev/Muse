import type { ClothingImage } from '../clothing/model';
import { bodyZones } from '../clothing/model';
import type { BodyZone } from '../clothing/model';
import { safeWardrobeReturnPath } from '../clothing/wardrobeContext';
import { decodeOutfitClothingReference } from '../outfits/decoders';
import type { ClothingReferenceStatus, OutfitClothingReference } from '../outfits/model';
import {
  normalizeOutfitPlacementLayers,
  OUTFIT_MAX_PLACEMENTS,
  OUTFIT_NAME_MAX_LENGTH,
  OUTFIT_POSITION_MAX,
  OUTFIT_POSITION_MIN,
  OUTFIT_ROTATION_MAX,
  OUTFIT_ROTATION_MIN,
  OUTFIT_SCALE_MAX,
  OUTFIT_SCALE_MIN,
  outfitPlacementKey,
} from './model';
import type {
  OutfitBuilderBaseline,
  OutfitBuilderMode,
  OutfitBuilderState,
  OutfitPlacement,
} from './model';

export const OUTFIT_BUILDER_SESSION_VERSION = 1;
export const OUTFIT_BUILDER_SESSION_KEY = 'muse.outfit-builder.v1';
export const OUTFIT_BUILDER_SESSION_MAX_BYTES = 512 * 1024;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

function integerInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} is outside its supported range.`);
  }
  return Number(value);
}

function numberInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its supported range.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function encodeImage(image: ClothingImage | null): unknown {
  if (image === null) {
    return null;
  }
  return {
    id: image.id,
    image_group_id: image.imageGroupId,
    display_order: image.displayOrder,
    image_kind: image.imageKind,
    mime_type: image.mimeType,
    width: image.width,
    height: image.height,
    byte_size: image.byteSize,
    is_primary: image.isPrimary,
    content_url: image.contentUrl,
    created_at: image.createdAt,
    updated_at: image.updatedAt,
  };
}

function encodeClothingReference(reference: OutfitClothingReference): unknown {
  return {
    id: reference.id,
    name: reference.name,
    garment_category: reference.garmentCategory,
    default_body_zone: reference.defaultBodyZone,
    deleted_at: reference.deletedAt,
    primary_image: encodeImage(reference.primaryImage),
    display_image: encodeImage(reference.displayImage),
    thumbnail_image: encodeImage(reference.thumbnailImage),
    image_candidates: reference.imageCandidates.map((image) => encodeImage(image)),
  };
}

function encodePlacement(placement: OutfitPlacement): unknown {
  return {
    clothing_item_id: placement.clothingItemId,
    clothing_item_status: placement.clothingItemStatus,
    clothing_item: encodeClothingReference(placement.clothingItem),
    body_zone: placement.bodyZone,
    position_x: placement.positionX,
    position_y: placement.positionY,
    scale: placement.scale,
    rotation: placement.rotation,
    layer_index: placement.layerIndex,
  };
}

function decodePlacement(value: unknown): OutfitPlacement {
  const placement = record(value, 'placement');
  const clothingItemId = integerInRange(
    placement.clothing_item_id,
    1,
    Number.MAX_SAFE_INTEGER,
    'clothing_item_id',
  );
  const clothingItemStatus = enumValue<ClothingReferenceStatus>(
    placement.clothing_item_status,
    ['active', 'deleted'],
    'clothing_item_status',
  );
  const clothingItem = decodeOutfitClothingReference(placement.clothing_item);
  if (clothingItem.id !== clothingItemId) {
    throw new Error('clothing_item.id must match clothing_item_id.');
  }
  if ((clothingItem.deletedAt === null) !== (clothingItemStatus === 'active')) {
    throw new Error('clothing_item_status must match clothing_item.deleted_at.');
  }
  return {
    key: outfitPlacementKey(clothingItemId),
    clothingItemId,
    clothingItemStatus,
    clothingItem,
    bodyZone: enumValue<BodyZone>(placement.body_zone, bodyZones, 'body_zone'),
    positionX: numberInRange(
      placement.position_x,
      OUTFIT_POSITION_MIN,
      OUTFIT_POSITION_MAX,
      'position_x',
    ),
    positionY: numberInRange(
      placement.position_y,
      OUTFIT_POSITION_MIN,
      OUTFIT_POSITION_MAX,
      'position_y',
    ),
    scale: numberInRange(placement.scale, OUTFIT_SCALE_MIN, OUTFIT_SCALE_MAX, 'scale'),
    rotation: numberInRange(
      placement.rotation,
      OUTFIT_ROTATION_MIN,
      OUTFIT_ROTATION_MAX,
      'rotation',
    ),
    layerIndex: integerInRange(placement.layer_index, 0, 10_000, 'layer_index'),
  };
}

function decodePlacements(value: unknown, label: string): OutfitPlacement[] {
  if (!Array.isArray(value) || value.length > OUTFIT_MAX_PLACEMENTS) {
    throw new Error(`${label} must be a bounded array.`);
  }
  const placements = value.map((placement) => decodePlacement(placement));
  const clothingIds = placements.map((placement) => placement.clothingItemId);
  const layers = placements.map((placement) => placement.layerIndex);
  if (new Set(clothingIds).size !== clothingIds.length || new Set(layers).size !== layers.length) {
    throw new Error(`${label} contains duplicate clothing or layer identifiers.`);
  }
  return normalizeOutfitPlacementLayers(placements);
}

function encodeBaseline(baseline: OutfitBuilderBaseline): unknown {
  return {
    name: baseline.name,
    placements: baseline.placements.map((placement) => encodePlacement(placement)),
  };
}

function decodeBaseline(value: unknown): OutfitBuilderBaseline {
  const baseline = record(value, 'baseline');
  return {
    name: string(baseline.name, 'baseline.name', OUTFIT_NAME_MAX_LENGTH),
    placements: decodePlacements(baseline.placements, 'baseline.placements'),
  };
}

export function normalizeOutfitBuilderOriginReturn(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, 'http://muse.local');
  } catch {
    return null;
  }
  if (parsed.origin !== 'http://muse.local' || parsed.hash !== '') {
    return null;
  }
  if (parsed.pathname === '/wardrobe') {
    return safeWardrobeReturnPath(`${parsed.pathname}${parsed.search}`);
  }
  if (parsed.pathname === '/saved-outfits' && parsed.search === '') {
    return '/saved-outfits';
  }
  return null;
}

function decodeOriginReturn(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const origin = string(value, 'origin_return_to', 2_048);
  const normalized = normalizeOutfitBuilderOriginReturn(origin);
  if (normalized === null) {
    throw new Error('origin_return_to must be a supported local Muse path.');
  }
  return normalized;
}

function encodeState(state: OutfitBuilderState): unknown {
  const active = state.placements.find((placement) => placement.key === state.activePlacementKey);
  return {
    mode: state.mode,
    outfit_id: state.outfitId,
    name: state.name,
    placements: state.placements.map((placement) => encodePlacement(placement)),
    active_clothing_item_id: active?.clothingItemId ?? null,
    origin_return_to: state.originReturnTo,
    baseline: encodeBaseline(state.baseline),
  };
}

export function decodeOutfitBuilderSession(value: unknown): OutfitBuilderState {
  const envelope = record(value, 'outfit builder session');
  if (envelope.version !== OUTFIT_BUILDER_SESSION_VERSION) {
    throw new Error('Outfit Builder session version is unsupported.');
  }
  const persisted = record(envelope.state, 'outfit builder session state');
  const mode = enumValue<OutfitBuilderMode>(persisted.mode, ['new', 'existing'], 'mode');
  const outfitId =
    persisted.outfit_id === null
      ? null
      : integerInRange(persisted.outfit_id, 1, Number.MAX_SAFE_INTEGER, 'outfit_id');
  if ((mode === 'new' && outfitId !== null) || (mode === 'existing' && outfitId === null)) {
    throw new Error('Outfit Builder mode and outfit id are inconsistent.');
  }
  const placements = decodePlacements(persisted.placements, 'placements');
  const activeClothingItemId =
    persisted.active_clothing_item_id === null
      ? null
      : integerInRange(
          persisted.active_clothing_item_id,
          1,
          Number.MAX_SAFE_INTEGER,
          'active_clothing_item_id',
        );
  const activePlacementKey =
    activeClothingItemId === null ? null : outfitPlacementKey(activeClothingItemId);
  if (
    activePlacementKey !== null &&
    !placements.some((placement) => placement.key === activePlacementKey)
  ) {
    throw new Error('The active placement must exist in the recovered draft.');
  }

  return {
    mode,
    outfitId,
    name: string(persisted.name, 'name', OUTFIT_NAME_MAX_LENGTH),
    placements,
    activePlacementKey,
    originReturnTo: decodeOriginReturn(persisted.origin_return_to),
    baseline: decodeBaseline(persisted.baseline),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function shouldPersist(state: OutfitBuilderState): boolean {
  return (
    state.mode === 'existing' ||
    state.name.length > 0 ||
    state.placements.length > 0 ||
    state.originReturnTo !== null ||
    state.baseline.name.length > 0 ||
    state.baseline.placements.length > 0
  );
}

export function encodeOutfitBuilderSession(state: OutfitBuilderState): string {
  return JSON.stringify({
    version: OUTFIT_BUILDER_SESSION_VERSION,
    state: encodeState(state),
  });
}

export function loadOutfitBuilderSession(storage: Storage): OutfitBuilderState | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(OUTFIT_BUILDER_SESSION_KEY);
  } catch {
    return null;
  }
  if (serialized === null) {
    return null;
  }
  if (byteLength(serialized) > OUTFIT_BUILDER_SESSION_MAX_BYTES) {
    removeOutfitBuilderSession(storage);
    return null;
  }
  try {
    return decodeOutfitBuilderSession(JSON.parse(serialized) as unknown);
  } catch {
    removeOutfitBuilderSession(storage);
    return null;
  }
}

export function persistOutfitBuilderSession(storage: Storage, state: OutfitBuilderState): boolean {
  if (!shouldPersist(state)) {
    removeOutfitBuilderSession(storage);
    return true;
  }
  const serialized = encodeOutfitBuilderSession(state);
  if (byteLength(serialized) > OUTFIT_BUILDER_SESSION_MAX_BYTES) {
    removeOutfitBuilderSession(storage);
    return false;
  }
  try {
    storage.setItem(OUTFIT_BUILDER_SESSION_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function removeOutfitBuilderSession(storage: Storage): void {
  try {
    storage.removeItem(OUTFIT_BUILDER_SESSION_KEY);
  } catch {
    // Storage can be unavailable in privacy modes. Recovery is best-effort only.
  }
}

export function getBrowserSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
