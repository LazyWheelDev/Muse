import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BringToFront,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  House,
  Layers3,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  SendToBack,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ApiClientError } from '../api/ApiClientError';
import { routePaths } from '../app/routeConfig';
import { HatIcon, HangerIcon, PantsIcon, ShoeIcon } from '../components/icons/GarmentIcons';
import { OutfitWorkspace } from '../components/outfits/OutfitWorkspace';
import type { WorkspacePlacement } from '../components/outfits/OutfitWorkspace.types';
import { MessageState, RetryButton } from '../components/ui/AsyncState';
import { ActionButton, NavigationButton } from '../components/ui/Buttons';
import { GarmentImage } from '../components/ui/GarmentImage';
import { DialogActions, DialogError, ModalDialog } from '../components/ui/ModalDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { useClothingDetail, useClothingList } from '../features/clothing/queries';
import type {
  BodyZone,
  ClothingImage,
  ClothingItemDetail,
  ClothingItemSummary,
} from '../features/clothing/model';
import { defaultBodyZoneByCategory } from '../features/clothing/model';
import {
  buildWardrobePath,
  PRESERVE_OUTFIT_DRAFT_PARAMETER,
} from '../features/clothing/wardrobeContext';
import {
  groupDisplayCandidates,
  garmentVisualCandidates,
  selectGroupDisplayImage,
  selectGroupThumbnail,
  selectSummaryDisplayImage,
  selectSummaryThumbnail,
} from '../features/clothing/imageSelection';
import { useOutfitBuilder } from '../features/outfit-builder/context';
import {
  builderGarmentFromClothingItem,
  OUTFIT_NAME_MAX_LENGTH,
  serializeOutfitPlacements,
  sortOutfitPlacementsByLayer,
} from '../features/outfit-builder/model';
import type { BuilderGarment, OutfitPlacement } from '../features/outfit-builder/model';
import { normalizeOutfitBuilderOriginReturn } from '../features/outfit-builder/session';
import {
  outfitKeys,
  useCreateOutfit,
  useDeleteOutfit,
  useOutfitDetail,
  useOutfitList,
  useUpdateOutfit,
} from '../features/outfits/queries';
import styles from './OutfitBuilderPage.module.css';

interface PrimaryZone {
  bodyZone: BodyZone;
  label: string;
  icon: ReactNode;
  y: number;
}

const primaryZones: readonly PrimaryZone[] = [
  { bodyZone: 'head', label: 'Head', icon: <HatIcon />, y: 0.13 },
  { bodyZone: 'upper_body', label: 'Top', icon: <HangerIcon />, y: 0.37 },
  { bodyZone: 'lower_body', label: 'Pants', icon: <PantsIcon />, y: 0.64 },
  { bodyZone: 'feet', label: 'Shoes', icon: <ShoeIcon />, y: 0.88 },
];
const draftPreservingWardrobePath = buildWardrobePath({
  category: 'all',
  itemId: null,
  view: 'carousel',
  preserveOutfitDraft: true,
});

type SaveMode = 'new' | 'existing';

