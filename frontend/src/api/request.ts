import { ApiClientError, isAbortError } from './ApiClientError';
import { createApiUrl } from './config';
import type { ApiErrorEnvelope } from './contracts';

export type JsonDecoder<T> = (value: unknown) => T;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  acceptedStatuses?: readonly number[];
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: BodyInit;
  headers?: HeadersInit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 && trimmedValue.length <= 500 ? trimmedValue : undefined;
}

export function decodeErrorEnvelope(value: unknown): ApiErrorEnvelope | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }

  const code = readSafeString(value.error.code);
  const message = readSafeString(value.error.message);

  if (code === undefined || message === undefined) {
    return undefined;
  }

  const requestId = readSafeString(value.error.request_id);

  return {
    error: {
      code,
      message,
      ...(Object.hasOwn(value.error, 'details') ? { details: value.error.details } : {}),
      ...(requestId === undefined ? {} : { request_id: requestId }),
    },
  };
}

export async function readJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');

  if (contentType === null || !contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function fallbackHttpMessage(status: number): string {
  if (status === 404) {
    return 'The requested local resource could not be found.';
  }

  if (status === 409) {
    return 'The local request conflicts with the current Muse data.';
  }

  return 'The local Muse service could not complete the request.';
}

async function createHttpError(response: Response): Promise<ApiClientError> {
  const responseBody = await readJsonSafely(response);
  const envelope = decodeErrorEnvelope(responseBody);
  const headerRequestId = readSafeString(response.headers.get('x-request-id'));

  if (envelope === undefined) {
    return new ApiClientError({
      code: 'unexpected_response',
      message: fallbackHttpMessage(response.status),
      status: response.status,
      ...(headerRequestId === undefined ? {} : { requestId: headerRequestId }),
    });
  }

  return new ApiClientError({
    code: envelope.error.code,
    message: envelope.error.message,
    status: response.status,
    ...(Object.hasOwn(envelope.error, 'details') ? { details: envelope.error.details } : {}),
    ...(envelope.error.request_id === undefined
      ? headerRequestId === undefined
        ? {}
        : { requestId: headerRequestId }
      : { requestId: envelope.error.request_id }),
  });
}

function requestHeaders(options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  return headers;
}

export async function requestJson<T>(
  endpointPath: `/${string}`,
  decoder: JsonDecoder<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(createApiUrl(endpointPath), {
      method: options.method ?? 'GET',
      headers: requestHeaders(options),
      cache: 'no-store',
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiClientError({
      code: 'backend_unavailable',
      message: 'Muse could not reach its local service.',
      cause: error,
    });
  }

  const acceptedStatus = options.acceptedStatuses?.includes(response.status) ?? false;

  if (!response.ok && !acceptedStatus) {
    throw await createHttpError(response);
  }

  const responseBody = await readJsonSafely(response);

  try {
    return decoder(responseBody);
  } catch (error) {
    throw new ApiClientError({
      code: 'invalid_response',
      message: 'The local Muse service returned an invalid response.',
      status: response.status,
      cause: error,
    });
  }
}

export async function requestVoid(
  endpointPath: `/${string}`,
  options: ApiRequestOptions = {},
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(createApiUrl(endpointPath), {
      method: options.method ?? 'DELETE',
      headers: requestHeaders(options),
      cache: 'no-store',
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiClientError({
      code: 'backend_unavailable',
      message: 'Muse could not reach its local service.',
      cause: error,
    });
  }

  const acceptedStatus = options.acceptedStatuses?.includes(response.status) ?? false;
  if (!response.ok && !acceptedStatus) {
    throw await createHttpError(response);
  }
}
