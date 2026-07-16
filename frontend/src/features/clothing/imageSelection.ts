import type { ClothingImage, ClothingImageGroup, ClothingItemSummary, ImageKind } from './model';

type OptionalClothingImage = ClothingImage | null | undefined;

const visualPreference: readonly ImageKind[] = ['cutout', 'normalized', 'original'];
const thumbnailPreference: readonly ImageKind[] = ['thumbnail', 'cutout', 'normalized', 'original'];

function selectByPreference(
  images: readonly OptionalClothingImage[] | null | undefined,
  preference: readonly ImageKind[],
): ClothingImage | null {
  if (images === null || images === undefined) {
    return null;
  }
  for (const imageKind of preference) {
    const match = images.find((image) => image?.imageKind === imageKind);
    if (match !== undefined) {
      return match ?? null;
    }
  }
  return null;
}

function orderByPreference(
  images: readonly OptionalClothingImage[] | null | undefined,
  preference: readonly ImageKind[],
): ClothingImage[] {
  if (images === null || images === undefined) {
    return [];
  }
  const ordered = preference.flatMap((kind) =>
    images.filter((image): image is ClothingImage => image?.imageKind === kind),
  );
  return ordered.filter(
    (image, index, all) =>
      all.findIndex((candidate) => candidate.contentUrl === image.contentUrl) === index,
  );
}

export function selectGarmentVisualSource(
  images: readonly OptionalClothingImage[] | null | undefined,
): ClothingImage | null {
  return selectByPreference(images, visualPreference);
}

export function garmentVisualCandidates(
  images: readonly OptionalClothingImage[] | null | undefined,
): ClothingImage[] {
  return orderByPreference(images, visualPreference);
}

export function selectGroupDisplayImage(group: ClothingImageGroup): ClothingImage | null {
  return selectGarmentVisualSource(group.variants);
}

export function groupDisplayCandidates(group: ClothingImageGroup): ClothingImage[] {
  return [
    ...garmentVisualCandidates(group.variants),
    ...orderByPreference(group.variants, ['thumbnail']),
  ];
}

export function selectGroupThumbnail(group: ClothingImageGroup): ClothingImage | null {
  return selectByPreference(group.variants, thumbnailPreference);
}

export function selectSummaryDisplayImage(item: ClothingItemSummary): ClothingImage | null {
  return selectGarmentVisualSource([item.displayImage]) ?? item.thumbnailImage;
}

export function selectSummaryThumbnail(item: ClothingItemSummary): ClothingImage | null {
  return item.thumbnailImage ?? item.displayImage;
}
