import type { ClothingImage, GarmentCategory, BodyZone } from '../clothing/model';

export type ClothingReferenceStatus = 'active' | 'deleted';

export interface OutfitClothingReference {
  id: number;
  name: string;
  garmentCategory: GarmentCategory;
  defaultBodyZone: BodyZone | null;
  deletedAt: string | null;
  primaryImage: ClothingImage | null;
  displayImage: ClothingImage | null;
  thumbnailImage: ClothingImage | null;
  imageCandidates: ClothingImage[];
}

export interface OutfitItem {
  serverItemId: number;
  clothingItemId: number;
  clothingItemStatus: ClothingReferenceStatus;
  clothingItem: OutfitClothingReference;
  bodyZone: BodyZone;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  layerIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutfitSummary {
  id: number;
  name: string;
  itemCount: number;
  previewUrl: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutfitDetail extends OutfitSummary {
  items: OutfitItem[];
  deletedAt: string | null;
}

export interface OutfitPage {
  items: OutfitSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface OutfitItemWritePayload {
  clothing_item_id: number;
  body_zone: BodyZone;
  position_x: number;
  position_y: number;
  scale: number;
  rotation: number;
  layer_index: number;
}

export interface OutfitCreatePayload {
  name: string;
  items: OutfitItemWritePayload[];
}

export interface OutfitUpdatePayload {
  name?: string;
  items?: OutfitItemWritePayload[];
}

export interface OutfitListOptions {
  limit?: number;
  offset?: number;
}
