import type { BodyZone, ClothingImage } from '../../features/clothing/model';

export interface WorkspacePlacement {
  clientId: string;
  name: string;
  bodyZone: BodyZone;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  layerIndex: number;
  imageCandidates: readonly ClothingImage[];
  deleted: boolean;
}
