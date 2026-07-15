import { describe, expect, it } from 'vitest';

import {
  rawClothingDetail,
  rawClothingPage,
  rawClothingSummary,
  rawImage,
} from '../../test/clothingFixtures';
import { decodeClothingDetail, decodeClothingPage, decodeClothingSummary } from './decoders';

describe('clothing decoders', () => {
  it('decodes a list summary with terminal not-requested processing', () => {
    expect(decodeClothingPage(rawClothingPage)).toMatchObject({
      total: 1,
      items: [
        {
          id: 1,
          garmentCategory: 'top',
          imageProcessingState: 'not_requested',
          displayImage: { imageKind: 'normalized' },
          thumbnailImage: { imageKind: 'thumbnail' },
        },
      ],
    });
  });

  it('normalizes derivative records into one logical image group', () => {
    const detail = decodeClothingDetail(rawClothingDetail);
    expect(detail.imageGroups).toHaveLength(1);
    expect(detail.imageGroups[0]).toMatchObject({
      id: 'group-1',
      displayOrder: 0,
      variants: [{ imageKind: 'normalized' }, { imageKind: 'thumbnail' }],
    });
  });

  it('groups a legacy flat image list by image_group_id', () => {
    const detail = decodeClothingDetail({ ...rawClothingDetail, image_groups: undefined });
    expect(detail.imageGroups).toHaveLength(1);
    expect(detail.imageGroups[0]?.variants).toHaveLength(2);
  });

  it.each([
    '/api/v1/media/%2e%2e/secret.webp',
    '/api/v1/media/%252e%252e/secret.webp',
    '/api/v1/media/folder%5csecret.webp',
    '/api/v1/media/image.webp?remote=1',
  ])('rejects unsafe media URL %s', (contentUrl) => {
    expect(() =>
      decodeClothingSummary({
        ...rawClothingSummary,
        display_image: { ...rawImage, content_url: contentUrl },
      }),
    ).toThrow(/content_url/u);
  });

  it('rejects unknown image and processing enums', () => {
    expect(() =>
      decodeClothingSummary({ ...rawClothingSummary, image_processing_state: 'pretend_success' }),
    ).toThrow(/image_processing_state/u);
    expect(() =>
      decodeClothingSummary({
        ...rawClothingSummary,
        display_image: { ...rawImage, image_kind: 'processed' },
      }),
    ).toThrow(/image_kind/u);
  });
});
