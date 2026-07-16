import { useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import { OutfitBuilderActionsContext, OutfitBuilderStateContext } from './context';
import type { OutfitBuilderActions } from './context';
import {
  createInitialOutfitBuilderState,
  outfitBuilderAction,
  outfitBuilderReducer,
} from './reducer';
import {
  getBrowserSessionStorage,
  loadOutfitBuilderSession,
  normalizeOutfitBuilderOriginReturn,
  persistOutfitBuilderSession,
} from './session';
import type { OutfitBuilderState } from './model';

interface OutfitBuilderProviderProps {
  children: ReactNode;
  storage?: Storage | null;
}

export function OutfitBuilderProvider({
  children,
  storage: configuredStorage,
}: OutfitBuilderProviderProps) {
  const storage = useMemo(
    () => (configuredStorage === undefined ? getBrowserSessionStorage() : configuredStorage),
    [configuredStorage],
  );
  const [state, dispatch] = useReducer(
    outfitBuilderReducer,
    storage,
    (activeStorage): OutfitBuilderState =>
      activeStorage === null
        ? createInitialOutfitBuilderState()
        : (loadOutfitBuilderSession(activeStorage) ?? createInitialOutfitBuilderState()),
  );

  useEffect(() => {
    if (storage !== null) {
      persistOutfitBuilderSession(storage, state);
    }
  }, [state, storage]);

  const actions = useMemo<OutfitBuilderActions>(
    () => ({
      startNew(originReturnTo = null) {
        dispatch(outfitBuilderAction.startNew(normalizeOutfitBuilderOriginReturn(originReturnTo)));
      },
      hydrate(outfit, originReturnTo = null) {
        dispatch(
          outfitBuilderAction.hydrate(outfit, normalizeOutfitBuilderOriginReturn(originReturnTo)),
        );
      },
      addGarment(garment, bodyZone) {
        dispatch(outfitBuilderAction.add(garment, bodyZone));
      },
      activateGarment(clothingItemId) {
        dispatch(outfitBuilderAction.activate(clothingItemId));
      },
      syncGarmentMedia(garment) {
        dispatch(outfitBuilderAction.syncMedia(garment));
      },
      replaceActiveGarment(garment, bodyZone) {
        dispatch(outfitBuilderAction.replace(garment, bodyZone));
      },
      moveActiveGarment(direction) {
        dispatch(outfitBuilderAction.move(direction));
      },
      moveActiveTo(positionX, positionY) {
        dispatch(outfitBuilderAction.moveTo(positionX, positionY));
      },
      resizeActiveGarment(direction) {
        dispatch(outfitBuilderAction.resize(direction));
      },
      rotateActiveGarment(direction) {
        dispatch(outfitBuilderAction.rotate(direction));
      },
      moveActiveLayer(direction) {
        dispatch(outfitBuilderAction.moveLayer(direction));
      },
      resetGarment(clothingItemId) {
        dispatch(outfitBuilderAction.reset(clothingItemId));
      },
      removeGarment(clothingItemId) {
        dispatch(outfitBuilderAction.remove(clothingItemId));
      },
      clearGarments() {
        dispatch(outfitBuilderAction.clear());
      },
      renameOutfit(name) {
        dispatch(outfitBuilderAction.rename(name));
      },
      markSaved(outfit) {
        dispatch(
          typeof outfit === 'number'
            ? outfitBuilderAction.markSaved(outfit)
            : outfitBuilderAction.markSavedFromDetail(outfit),
        );
      },
      restoreBaseline() {
        dispatch(outfitBuilderAction.restoreBaseline());
      },
      setOriginReturn(originReturnTo) {
        dispatch(
          outfitBuilderAction.setOriginReturn(normalizeOutfitBuilderOriginReturn(originReturnTo)),
        );
      },
    }),
    [],
  );

  return (
    <OutfitBuilderStateContext.Provider value={state}>
      <OutfitBuilderActionsContext.Provider value={actions}>
        {children}
      </OutfitBuilderActionsContext.Provider>
    </OutfitBuilderStateContext.Provider>
  );
}
