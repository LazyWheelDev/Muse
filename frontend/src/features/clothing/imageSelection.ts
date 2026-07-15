import type { ClothingImage, ClothingImageGroup, ClothingItemSummary, ImageKind } from './model';

const largePreference: readonly ImageKind[] = ['cutout', 'normalized', 'original', 'thumbnail'];
const thumbnailPreference: readonly ImageKind[] = ['thumbnail', 'cutout', 'normalized', 'original'];

function selectByPreference(
  images: readonly ClothingImage[],
  preference: readonly ImageKind[],
): ClothingImage | null {
  for (const imageKind of preference) {
    const match = images.find((image) => image.imageKind === imageKind);
    if (match !== undefined) {
      return match;
    }
  }
  return null;
}

function orderByPreference(
  images: readonly ClothingImage[],
  preference: readonly ImageKind[],
): ClothingImage[] {
  return preference.flatMap((kind) => images.filter((image) => image.imageKind === kind));
}

export function selectGroupDisplayImage(group: ClothingImageGroup): ClothingImage | null {
  return selectByPreference(group.variants, largePreference);
}

export function groupDisplayCandidates(group: ClothingImageGroup): ClothingImage[] {
  return orderByPreference(group.variants, largePreference);
}

export function selectGroupThumbnail(group: ClothingImageGroup): ClothingImage | null {
  return selectByPreference(group.variants, thumbnailPreference);
}

export function selectSummaryDisplayImage(item: ClothingItemSummary): ClothingImage | null {
  return item.displayImage ?? item.thumbnailImage;
}

export function selectSummaryThumbnail(item: ClothingItemSummary): ClothingImage | null {
  return item.thumbnailImage ?? item.displayImage;
}
