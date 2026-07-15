import { Camera, CheckCircle2, ImagePlus, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';

import {
  categoryLabels,
  defaultBodyZoneByCategory,
  garmentCategories,
  type ClothingWritePayload,
  type GarmentCategory,
} from '../../src/features/clothing/model';
import { getLanSession, MobileUploadError, uploadPhoneGarment, type LanSession } from './api';
import {
  consumePhoneEntryState,
  markPhoneUploadAttempted,
  rememberTerminalState,
  type PhoneTerminalState,
} from './token';

const maxClientFileSize = 25 * 1024 * 1024;
const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Phase =
  | 'preparing'
  | 'form'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'used'
  | 'invalid'
  | 'unavailable';

interface MobileDraft {
  name: string;
  category: GarmentCategory | '';
  brand: string;
  size: string;
  colorName: string;
  material: string;
  season: string;
  notes: string;
}

const initialDraft: MobileDraft = {
  name: '',
  category: '',
  brand: '',
  size: '',
  colorName: '',
  material: '',
  season: '',
  notes: '',
};

function optional(value: string): string | null {
  const result = value.trim();
  return result === '' ? null : result;
}

function payloadFromDraft(draft: MobileDraft): ClothingWritePayload {
  if (draft.category === '') {
    throw new Error('A garment category is required.');
  }
  return {
    name: draft.name.trim(),
    garment_category: draft.category,
    default_body_zone: defaultBodyZoneByCategory[draft.category],
    brand: optional(draft.brand),
    size: optional(draft.size),
    color_name: optional(draft.colorName),
    material: optional(draft.material),
    season: optional(draft.season),
    purchase_price: null,
    purchase_currency: null,
    purchase_date: null,
    notes: optional(draft.notes),
  };
}

function terminalToPhase(terminal: PhoneTerminalState | null): Phase | null {
  if (terminal === null) {
    return null;
  }
  return terminal;
}

function terminalForSession(
  session: LanSession,
  uploadAttempted: boolean,
): PhoneTerminalState | null {
  if (session.status === 'completed') {
    return uploadAttempted ? 'completed' : 'used';
  }
  if (session.status === 'expired') {
    return 'expired';
  }
  if (session.status === 'cancelled') {
    return 'cancelled';
  }
  if (session.status === 'failed' && !session.canRetry) {
    return 'failed';
  }
  return null;
}

function terminalForError(error: MobileUploadError): PhoneTerminalState | null {
  const terminalByCode: Readonly<Record<string, PhoneTerminalState>> = {
    phone_upload_session_expired: 'expired',
    phone_upload_session_cancelled: 'cancelled',
    phone_upload_session_used: 'used',
    phone_upload_session_already_used: 'used',
    phone_upload_session_completed: 'used',
    phone_upload_session_invalid: 'invalid',
    phone_upload_attempts_exhausted: 'failed',
  };
  return terminalByCode[error.code] ?? null;
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error === undefined ? null : (
        <span className="fieldError" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TerminalScreen({
  phase,
  onRetry,
  retrying = false,
}: {
  phase: Exclude<Phase, 'preparing' | 'form' | 'uploading' | 'processing'>;
  onRetry?: (() => void) | undefined;
  retrying?: boolean | undefined;
}) {
  const content = {
    completed: {
      title: 'Garment added',
      message: 'Your garment is saved on Muse. You can close this page and continue on the device.',
      icon: <CheckCircle2 aria-hidden="true" />,
    },
    expired: {
      title: 'This code expired',
      message: 'Return to Add Garment on Muse and generate a new phone upload code.',
      icon: <RefreshCw aria-hidden="true" />,
    },
    cancelled: {
      title: 'Upload cancelled',
      message: 'This code was cancelled on Muse and can no longer be used.',
      icon: <X aria-hidden="true" />,
    },
    failed: {
      title: 'Upload failed',
      message: 'No garment was added. Return to Muse and generate a new phone upload code.',
      icon: <X aria-hidden="true" />,
    },
    used: {
      title: 'Code already used',
      message:
        'For your privacy, each code imports at most one garment. Generate a new code on Muse.',
      icon: <X aria-hidden="true" />,
    },
    invalid: {
      title: 'Invalid upload code',
      message: 'This link is incomplete or invalid. Scan a new code from the Muse screen.',
      icon: <X aria-hidden="true" />,
    },
    unavailable: {
      title: 'Muse is unavailable',
      message:
        'Stay connected to the same local network. Muse will retry automatically, or you can try again now.',
      icon: <Smartphone aria-hidden="true" />,
    },
  } as const;
  const selected = content[phase];
  return (
    <main className={`terminalCard terminal_${phase}`}>
      <span className="terminalIcon">{selected.icon}</span>
      <p className="eyebrow">Muse phone upload</p>
      <h1>{selected.title}</h1>
      <p>{selected.message}</p>
      {phase === 'unavailable' && onRetry !== undefined ? (
        <button
          className="terminalRetry"
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
        >
          <RefreshCw className={retrying ? 'spinner' : undefined} aria-hidden="true" />
          {retrying ? 'Checking…' : 'Try again'}
        </button>
      ) : null}
    </main>
  );
}

export function MobileUploadApp() {
  const entry = useMemo(() => consumePhoneEntryState(), []);
  const token = entry.token;
  const initialTerminal = terminalToPhase(entry.terminal);
  const terminalPhaseRef = useRef<PhoneTerminalState | null>(entry.terminal);
  const uploadAttempted = useRef(entry.uploadAttempted);
  const uploadController = useRef<AbortController | null>(null);
  const authoritativeFailureAbort = useRef(false);
  const previewUrlRef = useRef<string | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    initialTerminal ?? (token === null ? 'invalid' : 'preparing'),
  );
  const [session, setSession] = useState<LanSession | null>(null);
  const [draft, setDraft] = useState<MobileDraft>(initialDraft);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(
    entry.invalidFragment ? 'This phone upload code is not valid.' : null,
  );
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [recoveryRequest, setRecoveryRequest] = useState(0);
  const [retryingConnection, setRetryingConnection] = useState(false);

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current !== null) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const enterTerminal = useCallback(
    (terminal: PhoneTerminalState) => {
      if (terminalPhaseRef.current !== null) {
        return;
      }
      terminalPhaseRef.current = terminal;
      releasePreview();
      rememberTerminalState(terminal);
      setPhase(terminal);
    },
    [releasePreview],
  );

  const applySession = useCallback(
    (next: LanSession) => {
      if (terminalPhaseRef.current !== null) {
        return;
      }
      setRetryingConnection(false);
      setSubmitError(null);
      setSession(next);
      const terminal = terminalForSession(next, uploadAttempted.current);
      if (terminal !== null) {
        enterTerminal(terminal);
        return;
      }
      if (next.status === 'failed') {
        if (uploadController.current !== null) {
          authoritativeFailureAbort.current = true;
          uploadController.current.abort();
        }
        setSubmitError('Muse could not complete that upload. Your details are ready to try again.');
        setPhase('form');
        return;
      }
      setPhase((current) => {
        if (terminalPhaseRef.current !== null) {
          return current;
        }
        if (next.status === 'uploading') {
          return current === 'processing' ? 'processing' : 'uploading';
        }
        if (next.status === 'processing') {
          return 'processing';
        }
        return current === 'uploading' || current === 'processing' ? current : 'form';
      });
    },
    [enterTerminal],
  );

  const applyResolvedRequestError = useCallback(
    (error: unknown, source: 'status' | 'upload') => {
      if (terminalPhaseRef.current !== null) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (error instanceof MobileUploadError) {
        const terminal = terminalForError(error);
        if (terminal !== null) {
          enterTerminal(terminal);
        } else if (!error.retryable && uploadAttempted.current) {
          enterTerminal('failed');
        } else {
          setSubmitError(error.message);
          setPhase((current) => {
            if (source === 'status') {
              return current === 'preparing' || current === 'unavailable' ? 'unavailable' : current;
            }
            return error.retryable && current !== 'preparing' ? 'form' : 'unavailable';
          });
        }
        return;
      }
      setSubmitError('Muse could not be reached on the local network.');
      setPhase((current) => {
        if (source === 'status') {
          return current === 'preparing' || current === 'unavailable' ? 'unavailable' : current;
        }
        return 'unavailable';
      });
    },
    [enterTerminal],
  );

  const applyRequestError = useCallback(
    async (
      error: unknown,
      { signal, source }: { signal?: AbortSignal; source: 'status' | 'upload' },
    ) => {
      if (terminalPhaseRef.current !== null) {
        return;
      }
      if (
        error instanceof MobileUploadError &&
        (error.code === 'phone_upload_session_used' ||
          error.code === 'phone_upload_session_already_used') &&
        uploadAttempted.current &&
        token !== null
      ) {
        setPhase((current) => (current === 'completed' ? current : 'processing'));
        try {
          applySession(await getLanSession(token, signal));
          return;
        } catch (statusError) {
          applyResolvedRequestError(statusError, source);
          return;
        }
      }
      applyResolvedRequestError(error, source);
    },
    [applyResolvedRequestError, applySession, token],
  );

  useEffect(() => {
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    return () => {
      cleanupTimerRef.current = window.setTimeout(releasePreview, 0);
    };
  }, [releasePreview]);

  useEffect(
    () => () => {
      uploadController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (token === null) {
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    void getLanSession(token, controller.signal)
      .then((next) => {
        if (!stopped) {
          applySession(next);
        }
      })
      .catch((error: unknown) => {
        if (!stopped) {
          void applyRequestError(error, { signal: controller.signal, source: 'status' });
        }
      });
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [applyRequestError, applySession, token]);

  useEffect(() => {
    if (
      token === null ||
      (phase !== 'form' &&
        phase !== 'uploading' &&
        phase !== 'processing' &&
        phase !== 'unavailable')
    ) {
      return;
    }
    let stopped = false;
    let timer: number | null = null;
    let activeController: AbortController | null = null;
    const delay = phase === 'form' || phase === 'unavailable' ? 5_000 : 2_000;
    const runImmediately = phase === 'unavailable' && recoveryRequest > 0;

    const schedule = () => {
      if (!stopped) {
        timer = window.setTimeout(() => void poll(), delay);
      }
    };
    const poll = async () => {
      if (stopped) {
        return;
      }
      if (document.visibilityState !== 'visible') {
        if (runImmediately) {
          setRetryingConnection(false);
        }
        schedule();
        return;
      }
      const controller = new AbortController();
      activeController = controller;
      try {
        const next = await getLanSession(token, controller.signal);
        if (!stopped) {
          applySession(next);
        }
      } catch (error) {
        if (!stopped) {
          await applyRequestError(error, { signal: controller.signal, source: 'status' });
        }
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
        if (runImmediately && !stopped) {
          setRetryingConnection(false);
        }
        schedule();
      }
    };

    if (runImmediately) {
      void poll();
    } else {
      schedule();
    }
    return () => {
      stopped = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      activeController?.abort();
    };
  }, [applyRequestError, applySession, phase, recoveryRequest, token]);

  function retryConnection() {
    if (token === null || retryingConnection) {
      return;
    }
    setSubmitError(null);
    setRetryingConnection(true);
    setRecoveryRequest((current) => current + 1);
  }

  function setField<Key extends keyof MobileDraft>(field: Key, value: MobileDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError(null);
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (selected === null) {
      return;
    }
    const lowerName = selected.name.toLowerCase();
    if (
      selected.type === 'image/heic' ||
      selected.type === 'image/heif' ||
      /\.(?:heic|heif)$/u.test(lowerName)
    ) {
      setErrors((current) => ({
        ...current,
        image:
          'HEIC and HEIF are not supported on this Muse device. On iPhone, use Camera > Formats > Most Compatible, or choose a JPG, PNG, or WebP copy.',
      }));
      return;
    }
    const hasSupportedSuffix = /\.(?:jpe?g|png|webp)$/u.test(lowerName);
    if (
      (selected.type !== '' && !supportedMimeTypes.has(selected.type)) ||
      (selected.type === '' && !hasSupportedSuffix)
    ) {
      setErrors((current) => ({ ...current, image: 'Choose a JPG, PNG, or WebP image.' }));
      return;
    }
    if (selected.size === 0 || selected.size > maxClientFileSize) {
      setErrors((current) => ({
        ...current,
        image:
          selected.size === 0
            ? 'The selected image is empty.'
            : 'Choose an image smaller than 25 MiB.',
      }));
      return;
    }
    if (previewUrl !== null) {
      releasePreview();
    }
    setImage(selected);
    const nextPreviewUrl = URL.createObjectURL(selected);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setErrors((current) => {
      const next = { ...current };
      delete next.image;
      return next;
    });
    setSubmitError(null);
  }

  function removeImage() {
    releasePreview();
    setImage(null);
    setPreviewUrl(null);
    setUploadPercent(null);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (image === null) {
      next.image = 'Choose or take one garment photograph.';
    }
    if (draft.name.trim() === '') {
      next.name = 'Enter a garment name.';
    }
    if (draft.name.trim().length > 120) {
      next.name = 'Use 120 characters or fewer.';
    }
    if (draft.category === '') {
      next.category = 'Choose a garment category.';
    }
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0 || image === null || token === null) {
      const firstId =
        image === null ? 'phone-image-gallery' : nextErrors.name ? 'phone-name' : 'phone-category';
      window.setTimeout(() => document.getElementById(firstId)?.focus(), 0);
      return;
    }
    const controller = new AbortController();
    authoritativeFailureAbort.current = false;
    uploadController.current = controller;
    uploadAttempted.current = true;
    markPhoneUploadAttempted();
    setUploadPercent(0);
    setPhase('uploading');
    try {
      await uploadPhoneGarment({
        token,
        image,
        metadata: payloadFromDraft(draft),
        signal: controller.signal,
        onProgress: ({ percent }) => {
          setUploadPercent(percent);
          if (percent === 100) {
            setPhase('processing');
          }
        },
      });
      enterTerminal('completed');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPhase('form');
        if (authoritativeFailureAbort.current) {
          authoritativeFailureAbort.current = false;
          setSubmitError(
            'Muse could not complete that upload. Your photograph and details are ready to try again.',
          );
        } else {
          setSubmitError('Upload cancelled. Your photograph and details are still ready to retry.');
        }
      } else {
        await applyRequestError(error, { signal: controller.signal, source: 'upload' });
      }
    } finally {
      uploadController.current = null;
    }
  }

  if (
    phase === 'completed' ||
    phase === 'expired' ||
    phase === 'cancelled' ||
    phase === 'failed' ||
    phase === 'used' ||
    phase === 'invalid' ||
    phase === 'unavailable'
  ) {
    return (
      <TerminalScreen
        phase={phase}
        onRetry={phase === 'unavailable' ? retryConnection : undefined}
        retrying={retryingConnection}
      />
    );
  }

  return (
    <main className="mobileShell">
      <header className="mobileHeader">
        <span className="mobileMark" aria-hidden="true">
          M
        </span>
        <div>
          <p className="eyebrow">Muse</p>
          <h1>Add Garment</h1>
        </div>
      </header>

      {phase === 'preparing' ? (
        <section className="preparingCard" role="status" aria-live="polite">
          <RefreshCw className="spinner" aria-hidden="true" />
          <h2>Preparing your secure upload…</h2>
          <p>Keep this phone connected to the same local network as Muse.</p>
        </section>
      ) : (
        <form className="uploadForm" onSubmit={(event) => void submit(event)} noValidate>
          <p className="networkReminder">
            <Smartphone aria-hidden="true" /> Keep this phone connected to the same local network as
            Muse until the garment is added.
          </p>
          <section className="formCard imageCard" aria-labelledby="phone-photo-title">
            <div className="sectionTitle">
              <span>1</span>
              <div>
                <h2 id="phone-photo-title">Garment photograph</h2>
                <p>Use one clear photograph of the garment.</p>
              </div>
            </div>
            <input
              className="fileInput"
              id="phone-image-camera"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              capture="environment"
              onChange={selectImage}
              disabled={phase !== 'form'}
            />
            <input
              className="fileInput"
              ref={galleryInput}
              id="phone-image-gallery"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={selectImage}
              disabled={phase !== 'form'}
              aria-invalid={errors.image === undefined ? undefined : true}
              aria-describedby={
                errors.image === undefined ? 'phone-image-help' : 'phone-image-error'
              }
            />
            {previewUrl === null ? (
              <div className="imageChoices">
                <label className="imageChoice primaryChoice" htmlFor="phone-image-camera">
                  <Camera aria-hidden="true" />
                  <span>Take a photo</span>
                </label>
                <label className="imageChoice" htmlFor="phone-image-gallery">
                  <ImagePlus aria-hidden="true" />
                  <span>Choose from photos</span>
                </label>
              </div>
            ) : (
              <div className="selectedImage">
                <img src={previewUrl} alt="Selected garment preview" />
                <div className="imageActions">
                  <button type="button" onClick={() => galleryInput.current?.click()}>
                    <RefreshCw aria-hidden="true" /> Replace
                  </button>
                  <button className="dangerButton" type="button" onClick={removeImage}>
                    <Trash2 aria-hidden="true" /> Remove
                  </button>
                </div>
              </div>
            )}
            <p className="imageHelp" id="phone-image-help">
              JPG, PNG or WebP · up to 25 MiB
            </p>
            {errors.image === undefined ? null : (
              <p className="fieldError" id="phone-image-error" role="alert">
                {errors.image}
              </p>
            )}
          </section>

          <section className="formCard" aria-labelledby="phone-details-title">
            <div className="sectionTitle">
              <span>2</span>
              <div>
                <h2 id="phone-details-title">Garment details</h2>
                <p>Name and category are required.</p>
              </div>
            </div>
            <div className="requiredFields">
              <Field id="phone-name" label="Garment name" error={errors.name}>
                <input
                  id="phone-name"
                  value={draft.name}
                  maxLength={120}
                  autoComplete="off"
                  required
                  disabled={phase !== 'form'}
                  aria-invalid={errors.name === undefined ? undefined : true}
                  aria-describedby={errors.name === undefined ? undefined : 'phone-name-error'}
                  onChange={(event) => setField('name', event.target.value)}
                />
              </Field>
              <Field id="phone-category" label="Category" error={errors.category}>
                <select
                  id="phone-category"
                  value={draft.category}
                  required
                  disabled={phase !== 'form'}
                  aria-invalid={errors.category === undefined ? undefined : true}
                  aria-describedby={
                    errors.category === undefined ? undefined : 'phone-category-error'
                  }
                  onChange={(event) =>
                    setField('category', event.target.value as GarmentCategory | '')
                  }
                >
                  <option value="">Choose a category</option>
                  {garmentCategories.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabels[category]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {draft.category === '' ? null : (
              <p className="zoneSuggestion" role="status">
                Suggested placement:{' '}
                {defaultBodyZoneByCategory[draft.category].replaceAll('_', ' ')}
              </p>
            )}
            <details className="optionalDetails">
              <summary>Optional details</summary>
              <div className="optionalFields">
                {(
                  [
                    ['brand', 'Brand', 120],
                    ['size', 'Size', 60],
                    ['colorName', 'Color', 80],
                    ['material', 'Material', 200],
                    ['season', 'Season', 120],
                  ] as const
                ).map(([field, label, maxLength]) => (
                  <Field key={field} id={`phone-${field}`} label={label}>
                    <input
                      id={`phone-${field}`}
                      value={draft[field]}
                      maxLength={maxLength}
                      autoComplete="off"
                      disabled={phase !== 'form'}
                      onChange={(event) => setField(field, event.target.value)}
                    />
                  </Field>
                ))}
                <Field id="phone-notes" label="Notes">
                  <textarea
                    id="phone-notes"
                    value={draft.notes}
                    maxLength={4000}
                    disabled={phase !== 'form'}
                    onChange={(event) => setField('notes', event.target.value)}
                  />
                </Field>
              </div>
            </details>
          </section>

          <div className="submitDock">
            {phase === 'uploading' || phase === 'processing' ? (
              <div className="uploadProgress" role="status" aria-live="polite" aria-atomic="true">
                <progress max="100" value={uploadPercent ?? undefined} />
                <span>
                  {phase === 'processing'
                    ? 'Processing safely on Muse…'
                    : uploadPercent === null
                      ? 'Uploading photograph…'
                      : `Uploading photograph… ${uploadPercent}%`}
                </span>
              </div>
            ) : null}
            {submitError === null ? null : (
              <p className="submitError" role="alert">
                {submitError}
              </p>
            )}
            <div className="submitActions">
              {phase === 'uploading' && uploadPercent !== 100 ? (
                <button
                  className="dangerButton"
                  type="button"
                  onClick={() => uploadController.current?.abort()}
                >
                  <X aria-hidden="true" /> Cancel upload
                </button>
              ) : null}
              <button
                className="submitButton"
                type="submit"
                disabled={phase !== 'form' || session?.canUpload === false}
              >
                <ImagePlus aria-hidden="true" /> Add garment to Muse
              </button>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
