import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getReadiness } from '../../api/healthClient';
import { createMuseQueryClient } from '../../app/queryClient';
import { DisplayPreferencesProvider } from '../../features/settings/DisplayPreferencesProvider';
import { defaultApplicationPreferences } from '../../features/settings/model';
import { settingsKeys } from '../../features/settings/queries';
import { StartupExperience } from './StartupExperience';

const readyResponse = {
  status: 'ready',
  checks: {
    database: { status: 'ok' },
    migrations: { status: 'ok' },
    storage: { status: 'ok' },
  },
} as const;

const notReadyResponse = {
  status: 'not_ready',
  checks: {
    database: { status: 'ok' },
    migrations: { status: 'ok' },
    storage: { status: 'error', message: 'Still starting.' },
  },
} as const;

function stubMotionPreference(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

function renderStartup(
  checkReadiness: typeof getReadiness,
  preferenceUpdate: Partial<typeof defaultApplicationPreferences> = {},
) {
  const queryClient = createMuseQueryClient();
  queryClient.setQueryData(settingsKeys.preferences, {
    preferences: { ...defaultApplicationPreferences, ...preferenceUpdate },
    lastSuccessfulBackup: null,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DisplayPreferencesProvider>
        <StartupExperience
          checkReadiness={checkReadiness}
          introDurationMs={40}
          reducedIntroDurationMs={5}
          readyHoldDurationMs={5}
          exitDurationMs={5}
          blackDurationMs={5}
          recoveryDelayMs={50}
          pollIntervalMs={10}
        >
          <main>Wardrobe ready</main>
        </StartupExperience>
      </DisplayPreferencesProvider>
    </QueryClientProvider>,
  );
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  stubMotionPreference(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StartupExperience', () => {
  it('plays the full cold-start sequence and never reveals the app before readiness', async () => {
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(readyResponse);

    const { container } = renderStartup(checkReadiness);

    expect(container.querySelector('[data-startup-state="intro"]')).toHaveAttribute(
      'data-splash-playback',
      'full',
    );
    expect(container.querySelector('[data-startup-wordmark]')).toHaveTextContent('Muse');
    expect(screen.getByText('Your wardrobe, reimagined.')).toBeVisible();
    expect(screen.queryByText('Wardrobe ready')).not.toBeInTheDocument();
    await advance(39);
    expect(container.querySelector('[data-startup-state="intro"]')).toBeInTheDocument();
    await advance(1);
    expect(container.querySelector('[data-startup-state="waiting"]')).toBeInTheDocument();
    await advance(5);
    expect(container.querySelector('[data-startup-state="leaving"]')).toBeInTheDocument();
    await advance(5);
    expect(container.querySelector('[data-startup-state="black"]')).toBeInTheDocument();
    await advance(5);
    expect(screen.getByText('Wardrobe ready')).toBeVisible();
    expect(container.querySelector('[data-startup-state="ready"]')).toBeInTheDocument();
  });

  it('holds on the local preparation state until a late readiness response succeeds', async () => {
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(notReadyResponse);

    const { container } = renderStartup(checkReadiness);
    await advance(40);

    expect(container.querySelector('[data-startup-state="waiting"]')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('preparing your local wardrobe');
    expect(screen.queryByText('Wardrobe ready')).not.toBeInTheDocument();

    checkReadiness.mockResolvedValue(readyResponse);
    await advance(10);
    await advance(5);
    await advance(5);
    await advance(5);
    expect(screen.getByText('Wardrobe ready')).toBeVisible();
    expect(checkReadiness.mock.calls.length).toBeGreaterThan(1);
  });

  it('offers a focused recovery action and can recover after retry', async () => {
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(notReadyResponse);

    const { container } = renderStartup(checkReadiness);
    await advance(50);

    expect(container.querySelector('[data-startup-state="recovery"]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Muse needs another moment.' })).toHaveFocus();
    checkReadiness.mockResolvedValue(readyResponse);
    fireEvent.click(screen.getByRole('button', { name: 'Retry startup' }));
    await advance(0);
    await advance(5);
    await advance(5);
    await advance(5);

    expect(screen.getByText('Wardrobe ready')).toBeVisible();
  });

  it('uses a reduced replay after the full Splash has already played this browser session', () => {
    window.sessionStorage.setItem('muse.splash.played.v1', '1');
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(notReadyResponse);

    const { container } = renderStartup(checkReadiness);

    expect(container.querySelector('[data-splash-playback="reduced"]')).toBeInTheDocument();
  });

  it.each([
    ['the operating-system motion preference', true, {}],
    ['the persisted Muse preference', false, { reducedMotion: true }],
    ['the persisted reduced Splash mode', false, { splashMode: 'reduced' as const }],
  ])('uses reduced playback for %s', (_label, systemReduced, preferenceUpdate) => {
    stubMotionPreference(systemReduced);
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(notReadyResponse);

    const { container } = renderStartup(checkReadiness, preferenceUpdate);

    expect(container.querySelector('[data-splash-playback="reduced"]')).toBeInTheDocument();
  });

  it('does not let the visual skip override bypass readiness', async () => {
    window.history.replaceState({}, '', '/?splash=skip');
    const checkReadiness = vi.fn<typeof getReadiness>().mockResolvedValue(notReadyResponse);

    const { container } = renderStartup(checkReadiness);
    await advance(1);

    expect(container.querySelector('[data-startup-state="waiting"]')).toBeInTheDocument();
    expect(screen.queryByText('Wardrobe ready')).not.toBeInTheDocument();
  });
});