function parsePositiveId(value: string | null): number {
  if (value === null || !/^\d+$/u.test(value)) {
    return 0;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function uniqueImages(images: readonly (ClothingImage | null | undefined)[]): ClothingImage[] {
  return images.filter(
    (image, index, all): image is ClothingImage =>
      image !== null &&
      image !== undefined &&
      all.findIndex((candidate) => candidate?.contentUrl === image.contentUrl) === index,
  );
}

function builderGarmentFromDetail(item: ClothingItemDetail): BuilderGarment {
  const base = builderGarmentFromClothingItem(item);
  const primaryGroup = item.imageGroups.find((group) => group.isPrimary) ?? item.imageGroups[0];
  if (primaryGroup === undefined) {
    return base;
  }
  const candidates = groupDisplayCandidates(primaryGroup);
  return {
    ...base,
    clothingItem: {
      ...base.clothingItem,
      primaryImage: selectGroupDisplayImage(primaryGroup),
      displayImage: selectGroupDisplayImage(primaryGroup),
      thumbnailImage: selectGroupThumbnail(primaryGroup),
      imageCandidates: garmentVisualCandidates(candidates),
    },
  };
}

function effectiveBodyZone(item: ClothingItemSummary): BodyZone {
  return item.defaultBodyZone ?? defaultBodyZoneByCategory[item.garmentCategory];
}

function workspacePlacement(placement: OutfitPlacement): WorkspacePlacement {
  const visualCandidates = garmentVisualCandidates([
    ...placement.clothingItem.imageCandidates,
    placement.clothingItem.displayImage,
    placement.clothingItem.primaryImage,
  ]);
  return {
    clientId: placement.key,
    name: placement.clothingItem.name,
    bodyZone: placement.bodyZone,
    positionX: placement.positionX,
    positionY: placement.positionY,
    scale: placement.scale,
    rotation: placement.rotation,
    layerIndex: placement.layerIndex,
    imageCandidates: uniqueImages([...visualCandidates, placement.clothingItem.thumbnailImage]),
    deleted: placement.clothingItemStatus === 'deleted',
  };
}

function builderUrl(outfitId: number, returnTo: string | null): string {
  const parameters = new URLSearchParams({ outfitId: String(outfitId) });
  if (returnTo !== null) {
    parameters.set('returnTo', returnTo);
  }
  return `${routePaths.outfitBuilder}?${parameters.toString()}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function OutfitBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const requestedOutfitId = parsePositiveId(searchParameters.get('outfitId'));
  const handedOffGarmentId = parsePositiveId(searchParameters.get('garment'));
  const preserveOutfitDraft = searchParameters.get(PRESERVE_OUTFIT_DRAFT_PARAMETER) === '1';
  const requestedReturnTo = normalizeOutfitBuilderOriginReturn(searchParameters.get('returnTo'));
  const { state, isDirty, activePlacement, actions } = useOutfitBuilder();
  const clothingQuery = useClothingList('all');
  const handoffQuery = useClothingDetail(handedOffGarmentId);
  const createMutation = useCreateOutfit();
  const updateMutation = useUpdateOutfit();
  const deleteMutation = useDeleteOutfit();
  const outfitQuery = useOutfitDetail(requestedOutfitId, !deleteMutation.isPending);
  const outfitCountQuery = useOutfitList({ limit: 1, offset: 0 });
  const [pickerZone, setPickerZone] = useState<BodyZone | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dismissedIncomingOutfitId, setDismissedIncomingOutfitId] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const initializedEntryRef = useRef(false);
  const processedHandoffRef = useRef<number | null>(null);
  const deletedOutfitIdRef = useRef<number | null>(null);
  const placedGarmentIdSignature = state.placements
    .map((placement) => placement.clothingItemId)
    .sort((left, right) => left - right)
    .join(',');
  const workspacePlacements = useMemo(
    () => state.placements.map((placement) => workspacePlacement(placement)),
    [state.placements],
  );
  const orderedLayers = useMemo(
    () => [...sortOutfitPlacementsByLayer(state.placements)].reverse(),
    [state.placements],
  );
  const saving = createMutation.isPending || updateMutation.isPending;
  const pendingOutfit =
    outfitQuery.data !== undefined &&
    requestedOutfitId > 0 &&
    requestedOutfitId !== state.outfitId &&
    requestedOutfitId !== dismissedIncomingOutfitId &&
    isDirty &&
    (state.placements.length > 0 || state.name.length > 0)
      ? outfitQuery.data
      : null;

  useBeforeUnload(
    useCallback(
      (event) => {
        if (isDirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [isDirty],
    ),
  );

  const blocker = useBlocker(
    useCallback(
      ({ nextLocation }) =>
        isDirty &&
        nextLocation.pathname !== routePaths.outfitBuilder &&
        !nextLocation.pathname.startsWith(routePaths.wardrobe),
      [isDirty],
    ),
  );

  useEffect(() => {
    if (initializedEntryRef.current) {
      return;
    }
    initializedEntryRef.current = true;
    if (requestedOutfitId <= 0 && !preserveOutfitDraft && !isDirty) {
      actions.startNew(requestedReturnTo);
    }
  }, [actions, isDirty, preserveOutfitDraft, requestedOutfitId, requestedReturnTo]);

  useEffect(() => {
    if (requestedReturnTo !== null && state.originReturnTo !== requestedReturnTo) {
      actions.setOriginReturn(requestedReturnTo);
    }
  }, [actions, requestedReturnTo, state.originReturnTo]);

  useEffect(() => {
    if (liveStatus === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => setLiveStatus(null), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [liveStatus]);

  useEffect(
    () => () => {
      const deletedOutfitId = deletedOutfitIdRef.current;
      if (deletedOutfitId !== null) {
        window.queueMicrotask(() => {
          queryClient.removeQueries({
            queryKey: outfitKeys.detail(deletedOutfitId),
            exact: true,
          });
        });
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (
      handedOffGarmentId <= 0 ||
      processedHandoffRef.current === handedOffGarmentId ||
      handoffQuery.data === undefined ||
      handoffQuery.isFetching
    ) {
      return;
    }
    processedHandoffRef.current = handedOffGarmentId;
    actions.addGarment(builderGarmentFromDetail(handoffQuery.data));
    const next = new URLSearchParams(searchParameters);
    next.delete('garment');
    setSearchParameters(next, { replace: true });
  }, [
    actions,
    handedOffGarmentId,
    handoffQuery.data,
    handoffQuery.isFetching,
    searchParameters,
    setSearchParameters,
  ]);

  useEffect(() => {
    if (clothingQuery.data === undefined || placedGarmentIdSignature === '') {
      return;
    }
    const placedIds = new Set(placedGarmentIdSignature.split(',').map(Number));
    for (const item of clothingQuery.data.items) {
      if (placedIds.has(item.id)) {
        actions.syncGarmentMedia(builderGarmentFromClothingItem(item));
      }
    }
  }, [actions, clothingQuery.data, placedGarmentIdSignature]);

  useEffect(() => {
    if (
      requestedOutfitId <= 0 ||
      outfitQuery.data === undefined ||
      state.outfitId === requestedOutfitId
    ) {
      return;
    }
    if (isDirty && (state.placements.length > 0 || state.name.length > 0)) {
      return;
    }
    actions.hydrate(outfitQuery.data, requestedReturnTo);
  }, [
    actions,
    isDirty,
    outfitQuery.data,
    requestedOutfitId,
    requestedReturnTo,
    state.name.length,
    state.outfitId,
    state.placements.length,
  ]);

  function compatibleGarments(bodyZone: BodyZone): ClothingItemSummary[] {
    return (clothingQuery.data?.items ?? []).filter((item) => effectiveBodyZone(item) === bodyZone);
  }

  function selectGarment(item: ClothingItemSummary, bodyZone: BodyZone) {
    const existing = state.placements.find((placement) => placement.clothingItemId === item.id);
    if (existing === undefined) {
      actions.addGarment(builderGarmentFromClothingItem(item), bodyZone);
    } else {
      actions.activateGarment(existing.clothingItemId);
    }
    setPickerZone(null);
  }

  function cycleZone(bodyZone: BodyZone, direction: -1 | 1) {
    const compatible = compatibleGarments(bodyZone);
    if (compatible.length === 0) {
      setPickerZone(bodyZone);
      return;
    }
    const zonePlacements = sortOutfitPlacementsByLayer(
      state.placements.filter((placement) => placement.bodyZone === bodyZone),
    );
    const current =
      activePlacement?.bodyZone === bodyZone ? activePlacement : (zonePlacements.at(-1) ?? null);
    const currentIndex = compatible.findIndex((item) => item.id === current?.clothingItemId);
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : compatible.length - 1
        : (currentIndex + direction + compatible.length) % compatible.length;
    const next = compatible[nextIndex];
    if (next === undefined) {
      return;
    }
    const alreadyPlaced = state.placements.find(
      (placement) => placement.clothingItemId === next.id,
    );
    if (alreadyPlaced !== undefined) {
      actions.activateGarment(alreadyPlaced.clothingItemId);
    } else if (current !== null) {
      actions.activateGarment(current.clothingItemId);
      actions.replaceActiveGarment(builderGarmentFromClothingItem(next), bodyZone);
    } else {
      actions.addGarment(builderGarmentFromClothingItem(next), bodyZone);
    }
  }

  function openSaveDialog() {
    if (state.placements.length === 0) {
      setLiveStatus('Add at least one garment before saving an outfit.');
      return;
    }
    setSaveError(null);
    if (state.mode === 'existing') {
      setSaveMode('existing');
      setSaveName(state.name || 'Saved Look');
      return;
    }
    const number = (outfitCountQuery.data?.total ?? 0) + 1;
    setSaveMode('new');
    setSaveName(state.name.trim() || `Look ${String(number).padStart(2, '0')}`);
  }

  function normalizedSaveName(): string | null {
    const normalized = saveName.trim();
    if (normalized.length === 0) {
      setSaveError('Enter a name for this outfit.');
      return null;
    }
    if (normalized.length > OUTFIT_NAME_MAX_LENGTH) {
      setSaveError('Use 120 characters or fewer.');
      return null;
    }
    return normalized;
  }

  async function createSavedOutfit() {
    const name = normalizedSaveName();
    if (name === null) {
      return;
    }
    setSaveError(null);
    try {
      const saved = await createMutation.mutateAsync({
        name,
        items: serializeOutfitPlacements(state.placements),
      });
      actions.markSaved(saved);
      setSaveMode(null);
      setLiveStatus(`${saved.name} was saved.`);
      void navigate(builderUrl(saved.id, state.originReturnTo), { replace: true });
    } catch (error) {
      setSaveError(messageFor(error, 'Muse could not save this outfit. Your draft is preserved.'));
    }
  }

  async function updateSavedOutfit() {
    const name = normalizedSaveName();
    if (name === null || state.outfitId === null) {
      return;
    }
    setSaveError(null);
    try {
      const saved = await updateMutation.mutateAsync({
        outfitId: state.outfitId,
        payload: {
          name,
          items: serializeOutfitPlacements(state.placements),
        },
      });
      actions.markSaved(saved);
      setSaveMode(null);
      setLiveStatus(`${saved.name} was updated.`);
    } catch (error) {
      setSaveError(
        messageFor(error, 'Muse could not update this outfit. Your draft is preserved.'),
      );
    }
  }

  async function deleteSavedOutfit() {
    if (state.outfitId === null) {
      return;
    }
    const deletedOutfitId = state.outfitId;
    try {
      await deleteMutation.mutateAsync({ outfitId: deletedOutfitId });
      deletedOutfitIdRef.current = deletedOutfitId;
      actions.startNew(null);
      setConfirmDelete(false);
      setShowOptions(false);
      void navigate(routePaths.savedOutfits, { replace: true });
    } catch {
      // The mutation error is rendered inside the confirmation dialog.
    }
  }

  function keepCurrentDraft() {
    setDismissedIncomingOutfitId(requestedOutfitId);
    void navigate(
      state.outfitId === null
        ? routePaths.outfitBuilder
        : builderUrl(state.outfitId, state.originReturnTo),
      { replace: true },
    );
  }

  const activeLayerPosition =
    activePlacement === null
      ? 0
      : sortOutfitPlacementsByLayer(state.placements).findIndex(
          (placement) => placement.key === activePlacement.key,
        ) + 1;
  const contextualWardrobe =
    state.originReturnTo?.startsWith(routePaths.wardrobe) === true ? state.originReturnTo : null;
  const contextualSavedOutfits =
    state.originReturnTo === routePaths.savedOutfits ? routePaths.savedOutfits : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Outfit Builder"
        startAction={
          <NavigationButton to={routePaths.home} aria-label="Return to Home">
            <House aria-hidden="true" /> Home
          </NavigationButton>
        }
        endAction={
          <ActionButton className={styles.statusButton} onClick={() => setShowOptions(true)}>
            <Layers3 aria-hidden="true" />
            <span className={isDirty ? styles.unsavedStatus : styles.savedStatus}>
              {isDirty ? 'Unsaved changes' : state.mode === 'existing' ? 'Saved' : 'Outfit items'}
            </span>
          </ActionButton>
        }
      />

      <div className={styles.builderLayout}>
        <section
          className={`${styles.panel} ${styles.commandPanel}`}
          aria-labelledby="commands-title"
        >
          <h2 className={styles.panelTitle} id="commands-title">
            Commands
          </h2>
          <div className={styles.smallDivider} aria-hidden="true">
            <i />
          </div>
          <p className={styles.activeSummary} aria-live="polite">
            {activePlacement === null ? (
              'Select a garment to adjust it.'
            ) : (
              <span>
                <strong>{activePlacement.clothingItem.name}</strong>
                <br />
                Layer {activeLayerPosition} of {state.placements.length}
              </span>
            )}
          </p>

          <fieldset className={styles.commandGroup} disabled={activePlacement === null}>
            <legend>Move</legend>
            <div className={styles.moveGrid}>
              <ActionButton
                className={`${styles.commandButton} ${styles.moveUp}`}
                iconOnly
                aria-label="Move garment up"
                onClick={() => actions.moveActiveGarment('up')}
              >
                <ArrowUp aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={`${styles.commandButton} ${styles.moveLeft}`}
                iconOnly
                aria-label="Move garment left"
                onClick={() => actions.moveActiveGarment('left')}
              >
                <ArrowLeft aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={`${styles.commandButton} ${styles.moveRight}`}
                iconOnly
                aria-label="Move garment right"
                onClick={() => actions.moveActiveGarment('right')}
              >
                <ArrowRight aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={`${styles.commandButton} ${styles.moveDown}`}
                iconOnly
                aria-label="Move garment down"
                onClick={() => actions.moveActiveGarment('down')}
              >
                <ArrowDown aria-hidden="true" />
              </ActionButton>
            </div>
          </fieldset>

          <fieldset className={styles.commandGroup} disabled={activePlacement === null}>
            <legend>Resize</legend>
            <div className={styles.commandRow}>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Decrease garment size"
                onClick={() => actions.resizeActiveGarment('decrease')}
              >
                <Minus aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Increase garment size"
                onClick={() => actions.resizeActiveGarment('increase')}
              >
                <Plus aria-hidden="true" />
              </ActionButton>
            </div>
          </fieldset>

          <fieldset className={styles.commandGroup} disabled={activePlacement === null}>
            <legend>Rotate</legend>
            <div className={styles.commandRow}>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Rotate garment left"
                onClick={() => actions.rotateActiveGarment('left')}
              >
                <RotateCcw aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Rotate garment right"
                onClick={() => actions.rotateActiveGarment('right')}
              >
                <RotateCw aria-hidden="true" />
              </ActionButton>
            </div>
          </fieldset>

          <fieldset className={styles.commandGroup} disabled={activePlacement === null}>
            <legend>Layer</legend>
            <div className={styles.commandRow}>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Move garment forward"
                onClick={() => actions.moveActiveLayer('forward')}
              >
                <BringToFront aria-hidden="true" />
              </ActionButton>
              <ActionButton
                className={styles.commandButton}
                iconOnly
                aria-label="Move garment backward"
                onClick={() => actions.moveActiveLayer('backward')}
              >
                <SendToBack aria-hidden="true" />
              </ActionButton>
            </div>
          </fieldset>
        </section>

        <section className={styles.workspaceColumn} aria-label="Outfit composition">
          <div className={`${styles.panel} ${styles.workspacePanel}`}>
            <OutfitWorkspace
              placements={workspacePlacements}
              activePlacementId={state.activePlacementKey}
              onActivate={(clientId) => {
                const placement = state.placements.find((item) => item.key === clientId);
                if (placement !== undefined) {
                  actions.activateGarment(placement.clothingItemId);
                }
              }}
              onMove={(_clientId, positionX, positionY) =>
                actions.moveActiveTo(positionX, positionY)
              }
            />
            {primaryZones.flatMap((zone) => {
              const compatible = compatibleGarments(zone.bodyZone);
              const disabled =
                clothingQuery.isPending || clothingQuery.isError || compatible.length === 0;
              const style = { '--zone-y': `${zone.y * 100}%` } as CSSProperties;
              return [
                <ActionButton
                  key={`${zone.bodyZone}-previous`}
                  className={`${styles.zoneArrow} ${styles.zoneArrowPrevious}`}
                  style={style}
                  iconOnly
                  aria-label={`Previous ${zone.label.toLowerCase()} garment`}
                  disabled={disabled}
                  onClick={() => cycleZone(zone.bodyZone, -1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </ActionButton>,
                <ActionButton
                  key={`${zone.bodyZone}-next`}
                  className={`${styles.zoneArrow} ${styles.zoneArrowNext}`}
                  style={style}
                  iconOnly
                  aria-label={`Next ${zone.label.toLowerCase()} garment`}
                  disabled={disabled}
                  onClick={() => cycleZone(zone.bodyZone, 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </ActionButton>,
              ];
            })}
          </div>
          <ActionButton
            className={styles.saveButton}
            variant="primary"
            disabled={saving}
            onClick={openSaveDialog}
          >
            {saving ? <RotateCw aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving
              ? 'Saving…'
              : state.mode === 'existing' && !isDirty
                ? 'Saved Outfit'
                : 'Save Outfit'}
          </ActionButton>
        </section>

        <section
          className={`${styles.panel} ${styles.categoryPanel}`}
          aria-label="Garment categories"
        >
          {primaryZones.map((zone) => (
            <button
              key={zone.bodyZone}
              type="button"
              className={styles.categoryCard}
              aria-pressed={activePlacement?.bodyZone === zone.bodyZone}
              onClick={() => setPickerZone(zone.bodyZone)}
            >
              <span className={styles.categoryIcon} aria-hidden="true">
                {zone.icon}
              </span>
              {zone.label}
            </button>
          ))}
        </section>

        {contextualWardrobe === null && contextualSavedOutfits === null ? (
          <span />
        ) : contextualSavedOutfits !== null ? (
          <NavigationButton className={styles.wardrobeReturn} to={contextualSavedOutfits}>
            <Bookmark aria-hidden="true" /> Saved Outfits
          </NavigationButton>
        ) : (
          <NavigationButton
            className={styles.wardrobeReturn}
            to={contextualWardrobe ?? routePaths.wardrobe}
          >
            <HangerIcon /> Wardrobe
          </NavigationButton>
        )}
      </div>

      {handoffQuery.isError && handedOffGarmentId > 0 ? (
        <p className={styles.liveStatus} role="alert">
          Muse could not add the selected garment. Return to Wardrobe and try again.
        </p>
      ) : null}
      {outfitQuery.isError && requestedOutfitId > 0 ? (
        <p className={styles.liveStatus} role="alert">
          Muse could not open that saved outfit.
        </p>
      ) : null}
      {liveStatus === null ? null : (
        <p className={styles.liveStatus} role="status">
          {liveStatus}
        </p>
      )}

      {pickerZone === null ? null : (
        <ModalDialog
          className={styles.pickerDialog}
          title={`Choose ${primaryZones.find((zone) => zone.bodyZone === pickerZone)?.label ?? 'garment'}`}
          description="Select a compatible garment. Adding one keeps the rest of your outfit unchanged."
          onClose={() => setPickerZone(null)}
        >
          {clothingQuery.isPending ? (
            <p role="status">Loading your local wardrobe…</p>
          ) : clothingQuery.isError ? (
            <MessageState
              role="alert"
              title="Muse could not load your wardrobe."
              message="Your current outfit is preserved."
              action={<RetryButton onRetry={() => void clothingQuery.refetch()} />}
            />
          ) : compatibleGarments(pickerZone).length === 0 ? (
            <div className={styles.pickerToolbar}>
              <p>No compatible garments are available yet.</p>
              <NavigationButton to={draftPreservingWardrobePath}>Open Wardrobe</NavigationButton>
            </div>
          ) : (
            <>
              <div className={styles.pickerToolbar}>
                <p>{compatibleGarments(pickerZone).length} compatible garments</p>
                <NavigationButton to={draftPreservingWardrobePath}>Open Wardrobe</NavigationButton>
              </div>
              <ul className={styles.pickerGrid}>
                {compatibleGarments(pickerZone).map((item) => {
                  const selected = state.placements.some(
                    (placement) => placement.clothingItemId === item.id,
                  );
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={styles.pickerCard}
                        aria-pressed={selected}
                        aria-label={`${selected ? 'Select placed' : 'Add'} ${item.name}`}
                        onClick={() => selectGarment(item, pickerZone)}
                      >
                        <GarmentImage
                          className={styles.pickerImage ?? ''}
                          image={selectSummaryThumbnail(item)}
                          fallbackImages={uniqueImages([selectSummaryDisplayImage(item)])}
                          alt={item.name}
                          loading="lazy"
                        />
                        <span>{item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <DialogActions>
            <ActionButton data-autofocus onClick={() => setPickerZone(null)}>
              Close
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      )}

      {showOptions ? (
        <ModalDialog
          title="Outfit items"
          description="Select an item to make it active. The first listed item is visually in front."
          onClose={() => setShowOptions(false)}
        >
          {orderedLayers.length === 0 ? (
            <p>No garments have been added yet.</p>
          ) : (
            <ol className={styles.layerList}>
              {orderedLayers.map((placement, index) => (
                <li
                  key={placement.key}
                  className={`${styles.layerRow} ${placement.key === activePlacement?.key ? styles.layerRowActive : ''}`}
                >
                  <span aria-hidden="true">{orderedLayers.length - index}</span>
                  <span>
                    {placement.clothingItem.name}
                    {placement.clothingItemStatus === 'deleted' ? (
                      <small className={styles.deletedBadge}> No longer in Wardrobe</small>
                    ) : null}
                  </span>
                  <ActionButton
                    aria-pressed={placement.key === activePlacement?.key}
                    onClick={() => actions.activateGarment(placement.clothingItemId)}
                  >
                    Select
                  </ActionButton>
                </li>
              ))}
            </ol>
          )}
          <DialogActions>
            <ActionButton data-autofocus onClick={() => setShowOptions(false)}>
              Close
            </ActionButton>
            <ActionButton
              disabled={activePlacement === null}
              onClick={() => actions.resetGarment()}
            >
              <Undo2 aria-hidden="true" /> Reset active
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={activePlacement === null}
              onClick={() => actions.removeGarment()}
            >
              <Trash2 aria-hidden="true" /> Remove active
            </ActionButton>
            {state.placements.length > 0 ? (
              <ActionButton
                variant="danger"
                onClick={() => {
                  setShowOptions(false);
                  setConfirmClear(true);
                }}
              >
                Clear outfit
              </ActionButton>
            ) : null}
            {state.mode === 'existing' && isDirty ? (
              <ActionButton onClick={() => actions.restoreBaseline()}>
                <RotateCcw aria-hidden="true" /> Cancel changes
              </ActionButton>
            ) : null}
            {state.mode === 'existing' ? (
              <ActionButton
                variant="danger"
                onClick={() => {
                  setShowOptions(false);
                  setConfirmDelete(true);
                }}
              >
                Delete saved outfit
              </ActionButton>
            ) : null}
          </DialogActions>
        </ModalDialog>
      ) : null}

      {saveMode === null ? null : (
        <ModalDialog
          title={saveMode === 'new' ? 'Save Outfit' : 'Save changes'}
          description={
            saveMode === 'new'
              ? 'Name this look before saving it locally.'
              : 'Update this outfit or save the current version as a new outfit.'
          }
          onClose={() => (saving ? undefined : setSaveMode(null))}
        >
          <div className={styles.saveForm}>
            <label htmlFor="outfit-name">
              Outfit name
              <input
                id="outfit-name"
                data-autofocus
                value={saveName}
                maxLength={OUTFIT_NAME_MAX_LENGTH}
                disabled={saving}
                onChange={(event) => {
                  setSaveName(event.target.value);
                  setSaveError(null);
                }}
              />
            </label>
            {saveError === null ? null : (
              <p className={styles.inlineError} role="alert">
                {saveError}
              </p>
            )}
          </div>
          <DialogActions>
            <ActionButton disabled={saving} onClick={() => setSaveMode(null)}>
              Cancel
            </ActionButton>
            {saveMode === 'existing' ? (
              <ActionButton disabled={saving} onClick={() => void createSavedOutfit()}>
                Save as New Outfit
              </ActionButton>
            ) : null}
            <ActionButton
              variant="primary"
              disabled={saving}
              onClick={() =>
                void (saveMode === 'existing' ? updateSavedOutfit() : createSavedOutfit())
              }
            >
              {saving ? 'Saving…' : saveMode === 'existing' ? 'Update Outfit' : 'Save Outfit'}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      )}

      {confirmClear ? (
        <ModalDialog
          title="Clear this outfit?"
          description="Every garment will be removed from this draft. Your Wardrobe will not change."
          onClose={() => setConfirmClear(false)}
        >
          <DialogActions>
            <ActionButton data-autofocus onClick={() => setConfirmClear(false)}>
              Keep outfit
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={() => {
                actions.clearGarments();
                setConfirmClear(false);
              }}
            >
              Clear outfit
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}

      {confirmDelete ? (
        <ModalDialog
          title={`Delete ${state.name || 'this outfit'}?`}
          description="The outfit will disappear from Saved Outfits. Every garment and clothing image will remain in Wardrobe."
          onClose={() => (deleteMutation.isPending ? undefined : setConfirmDelete(false))}
        >
          {deleteMutation.error === null ? null : (
            <DialogError>
              {messageFor(deleteMutation.error, 'Muse could not delete this outfit.')}
            </DialogError>
          )}
          <DialogActions>
            <ActionButton
              data-autofocus
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(false)}
            >
              Keep outfit
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => void deleteSavedOutfit()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete outfit'}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}

      {pendingOutfit === null ? null : (
        <ModalDialog
          title="Open another outfit?"
          description="Your current unsaved draft is still available. Opening another outfit will replace it."
          onClose={keepCurrentDraft}
        >
          <DialogActions>
            <ActionButton data-autofocus onClick={keepCurrentDraft}>
              Keep current draft
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={() => {
                actions.hydrate(pendingOutfit, requestedReturnTo);
                setDismissedIncomingOutfitId(requestedOutfitId);
              }}
            >
              Discard and open {pendingOutfit.name}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      )}

      {blocker.state === 'blocked' ? (
        <ModalDialog
          title="Unsaved outfit"
          description="Keep this draft for later, discard it, or stay in Outfit Builder."
          onClose={() => blocker.reset()}
        >
          <DialogActions>
            <ActionButton data-autofocus onClick={() => blocker.reset()}>
              Keep editing
            </ActionButton>
            <ActionButton onClick={() => blocker.proceed()}>Keep draft and leave</ActionButton>
            <ActionButton
              variant="danger"
              onClick={() => {
                actions.startNew(null);
                blocker.proceed();
              }}
            >
              Discard draft and leave
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}
    </div>
  );
}
