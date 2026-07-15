import type { ClothingItemSummary, GarmentCategory, BodyZone } from '../clothing/model';
import { defaultBodyZoneByCategory } from '../clothing/model';
import type {
  ClothingReferenceStatus,
  OutfitClothingReference,
  OutfitCreatePayload,
  OutfitDetail,
  OutfitItem,
  OutfitItemWritePayload,
  OutfitUpdatePayload,
} from '../outfits/model';

export const OUTFIT_WORKSPACE_WIDTH = 640;
export const OUTFIT_WORKSPACE_HEIGHT = 800;
export const OUTFIT_POSITION_MIN = 0;
export const OUTFIT_POSITION_MAX = 1;
export const OUTFIT_SCALE_MIN = 0.1;
export const OUTFIT_SCALE_MAX = 4;
export const OUTFIT_ROTATION_MIN = -180;
export const OUTFIT_ROTATION_MAX = 180;
export const OUTFIT_LAYER_MIN = 0;
export const OUTFIT_LAYER_MAX = 10_000;
export const OUTFIT_MAX_PLACEMENTS = 250;
export const OUTFIT_NAME_MAX_LENGTH = 120;
export const OUTFIT_MOVE_STEP = 0.025;
export const OUTFIT_SCALE_STEP = 0.1;
export const OUTFIT_ROTATION_STEP = 5;

export const OUTFIT_BASE_WIDTH_BY_BODY_ZONE: Readonly<Record<BodyZone, number>> = {
  head: 0.28,
  neck: 0.34,
  upper_body: 0.5,
  full_body: 0.56,
  lower_body: 0.42,
  feet: 0.4,
  accessory: 0.3,
};

export interface NormalizedPoint {
  x: number;
  y: number;
}

export const OUTFIT_DEFAULT_CENTER_BY_BODY_ZONE: Readonly<Record<BodyZone, NormalizedPoint>> = {
  head: { x: 0.5, y: 0.13 },
  neck: { x: 0.5, y: 0.24 },
  upper_body: { x: 0.5, y: 0.37 },
  full_body: { x: 0.5, y: 0.47 },
  lower_body: { x: 0.5, y: 0.64 },
  feet: { x: 0.5, y: 0.88 },
  accessory: { x: 0.62, y: 0.4 },
};

export const OUTFIT_DEFAULT_LAYER_RANK_BY_CATEGORY: Readonly<Record<GarmentCategory, number>> = {
  pants: 20,
  dress: 25,
  top: 40,
  shoes: 50,
  hat: 60,
  outerwear: 70,
  scarf: 80,
  accessory: 90,
  other: 90,
};

export interface BuilderGarment {
  clothingItemId: number;
  clothingItemStatus: ClothingReferenceStatus;
  clothingItem: OutfitClothingReference;
}

export interface OutfitPlacement extends BuilderGarment {
  key: string;
  bodyZone: BodyZone;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  layerIndex: number;
}

export interface OutfitBuilderBaseline {
  name: string;
  placements: OutfitPlacement[];
}

export type OutfitBuilderMode = 'new' | 'existing';

export interface OutfitBuilderState {
  mode: OutfitBuilderMode;
  outfitId: number | null;
  name: string;
  placements: OutfitPlacement[];
  activePlacementKey: string | null;
  originReturnTo: string | null;
  baseline: OutfitBuilderBaseline;
}

export interface OutfitPlacementFrame {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  left: number;
  top: number;
  rotation: number;
  layerIndex: number;
}

export function outfitPlacementKey(clothingItemId: number): string {
  if (!Number.isSafeInteger(clothingItemId) || clothingItemId <= 0) {
    throw new Error('Clothing item id must be a positive integer.');
  }
  return `clothing-${clothingItemId}`;
}

function uniqueImages<T extends { id: number }>(images: readonly (T | null)[]): T[] {
  return images.filter(
    (image, index, all): image is T =>
      image !== null && all.findIndex((candidate) => candidate?.id === image.id) === index,
  );
}

export function builderGarmentFromClothingItem(item: ClothingItemSummary): BuilderGarment {
  const displayCandidates = uniqueImages([item.displayImage, item.thumbnailImage]);
  return {
    clothingItemId: item.id,
    clothingItemStatus: 'active',
    clothingItem: {
      id: item.id,
      name: item.name,
      garmentCategory: item.garmentCategory,
      defaultBodyZone: item.defaultBodyZone,
      deletedAt: null,
      primaryImage: item.displayImage,
      displayImage: item.displayImage,
      thumbnailImage: item.thumbnailImage,
      imageCandidates: displayCandidates,
    },
  };
}

export function builderGarmentFromOutfitItem(item: OutfitItem): BuilderGarment {
  return {
    clothingItemId: item.clothingItemId,
    clothingItemStatus: item.clothingItemStatus,
    clothingItem: item.clothingItem,
  };
}

export function cloneOutfitPlacement(placement: OutfitPlacement): OutfitPlacement {
  return {
    ...placement,
    clothingItem: {
      ...placement.clothingItem,
      imageCandidates: [...placement.clothingItem.imageCandidates],
    },
  };
}

export function cloneOutfitBuilderBaseline(baseline: OutfitBuilderBaseline): OutfitBuilderBaseline {
  return {
    name: baseline.name,
    placements: baseline.placements.map((placement) => cloneOutfitPlacement(placement)),
  };
}

export function defaultBodyZoneForGarment(garment: BuilderGarment): BodyZone {
  return (
    garment.clothingItem.defaultBodyZone ??
    defaultBodyZoneByCategory[garment.clothingItem.garmentCategory]
  );
}

