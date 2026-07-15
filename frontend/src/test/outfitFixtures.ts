import { rawImage, rawThumbnail } from './clothingFixtures';

export const rawOutfitClothingReference = {
  id: 1,
  name: 'Linen Shirt',
  garment_category: 'top',
  default_body_zone: 'upper_body',
  deleted_at: null,
  primary_image: rawImage,
  display_image: rawImage,
  thumbnail_image: rawThumbnail,
  image_candidates: [rawImage],
} as const;

export const rawOutfitItem = {
  id: 101,
  clothing_item_id: 1,
  clothing_item_status: 'active',
  clothing_item: rawOutfitClothingReference,
  body_zone: 'upper_body',
  position_x: 0.5,
  position_y: 0.37,
  scale: 1,
  rotation: 0,
  layer_index: 0,
  created_at: '2026-07-15T12:00:00Z',
  updated_at: '2026-07-15T12:00:00Z',
} as const;

export const rawOutfitSummary = {
  id: 20,
  name: 'Summer Look',
  item_count: 1,
  preview_url: '/api/v1/media/outfits/previews/outfit-20.webp',
  preview_width: 600,
  preview_height: 750,
  created_at: '2026-07-15T12:00:00Z',
  updated_at: '2026-07-15T12:00:00Z',
} as const;

export const rawOutfitDetail = {
  ...rawOutfitSummary,
  items: [rawOutfitItem],
  deleted_at: null,
} as const;

export const rawOutfitPage = {
  items: [rawOutfitSummary],
  total: 1,
  limit: 24,
  offset: 0,
} as const;
