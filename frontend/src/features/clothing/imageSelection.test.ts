import { describe, expect, it } from 'vitest';

import { decodeClothingDetail } from './decoders';
import {
  groupDisplayCandidates,
  selectGroupDisplayImage,
  selectGroupThumbnail,
} from './imageSelection';
import { rawClothingDetail, rawImage, rawThumbnail } from '../../test/clothingFixtures';

describe('image selection', () => {
  it('prefers cutout for display and thumbnail for grids', () => {
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
    expect(group).toBeDefined();
    expect(selectGroupDisplayImage(group!)?.imageKind).toBe('cutout');
    expect(selectGroupThumbnail(group!)?.imageKind).toBe('thumbnail');
    expect(groupDisplayCandidates(group!).map((image) => image.imageKind)).toEqual([
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
