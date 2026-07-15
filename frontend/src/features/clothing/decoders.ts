import type {
  BodyZone,
  ClothingImage,
  ClothingImageGroup,
  ClothingItemDetail,
  ClothingItemSummary,
  ClothingPage,
  GarmentCategory,
  ImageKind,
  ImageProcessingState,
} from './model';
import { bodyZones, garmentCategories } from './model';
import { decodeSafeLocalMediaUrl } from '../../api/mediaUrl';

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

function nullableString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : string(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be a timestamp.`);
  }
  return result;
}

const imageKinds = ['original', 'normalized', 'thumbnail', 'cutout'] as const;
const processingStates = [
  'not_requested',
  'pending',
  'processing',
  'completed',
  'completed_with_fallback',
  'failed',
] as const;
const mimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function decodeClothingImage(value: unknown, fallbackOrder = 0): ClothingImage {
  const image = record(value, 'image');
  const id = positiveInteger(image.id, 'image.id');
  const rawGroupId = image.image_group_id ?? `legacy-${id}`;
  const imageGroupId =
    typeof rawGroupId === 'number'
      ? String(positiveInteger(rawGroupId, 'image_group_id'))
      : string(rawGroupId, 'image_group_id');

  return {
    id,
    imageGroupId,
    displayOrder: nonnegativeInteger(image.display_order ?? fallbackOrder, 'display_order'),
    imageKind: enumValue<ImageKind>(image.image_kind, imageKinds, 'image_kind'),
    mimeType: enumValue(image.mime_type, mimeTypes, 'mime_type'),
    width: positiveInteger(image.width, 'width'),
    height: positiveInteger(image.height, 'height'),
    byteSize: positiveInteger(image.byte_size, 'byte_size'),
    isPrimary: boolean(image.is_primary, 'is_primary'),
    contentUrl: decodeSafeLocalMediaUrl(image.content_url, 'content_url'),
    createdAt: timestamp(image.created_at, 'created_at'),
    updatedAt: timestamp(image.updated_at, 'updated_at'),
  };
}

function decodeImageGroup(value: unknown, fallbackOrder: number): ClothingImageGroup {
  const group = record(value, 'image_group');
  const rawVariants = group.variants ?? group.images;
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    throw new Error('image_group.variants must be a non-empty array.');
  }
  const variants = rawVariants.map((image) => decodeClothingImage(image, fallbackOrder));
  const rawId = group.image_group_id ?? group.id ?? variants[0]?.imageGroupId;
  if (rawId === undefined) {
    throw new Error('image_group requires an id.');
  }
  const id = typeof rawId === 'number' ? String(rawId) : string(rawId, 'image_group.id');
  return {
    id,
    displayOrder: nonnegativeInteger(group.display_order ?? fallbackOrder, 'display_order'),
    isPrimary:
      group.is_primary === undefined
        ? variants.some((image) => image.isPrimary)
        : boolean(group.is_primary, 'is_primary'),
    variants,
  };
}

function groupFlatImages(images: ClothingImage[]): ClothingImageGroup[] {
  const groups = new Map<string, ClothingImage[]>();
  for (const image of images) {
    const current = groups.get(image.imageGroupId) ?? [];
    current.push(image);
    groups.set(image.imageGroupId, current);
  }
  return [...groups.entries()]
    .map(([id, variants]) => ({
      id,
      displayOrder: Math.min(...variants.map((image) => image.displayOrder)),
      isPrimary: variants.some((image) => image.isPrimary),
      variants,
    }))
    .sort(
      (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
    );
}

function decodeMetadata(item: JsonRecord) {
  const price = item.purchase_price;
  const purchasePrice =
    price === null || price === undefined
      ? null
      : typeof price === 'number' && Number.isFinite(price)
        ? String(price)
        : string(price, 'purchase_price');
  const zone = item.default_body_zone;

  return {
    name: string(item.name, 'name'),
    garmentCategory: enumValue<GarmentCategory>(
      item.garment_category,
      garmentCategories,
      'garment_category',
    ),
    defaultBodyZone:
      zone === null || zone === undefined
        ? null
        : enumValue<BodyZone>(zone, bodyZones, 'default_body_zone'),
    brand: nullableString(item.brand, 'brand'),
    size: nullableString(item.size, 'size'),
    colorName: nullableString(item.color_name, 'color_name'),
    material: nullableString(item.material, 'material'),
    season: nullableString(item.season, 'season'),
    purchasePrice,
    purchaseCurrency: nullableString(item.purchase_currency, 'purchase_currency'),
    purchaseDate: nullableString(item.purchase_date, 'purchase_date'),
    notes: nullableString(item.notes, 'notes'),
  };
}

function decodeSummaryBase(value: unknown): ClothingItemSummary {
  const item = record(value, 'clothing item');
  const fallbackPrimary = item.primary_image;
  const displayImage = item.display_image ?? fallbackPrimary;
  const thumbnailImage = item.thumbnail_image;

  return {
    id: positiveInteger(item.id, 'id'),
    ...decodeMetadata(item),
    imageProcessingState: enumValue<ImageProcessingState>(
      item.image_processing_state ?? 'completed',
      processingStates,
      'image_processing_state',
    ),
    processingErrorCode: nullableString(item.processing_error_code, 'processing_error_code'),
    displayImage:
      displayImage === null || displayImage === undefined
        ? null
        : decodeClothingImage(displayImage),
    thumbnailImage:
      thumbnailImage === null || thumbnailImage === undefined
        ? null
        : decodeClothingImage(thumbnailImage),
    createdAt: timestamp(item.created_at, 'created_at'),
    updatedAt: timestamp(item.updated_at, 'updated_at'),
  };
}

export function decodeClothingSummary(value: unknown): ClothingItemSummary {
  return decodeSummaryBase(value);
}

export function decodeClothingDetail(value: unknown): ClothingItemDetail {
  const item = record(value, 'clothing item');
  let imageGroups: ClothingImageGroup[];

  if (Array.isArray(item.image_groups)) {
    imageGroups = item.image_groups.map((group, index) => decodeImageGroup(group, index));
  } else if (Array.isArray(item.images)) {
    imageGroups = groupFlatImages(
      item.images.map((image, index) => decodeClothingImage(image, index)),
    );
  } else {
    imageGroups = [];
  }

  return {
    ...decodeSummaryBase(value),
    imageGroups: imageGroups.sort(
      (left, right) =>
        Number(right.isPrimary) - Number(left.isPrimary) ||
        left.displayOrder - right.displayOrder ||
        left.id.localeCompare(right.id),
    ),
  };
}

export function decodeClothingPage(value: unknown): ClothingPage {
  const page = record(value, 'clothing page');
  if (!Array.isArray(page.items)) {
    throw new Error('clothing page items must be an array.');
  }
  return {
    items: page.items.map(decodeClothingSummary),
    total: nonnegativeInteger(page.total, 'total'),
    limit: positiveInteger(page.limit, 'limit'),
    offset: nonnegativeInteger(page.offset, 'offset'),
  };
}
