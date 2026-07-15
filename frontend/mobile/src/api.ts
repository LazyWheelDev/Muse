import type { ClothingWritePayload } from '../../src/features/clothing/model';

export type LanSessionStatus =
  | 'pending'
  | 'opened'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface LanSession {
  status: LanSessionStatus;
  expiresAt: string;
  canUpload: boolean;
  canRetry: boolean;
}

export interface MobileUploadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface LanUploadResult {
  status: 'completed';
}

export class MobileUploadError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor({
    code,
    message,
    status = null,
    retryable = false,
  }: {
    code: string;
    message: string;
    status?: number | null;
    retryable?: boolean;
  }) {
    super(message);
    this.name = 'MobileUploadError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const statuses: readonly LanSessionStatus[] = [
  'pending',
  'opened',
  'uploading',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'expired',
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function decodeLanSession(value: unknown): LanSession {
  const body = record(value);
  const status = body?.status;
  const expiresAt = body?.expires_at;
  const canUpload = body?.can_upload;
  const canRetry = body?.can_retry;
  if (
    typeof status !== 'string' ||
    !statuses.includes(status as LanSessionStatus) ||
    typeof expiresAt !== 'string' ||
    Number.isNaN(Date.parse(expiresAt)) ||
    typeof canUpload !== 'boolean' ||
    typeof canRetry !== 'boolean'
  ) {
    throw new MobileUploadError({
      code: 'invalid_response',
      message: 'Muse returned an invalid local response. Scan a new code on the device.',
    });
  }
  return { status: status as LanSessionStatus, expiresAt, canUpload, canRetry };
}

function decodeUploadResult(value: unknown): LanUploadResult {
  const body = record(value);
  if (body?.status !== 'completed') {
    throw new MobileUploadError({
      code: 'invalid_response',
      message: 'Muse returned an invalid local response. Check the garment on the device.',
    });
  }
  return { status: 'completed' };
}

function safeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    phone_upload_session_expired: 'This code has expired. Generate a new code on Muse.',
    phone_upload_session_cancelled: 'This upload was cancelled on Muse.',
    phone_upload_session_used: 'This code has already been used. Generate a new code on Muse.',
    phone_upload_session_already_used:
      'This code has already been used. Generate a new code on Muse.',
    phone_upload_session_invalid: 'This phone upload code is not valid.',
    phone_upload_session_busy: 'Another upload is already using this code.',
    phone_upload_attempts_exhausted:
      'This code has no upload attempts remaining. Generate a new code on Muse.',
    unsupported_image_format: 'Choose a JPG, PNG, or WebP image.',
    upload_too_large: 'Choose an image smaller than 25 MiB.',
    empty_image: 'The selected image is empty.',
    corrupt_image: 'This image could not be read safely. Choose another photograph.',
    image_mime_mismatch: 'The selected file does not match its image format.',
    image_pixel_limit_exceeded: 'This photograph is too large to process safely.',
    image_dimensions_exceeded: 'This photograph is too large to process safely.',
    rate_limit_exceeded: 'Too many requests were made. Wait briefly and try again.',
    phone_upload_rate_limited: 'Too many requests were made. Wait briefly and try again.',
    upload_concurrency_exceeded: 'Muse is receiving another photograph. Wait and try again.',
  };
  return messages[code] ?? 'Muse could not complete this local upload. Try again safely.';
}

function errorFromBody(status: number, value: unknown): MobileUploadError {
  const body = record(value);
  const error = record(body?.error);
  const code = typeof error?.code === 'string' ? error.code.slice(0, 120) : 'unexpected_response';
  const details = record(error?.details);
  const transientCodes = new Set([
    'phone_upload_session_busy',
    'phone_upload_rate_limited',
    'rate_limit_exceeded',
    'upload_concurrency_exceeded',
  ]);
  const retryable =
    typeof details?.retryable === 'boolean'
      ? details.retryable
      : status >= 500 || transientCodes.has(code);
  return new MobileUploadError({
    code,
    message: safeErrorMessage(code),
    status,
    retryable,
  });
}

function authHeaders(token: string): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  headers.set('X-Muse-Upload-Token', token);
  return headers;
}

export async function getLanSession(token: string, signal?: AbortSignal): Promise<LanSession> {
  let response: Response;
  try {
    response = await fetch('/phone-api/v1/session', {
      method: 'GET',
      headers: authHeaders(token),
      credentials: 'omit',
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new MobileUploadError({
      code: 'listener_unavailable',
      message: 'Muse could not be reached. Stay on the same local network and try again.',
      retryable: true,
    });
  }
  const value = parseJson(await response.text());
  if (!response.ok) {
    throw errorFromBody(response.status, value);
  }
  return decodeLanSession(value);
}

export function safeUploadFilename(image: File): string {
  const lowerName = image.name.toLowerCase();
  if (image.type === 'image/png' || (image.type === '' && lowerName.endsWith('.png'))) {
    return 'garment-upload.png';
  }
  if (image.type === 'image/webp' || (image.type === '' && lowerName.endsWith('.webp'))) {
    return 'garment-upload.webp';
  }
  return 'garment-upload.jpg';
}

export function uploadPhoneGarment({
  token,
  image,
  metadata,
  signal,
  onProgress,
}: {
  token: string;
  image: File;
  metadata: ClothingWritePayload;
  signal?: AbortSignal;
  onProgress?: (progress: MobileUploadProgress) => void;
}): Promise<LanUploadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));
    form.append('image', image, safeUploadFilename(image));
    const abort = () => xhr.abort();
    const finish = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });

    xhr.open('POST', '/phone-api/v1/upload');
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Muse-Upload-Token', token);
    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
        percent:
          event.lengthComputable && event.total > 0
            ? Math.min(100, Math.round((event.loaded / event.total) * 100))
            : null,
      });
    });
    xhr.addEventListener('load', () => {
      finish();
      const value = parseJson(xhr.responseText);
      if (xhr.status !== 201) {
        reject(errorFromBody(xhr.status, value));
        return;
      }
      try {
        resolve(decodeUploadResult(value));
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new MobileUploadError({
                code: 'invalid_response',
                message: 'Muse returned an invalid local response.',
              }),
        );
      }
    });
    xhr.addEventListener('error', () => {
      finish();
      reject(
        new MobileUploadError({
          code: 'listener_unavailable',
          message: 'The local connection was interrupted. Check Wi-Fi and try again.',
          retryable: true,
        }),
      );
    });
    xhr.addEventListener('abort', () => {
      finish();
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
    });
    xhr.send(form);
  });
}
