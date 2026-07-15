import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from './ApiClientError';
import { requestJson } from './request';

const identityDecoder = (value: unknown) => value;

function createFetchMock() {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('requests same-origin JSON and forwards cancellation', async () => {
    const fetchMock = createFetchMock();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      requestJson('/health', identityDecoder, { signal: controller.signal }),
    ).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      }),
    );
  });

  it('converts a structured API error without losing its request identifier', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'resource_conflict',
            message: 'The resource already exists.',
            details: { field: 'name' },
            request_id: 'request-from-body',
          },
        }),
        {
          status: 409,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': 'request-from-header',
          },
        },
      ),
    );

    const request = requestJson('/resource', identityDecoder);

    await expect(request).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'resource_conflict',
      message: 'The resource already exists.',
      status: 409,
      details: { field: 'name' },
      requestId: 'request-from-body',
    });
  });

  it('does not expose an unstructured server response', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response('<h1>Internal traceback</h1>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const request = requestJson('/resource', identityDecoder);

    await expect(request).rejects.toMatchObject({
      code: 'unexpected_response',
      message: 'The local Muse service could not complete the request.',
      status: 500,
    });
    await expect(request).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('traceback'),
    );
  });

  it('maps network failures to a safe unavailable error', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockRejectedValue(new TypeError('connection refused at a private address'));

    await expect(requestJson('/health', identityDecoder)).rejects.toMatchObject({
      code: 'backend_unavailable',
      message: 'Muse could not reach its local service.',
      status: null,
    });
  });

  it('preserves abort errors for caller-controlled cancellation', async () => {
    const fetchMock = createFetchMock();
    const abortError = new DOMException('The request was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    await expect(requestJson('/health', identityDecoder)).rejects.toBe(abortError);
  });

  it('allows an endpoint to decode an explicitly accepted non-success status', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'not_ready' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      requestJson('/readiness', identityDecoder, { acceptedStatuses: [503] }),
    ).resolves.toEqual({ status: 'not_ready' });
  });

  it('wraps decoder failures as invalid responses', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = requestJson('/health', () => {
      throw new Error('Malformed data');
    });

    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  });
});
