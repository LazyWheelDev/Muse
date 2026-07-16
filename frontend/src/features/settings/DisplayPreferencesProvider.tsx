import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSettings, useUpdateSettings } from './queries';
import {
  DisplayPreferencesContext,
  type DisplayPreferencesContextValue,
} from './displayPreferencesContext';
import {
  defaultApplicationPreferences,
  screenTimeoutMinutes,
  splashModes,
  type ApplicationPreferences,
  type ApplicationPreferencesUpdate,
} from './model';
import styles from './DisplayPreferencesProvider.module.css';

const CACHE_KEY = 'muse.display-preferences.v1';

function readCachedPreferences(): ApplicationPreferences {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === null) return defaultApplicationPreferences;
    const value = JSON.parse(raw) as Partial<ApplicationPreferences>;
    if (
      typeof value.deviceName !== 'string' ||
      value.deviceName.length === 0 ||
      value.deviceName.length > 48 ||
      !Number.isInteger(value.interfaceBrightnessPercent) ||
      Number(value.interfaceBrightnessPercent) < 20 ||
      Number(value.interfaceBrightnessPercent) > 100 ||
      !screenTimeoutMinutes.includes(value.screenTimeoutMinutes as never) ||
      typeof value.reducedMotion !== 'boolean' ||
      !splashModes.includes(value.splashMode as never)
    ) {
      return defaultApplicationPreferences;
    }
    return value as ApplicationPreferences;
  } catch {
    return defaultApplicationPreferences;
  }
}

function cachePreferences(preferences: ApplicationPreferences) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(preferences));
  } catch {
    // The server remains authoritative when browser storage is unavailable.
  }
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const settingsQuery = useSettings();
  const updateMutation = useUpdateSettings();
  const [cachedPreferences] = useState<ApplicationPreferences>(readCachedPreferences);
  const [localPreferences, setLocalPreferences] = useState<ApplicationPreferences | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const persistedPreferences = settingsQuery.data?.preferences ?? cachedPreferences;
  const preferences = localPreferences ?? persistedPreferences;

  useEffect(() => {
    if (settingsQuery.data === undefined) return;
    cachePreferences(settingsQuery.data.preferences);
  }, [settingsQuery.data]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.museReducedMotion = preferences.reducedMotion ? 'true' : 'false';
    root.style.setProperty(
      '--muse-interface-dim-opacity',
      String(((100 - preferences.interfaceBrightnessPercent) / 100) * 0.68),
    );
    return () => {
      delete root.dataset.museReducedMotion;
      root.style.removeProperty('--muse-interface-dim-opacity');
    };
  }, [preferences.interfaceBrightnessPercent, preferences.reducedMotion]);

  const previewPreferences = useCallback(
    (update: ApplicationPreferencesUpdate) => {
      setLocalPreferences((current) => ({ ...(current ?? persistedPreferences), ...update }));
    },
    [persistedPreferences],
  );

  const savePreferences = useCallback(
    async (update: ApplicationPreferencesUpdate) => {
      setLocalPreferences((current) => ({ ...(current ?? persistedPreferences), ...update }));
      try {
        const saved = await updateMutation.mutateAsync(update);
        cachePreferences(saved.preferences);
        setLocalPreferences(null);
      } catch (error) {
        setLocalPreferences(null);
        throw error;
      }
    },
    [persistedPreferences, updateMutation],
  );

  const sleepDisplay = useCallback(() => setSleeping(true), []);
  const wakeDisplay = useCallback(() => setSleeping(false), []);

  useEffect(() => {
    if (sleeping || preferences.screenTimeoutMinutes === 0) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSleeping(true), preferences.screenTimeoutMinutes * 60_000);
    };
    schedule();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    for (const eventName of events) window.addEventListener(eventName, schedule, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const eventName of events) window.removeEventListener(eventName, schedule);
    };
  }, [preferences.screenTimeoutMinutes, sleeping]);

  useEffect(() => {
    if (!sleeping) return;
    const wake = () => setSleeping(false);
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    for (const eventName of events) window.addEventListener(eventName, wake, { passive: true });
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, wake);
    };
  }, [sleeping]);

  const value = useMemo<DisplayPreferencesContextValue>(
    () => ({
      preferences,
      settingsUnavailable: settingsQuery.isError,
      isSaving: updateMutation.isPending,
      previewPreferences,
      savePreferences,
      sleeping,
      sleepDisplay,
      wakeDisplay,
    }),
    [
      preferences,
      previewPreferences,
      savePreferences,
      settingsQuery.isError,
      sleeping,
      sleepDisplay,
      updateMutation.isPending,
      wakeDisplay,
    ],
  );

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
      <div className={styles.dimmingOverlay} aria-hidden="true" />
      {sleeping ? (
        <button
          className={styles.sleepOverlay}
          type="button"
          aria-label="Wake Muse display"
          onClick={wakeDisplay}
        >
          <span className={styles.sleepMark} aria-hidden="true">
            M
          </span>
          <span>Touch anywhere to wake Muse</span>
        </button>
      ) : null}
    </DisplayPreferencesContext.Provider>
  );
}
