import { ArrowLeft, ImagePlus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ApiClientError, isAbortError } from '../api/ApiClientError';
import { ActionButton, NavigationButton } from '../components/ui/Buttons';
import { DialogActions, ModalDialog } from '../components/ui/ModalDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SelectField, TextAreaField, TextField } from '../components/ui/FormField';
import { useImportClothing } from '../features/clothing/queries';
import {
  bodyZoneLabels,
  bodyZones,
  categoryLabels,
  defaultBodyZoneByCategory,
  garmentCategories,
} from '../features/clothing/model';
import type { BodyZone, ClothingWritePayload, GarmentCategory } from '../features/clothing/model';
import {
  buildWardrobePath,
  parseWardrobePath,
  safeWardrobeReturnPath,
} from '../features/clothing/wardrobeContext';
import { useUnsavedChanges } from '../features/clothing/useUnsavedChanges';
import styles from './AddGarmentPage.module.css';

const maxClientFileSize = 25 * 1024 * 1024;
const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const imageValidationErrorCodes = new Set([
  'animated_image_unsupported',
  'corrupt_image',
  'empty_image',
  'image_color_mode_unsupported',
  'image_dimensions_exceeded',
  'image_mime_mismatch',
  'image_pixel_limit_exceeded',
  'invalid_image_dimensions',
  'invalid_image_metadata',
  'invalid_upload_filename',
  'unsupported_image_format',
  'upload_too_large',
]);

