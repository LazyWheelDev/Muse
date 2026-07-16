import { createContext, useContext } from 'react';

import type { BodyZone } from '../clothing/model';
import type { OutfitDetail } from '../outfits/model';
import { selectActiveOutfitPlacement, selectOutfitBuilderIsDirty } from './model';
import type { BuilderGarment, OutfitBuilderState, OutfitPlacement } from './model';
import type { LayerDirection, MoveDirection, ResizeDirection, RotateDirection } from './reducer';

export interface OutfitBuilderActions {
  startNew: (originReturnTo?: string | null) => void;
  hydrate: (outfit: OutfitDetail, originReturnTo?: string | null) => void;
  addGarment: (garment: BuilderGarment, bodyZone?: BodyZone) => void;
  activateGarment: (clothingItemId: number) => void;
  syncGarmentMedia: (garment: BuilderGarment) => void;
  replaceActiveGarment: (garment: BuilderGarment, bodyZone?: BodyZone) => void;
  moveActiveGarment: (direction: MoveDirection) => void;
  moveActiveTo: (positionX: number, positionY: number) => void;
  resizeActiveGarment: (direction: ResizeDirection) => void;
  rotateActiveGarment: (direction: RotateDirection) => void;
  moveActiveLayer: (direction: LayerDirection) => void;
  resetGarment: (clothingItemId?: number) => void;
  removeGarment: (clothingItemId?: number) => void;
  clearGarments: () => void;
  renameOutfit: (name: string) => void;
  markSaved: (outfit: OutfitDetail | number) => void;
  restoreBaseline: () => void;
  setOriginReturn: (originReturnTo: string | null) => void;
}

export interface OutfitBuilderContextValue {
  state: OutfitBuilderState;
  isDirty: boolean;
  activePlacement: OutfitPlacement | null;
  actions: OutfitBuilderActions;
}

export const OutfitBuilderStateContext = createContext<OutfitBuilderState | null>(null);
export const OutfitBuilderActionsContext = createContext<OutfitBuilderActions | null>(null);

export function useOutfitBuilderState(): OutfitBuilderState {
  const state = useContext(OutfitBuilderStateContext);
  if (state === null) {
    throw new Error('useOutfitBuilderState must be used inside OutfitBuilderProvider.');
  }
  return state;
}

export function useOutfitBuilderActions(): OutfitBuilderActions {
  const actions = useContext(OutfitBuilderActionsContext);
  if (actions === null) {
    throw new Error('useOutfitBuilderActions must be used inside OutfitBuilderProvider.');
  }
  return actions;
}

export function useOutfitBuilder(): OutfitBuilderContextValue {
  const state = useOutfitBuilderState();
  const actions = useOutfitBuilderActions();
  return {
    state,
    isDirty: selectOutfitBuilderIsDirty(state),
    activePlacement: selectActiveOutfitPlacement(state),
    actions,
  };
}
