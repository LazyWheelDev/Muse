import { ApiClientError } from '../../api/ApiClientError';
import { createApiUrl } from '../../api/config';
import {
  decodeErrorEnvelope,
  fallbackHttpMessage,
  requestJson,
  requestVoid,
} from '../../api/request';
import { decodeClothingDetail, decodeClothingPage } from './decoders';
import type {
  ClothingItemDetail,
  ClothingPage,
  ClothingUpdatePayload,
  ClothingWritePayload,
  GarmentCategory,
} from './model';

export interface UploadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface ImportClothingOptions {
  image: File;
  metadata: ClothingWritePayload;
  signal?: AbortSignal;
  idempotencyKey?: string;
  onProgress?: (progress: UploadProgress) => void;
}

function clothingItemPath(itemId: number): `/clothing-items/${number}` {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new Error('Clothing item id must be a positive integer.');
  }
  return `/clothing-items/${itemId}`;
}

export function listClothingItems(
  category: GarmentCategory | 'all',
  signal?: AbortSignal,
): Promise<ClothingPage> {
  const search = new URLSearchParams({ limit: '100', offset: '0' });
  if (category !== 'all') {
    search.set('garment_category', category);
  }
  return requestJson(`/clothing-items?${search.toString()}`, decodeClothingPage, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getClothingItem(itemId: number, signal?: AbortSignal): Promise<ClothingItemDetail> {
  return requestJson(clothingItemPath(itemId), decodeClothingDetail, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function updateClothingItem(
  itemId: number,
  payload: ClothingUpdatePayload,
  signal?: AbortSignal,
): Promise<ClothingItemDetail> {
  return requestJson(clothingItemPath(itemId), decodeClothingDetail, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
}

export function deleteClothingItem(itemId: number, signal?: AbortSignal): Promise<void> {
  return requestVoid(clothingItemPath(itemId), {
    method: 'DELETE',
    ...(signal === undefined ? {} : { signal }),
  });
}

function readRequestId(xhr: XMLHttpRequest): string | undefined {
  const requestId = xhr.getResponseHeader('X-Request-ID')?.trim();
  return requestId ? requestId.slice(0, 500) : undefined;
}

function parseResponseBody(xhr: XMLHttpRequest): unknown {
  const contentType = xhr.getResponseHeader('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') || xhr.responseText.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(xhr.responseText) as unknown;
  } catch {
    return undefined;
  }
}

function uploadHttpError(xhr: XMLHttpRequest): ApiClientError {
  const envelope = decodeErrorEnvelope(parseResponseBody(xhr));
  const headerRequestId = readRequestId(xhr);
  if (envelope === undefined) {
    return new ApiClientError({
      code: 'unexpected_response',
      message: fallbackHttpMessage(xhr.status),
      status: xhr.status,
      ...(headerRequestId === undefined ? {} : { requestId: headerRequestId }),
    });
  }
  return new ApiClientError({
    code: envelope.error.code,
    message: envelope.error.message,
    status: xhr.status,
    ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }),
    ...(envelope.error.request_id === undefined
      ? headerRequestId === undefined
        ? {}
        : { requestId: headerRequestId }
      : { requestId: envelope.error.request_id }),
  });
}

export function importClothingItem(options: ImportClothingOptions): Promise<ClothingItemDetail> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('The import was cancelled.', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('metadata', JSON.stringify(options.metadata));
    formData.append('image', options.image, options.image.name);

    const abort = () => xhr.abort();
    options.signal?.addEventListener('abort', abort, { once: true });

    const finish = () => options.signal?.removeEventListener('abort', abort);
    xhr.open('POST', createApiUrl('/clothing-items/import'));
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    if (options.idempotencyKey !== undefined) {
      xhr.setRequestHeader('Idempotency-Key', options.idempotencyKey);
    }
    xhr.upload.addEventListener('progress', (event) => {
      options.onProgress?.({
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
      if (xhr.status !== 201) {
        reject(uploadHttpError(xhr));
        return;
      }
      try {
        resolve(decodeClothingDetail(parseResponseBody(xhr)));
      } catch (error) {
        reject(
          new ApiClientError({
            code: 'invalid_response',
            message: 'The local Muse service returned an invalid response.',
            status: xhr.status,
            cause: error,
          }),
        );
      }
    });
    xhr.addEventListener('error', () => {
      finish();
      reject(
        new ApiClientError({
          code: 'backend_unavailable',
          message: 'Muse could not reach its local service.',
        }),
      );
    });
    xhr.addEventListener('abort', () => {
      finish();
      reject(new DOMException('The import was cancelled.', 'AbortError'));
    });
    xhr.send(formData);
  });
}
