import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { getReadiness } from '../../api/healthClient';
import { useDisplayPreferences } from '../../features/settings/displayPreferencesContext';
import { ActionButton } from '../ui/Buttons';
import styles from './StartupExperience.module.css';

const PLAYED_KEY = 'muse.splash.played.v1';

export type StartupVisualState = 'intro' | 'waiting' | 'leaving' | 'black' | 'ready' | 'recovery';
type PlaybackMode = 'full' | 'reduced' | 'skip';

export interface StartupExperienceProps {
  children: ReactNode;
  checkReadiness?: typeof getReadiness;
  introDurationMs?: number;
  reducedIntroDurationMs?: number;
  readyHoldDurationMs?: number;
  exitDurationMs?: number;
  blackDurationMs?: number;
  recoveryDelayMs?: number;
  pollIntervalMs?: number;
}

function splashOverride(): PlaybackMode | null {
  const override = new URLSearchParams(window.location.search).get('splash');
  if (override === 'full' || override === 'reduced' || override === 'skip') return override;
  return null;
}

function splashWasPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(PLAYED_KEY) !== null;
  } catch {
    return true;
  }
}

function systemPrefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function markPlayed() {
  try {
    window.sessionStorage.setItem(PLAYED_KEY, '1');
  } catch {
    // A reduced replay remains a safe fallback when session storage is unavailable.
  }
}

export function StartupExperience({
  children,
  checkReadiness = getReadiness,
  introDurationMs = 2_750,
  reducedIntroDurationMs = 320,
  readyHoldDurationMs = 180,
  exitDurationMs = 420,
  blackDurationMs = 180,
  recoveryDelayMs = 20_000,
  pollIntervalMs = 1_000,
}: StartupExperienceProps) {
  const { preferences } = useDisplayPreferences();
  const [override] = useState(splashOverride);
  const [playedBeforeThisMount] = useState(splashWasPlayed);
  const [systemReducedMotion] = useState(systemPrefersReducedMotion);
  const playback: PlaybackMode =
    override ??
    (preferences.reducedMotion ||
    preferences.splashMode === 'reduced' ||
    systemReducedMotion ||
    playedBeforeThisMount
      ? 'reduced'
      : 'full');
  const [visualState, setVisualState] = useState<StartupVisualState>('intro');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const recoveryRef = useRef<HTMLHeadingElement>(null);

  useEffect(markPlayed, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timer = 0;
    const recoveryTimer = window.setTimeout(() => {
      if (active) setVisualState((current) => (current === 'ready' ? current : 'recovery'));
    }, recoveryDelayMs);

    async function check() {
      try {
        const response = await checkReadiness({ signal: controller.signal });
        if (!active) return;
        if (response.status === 'ready') {
          window.clearTimeout(recoveryTimer);
          setReady(true);
          setVisualState((current) => (current === 'recovery' ? 'waiting' : current));
          return;
        }
      } catch {
        if (!active) return;
      }
      timer = window.setTimeout(() => void check(), pollIntervalMs);
    }

    void check();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(recoveryTimer);
    };
  }, [attempt, checkReadiness, pollIntervalMs, recoveryDelayMs]);

  useEffect(() => {
    if (visualState !== 'intro') return;
    const duration =
      playback === 'full' ? introDurationMs : playback === 'reduced' ? reducedIntroDurationMs : 0;
    const timer = window.setTimeout(() => setVisualState('waiting'), duration);
    return () => window.clearTimeout(timer);
  }, [introDurationMs, playback, reducedIntroDurationMs, visualState]);

  useEffect(() => {
    if (visualState !== 'waiting' || !ready) return;
    const timer = window.setTimeout(() => setVisualState('leaving'), readyHoldDurationMs);
    return () => window.clearTimeout(timer);
  }, [ready, readyHoldDurationMs, visualState]);

  useEffect(() => {
    if (visualState !== 'leaving') return;
    const timer = window.setTimeout(() => setVisualState('black'), exitDurationMs);
    return () => window.clearTimeout(timer);
  }, [exitDurationMs, visualState]);

  useEffect(() => {
    if (visualState !== 'black') return;
    const timer = window.setTimeout(() => setVisualState('ready'), blackDurationMs);
    return () => window.clearTimeout(timer);
  }, [blackDurationMs, visualState]);

  useEffect(() => {
    if (visualState === 'recovery') recoveryRef.current?.focus();
  }, [visualState]);

  const retry = useCallback(() => {
    setReady(false);
    setVisualState('waiting');
    setAttempt((value) => value + 1);
  }, []);

  if (visualState === 'ready') {
    return (
      <div className={styles.applicationReveal} data-startup-state="ready">
        {children}
      </div>
    );
  }

  const reduced = playback !== 'full';
  return (
    <div
      className={`${styles.startup} ${styles[visualState]} ${reduced ? styles.reduced : styles.full}`}
      data-startup-state={visualState}
      data-splash-playback={playback}
      aria-busy={visualState !== 'recovery'}
    >
      <span className={styles.backgroundMonogram} aria-hidden="true">
        M
      </span>

      {visualState === 'recovery' ? (
        <section className={styles.recoveryPanel} aria-labelledby="startup-recovery-title">
          <span className={styles.recoveryMark} aria-hidden="true">
            M
          </span>
          <h1 id="startup-recovery-title" ref={recoveryRef} tabIndex={-1}>
            Muse needs another moment.
          </h1>
          <p>The local application is not ready yet. Your wardrobe data has not been changed.</p>
          <ActionButton variant="primary" onClick={retry}>
            Retry startup
          </ActionButton>
        </section>
      ) : (
        <div className={styles.composition} role="status" aria-live="polite" aria-atomic="true">
          <span className={styles.accessibleStatus}>
            {visualState === 'waiting' && !ready
              ? 'Muse is preparing your local wardrobe.'
              : 'Muse. Your wardrobe, reimagined.'}
          </span>
          <div className={styles.dropletAssembly} aria-hidden="true">
            <span className={styles.trail} />
            <span className={styles.droplet} />
          </div>
          <div className={styles.wordmark} data-startup-wordmark aria-hidden="true">
            <span className={styles.letterM}>M</span>
            <span className={styles.letterU}>u</span>
            <span className={styles.letterS}>s</span>
            <span className={styles.letterE}>e</span>
          </div>
          <div className={styles.divider} aria-hidden="true">
            <span />
            <i />
            <span />
          </div>
          <p className={styles.tagline}>Your wardrobe, reimagined.</p>
          {visualState === 'waiting' && !ready ? (
            <p className={styles.waitingCopy}>Preparing your local wardrobe…</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
