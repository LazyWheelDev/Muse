import type { BodyZone } from '../clothing/model';
import type { OutfitDetail } from '../outfits/model';
import {
  cloneOutfitBuilderBaseline,
  cloneOutfitPlacement,
  createDefaultOutfitPlacement,
  defaultLayerRankForPlacement,
  normalizeOutfitPlacementLayers,
  normalizeOutfitPlacementLayersInOrder,
  OUTFIT_MAX_PLACEMENTS,
  OUTFIT_MOVE_STEP,
  OUTFIT_NAME_MAX_LENGTH,
  OUTFIT_POSITION_MAX,
  OUTFIT_POSITION_MIN,
  OUTFIT_ROTATION_MAX,
  OUTFIT_ROTATION_MIN,
  OUTFIT_ROTATION_STEP,
  OUTFIT_SCALE_MAX,
  OUTFIT_SCALE_MIN,
  OUTFIT_SCALE_STEP,
  outfitBuilderStateFromDetail,
  outfitPlacementKey,
  selectActiveOutfitPlacement,
  sortOutfitPlacementsByLayer,
} from './model';
import type { BuilderGarment, OutfitBuilderState, OutfitPlacement } from './model';

export type MoveDirection = 'up' | 'down' | 'left' | 'right';
export type ResizeDirection = 'increase' | 'decrease';
export type RotateDirection = 'left' | 'right';
export type LayerDirection = 'forward' | 'backward';

export type OutfitBuilderAction =
  | { type: 'start-new'; originReturnTo: string | null }
  | { type: 'hydrate'; outfit: OutfitDetail; originReturnTo: string | null }
  | { type: 'add'; garment: BuilderGarment; bodyZone?: BodyZone }
  | { type: 'activate'; clothingItemId: number }
  | { type: 'replace'; garment: BuilderGarment; bodyZone?: BodyZone }
  | { type: 'move'; direction: MoveDirection }
  | { type: 'move-to'; positionX: number; positionY: number }
  | { type: 'resize'; direction: ResizeDirection }
  | { type: 'rotate'; direction: RotateDirection }
  | { type: 'move-layer'; direction: LayerDirection }
  | { type: 'reset'; clothingItemId?: number }
  | { type: 'remove'; clothingItemId?: number }
  | { type: 'clear' }
  | { type: 'rename'; name: string }
  | { type: 'mark-saved'; outfitId: number }
  | { type: 'mark-saved-from-detail'; outfit: OutfitDetail }
  | { type: 'restore-baseline' }
  | { type: 'set-origin-return'; originReturnTo: string | null };

