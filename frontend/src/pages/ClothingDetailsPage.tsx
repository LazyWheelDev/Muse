import {
  ArrowLeft,
  BadgeEuro,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Grid3X3,
  Info,
  MapPin,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Palette,
  Pencil,
  Ruler,
  Shirt,
  Sparkles,
  Sun,
  Tag,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiClientError } from '../api/ApiClientError';
import { HangerIcon } from '../components/icons/GarmentIcons';
import { routePaths } from '../app/routeConfig';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { ActionButton, NavigationButton, RoundAction } from '../components/ui/Buttons';
import { GarmentImage } from '../components/ui/GarmentImage';
import { DialogActions, DialogError, ModalDialog } from '../components/ui/ModalDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { useHorizontalSwipe } from '../components/ui/useHorizontalSwipe';
import {
  groupDisplayCandidates,
  selectGroupDisplayImage,
} from '../features/clothing/imageSelection';
import {
  bodyZoneLabels,
  bodyZones,
  categoryLabels,
  garmentCategories,
} from '../features/clothing/model';
import type {
  BodyZone,
  ClothingItemDetail,
  ClothingUpdatePayload,
  GarmentCategory,
} from '../features/clothing/model';
import {
  useClothingDetail,
  useDeleteClothing,
  useUpdateClothing,
} from '../features/clothing/queries';
import { safeWardrobeReturnPath } from '../features/clothing/wardrobeContext';
import { useUnsavedChanges } from '../features/clothing/useUnsavedChanges';
import styles from './ClothingDetailsPage.module.css';

interface DetailDraft {
  name: string;
  category: GarmentCategory;
  bodyZone: BodyZone | '';
  brand: string;
  size: string;
  colorName: string;
  material: string;
  season: string;
  purchasePrice: string;
  purchaseCurrency: string;
  purchaseDate: string;
  notes: string;
}

type DraftField = keyof DetailDraft;

interface FieldDefinition {
  field: DraftField;
  label: string;
  icon: ReactNode;
  kind?: 'text' | 'select-category' | 'select-zone' | 'date' | 'textarea';
  maxLength?: number;
}

const primaryFields: readonly FieldDefinition[] = [
  { field: 'name', label: 'Name', icon: <Tag />, maxLength: 120 },
  { field: 'category', label: 'Category', icon: <Shirt />, kind: 'select-category' },
  { field: 'brand', label: 'Brand', icon: <BriefcaseBusiness />, maxLength: 120 },
  { field: 'size', label: 'Size', icon: <Ruler />, maxLength: 60 },
  { field: 'colorName', label: 'Color', icon: <Palette />, maxLength: 80 },
];

const additionalFields: readonly FieldDefinition[] = [
  { field: 'material', label: 'Material', icon: <Grid3X3 />, maxLength: 200 },
  { field: 'season', label: 'Season', icon: <Sun />, maxLength: 120 },
  { field: 'bodyZone', label: 'Default body zone', icon: <MapPin />, kind: 'select-zone' },
  { field: 'purchasePrice', label: 'Purchase price', icon: <BadgeEuro /> },
  { field: 'purchaseDate', label: 'Purchase date', icon: <CalendarDays />, kind: 'date' },
  {
    field: 'notes',
    label: 'Notes',
    icon: <MessageSquareText />,
    kind: 'textarea',
    maxLength: 4000,
  },
];

function detailToDraft(item: ClothingItemDetail): DetailDraft {
  return {
    name: item.name,
    category: item.garmentCategory,
    bodyZone: item.defaultBodyZone ?? '',
    brand: item.brand ?? '',
    size: item.size ?? '',
    colorName: item.colorName ?? '',
    material: item.material ?? '',
    season: item.season ?? '',
    purchasePrice: item.purchasePrice ?? '',
    purchaseCurrency: item.purchaseCurrency ?? 'EUR',
    purchaseDate: item.purchaseDate ?? '',
    notes: item.notes ?? '',
  };
}

