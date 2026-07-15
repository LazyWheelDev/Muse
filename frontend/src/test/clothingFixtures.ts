export const rawImage = {
  id: 10,
  image_group_id: 'group-1',
  display_order: 0,
  image_kind: 'normalized',
  mime_type: 'image/webp',
  width: 900,
  height: 900,
  byte_size: 40_000,
  is_primary: true,
  content_url: '/api/v1/media/normalized/group-1.webp',
  created_at: '2026-07-15T12:00:00Z',
  updated_at: '2026-07-15T12:00:00Z',
} as const;

export const rawThumbnail = {
  ...rawImage,
  id: 11,
  image_kind: 'thumbnail',
  width: 320,
  height: 320,
  byte_size: 8_000,
  is_primary: false,
  content_url: '/api/v1/media/thumbnails/group-1.webp',
} as const;

export const rawClothingSummary = {
  id: 1,
  name: 'Linen Shirt',
  garment_category: 'top',
  default_body_zone: 'upper_body',
  brand: 'Muse Studio',
  size: 'M',
  color_name: 'Beige',
  material: '100% Linen',
  season: 'Spring / Summer',
  purchase_price: '39.99',
  purchase_currency: 'EUR',
  purchase_date: '2026-07-01',
  notes: 'Wear with light trousers.',
  image_processing_state: 'not_requested',
  processing_error_code: null,
  primary_image: rawImage,
  display_image: rawImage,
  thumbnail_image: rawThumbnail,
  created_at: '2026-07-15T12:00:00Z',
  updated_at: '2026-07-15T12:00:00Z',
} as const;

export const rawClothingDetail = {
  ...rawClothingSummary,
  images: [rawImage, rawThumbnail],
  image_groups: [
    {
      image_group_id: 'group-1',
      display_order: 0,
      display_image: rawImage,
      thumbnail_image: rawThumbnail,
      original_image: null,
      images: [rawImage, rawThumbnail],
    },
  ],
} as const;

export const rawClothingPage = {
  items: [rawClothingSummary],
  total: 1,
  limit: 100,
  offset: 0,
} as const;

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
