import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { decodeClothingDetail } from '../../features/clothing/decoders';
import { rawClothingDetail, rawImage } from '../../test/clothingFixtures';
import { GarmentImage } from './GarmentImage';

describe('GarmentImage', () => {
  it('tries the next safe derivative before showing a placeholder', () => {
    const detail = decodeClothingDetail({
      ...rawClothingDetail,
      images: [
        { ...rawImage, id: 12, image_kind: 'cutout', content_url: '/api/v1/media/cutouts/a.webp' },
        rawImage,
      ],
      image_groups: undefined,
    });
    const [cutout, normalized] = detail.imageGroups[0]!.variants;
    render(<GarmentImage image={cutout!} fallbackImages={[normalized!]} alt="Linen Shirt" />);

    const image = screen.getByRole('img', { name: 'Linen Shirt' });
    expect(image).toHaveAttribute('src', '/api/v1/media/cutouts/a.webp');
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Linen Shirt' })).toHaveAttribute(
      'src',
      '/api/v1/media/normalized/group-1.webp',
    );
  });
});