function normalizeOptional(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function draftPayload(draft: DetailDraft) {
  const purchasePrice = normalizeOptional(draft.purchasePrice);
  return {
    name: draft.name.trim(),
    garment_category: draft.category,
    default_body_zone: draft.bodyZone || null,
    brand: normalizeOptional(draft.brand),
    size: normalizeOptional(draft.size),
    color_name: normalizeOptional(draft.colorName),
    material: normalizeOptional(draft.material),
    season: normalizeOptional(draft.season),
    purchase_price: purchasePrice,
    purchase_currency: purchasePrice === null ? null : normalizeOptional(draft.purchaseCurrency),
    purchase_date: normalizeOptional(draft.purchaseDate),
    notes: normalizeOptional(draft.notes),
  };
}

function changedPayload(draft: DetailDraft, pristine: DetailDraft): ClothingUpdatePayload {
  const current = draftPayload(draft);
  const original = draftPayload(pristine);
  const changed = Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) => value !== original[key as keyof typeof original],
    ),
  ) as ClothingUpdatePayload;
  if ('purchase_price' in changed || 'purchase_currency' in changed) {
    changed.purchase_price = current.purchase_price;
    changed.purchase_currency = current.purchase_currency;
  }
  return changed;
}

function displayValue(field: DraftField, draft: DetailDraft): string {
  if (field === 'category') {
    return categoryLabels[draft.category];
  }
  if (field === 'bodyZone') {
    return draft.bodyZone === '' ? 'Not added' : bodyZoneLabels[draft.bodyZone];
  }
  if (field === 'purchasePrice') {
    return draft.purchasePrice === ''
      ? 'Not added'
      : `${draft.purchasePrice} ${draft.purchaseCurrency}`.trim();
  }
  return draft[field] || 'Not added';
}

function validateDraft(draft: DetailDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim() === '') {
    errors.name = 'Enter a garment name.';
  }
  if (
    draft.purchasePrice.trim() !== '' &&
    !/^\d{1,10}(?:\.\d{1,2})?$/u.test(draft.purchasePrice.trim())
  ) {
    errors.purchasePrice = 'Enter a non-negative price with up to two decimal places.';
  }
  if (draft.purchasePrice.trim() !== '' && !/^[A-Za-z]{3}$/u.test(draft.purchaseCurrency.trim())) {
    errors.purchaseCurrency = 'Use a three-letter currency code.';
  }
  return errors;
}

function DetailRow({
  definition,
  draft,
  editing,
  error,
  currencyError,
  onChange,
}: {
  definition: FieldDefinition;
  draft: DetailDraft;
  editing: boolean;
  error?: string | undefined;
  currencyError?: string | undefined;
  onChange: (field: DraftField, value: string) => void;
}) {
  const id = `detail-${definition.field}`;
  return (
    <div className={styles.detailRow}>
      <span className={styles.fieldIcon} aria-hidden="true">
        {definition.icon}
      </span>
      {editing ? (
        <label htmlFor={id}>{definition.label}</label>
      ) : (
        <span className={styles.fieldLabel}>{definition.label}</span>
      )}
      {editing ? (
        <div className={styles.editControl}>
          {definition.kind === 'select-category' ? (
            <select
              id={id}
              value={draft.category}
              onChange={(event) => onChange('category', event.target.value)}
            >
              {garmentCategories.map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category]}
                </option>
              ))}
            </select>
          ) : definition.kind === 'select-zone' ? (
            <select
              id={id}
              value={draft.bodyZone}
              onChange={(event) => onChange('bodyZone', event.target.value)}
            >
              <option value="">No default</option>
              {bodyZones.map((zone) => (
                <option key={zone} value={zone}>
                  {bodyZoneLabels[zone]}
                </option>
              ))}
            </select>
          ) : definition.kind === 'textarea' ? (
            <textarea
              id={id}
              value={draft.notes}
              maxLength={definition.maxLength}
              onChange={(event) => onChange('notes', event.target.value)}
            />
          ) : (
            <input
              id={id}
              type={definition.kind === 'date' ? 'date' : 'text'}
              inputMode={definition.field === 'purchasePrice' ? 'decimal' : undefined}
              value={draft[definition.field]}
              maxLength={definition.maxLength}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              onChange={(event) => onChange(definition.field, event.target.value)}
            />
          )}
          {definition.field === 'purchasePrice' ? (
            <input
              id={`${id}-currency`}
              className={styles.currencyInput}
              aria-label="Purchase currency"
              value={draft.purchaseCurrency}
              maxLength={3}
              aria-invalid={currencyError === undefined ? undefined : true}
              aria-describedby={currencyError === undefined ? undefined : `${id}-currency-error`}
              onChange={(event) => onChange('purchaseCurrency', event.target.value.toUpperCase())}
            />
          ) : null}
          {error === undefined ? null : (
            <span className={styles.rowError} id={`${id}-error`}>
              {error}
            </span>
          )}
          {currencyError === undefined ? null : (
            <span className={styles.rowError} id={`${id}-currency-error`}>
              {currencyError}
            </span>
          )}
        </div>
      ) : (
        <>
          <span className={draft[definition.field] === '' ? styles.mutedValue : styles.fieldValue}>
            {displayValue(definition.field, draft)}
          </span>
          <Pencil className={styles.pencilCue} size={20} aria-hidden="true" />
        </>
      )}
    </div>
  );
}

