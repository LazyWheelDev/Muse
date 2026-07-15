import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { getHealth } from '../../api/healthClient';
import { BackendStatus } from './BackendStatus';

const healthyResponse = {
  status: 'ok',
  service: 'muse-backend',
  version: '0.1.0',
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('BackendStatus', () => {
  it('reports a successful local connection', async () => {
    const checkHealth = vi.fn<typeof getHealth>().mockResolvedValue(healthyResponse);

    render(<BackendStatus checkHealth={checkHealth} />);

    expect(screen.getByRole('status')).toHaveTextContent('Local service: checking');
    expect(await screen.findByText('Local service: connected')).toBeVisible();
  });

  it('reports unavailability without throwing into its parent layout', async () => {
    const checkHealth = vi
      .fn<typeof getHealth>()
      .mockRejectedValue(new Error('Private connection detail'));

    render(<BackendStatus checkHealth={checkHealth} />);

    expect(await screen.findByText('Local service: unavailable')).toBeVisible();
  });

  it('aborts its health request when unmounted', () => {
    let receivedSignal: AbortSignal | undefined;
    const checkHealth = vi.fn<typeof getHealth>((options = {}) => {
      receivedSignal = options.signal;
      return new Promise(() => undefined);
    });

    const { unmount } = render(<BackendStatus checkHealth={checkHealth} />);
    unmount();

    expect(receivedSignal?.aborted).toBe(true);
  });

  it('aborts a stalled request and reports it as unavailable', async () => {
    vi.useFakeTimers();
    const checkHealth = vi.fn<typeof getHealth>(({ signal } = {}) => {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Timed out.', 'AbortError'));
        });
      });
    });

    render(<BackendStatus checkHealth={checkHealth} timeoutMs={50} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Local service: unavailable');
  });
});