interface ImportDraft {
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

const initialDraft: ImportDraft = {
  name: '',
  category: 'top',
  bodyZone: defaultBodyZoneByCategory.top,
  brand: '',
  size: '',
  colorName: '',
  material: '',
  season: '',
  purchasePrice: '',
  purchaseCurrency: 'EUR',
  purchaseDate: '',
  notes: '',
};

function optional(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function createPayload(draft: ImportDraft): ClothingWritePayload {
  const purchasePrice = optional(draft.purchasePrice);
  return {
    name: draft.name.trim(),
    garment_category: draft.category,
    default_body_zone: draft.bodyZone || null,
    brand: optional(draft.brand),
    size: optional(draft.size),
    color_name: optional(draft.colorName),
    material: optional(draft.material),
    season: optional(draft.season),
    purchase_price: purchasePrice,
    purchase_currency: purchasePrice === null ? null : optional(draft.purchaseCurrency),
    purchase_date: optional(draft.purchaseDate),
    notes: optional(draft.notes),
  };
}

export function AddGarmentPage() {
  const navigate = useNavigate();
  const [searchParameters] = useSearchParams();
  const returnTo = safeWardrobeReturnPath(searchParameters.get('returnTo'));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState<ImportDraft>(initialDraft);
  const [bodyZoneTouched, setBodyZoneTouched] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const importMutation = useImportClothing();
  const isDirty =
    image !== null || JSON.stringify(draft) !== JSON.stringify(initialDraft) || bodyZoneTouched;
  const blocker = useUnsavedChanges(isDirty && !importMutation.isSuccess);

  const previewUrl = useMemo(() => (image === null ? null : URL.createObjectURL(image)), [image]);
  useEffect(
    () => () => {
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const imageError = errors.image;
  const uploadLabel = useMemo(() => {
    if (!importMutation.isPending) {
      return null;
    }
    if (uploadPercent === 100) {
      return 'Preparing garment image…';
    }
    return uploadPercent === null ? 'Uploading garment…' : `Uploading garment… ${uploadPercent}%`;
  }, [importMutation.isPending, uploadPercent]);

  function setField<Key extends keyof ImportDraft>(field: Key, value: ImportDraft[Key]) {
    idempotencyKeyRef.current = crypto.randomUUID();
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setSubmitError(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.image;
      return next;
    });
    if (selected === null) {
      return;
    }
    const hasSupportedSuffix = /\.(?:jpe?g|png|webp)$/iu.test(selected.name);
    if (selected.type !== '' && !supportedMimeTypes.has(selected.type)) {
      setImage(null);
      setErrors((current) => ({ ...current, image: 'Choose a JPG, PNG, or WebP image.' }));
      return;
    }
    if (selected.type === '' && !hasSupportedSuffix) {
      setImage(null);
      setErrors((current) => ({ ...current, image: 'Choose a JPG, PNG, or WebP image.' }));
      return;
    }
    if (selected.size === 0 || selected.size > maxClientFileSize) {
      setImage(null);
      setErrors((current) => ({
        ...current,
        image:
          selected.size === 0
            ? 'The selected image is empty.'
            : 'Choose an image smaller than 25 MiB.',
      }));
      return;
    }
    idempotencyKeyRef.current = crypto.randomUUID();
    setImage(selected);
  }

  function removeImage() {
    idempotencyKeyRef.current = crypto.randomUUID();
    setImage(null);
    setUploadPercent(null);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
    }
  }

  function validate(): Record<string, string> {
    const nextErrors: Record<string, string> = {};
    if (image === null) {
      nextErrors.image = 'Choose a garment image.';
    }
    if (draft.name.trim().length === 0) {
      nextErrors.name = 'Enter a garment name.';
    }
    if (draft.name.trim().length > 120) {
      nextErrors.name = 'Use 120 characters or fewer.';
    }
    if (draft.purchasePrice.trim() !== '') {
      if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(draft.purchasePrice.trim())) {
        nextErrors.purchasePrice = 'Enter a non-negative price with up to two decimal places.';
      }
      if (!/^[A-Za-z]{3}$/u.test(draft.purchaseCurrency.trim())) {
        nextErrors.purchaseCurrency = 'Use a three-letter currency code.';
      }
    }
    return nextErrors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0 || image === null) {
      const firstInvalidId =
        image === null
          ? 'garment-image'
          : validationErrors.name !== undefined
            ? 'import-name'
            : validationErrors.purchasePrice !== undefined
              ? 'import-purchase-price'
              : 'import-purchase-currency';
      window.setTimeout(() => document.getElementById(firstInvalidId)?.focus(), 0);
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setUploadPercent(0);
    try {
      const item = await importMutation.mutateAsync({
        image,
        metadata: createPayload(draft),
        signal: controller.signal,
        idempotencyKey: idempotencyKeyRef.current,
        onProgress: ({ percent }) => setUploadPercent(percent),
      });
      setImage(null);
      setDraft(initialDraft);
      setBodyZoneTouched(false);
      window.setTimeout(() => {
        void navigate(
          buildWardrobePath({
            ...parseWardrobePath(returnTo),
            category: item.garmentCategory,
            itemId: item.id,
            view: 'carousel',
          }),
          { replace: true },
        );
      }, 0);
    } catch (error) {
      if (!isAbortError(error)) {
        if (error instanceof ApiClientError && imageValidationErrorCodes.has(error.code)) {
          setErrors((current) => ({ ...current, image: error.message }));
          window.setTimeout(() => fileInputRef.current?.focus(), 0);
        } else {
          setSubmitError(
            error instanceof ApiClientError
              ? error.message
              : 'Muse could not import this garment. Please try again.',
          );
        }
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Add Garment"
        startAction={
          <NavigationButton to={returnTo} aria-label="Back to Wardrobe">
            <ArrowLeft aria-hidden="true" /> Back
          </NavigationButton>
        }
      />
      <form className={styles.importLayout} onSubmit={(event) => void submit(event)} noValidate>
        <section className={styles.imagePanel} aria-labelledby="garment-image-title">
          <h2 id="garment-image-title">Garment image</h2>
          <input
            className={styles.fileInput}
            ref={fileInputRef}
            id="garment-image"
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={selectImage}
            disabled={importMutation.isPending}
            aria-invalid={imageError === undefined ? undefined : true}
            aria-describedby={
              imageError === undefined ? 'garment-image-help' : 'garment-image-error'
            }
          />
          {previewUrl === null ? (
            <label className={styles.imageDrop} id="choose-garment-image" htmlFor="garment-image">
              <ImagePlus size={64} aria-hidden="true" />
              <strong>Choose a garment photograph</strong>
              <span id="garment-image-help">JPG, PNG, or WebP · up to 25 MiB</span>
            </label>
          ) : (
            <div className={styles.previewFrame}>
              <img src={previewUrl} alt="Selected garment preview" />
            </div>
          )}
          {imageError === undefined ? null : (
            <p className={styles.fieldError} id="garment-image-error" role="alert">
              {imageError}
            </p>
          )}
          {image === null ? null : (
            <div className={styles.imageActions}>
              <ActionButton
                onClick={() => {
                  if (fileInputRef.current !== null) {
                    fileInputRef.current.value = '';
                    fileInputRef.current.click();
                  }
                }}
                disabled={importMutation.isPending}
              >
                <RotateCcw aria-hidden="true" /> Replace image
              </ActionButton>
              <ActionButton
                variant="danger"
                onClick={removeImage}
                disabled={importMutation.isPending}
              >
                <Trash2 aria-hidden="true" /> Remove
              </ActionButton>
            </div>
          )}
        </section>

        <section className={styles.metadataPanel} aria-labelledby="garment-details-title">
          <h2 id="garment-details-title">Garment details</h2>
          <fieldset className={styles.formFieldset} disabled={importMutation.isPending}>
            <legend className={styles.visuallyHidden}>Garment metadata</legend>
            <div className={styles.formFields}>
              <TextField
                id="import-name"
                label="Name"
                name="name"
                value={draft.name}
                maxLength={120}
                required
                autoComplete="off"
                error={errors.name}
                onChange={(event) => setField('name', event.target.value)}
              />
              <SelectField
                label="Category"
                name="category"
                value={draft.category}
                onChange={(event) => {
                  const category = event.target.value as GarmentCategory;
                  setField('category', category);
                  if (!bodyZoneTouched) {
                    setField('bodyZone', defaultBodyZoneByCategory[category]);
                  }
                }}
              >
                {garmentCategories.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabels[category]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Default body zone"
                hint="This suggests where Muse will place the garment. It does not change its category."
                name="bodyZone"
                value={draft.bodyZone}
                onChange={(event) => {
                  setBodyZoneTouched(true);
                  setField('bodyZone', event.target.value as BodyZone | '');
                }}
              >
                <option value="">No default</option>
                {bodyZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {bodyZoneLabels[zone]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Brand"
                name="brand"
                value={draft.brand}
                maxLength={120}
                onChange={(event) => setField('brand', event.target.value)}
              />
              <TextField
                label="Size"
                name="size"
                value={draft.size}
                maxLength={60}
                onChange={(event) => setField('size', event.target.value)}
              />
              <TextField
                label="Color"
                name="colorName"
                value={draft.colorName}
                maxLength={80}
                onChange={(event) => setField('colorName', event.target.value)}
              />
              <TextField
                label="Material"
                name="material"
                value={draft.material}
                maxLength={200}
                onChange={(event) => setField('material', event.target.value)}
              />
              <TextField
                label="Season"
                name="season"
                value={draft.season}
                maxLength={120}
                onChange={(event) => setField('season', event.target.value)}
              />
              <div className={styles.priceFields}>
                <TextField
                  id="import-purchase-price"
                  label="Purchase price"
                  name="purchasePrice"
                  inputMode="decimal"
                  value={draft.purchasePrice}
                  error={errors.purchasePrice}
                  onChange={(event) => setField('purchasePrice', event.target.value)}
                />
                <TextField
                  id="import-purchase-currency"
                  label="Currency"
                  name="purchaseCurrency"
                  value={draft.purchaseCurrency}
                  maxLength={3}
                  error={errors.purchaseCurrency}
                  onChange={(event) =>
                    setField('purchaseCurrency', event.target.value.toUpperCase())
                  }
                />
              </div>
              <TextField
                label="Purchase date"
                name="purchaseDate"
                type="date"
                value={draft.purchaseDate}
                onChange={(event) => setField('purchaseDate', event.target.value)}
              />
              <TextAreaField
                label="Notes"
                name="notes"
                value={draft.notes}
                maxLength={4000}
                onChange={(event) => setField('notes', event.target.value)}
              />
            </div>
          </fieldset>
          <div className={styles.submitArea}>
            {uploadLabel === null ? null : (
              <div className={styles.progress} role="status" aria-live="polite">
                <progress max="100" value={uploadPercent ?? undefined} />
                <span>{uploadLabel}</span>
              </div>
            )}
            {submitError === null ? null : (
              <p className={styles.submitError} role="alert">
                {submitError}
              </p>
            )}
            <div className={styles.submitButtons}>
              {importMutation.isPending && uploadPercent !== 100 ? (
                <ActionButton variant="danger" onClick={() => abortControllerRef.current?.abort()}>
                  <X aria-hidden="true" /> Cancel import
                </ActionButton>
              ) : importMutation.isPending ? (
                <span className={styles.finishingStatus}>Finishing safely on this device…</span>
              ) : (
                <NavigationButton to={returnTo}>Cancel</NavigationButton>
              )}
              <ActionButton variant="primary" type="submit" disabled={importMutation.isPending}>
                <Upload aria-hidden="true" /> Import garment
              </ActionButton>
            </div>
          </div>
        </section>
      </form>

      {blocker.state === 'blocked' ? (
        <ModalDialog
          title="Discard this garment?"
          description="Your selected image and entered details have not been imported."
          onClose={() => blocker.reset()}
        >
          <DialogActions>
            <ActionButton data-autofocus onClick={() => blocker.reset()}>
              Keep editing
            </ActionButton>
            <ActionButton variant="danger" onClick={() => blocker.proceed()}>
              Discard changes
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}
    </div>
  );
}