function ProcessingStatus({ item }: { item: ClothingItemDetail }) {
  if (item.imageProcessingState === 'not_requested' || item.imageProcessingState === 'completed') {
    return null;
  }
  const inProgress =
    item.imageProcessingState === 'pending' || item.imageProcessingState === 'processing';
  return (
    <div className={styles.processingStatus} role="status">
      {inProgress ? <Sparkles aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      <div>
        <strong>{inProgress ? 'Preparing garment image' : 'Using the safe fallback image'}</strong>
        <p>
          {inProgress
            ? 'Muse is finishing optional background cleanup. You can use this garment now.'
            : 'Background cleanup was unavailable. Your normalized and original images are preserved.'}
        </p>
      </div>
    </div>
  );
}

function ClothingDetailsContent({
  item,
  returnTo,
}: {
  item: ClothingItemDetail;
  returnTo: string;
}) {
  const itemId = item.id;
  const navigate = useNavigate();
  const updateMutation = useUpdateClothing(itemId);
  const deleteMutation = useDeleteClothing();
  const informationRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<DetailDraft>(() => detailToDraft(item));
  const [pristine, setPristine] = useState<DetailDraft>(() => detailToDraft(item));
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(pristine);
  const blocker = useUnsavedChanges(isDirty);
  const currentImageIndex =
    item.imageGroups.length === 0 ? 0 : Math.min(imageIndex, item.imageGroups.length - 1);
  const activeGroup = item.imageGroups[currentImageIndex] ?? null;
  const activeImage =
    activeGroup === null ? item.displayImage : selectGroupDisplayImage(activeGroup);
  const fallbackImages =
    activeGroup === null
      ? item.thumbnailImage === null
        ? []
        : [item.thumbnailImage]
      : groupDisplayCandidates(activeGroup);

  const outfitBuilderPath = useMemo(() => {
    const parameters = new URLSearchParams({ garment: String(itemId), returnTo });
    return `${routePaths.outfitBuilder}?${parameters.toString()}`;
  }, [itemId, returnTo]);

  function updateField(field: DraftField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSaveError(null);
  }

  async function save(proceedAfterSave = false) {
    const validationErrors = validateDraft(draft);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      const firstInvalidId =
        validationErrors.name !== undefined
          ? 'detail-name'
          : validationErrors.purchasePrice !== undefined
            ? 'detail-purchasePrice'
            : 'detail-purchasePrice-currency';
      window.setTimeout(() => document.getElementById(firstInvalidId)?.focus(), 0);
      return;
    }
    const payload = changedPayload(draft, pristine);
    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }
    setSaveError(null);
    try {
      const updated = await updateMutation.mutateAsync({ payload });
      const next = detailToDraft(updated);
      setDraft(next);
      setPristine(next);
      setEditing(false);
      if (proceedAfterSave && blocker.state === 'blocked') {
        blocker.proceed();
      }
    } catch (error) {
      setSaveError(
        error instanceof ApiClientError ? error.message : 'Muse could not save these changes.',
      );
    }
  }

  function cancelEditing() {
    setDraft(pristine);
    setErrors({});
    setSaveError(null);
    setEditing(false);
  }

  function selectRelativeImage(offset: number) {
    const count = item.imageGroups.length;
    if (count > 0) {
      setImageIndex((current) => (current + offset + count) % count);
    }
  }

  const swipeHandlers = useHorizontalSwipe(
    () => selectRelativeImage(-1),
    () => selectRelativeImage(1),
    item.imageGroups.length <= 1,
  );

  const header = (
    <PageHeader
      title="Details"
      startAction={
        <NavigationButton to={returnTo} aria-label="Back to Wardrobe">
          <ArrowLeft aria-hidden="true" /> Back
        </NavigationButton>
      }
      endAction={
        isDirty ? (
          <ActionButton
            variant="primary"
            disabled={updateMutation.isPending}
            onClick={() => void save()}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </ActionButton>
        ) : (
          <span className={styles.savedStatus} role="status">
            <CheckCircle2 aria-hidden="true" /> Saved
          </span>
        )
      }
    />
  );

  return (
    <div className={styles.page}>
      {header}
      <div className={styles.detailsLayout}>
        <section className={styles.imagePanel} aria-label="Garment images">
          <div className={styles.imageFrame} aria-roledescription="carousel" {...swipeHandlers}>
            <GarmentImage
              image={activeImage}
              fallbackImages={fallbackImages}
              alt={`${item.name}, image ${currentImageIndex + 1}`}
            />
            <ActionButton
              className={`${styles.carouselArrow} ${styles.previousArrow}`}
              iconOnly
              aria-label="Previous garment image"
              disabled={item.imageGroups.length <= 1}
              onClick={() => selectRelativeImage(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </ActionButton>
            <ActionButton
              className={`${styles.carouselArrow} ${styles.nextArrow}`}
              iconOnly
              aria-label="Next garment image"
              disabled={item.imageGroups.length <= 1}
              onClick={() => selectRelativeImage(1)}
            >
              <ChevronRight aria-hidden="true" />
            </ActionButton>
            <ActionButton
              className={styles.fullscreenButton}
              iconOnly
              aria-label="Open image fullscreen"
              onClick={() => setFullscreen(true)}
            >
              <Maximize2 aria-hidden="true" />
            </ActionButton>
          </div>
          <div
            className={styles.indicators}
            aria-label={`Image ${currentImageIndex + 1} of ${Math.max(1, item.imageGroups.length)}`}
          >
            {Array.from({ length: Math.max(1, item.imageGroups.length) }, (_, index) => (
              <span
                key={index}
                className={index === currentImageIndex ? styles.indicatorActive : ''}
              />
            ))}
          </div>
          <div className={styles.quickActions}>
            <RoundAction
              icon={<Info />}
              label="Info"
              onClick={() => informationRef.current?.focus()}
            />
            <RoundAction
              icon={<Pencil />}
              label={editing ? 'Cancel' : 'Edit'}
              onClick={() => (editing ? cancelEditing() : setEditing(true))}
            />
            <RoundAction icon={<Trash2 />} label="Delete" onClick={() => setConfirmDelete(true)} />
          </div>
          <NavigationButton to={outfitBuilderPath} variant="primary" fullWidth>
            <HangerIcon /> Go to Outfit Builder
          </NavigationButton>
        </section>

        <section
          className={styles.informationPanel}
          ref={informationRef}
          tabIndex={-1}
          aria-label="Garment information"
        >
          <div className={styles.sectionTitle}>
            <h2>Primary Information</h2>
            <span />
          </div>
          {primaryFields.map((definition) => (
            <DetailRow
              key={definition.field}
              definition={definition}
              draft={draft}
              editing={editing}
              error={errors[definition.field]}
              currencyError={
                definition.field === 'purchasePrice' ? errors.purchaseCurrency : undefined
              }
              onChange={updateField}
            />
          ))}
          <div className={styles.sectionTitle}>
            <h2>Additional Information</h2>
            <span />
          </div>
          {additionalFields.map((definition) => (
            <DetailRow
              key={definition.field}
              definition={definition}
              draft={draft}
              editing={editing}
              error={errors[definition.field]}
              currencyError={
                definition.field === 'purchasePrice' ? errors.purchaseCurrency : undefined
              }
              onChange={updateField}
            />
          ))}
          {saveError === null ? null : (
            <p className={styles.saveError} role="alert">
              {saveError}
            </p>
          )}
          <ProcessingStatus item={item} />
        </section>
      </div>

      {fullscreen ? (
        <ModalDialog
          className={styles.fullscreenDialog}
          title={item.name}
          onClose={() => setFullscreen(false)}
        >
          <div className={styles.fullscreenImage} {...swipeHandlers}>
            <GarmentImage
              image={activeImage}
              fallbackImages={fallbackImages}
              alt={`${item.name}, image ${currentImageIndex + 1}`}
            />
            <ActionButton
              className={`${styles.carouselArrow} ${styles.previousArrow}`}
              iconOnly
              aria-label="Previous garment image"
              disabled={item.imageGroups.length <= 1}
              onClick={() => selectRelativeImage(-1)}
            >
              <ChevronLeft />
            </ActionButton>
            <ActionButton
              className={`${styles.carouselArrow} ${styles.nextArrow}`}
              iconOnly
              aria-label="Next garment image"
              disabled={item.imageGroups.length <= 1}
              onClick={() => selectRelativeImage(1)}
            >
              <ChevronRight />
            </ActionButton>
          </div>
          <DialogActions>
            <ActionButton data-autofocus onClick={() => setFullscreen(false)}>
              <Minimize2 /> Reduce view
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}

      {confirmDelete ? (
        <ModalDialog
          title={`Delete ${item.name}?`}
          description="This garment will disappear from Wardrobe. Saved outfits may still retain a reference to it. Its original image will not be permanently purged."
          onClose={() => setConfirmDelete(false)}
        >
          {deleteMutation.error === null ? null : (
            <DialogError>
              {deleteMutation.error instanceof ApiClientError
                ? deleteMutation.error.message
                : 'Muse could not delete this garment.'}
            </DialogError>
          )}
          <DialogActions>
            <ActionButton
              data-autofocus
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(false)}
            >
              Keep garment
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteMutation.mutate(
                  { itemId: item.id },
                  {
                    onSuccess: () => {
                      setPristine(draft);
                      setEditing(false);
                      setConfirmDelete(false);
                      window.setTimeout(() => navigate(returnTo, { replace: true }), 0);
                    },
                  },
                )
              }
            >
              <Trash2 /> {deleteMutation.isPending ? 'Deleting…' : 'Delete garment'}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}

      {blocker.state === 'blocked' ? (
        <ModalDialog
          title="Unsaved changes"
          description="Save your changes before leaving, or discard them."
          onClose={() => blocker.reset()}
        >
          {saveError === null ? null : <DialogError>{saveError}</DialogError>}
          <DialogActions>
            <ActionButton data-autofocus onClick={() => blocker.reset()}>
              Keep editing
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={() => {
                setDraft(pristine);
                setEditing(false);
                blocker.proceed();
              }}
            >
              Discard changes
            </ActionButton>
            <ActionButton
              variant="primary"
              disabled={updateMutation.isPending}
              onClick={() => void save(true)}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save and continue'}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}
    </div>
  );
}

export function ClothingDetailsPage() {
  const { garmentId: garmentIdParameter } = useParams();
  const itemId = /^\d+$/u.test(garmentIdParameter ?? '') ? Number(garmentIdParameter) : 0;
  const [searchParameters] = useSearchParams();
  const returnTo = safeWardrobeReturnPath(searchParameters.get('returnTo'));
  const detailQuery = useClothingDetail(itemId);
  const shellHeader = (
    <PageHeader
      title="Details"
      startAction={
        <NavigationButton to={returnTo} aria-label="Back to Wardrobe">
          <ArrowLeft aria-hidden="true" /> Back
        </NavigationButton>
      }
    />
  );

  if (itemId <= 0) {
    return (
      <div className={styles.page}>
        {shellHeader}
        <MessageState
          role="alert"
          title="Garment not found"
          message="This garment address is not valid."
          action={<NavigationButton to={returnTo}>Back to Wardrobe</NavigationButton>}
        />
      </div>
    );
  }

  if (detailQuery.isError) {
    const notFound =
      detailQuery.error instanceof ApiClientError && detailQuery.error.status === 404;
    return (
      <div className={styles.page}>
        {shellHeader}
        <MessageState
          role="alert"
          title={notFound ? 'Garment not found' : 'Muse could not load this garment.'}
          message={
            notFound
              ? 'It may have been removed from Wardrobe.'
              : 'Your saved garment has not been changed.'
          }
          action={
            notFound ? (
              <NavigationButton to={returnTo}>Back to Wardrobe</NavigationButton>
            ) : (
              <RetryButton onRetry={() => void detailQuery.refetch()} />
            )
          }
        />
      </div>
    );
  }

  if (detailQuery.isPending || detailQuery.data === undefined) {
    return (
      <div className={styles.page}>
        {shellHeader}
        <LoadingState label="Loading garment details…" />
      </div>
    );
  }

  return (
    <ClothingDetailsContent key={detailQuery.data.id} item={detailQuery.data} returnTo={returnTo} />
  );
}