export function createInitialOutfitBuilderState(): OutfitBuilderState {
  return {
    mode: 'new',
    outfitId: null,
    name: '',
    placements: [],
    activePlacementKey: null,
    originReturnTo: null,
    baseline: { name: '', placements: [] },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function activeKeyForClothingItem(clothingItemId: number): string | null {
  try {
    return outfitPlacementKey(clothingItemId);
  } catch {
    return null;
  }
}

function insertByDefaultRank(
  placements: readonly OutfitPlacement[],
  placement: OutfitPlacement,
): OutfitPlacement[] {
  const ordered = sortOutfitPlacementsByLayer(placements);
  const newRank = defaultLayerRankForPlacement(placement);
  const insertionIndex = ordered.findIndex(
    (existing) => defaultLayerRankForPlacement(existing) > newRank,
  );
  const next = [...ordered];
  next.splice(insertionIndex === -1 ? next.length : insertionIndex, 0, placement);
  return normalizeOutfitPlacementLayersInOrder(next);
}

function updateActivePlacement(
  state: OutfitBuilderState,
  updater: (placement: OutfitPlacement) => OutfitPlacement,
): OutfitBuilderState {
  if (state.activePlacementKey === null) {
    return state;
  }
  let changed = false;
  const placements = state.placements.map((placement) => {
    if (placement.key !== state.activePlacementKey) {
      return placement;
    }
    const next = updater(placement);
    changed = next !== placement;
    return next;
  });
  return changed ? { ...state, placements } : state;
}

function addGarment(
  state: OutfitBuilderState,
  garment: BuilderGarment,
  bodyZone?: BodyZone,
): OutfitBuilderState {
  const duplicate = state.placements.find(
    (placement) => placement.clothingItemId === garment.clothingItemId,
  );
  if (duplicate !== undefined) {
    return { ...state, activePlacementKey: duplicate.key };
  }
  if (state.placements.length >= OUTFIT_MAX_PLACEMENTS) {
    return state;
  }
  const placement = createDefaultOutfitPlacement(garment, bodyZone);
  return {
    ...state,
    placements: insertByDefaultRank(state.placements, placement),
    activePlacementKey: placement.key,
  };
}

function replaceActiveGarment(
  state: OutfitBuilderState,
  garment: BuilderGarment,
  bodyZone?: BodyZone,
): OutfitBuilderState {
  const active = selectActiveOutfitPlacement(state);
  if (active === null) {
    return addGarment(state, garment, bodyZone);
  }
  const duplicate = state.placements.find(
    (placement) => placement.clothingItemId === garment.clothingItemId,
  );
  if (duplicate !== undefined) {
    return { ...state, activePlacementKey: duplicate.key };
  }
  const replacement: OutfitPlacement = {
    ...active,
    ...garment,
    key: outfitPlacementKey(garment.clothingItemId),
    bodyZone: bodyZone ?? active.bodyZone,
  };
  return {
    ...state,
    placements: state.placements.map((placement) =>
      placement.key === active.key ? replacement : placement,
    ),
    activePlacementKey: replacement.key,
  };
}

function moveLayer(state: OutfitBuilderState, direction: LayerDirection): OutfitBuilderState {
  if (state.activePlacementKey === null) {
    return state;
  }
  const ordered = normalizeOutfitPlacementLayers(state.placements);
  const activeIndex = ordered.findIndex((placement) => placement.key === state.activePlacementKey);
  const targetIndex = direction === 'forward' ? activeIndex + 1 : activeIndex - 1;
  if (activeIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
    return state;
  }
  const next = [...ordered];
  const active = next[activeIndex];
  const target = next[targetIndex];
  if (active === undefined || target === undefined) {
    return state;
  }
  next[activeIndex] = target;
  next[targetIndex] = active;
  return { ...state, placements: normalizeOutfitPlacementLayersInOrder(next) };
}

function resetPlacement(state: OutfitBuilderState, clothingItemId?: number): OutfitBuilderState {
  const key =
    clothingItemId === undefined
      ? state.activePlacementKey
      : activeKeyForClothingItem(clothingItemId);
  if (key === null) {
    return state;
  }
  const placement = state.placements.find((candidate) => candidate.key === key);
  if (placement === undefined) {
    return state;
  }
  const reset = createDefaultOutfitPlacement(
    {
      clothingItemId: placement.clothingItemId,
      clothingItemStatus: placement.clothingItemStatus,
      clothingItem: placement.clothingItem,
    },
    placement.bodyZone,
  );
  const remaining = state.placements.filter((candidate) => candidate.key !== key);
  return {
    ...state,
    placements: insertByDefaultRank(remaining, reset),
    activePlacementKey: reset.key,
  };
}

function removePlacement(state: OutfitBuilderState, clothingItemId?: number): OutfitBuilderState {
  const key =
    clothingItemId === undefined
      ? state.activePlacementKey
      : activeKeyForClothingItem(clothingItemId);
  if (key === null || !state.placements.some((placement) => placement.key === key)) {
    return state;
  }
  const placements = normalizeOutfitPlacementLayers(
    state.placements.filter((placement) => placement.key !== key),
  );
  return {
    ...state,
    placements,
    activePlacementKey:
      state.activePlacementKey === key
        ? (placements.at(-1)?.key ?? null)
        : state.activePlacementKey,
  };
}

export function outfitBuilderReducer(
  state: OutfitBuilderState,
  action: OutfitBuilderAction,
): OutfitBuilderState {
  switch (action.type) {
    case 'start-new':
      return { ...createInitialOutfitBuilderState(), originReturnTo: action.originReturnTo };
    case 'hydrate':
      return outfitBuilderStateFromDetail(action.outfit, action.originReturnTo);
    case 'add':
      return addGarment(state, action.garment, action.bodyZone);
    case 'activate': {
      const key = activeKeyForClothingItem(action.clothingItemId);
      return key !== null && state.placements.some((placement) => placement.key === key)
        ? { ...state, activePlacementKey: key }
        : state;
    }
    case 'replace':
      return replaceActiveGarment(state, action.garment, action.bodyZone);
    case 'move':
      return updateActivePlacement(state, (placement) => {
        const xDelta =
          action.direction === 'left'
            ? -OUTFIT_MOVE_STEP
            : action.direction === 'right'
              ? OUTFIT_MOVE_STEP
              : 0;
        const yDelta =
          action.direction === 'up'
            ? -OUTFIT_MOVE_STEP
            : action.direction === 'down'
              ? OUTFIT_MOVE_STEP
              : 0;
        const positionX = rounded(
          clamp(placement.positionX + xDelta, OUTFIT_POSITION_MIN, OUTFIT_POSITION_MAX),
        );
        const positionY = rounded(
          clamp(placement.positionY + yDelta, OUTFIT_POSITION_MIN, OUTFIT_POSITION_MAX),
        );
        return positionX === placement.positionX && positionY === placement.positionY
          ? placement
          : { ...placement, positionX, positionY };
      });
    case 'move-to':
      return updateActivePlacement(state, (placement) => {
        if (!Number.isFinite(action.positionX) || !Number.isFinite(action.positionY)) {
          return placement;
        }
        const positionX = rounded(
          clamp(action.positionX, OUTFIT_POSITION_MIN, OUTFIT_POSITION_MAX),
        );
        const positionY = rounded(
          clamp(action.positionY, OUTFIT_POSITION_MIN, OUTFIT_POSITION_MAX),
        );
        return positionX === placement.positionX && positionY === placement.positionY
          ? placement
          : { ...placement, positionX, positionY };
      });
    case 'resize':
      return updateActivePlacement(state, (placement) => {
        const delta = action.direction === 'increase' ? OUTFIT_SCALE_STEP : -OUTFIT_SCALE_STEP;
        const scale = rounded(clamp(placement.scale + delta, OUTFIT_SCALE_MIN, OUTFIT_SCALE_MAX));
        return scale === placement.scale ? placement : { ...placement, scale };
      });
    case 'rotate':
      return updateActivePlacement(state, (placement) => {
        const delta = action.direction === 'right' ? OUTFIT_ROTATION_STEP : -OUTFIT_ROTATION_STEP;
        const rotation = rounded(
          clamp(placement.rotation + delta, OUTFIT_ROTATION_MIN, OUTFIT_ROTATION_MAX),
        );
        return rotation === placement.rotation ? placement : { ...placement, rotation };
      });
    case 'move-layer':
      return moveLayer(state, action.direction);
    case 'reset':
      return resetPlacement(state, action.clothingItemId);
    case 'remove':
      return removePlacement(state, action.clothingItemId);
    case 'clear':
      return state.placements.length === 0
        ? state
        : { ...state, placements: [], activePlacementKey: null };
    case 'rename': {
      const name = action.name.slice(0, OUTFIT_NAME_MAX_LENGTH);
      return name === state.name ? state : { ...state, name };
    }
    case 'mark-saved': {
      if (!Number.isSafeInteger(action.outfitId) || action.outfitId <= 0) {
        return state;
      }
      return {
        ...state,
        mode: 'existing',
        outfitId: action.outfitId,
        baseline: {
          name: state.name,
          placements: state.placements.map((placement) => cloneOutfitPlacement(placement)),
        },
      };
    }
    case 'mark-saved-from-detail': {
      const hydrated = outfitBuilderStateFromDetail(action.outfit, state.originReturnTo);
      const activeStillExists = hydrated.placements.some(
        (placement) => placement.key === state.activePlacementKey,
      );
      return {
        ...hydrated,
        activePlacementKey: activeStillExists
          ? state.activePlacementKey
          : hydrated.activePlacementKey,
      };
    }
    case 'restore-baseline': {
      const baseline = cloneOutfitBuilderBaseline(state.baseline);
      const activeStillExists = baseline.placements.some(
        (placement) => placement.key === state.activePlacementKey,
      );
      return {
        ...state,
        name: baseline.name,
        placements: baseline.placements,
        activePlacementKey: activeStillExists
          ? state.activePlacementKey
          : (baseline.placements.at(-1)?.key ?? null),
      };
    }
    case 'set-origin-return':
      return action.originReturnTo === state.originReturnTo
        ? state
        : { ...state, originReturnTo: action.originReturnTo };
  }
}

export const outfitBuilderAction = {
  startNew: (originReturnTo: string | null): OutfitBuilderAction => ({
    type: 'start-new',
    originReturnTo,
  }),
  hydrate: (outfit: OutfitDetail, originReturnTo: string | null): OutfitBuilderAction => ({
    type: 'hydrate',
    outfit,
    originReturnTo,
  }),
  add: (garment: BuilderGarment, bodyZone?: BodyZone): OutfitBuilderAction => ({
    type: 'add',
    garment,
    ...(bodyZone === undefined ? {} : { bodyZone }),
  }),
  activate: (clothingItemId: number): OutfitBuilderAction => ({
    type: 'activate',
    clothingItemId,
  }),
  replace: (garment: BuilderGarment, bodyZone?: BodyZone): OutfitBuilderAction => ({
    type: 'replace',
    garment,
    ...(bodyZone === undefined ? {} : { bodyZone }),
  }),
  move: (direction: MoveDirection): OutfitBuilderAction => ({ type: 'move', direction }),
  moveTo: (positionX: number, positionY: number): OutfitBuilderAction => ({
    type: 'move-to',
    positionX,
    positionY,
  }),
  resize: (direction: ResizeDirection): OutfitBuilderAction => ({ type: 'resize', direction }),
  rotate: (direction: RotateDirection): OutfitBuilderAction => ({ type: 'rotate', direction }),
  moveLayer: (direction: LayerDirection): OutfitBuilderAction => ({
    type: 'move-layer',
    direction,
  }),
  reset: (clothingItemId?: number): OutfitBuilderAction => ({
    type: 'reset',
    ...(clothingItemId === undefined ? {} : { clothingItemId }),
  }),
  remove: (clothingItemId?: number): OutfitBuilderAction => ({
    type: 'remove',
    ...(clothingItemId === undefined ? {} : { clothingItemId }),
  }),
  clear: (): OutfitBuilderAction => ({ type: 'clear' }),
  rename: (name: string): OutfitBuilderAction => ({ type: 'rename', name }),
  markSaved: (outfitId: number): OutfitBuilderAction => ({ type: 'mark-saved', outfitId }),
  markSavedFromDetail: (outfit: OutfitDetail): OutfitBuilderAction => ({
    type: 'mark-saved-from-detail',
    outfit,
  }),
  restoreBaseline: (): OutfitBuilderAction => ({ type: 'restore-baseline' }),
  setOriginReturn: (originReturnTo: string | null): OutfitBuilderAction => ({
    type: 'set-origin-return',
    originReturnTo,
  }),
};
