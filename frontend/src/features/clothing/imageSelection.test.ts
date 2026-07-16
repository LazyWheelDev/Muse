import { describe, expect, it } from 'vitest';

import { decodeClothingDetail } from './decoders';
import {
  garmentVisualCandidates,
  groupDisplayCandidates,
  selectGarmentVisualSource,
  selectGroupDisplayImage,
  selectGroupThumbnail,
} from './imageSelection';
import { rawClothingDetail, rawImage, rawThumbnail } from '../../test/clothingFixtures';

describe('image selection', () => {
  const detail = decodeClothingDetail({
    ...rawClothingDetail,
    images: [
      {
        ...rawImage,
        id: 12,
        image_kind: 'original',
        content_url: '/api/v1/media/originals/a.jpg',
      },
      rawImage,
      rawThumbnail,
      { ...rawImage, id: 13, image_kind: 'cutout', content_url: '/api/v1/media/cutouts/a.webp' },
    ],
    image_groups: undefined,
  });
  const group = detail.imageGroups[0];
  if (group === undefined) {
    throw new Error('The image selection fixture requires one image group.');
  }
  const cutout = group.variants.find((image) => image.imageKind === 'cutout');
  const normalized = group.variants.find((image) => image.imageKind === 'normalized');
  const original = group.variants.find((image) => image.imageKind === 'original');

  it('selects an available cutout before every other garment visual source', () => {
    expect(selectGarmentVisualSource([original, normalized, cutout])).toBe(cutout);
  });

  it('selects normalized media when a cutout is unavailable', () => {
    expect(selectGarmentVisualSource([original, undefined, normalized])).toBe(normalized);
  });

  it('selects original media when it is the only available visual source', () => {
    expect(selectGarmentVisualSource([null, original])).toBe(original);
  });

  it('ignores invalid or missing optional visual media without inventing a source', () => {
    expect(selectGarmentVisualSource(undefined)).toBeNull();
    expect(selectGarmentVisualSource([null, undefined, detail.thumbnailImage])).toBeNull();
    expect(garmentVisualCandidates(null)).toEqual([]);
  });

  it('prefers cutout for display and thumbnail for grids', () => {
    expect(selectGroupDisplayImage(group)?.imageKind).toBe('cutout');
    expect(selectGroupThumbnail(group)?.imageKind).toBe('thumbnail');
    expect(groupDisplayCandidates(group).map((image) => image.imageKind)).toEqual([
      'cutout',
      'normalized',
      'original',
      'thumbnail',
    ]);
  });

  it('falls back from normalized to original without inventing an image', () => {
    const detail = decodeClothingDetail({
      ...rawClothingDetail,
      images: [
        { ...rawImage, image_kind: 'original', content_url: '/api/v1/media/originals/a.jpg' },
      ],
      image_groups: undefined,
    });
    expect(selectGroupDisplayImage(detail.imageGroups[0]!)?.imageKind).toBe('original');
  });
});
