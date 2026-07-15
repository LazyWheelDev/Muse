import { decodeSafeLocalMediaUrl } from '../../api/mediaUrl';
import { decodeClothingImage } from '../clothing/decoders';
import { bodyZones, garmentCategories } from '../clothing/model';
import type { BodyZone, GarmentCategory } from '../clothing/model';
import type {
  ClothingReferenceStatus,
  OutfitClothingReference,
  OutfitDetail,
  OutfitItem,
  OutfitPage,
  OutfitSummary,
} from './model';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function boundedName(value: unknown, label: string): string {
  const result = string(value, label);
  if (result.trim().length === 0 || result.length > 120) {
    throw new Error(`${label} must contain between 1 and 120 characters.`);
  }
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return timestamp(value, label);
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be a timestamp.`);
  }
  return result;
}

function integerInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function numberInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function nullableImage(value: unknown) {
  return value === null ? null : decodeClothingImage(value);
}

function decodeImageCandidates(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('image_candidates must be an array.');
  }
  const candidates = value.map((candidate) => decodeClothingImage(candidate));
  const ids = candidates.map((candidate) => candidate.id);
  const urls = candidates.map((candidate) => candidate.contentUrl);
  if (new Set(ids).size !== ids.length || new Set(urls).size !== urls.length) {
    throw new Error('image_candidates must not contain duplicate images.');
  }
  return candidates;
}

export function decodeOutfitClothingReference(value: unknown): OutfitClothingReference {
  const item = record(value, 'clothing_item');
  const defaultZone = item.default_body_zone;

  return {
    id: integerInRange(item.id, 1, Number.MAX_SAFE_INTEGER, 'clothing_item.id'),
    name: boundedName(item.name, 'clothing_item.name'),
    garmentCategory: enumValue<GarmentCategory>(
      item.garment_category,
      garmentCategories,
      'clothing_item.garment_category',
    ),
    defaultBodyZone:
      defaultZone === null
        ? null
        : enumValue<BodyZone>(defaultZone, bodyZones, 'clothing_item.default_body_zone'),
    deletedAt: nullableTimestamp(item.deleted_at, 'clothing_item.deleted_at'),
    primaryImage: nullableImage(item.primary_image),
    displayImage: nullableImage(item.display_image),
    thumbnailImage: nullableImage(item.thumbnail_image),
    imageCandidates: decodeImageCandidates(item.image_candidates),
  };
}

export function decodeOutfitItem(value: unknown): OutfitItem {
  const item = record(value, 'outfit item');
  const clothingItemId = integerInRange(
    item.clothing_item_id,
    1,
    Number.MAX_SAFE_INTEGER,
    'clothing_item_id',
  );
  const clothingItemStatus = enumValue<ClothingReferenceStatus>(
    item.clothing_item_status,
    ['active', 'deleted'],
    'clothing_item_status',
  );
  const clothingItem = decodeOutfitClothingReference(item.clothing_item);

  if (clothingItem.id !== clothingItemId) {
    throw new Error('clothing_item.id must match clothing_item_id.');
  }
  if ((clothingItem.deletedAt === null) !== (clothingItemStatus === 'active')) {
    throw new Error('clothing_item_status must match clothing_item.deleted_at.');
  }

  return {
    serverItemId: integerInRange(item.id, 1, Number.MAX_SAFE_INTEGER, 'outfit item.id'),
    clothingItemId,
    clothingItemStatus,
    clothingItem,
    bodyZone: enumValue<BodyZone>(item.body_zone, bodyZones, 'body_zone'),
    positionX: numberInRange(item.position_x, 0, 1, 'position_x'),
    positionY: numberInRange(item.position_y, 0, 1, 'position_y'),
    scale: numberInRange(item.scale, 0.1, 4, 'scale'),
    rotation: numberInRange(item.rotation, -180, 180, 'rotation'),
    layerIndex: integerInRange(item.layer_index, 0, 10_000, 'layer_index'),
    createdAt: timestamp(item.created_at, 'created_at'),
    updatedAt: timestamp(item.updated_at, 'updated_at'),
  };
}

function decodePreview(summary: JsonRecord) {
  const previewUrl =
    summary.preview_url === null
      ? null
      : decodeSafeLocalMediaUrl(summary.preview_url, 'preview_url');
  const previewWidth =
    summary.preview_width === null
      ? null
      : integerInRange(summary.preview_width, 1, 10_000, 'preview_width');
  const previewHeight =
    summary.preview_height === null
      ? null
      : integerInRange(summary.preview_height, 1, 10_000, 'preview_height');

  if (
    (previewUrl === null && (previewWidth !== null || previewHeight !== null)) ||
    (previewUrl !== null && (previewWidth === null || previewHeight === null))
  ) {
    throw new Error('preview_url and preview dimensions must be present or absent together.');
  }

  return { previewUrl, previewWidth, previewHeight };
}

export function decodeOutfitSummary(value: unknown): OutfitSummary {
  const summary = record(value, 'outfit');
  return {
    id: integerInRange(summary.id, 1, Number.MAX_SAFE_INTEGER, 'outfit.id'),
    name: boundedName(summary.name, 'outfit.name'),
    itemCount: integerInRange(summary.item_count, 0, 250, 'item_count'),
    ...decodePreview(summary),
    createdAt: timestamp(summary.created_at, 'created_at'),
    updatedAt: timestamp(summary.updated_at, 'updated_at'),
  };
}

export function decodeOutfitDetail(value: unknown): OutfitDetail {
  const detail = record(value, 'outfit');
  const summary = decodeOutfitSummary(detail);
  if (!Array.isArray(detail.items)) {
    throw new Error('outfit.items must be an array.');
  }
  const items = detail.items.map((item) => decodeOutfitItem(item));
  const clothingIds = items.map((item) => item.clothingItemId);
  const layers = items.map((item) => item.layerIndex);

  if (items.length === 0 || items.length > 250) {
    throw new Error('outfit.items must contain between 1 and 250 items.');
  }
  if (new Set(clothingIds).size !== clothingIds.length) {
    throw new Error('outfit.items must not repeat a clothing item.');
  }
  if (new Set(layers).size !== layers.length) {
    throw new Error('outfit.items must use unique layer indexes.');
  }
  if (summary.itemCount !== items.length) {
    throw new Error('item_count must match outfit.items length.');
  }

  return {
    ...summary,
    items: [...items].sort(
      (left, right) =>
        left.layerIndex - right.layerIndex || left.clothingItemId - right.clothingItemId,
    ),
    deletedAt: nullableTimestamp(detail.deleted_at, 'deleted_at'),
  };
}

export function decodeOutfitPage(value: unknown): OutfitPage {
  const page = record(value, 'outfit page');
  if (!Array.isArray(page.items)) {
    throw new Error('outfit page.items must be an array.');
  }
  const limit = integerInRange(page.limit, 1, 100, 'limit');
  const offset = integerInRange(page.offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const total = integerInRange(page.total, 0, Number.MAX_SAFE_INTEGER, 'total');
  const items = page.items.map((item) => decodeOutfitSummary(item));

  if (items.length > limit || (items.length > 0 && offset + items.length > total)) {
    throw new Error('outfit page bounds are inconsistent.');
  }

  return { items, total, limit, offset };
}
