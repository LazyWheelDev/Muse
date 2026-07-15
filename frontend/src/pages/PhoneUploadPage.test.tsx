import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/renderApp';

const firstId = 'a'.repeat(32);
const secondId = 'b'.repeat(32);
const firstUrl = `http://muse.local:8765/u/#token=${'A'.repeat(43)}`;
const firstFallbackUrl = `http://192.168.1.20:8765/u/#token=${'A'.repeat(43)}`;
const secondUrl = `http://muse.local:8765/u/#token=${'B'.repeat(43)}`;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function timestamps() {
  const now = new Date();
  return {
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

function created(id = firstId, url = firstUrl, expiresAt = timestamps().expires_at) {
  return {
    id,
    status: 'pending',
    created_at: timestamps().created_at,
    expires_at: expiresAt,
    upload_url: url,
    fallback_upload_url: id === firstId ? firstFallbackUrl : null,
    qr_payload: url,
    listener_status: 'ready',
  };
}

function status(
  state: string,
  clothingItemId: number | null = null,
  listenerStatus: 'ready' | 'unavailable' = 'ready',
) {
  return {
    id: firstId,
    status: state,
    ...timestamps(),
    started_at: null,
    completed_at: state === 'completed' ? new Date().toISOString() : null,
    cancelled_at: null,
    failed_at: null,
    clothing_item_id: clothingItemId,
    error_code: null,
    listener_status: listenerStatus,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PhoneUploadPage', () => {
  it('creates one session and displays a local QR payload, URL fallback, and countdown', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/v1/phone-upload-sessions' && init?.method === 'POST') {
        return Promise.resolve(json(created(), 201));
      }
      if (url === `/api/v1/phone-upload-sessions/${firstId}`) {
        return Promise.resolve(json(status('pending')));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp('/wardrobe/add/phone');

    expect(await screen.findByRole('img', { name: /QR code/u })).toBeVisible();
    expect(screen.getByText(firstUrl)).toBeVisible();
    expect(screen.getByText(firstFallbackUrl)).toBeVisible();
    expect(screen.getByText('Waiting for phone')).toBeVisible();
    expect(screen.getByText('Phone upload available')).toBeVisible();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('regenerates atomically and replaces the visible one-time URL', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/v1/phone-upload-sessions') {
        return Promise.resolve(json(created(), 201));
      }
      if (url.endsWith('/regenerate') && init?.method === 'POST') {
        return Promise.resolve(json(created(secondId, secondUrl), 201));
      }
      if (url.includes('/phone-upload-sessions/')) {
        return Promise.resolve(
          json({ ...status('pending'), id: url.includes(secondId) ? secondId : firstId }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe/add/phone');
    await screen.findByText(firstUrl);

    await user.click(screen.getByRole('button', { name: 'Generate new code' }));
    expect(await screen.findByText(secondUrl)).toBeVisible();
    expect(screen.queryByText(firstUrl)).not.toBeInTheDocument();
  });

  it('cancels an active session before returning to the preserved Wardrobe context', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/v1/phone-upload-sessions') {
        return Promise.resolve(json(created(), 201));
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json(status('opened')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp(
      '/wardrobe/add/phone?returnTo=%2Fwardrobe%3Fcategory%3Dtop%26item%3D7',
    );
    await screen.findByText(firstUrl);
    await user.click(screen.getByRole('button', { name: 'Cancel session' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/wardrobe'));
    expect(router.state.location.search).toBe('?category=top&item=7');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('invalidates Wardrobe data and opens the imported garment after completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        return Promise.resolve(
          url === '/api/v1/phone-upload-sessions'
            ? json(created(), 201)
            : json(status('completed', 42)),
        );
      }),
    );
    const { router } = renderApp('/wardrobe/add/phone');

    expect(await screen.findByText('Import complete')).toBeVisible();
    await waitFor(() => expect(router.state.location.pathname).toBe('/wardrobe/42'), {
      timeout: 2_000,
    });
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe(
      '/wardrobe?item=42',
    );
  });

  it('keeps an admitted upload active after the code creation deadline', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      return Promise.resolve(
        url === '/api/v1/phone-upload-sessions'
          ? json(created(firstId, firstUrl, new Date(Date.now() - 1_000).toISOString()), 201)
          : json(status('processing')),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp('/wardrobe/add/phone');

    expect(await screen.findByText('Processing image')).toBeVisible();
    expect(screen.queryByText('Session expired')).not.toBeInTheDocument();
  });

  it('cancels a failed but still retryable session before leaving', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/v1/phone-upload-sessions') {
        return Promise.resolve(json(created(), 201));
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json(status('failed')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderApp('/wardrobe/add/phone');
    expect(await screen.findByText('Import failed')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel session' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/wardrobe'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it.each([
    ['opened', 'Phone connected'],
    ['uploading', 'Receiving image'],
    ['processing', 'Processing image'],
    ['failed', 'Import failed'],
    ['cancelled', 'Session cancelled'],
    ['expired', 'Session expired'],
  ])('announces the %s session state', async (sessionState, expectedTitle) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input) === '/api/v1/phone-upload-sessions'
            ? json(created(), 201)
            : json(status(sessionState)),
        ),
      ),
    );
    renderApp('/wardrobe/add/phone');

    expect(await screen.findByText(expectedTitle)).toBeVisible();
  });

  it('renders a safe network-unavailable creation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json(
            {
              error: {
                code: 'phone_upload_network_unavailable',
                message: 'Muse could not find a usable local-network address.',
              },
            },
            503,
          ),
        ),
      ),
    );
    renderApp('/wardrobe/add/phone');

    expect(
      await screen.findByText('Muse could not find a usable local-network address.'),
    ).toBeVisible();
    expect(screen.getByText('Phone upload unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
    expect(screen.queryByRole('img', { name: /QR code/u })).not.toBeInTheDocument();
  });

  it('retries listener-unavailable creation without displaying an unusable QR code', async () => {
    let createAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === '/api/v1/phone-upload-sessions' && init?.method === 'POST') {
        createAttempts += 1;
        return Promise.resolve(
          createAttempts === 1
            ? json(
                {
                  error: {
                    code: 'phone_upload_listener_unavailable',
                    message: 'Phone upload is temporarily unavailable on the local network.',
                  },
                },
                503,
              )
            : json(created(), 201),
        );
      }
      return Promise.resolve(json(status('pending')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/wardrobe/add/phone');

    expect(await screen.findByText('Phone upload unavailable')).toBeVisible();
    expect(screen.queryByRole('img', { name: /QR code/u })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry connection' }));

    expect(await screen.findByRole('img', { name: /QR code/u })).toBeVisible();
    expect(screen.getByText('Phone upload available')).toBeVisible();
    expect(createAttempts).toBe(2);
  });

  it('keeps the same QR visible and announces automatic recovery during listener outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input) === '/api/v1/phone-upload-sessions'
            ? json(created(), 201)
            : json(status('pending', null, 'unavailable')),
        ),
      ),
    );
    renderApp('/wardrobe/add/phone');

    expect(await screen.findByText('Phone upload unavailable')).toBeVisible();
    expect(screen.getByRole('img', { name: /QR code/u })).toBeVisible();
    expect(screen.getByText(firstUrl)).toBeVisible();
    expect(
      screen.getByText(/It will retry automatically, and this code remains valid/u),
    ).toBeVisible();
  });
});