export function createDefaultOutfitPlacement(
  garment: BuilderGarment,
  bodyZone = defaultBodyZoneForGarment(garment),
  layerIndex = OUTFIT_LAYER_MIN,
): OutfitPlacement {
  const center = OUTFIT_DEFAULT_CENTER_BY_BODY_ZONE[bodyZone];
  return {
    ...garment,
    key: outfitPlacementKey(garment.clothingItemId),
    bodyZone,
    positionX: center.x,
    positionY: center.y,
    scale: 1,
    rotation: 0,
    layerIndex,
  };
}

export function sortOutfitPlacementsByLayer(
  placements: readonly OutfitPlacement[],
): OutfitPlacement[] {
  return [...placements].sort(
    (left, right) =>
      left.layerIndex - right.layerIndex || left.clothingItemId - right.clothingItemId,
  );
}

export function normalizeOutfitPlacementLayers(
  placements: readonly OutfitPlacement[],
): OutfitPlacement[] {
  return sortOutfitPlacementsByLayer(placements).map((placement, layerIndex) => ({
    ...placement,
    layerIndex,
  }));
}

export function normalizeOutfitPlacementLayersInOrder(
  placements: readonly OutfitPlacement[],
): OutfitPlacement[] {
  return placements.map((placement, layerIndex) => ({ ...placement, layerIndex }));
}

export function defaultLayerRankForPlacement(placement: OutfitPlacement): number {
  return OUTFIT_DEFAULT_LAYER_RANK_BY_CATEGORY[placement.clothingItem.garmentCategory];
}

export function getOutfitPlacementFrame(placement: OutfitPlacement): OutfitPlacementFrame {
  const image =
    placement.clothingItem.displayImage ??
    placement.clothingItem.imageCandidates[0] ??
    placement.clothingItem.primaryImage ??
    placement.clothingItem.thumbnailImage;
  const width =
    OUTFIT_BASE_WIDTH_BY_BODY_ZONE[placement.bodyZone] * OUTFIT_WORKSPACE_WIDTH * placement.scale;
  const aspectRatio = image === null || image === undefined ? 1 : image.height / image.width;
  const height = width * aspectRatio;
  const centerX = placement.positionX * OUTFIT_WORKSPACE_WIDTH;
  const centerY = placement.positionY * OUTFIT_WORKSPACE_HEIGHT;

  return {
    centerX,
    centerY,
    width,
    height,
    left: centerX - width / 2,
    top: centerY - height / 2,
    rotation: placement.rotation,
    layerIndex: placement.layerIndex,
  };
}

export function outfitPlacementFromItem(item: OutfitItem): OutfitPlacement {
  return {
    ...builderGarmentFromOutfitItem(item),
    key: outfitPlacementKey(item.clothingItemId),
    bodyZone: item.bodyZone,
    positionX: item.positionX,
    positionY: item.positionY,
    scale: item.scale,
    rotation: item.rotation,
    layerIndex: item.layerIndex,
  };
}

export function serializeOutfitPlacements(
  placements: readonly OutfitPlacement[],
): OutfitItemWritePayload[] {
  return sortOutfitPlacementsByLayer(placements).map((placement) => ({
    clothing_item_id: placement.clothingItemId,
    body_zone: placement.bodyZone,
    position_x: placement.positionX,
    position_y: placement.positionY,
    scale: placement.scale,
    rotation: placement.rotation,
    layer_index: placement.layerIndex,
  }));
}

function validatedOutfitName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > OUTFIT_NAME_MAX_LENGTH) {
    throw new Error('Outfit name must contain between 1 and 120 characters.');
  }
  return normalized;
}

function assertSavablePlacements(placements: readonly OutfitPlacement[]): void {
  if (placements.length === 0 || placements.length > OUTFIT_MAX_PLACEMENTS) {
    throw new Error('An outfit must contain between 1 and 250 garments.');
  }
}

export function serializeOutfitBuilderCreate(state: OutfitBuilderState): OutfitCreatePayload {
  assertSavablePlacements(state.placements);
  return {
    name: validatedOutfitName(state.name),
    items: serializeOutfitPlacements(state.placements),
  };
}

export function serializeOutfitBuilderUpdate(state: OutfitBuilderState): OutfitUpdatePayload {
  return serializeOutfitBuilderCreate(state);
}

function comparableState(name: string, placements: readonly OutfitPlacement[]) {
  return {
    name,
    items: serializeOutfitPlacements(placements),
  };
}

export function selectOutfitBuilderIsDirty(state: OutfitBuilderState): boolean {
  return (
    JSON.stringify(comparableState(state.name, state.placements)) !==
    JSON.stringify(comparableState(state.baseline.name, state.baseline.placements))
  );
}

export function selectActiveOutfitPlacement(state: OutfitBuilderState): OutfitPlacement | null {
  return state.placements.find((placement) => placement.key === state.activePlacementKey) ?? null;
}

export function outfitBuilderStateFromDetail(
  outfit: OutfitDetail,
  originReturnTo: string | null,
): OutfitBuilderState {
  const placements = normalizeOutfitPlacementLayers(
    outfit.items.map((item) => outfitPlacementFromItem(item)),
  );
  const baseline = {
    name: outfit.name,
    placements: placements.map((placement) => cloneOutfitPlacement(placement)),
  };
  return {
    mode: 'existing',
    outfitId: outfit.id,
    name: outfit.name,
    placements,
    activePlacementKey: placements.at(-1)?.key ?? null,
    originReturnTo,
    baseline,
  };
}
