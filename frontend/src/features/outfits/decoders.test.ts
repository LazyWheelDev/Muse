import { describe, expect, it } from 'vitest';

import { rawImage, rawThumbnail } from '../../test/clothingFixtures';
import {
  rawOutfitClothingReference,
  rawOutfitDetail,
  rawOutfitItem,
  rawOutfitPage,
  rawOutfitSummary,
} from '../../test/outfitFixtures';
import {
  decodeOutfitClothingReference,
  decodeOutfitDetail,
  decodeOutfitPage,
  decodeOutfitSummary,
} from './decoders';

describe('outfit response decoders', () => {
  it('decodes preview dimensions and complete local clothing image fallbacks', () => {
    const summary = decodeOutfitSummary(rawOutfitSummary);
    const reference = decodeOutfitClothingReference(rawOutfitClothingReference);

    expect(summary).toMatchObject({
      id: 20,
      name: 'Summer Look',
      itemCount: 1,
      previewUrl: '/api/v1/media/outfits/previews/outfit-20.webp',
      previewWidth: 600,
      previewHeight: 750,
    });
    expect(reference).toMatchObject({
      defaultBodyZone: 'upper_body',
      garmentCategory: 'top',
      deletedAt: null,
    });
    expect(reference.imageCandidates.map((image) => image.imageKind)).toEqual(['normalized']);
    expect(reference.displayImage?.contentUrl).toBe(rawImage.content_url);
    expect(reference.thumbnailImage?.contentUrl).toBe(rawThumbnail.content_url);
  });

  it('decodes a detail deterministically and retains a deleted garment reference', () => {
    const deletedReference = {
      ...rawOutfitClothingReference,
      deleted_at: '2026-07-16T12:00:00Z',
    };
    const secondItem = {
      ...rawOutfitItem,
      id: 102,
      clothing_item_id: 2,
      clothing_item_status: 'deleted',
      clothing_item: { ...deletedReference, id: 2, name: 'Archived Jacket' },
      body_zone: 'upper_body',
      layer_index: 8,
    };
    const detail = decodeOutfitDetail({
      ...rawOutfitDetail,
      item_count: 2,
      items: [secondItem, { ...rawOutfitItem, layer_index: 3 }],
    });

    expect(detail.items.map((item) => item.clothingItemId)).toEqual([1, 2]);
    expect(detail.items[1]).toMatchObject({
      clothingItemStatus: 'deleted',
      bodyZone: 'upper_body',
    });
    expect(detail.items[1]?.clothingItem.deletedAt).not.toBeNull();
  });

  it('accepts an outfit without a preview only when both dimensions are also absent', () => {
    expect(
      decodeOutfitSummary({
        ...rawOutfitSummary,
        preview_url: null,
        preview_width: null,
        preview_height: null,
      }),
    ).toMatchObject({ previewUrl: null, previewWidth: null, previewHeight: null });

    expect(() =>
      decodeOutfitSummary({ ...rawOutfitSummary, preview_url: null, preview_width: 600 }),
    ).toThrow(/present or absent together/u);
    expect(() => decodeOutfitSummary({ ...rawOutfitSummary, preview_height: null })).toThrow(
      /present or absent together/u,
    );
  });

  it.each([
    'https://example.com/outfit.webp',
    '/api/v1/media/../secrets.db',
    '/api/v1/media/%252e%252e/secrets.db',
    '/api/v1/media/outfit.webp?token=remote',
    '/api/v1/media/outfit.webp#fragment',
  ])('rejects unsafe preview URL %s', (previewUrl) => {
    expect(() => decodeOutfitSummary({ ...rawOutfitSummary, preview_url: previewUrl })).toThrow(
      /media|path|encoding/u,
    );
  });

  it('rejects an unsafe or duplicate image candidate at the response boundary', () => {
    expect(() =>
      decodeOutfitClothingReference({
        ...rawOutfitClothingReference,
        image_candidates: [{ ...rawImage, content_url: '/api/v1/media/%252e%252e/private.webp' }],
      }),
    ).toThrow(/unsafe path/u);

    expect(() =>
      decodeOutfitClothingReference({
        ...rawOutfitClothingReference,
        image_candidates: [rawImage, rawImage],
      }),
    ).toThrow(/duplicate/u);
  });

  it('rejects conflicting references, duplicate garments, and duplicate layers', () => {
    expect(() =>
      decodeOutfitDetail({
        ...rawOutfitDetail,
        items: [{ ...rawOutfitItem, clothing_item_id: 99 }],
      }),
    ).toThrow(/must match/u);

    const duplicate = { ...rawOutfitItem, id: 102 };
    expect(() =>
      decodeOutfitDetail({ ...rawOutfitDetail, item_count: 2, items: [rawOutfitItem, duplicate] }),
    ).toThrow(/repeat a clothing item|unique layer/u);
  });

  it('strictly decodes pagination bounds', () => {
    expect(decodeOutfitPage(rawOutfitPage)).toMatchObject({ total: 1, limit: 24, offset: 0 });
    expect(decodeOutfitPage({ ...rawOutfitPage, items: [], total: 1, offset: 100 })).toMatchObject({
      items: [],
      total: 1,
      offset: 100,
    });
    expect(() => decodeOutfitPage({ ...rawOutfitPage, total: 0 })).toThrow(/bounds/u);
    expect(() => decodeOutfitPage({ ...rawOutfitPage, limit: 101 })).toThrow(/between/u);
  });
});
