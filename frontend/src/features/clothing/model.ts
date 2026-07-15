export const garmentCategories = [
  'hat',
  'scarf',
  'top',
  'dress',
  'pants',
  'shoes',
  'outerwear',
  'accessory',
  'other',
] as const;

export type GarmentCategory = (typeof garmentCategories)[number];

export const bodyZones = [
  'head',
  'neck',
  'upper_body',
  'full_body',
  'lower_body',
  'feet',
  'accessory',
] as const;

export type BodyZone = (typeof bodyZones)[number];

export type ImageKind = 'original' | 'normalized' | 'thumbnail' | 'cutout';

export type ImageProcessingState =
  'not_requested' | 'pending' | 'processing' | 'completed' | 'completed_with_fallback' | 'failed';

export interface ClothingImage {
  id: number;
  imageGroupId: string;
  displayOrder: number;
  imageKind: ImageKind;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  byteSize: number;
  isPrimary: boolean;
  contentUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClothingImageGroup {
  id: string;
  displayOrder: number;
  isPrimary: boolean;
  variants: ClothingImage[];
}

export interface ClothingMetadata {
  name: string;
  garmentCategory: GarmentCategory;
  defaultBodyZone: BodyZone | null;
  brand: string | null;
  size: string | null;
  colorName: string | null;
  material: string | null;
  season: string | null;
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  purchaseDate: string | null;
  notes: string | null;
}

export interface ClothingItemSummary extends ClothingMetadata {
  id: number;
  imageProcessingState: ImageProcessingState;
  processingErrorCode: string | null;
  displayImage: ClothingImage | null;
  thumbnailImage: ClothingImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClothingItemDetail extends ClothingItemSummary {
  imageGroups: ClothingImageGroup[];
}

export interface ClothingPage {
  items: ClothingItemSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClothingWritePayload {
  name: string;
  garment_category: GarmentCategory;
  default_body_zone: BodyZone | null;
  brand: string | null;
  size: string | null;
  color_name: string | null;
  material: string | null;
  season: string | null;
  purchase_price: string | null;
  purchase_currency: string | null;
  purchase_date: string | null;
  notes: string | null;
}

export type ClothingUpdatePayload = Partial<ClothingWritePayload>;

export const categoryLabels: Record<GarmentCategory, string> = {
  hat: 'Hat',
  scarf: 'Scarf',
  top: 'Shirt',
  dress: 'Dress',
  pants: 'Pants',
  shoes: 'Shoes',
  outerwear: 'Outerwear',
  accessory: 'Accessories',
  other: 'Other',
};

export const bodyZoneLabels: Record<BodyZone, string> = {
  head: 'Head',
  neck: 'Neck',
  upper_body: 'Upper body',
  full_body: 'Full body',
  lower_body: 'Lower body',
  feet: 'Feet',
  accessory: 'Accessory',
};

export const defaultBodyZoneByCategory: Record<GarmentCategory, BodyZone> = {
  hat: 'head',
  scarf: 'neck',
  top: 'upper_body',
  dress: 'full_body',
  pants: 'lower_body',
  shoes: 'feet',
  outerwear: 'upper_body',
  accessory: 'accessory',
  other: 'accessory',
};
