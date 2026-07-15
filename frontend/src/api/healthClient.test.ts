import { afterEach, describe, expect, it, vi } from 'vitest';

import { getHealth, getReadiness } from './healthClient';

function mockJsonResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('healthClient', () => {
  it('validates the health response contract', async () => {
    mockJsonResponse({ status: 'ok', service: 'muse-backend', version: '0.1.0' });

    await expect(getHealth()).resolves.toEqual({
      status: 'ok',
      service: 'muse-backend',
      version: '0.1.0',
    });
  });

  it('accepts a structured not-ready response returned with 503', async () => {
    mockJsonResponse(
      {
        status: 'not_ready',
        checks: {
          database: { status: 'ok' },
          migrations: { status: 'ok' },
          storage: { status: 'ok' },
          frontend: { status: 'error', message: 'Frontend build is unavailable.' },
        },
      },
      503,
    );

    await expect(getReadiness()).resolves.toMatchObject({
      status: 'not_ready',
      checks: {
        frontend: { status: 'error', message: 'Frontend build is unavailable.' },
      },
    });
  });

  it('rejects malformed health data', async () => {
    mockJsonResponse({ status: 'ok', service: 'another-service', version: '0.1.0' });

    await expect(getHealth()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('accepts the required readiness checks without the production-only frontend check', async () => {
    mockJsonResponse({
      status: 'ready',
      checks: {
        database: { status: 'ok', message: null },
        migrations: { status: 'ok', message: null },
        storage: { status: 'ok', message: null },
      },
    });

    await expect(getReadiness()).resolves.toMatchObject({
      status: 'ready',
      checks: {
        database: { status: 'ok', message: null },
        migrations: { status: 'ok', message: null },
        storage: { status: 'ok', message: null },
      },
    });
  });

  it('requires every readiness foundation check', async () => {
    mockJsonResponse({
      status: 'ready',
      checks: {
        database: { status: 'ok' },
        migrations: { status: 'ok' },
      },
    });

    await expect(getReadiness()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
