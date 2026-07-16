import { useId, useRef, useState } from 'react';

import {
  SettingsPanel,
  SettingsSectionPage,
  StatusNotice,
  ToggleControl,
} from '../components/settings/SettingsPrimitives';
import { useDisplayPreferences } from '../features/settings/displayPreferencesContext';
import type { ScreenTimeoutMinutes } from '../features/settings/model';
import styles from './SettingsSections.module.css';

export function DisplaySettingsPage() {
  const { preferences, settingsUnavailable, isSaving, previewPreferences, savePreferences } =
    useDisplayPreferences();
  const [error, setError] = useState<string | null>(null);
  const brightnessDirtyRef = useRef(false);
  const brightnessId = useId();
  const timeoutId = useId();

  async function save(update: Parameters<typeof savePreferences>[0]) {
    setError(null);
    try {
      await savePreferences(update);
    } catch {
      setError('Muse could not save this display preference. The previous value was restored.');
    }
  }

  function previewBrightness(value: number) {
    const safeValue = Math.min(100, Math.max(20, value));
    brightnessDirtyRef.current = true;
    previewPreferences({ interfaceBrightnessPercent: safeValue });
  }

  function commitBrightness() {
    if (!brightnessDirtyRef.current) return;
    brightnessDirtyRef.current = false;
    void save({ interfaceBrightnessPercent: preferences.interfaceBrightnessPercent });
  }

  return (
    <SettingsSectionPage title="Display">
      <SettingsPanel
        title="Interface brightness"
        description="This dims the Muse interface. It does not claim to change the physical display backlight."
      >
        <div className={styles.rangeField}>
          <div className={styles.fieldHeading}>
            <label htmlFor={brightnessId}>Interface brightness</label>
            <output htmlFor={brightnessId}>{preferences.interfaceBrightnessPercent}%</output>
          </div>
          <input
            type="range"
            id={brightnessId}
            min="20"
            max="100"
            step="5"
            value={preferences.interfaceBrightnessPercent}
            disabled={isSaving}
            onChange={(event) => previewBrightness(Number(event.target.value))}
            onPointerUp={commitBrightness}
            onBlur={commitBrightness}
          />
        </div>
      </SettingsPanel>

      <SettingsPanel title="Screen behavior">
        <div className={styles.selectRow}>
          <label htmlFor={timeoutId}>
            <span>Screen timeout</span>
            <small>Muse sleeps the display without stopping local services.</small>
          </label>
          <select
            id={timeoutId}
            value={preferences.screenTimeoutMinutes}
            disabled={isSaving}
            onChange={(event) =>
              void save({
                screenTimeoutMinutes: Number(event.target.value) as ScreenTimeoutMinutes,
              })
            }
          >
            <option value="0">Never</option>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
          </select>
        </div>
        <ToggleControl
          label="Reduced Motion"
          description="Use shorter fades and a simplified Splash experience."
          checked={preferences.reducedMotion}
          disabled={isSaving}
          onChange={(reducedMotion) => void save({ reducedMotion })}
        />
        <ToggleControl
          label="Full Splash on cold start"
          description="Reloads remain brief; normal navigation never replays Splash."
          checked={preferences.splashMode === 'full'}
          disabled={isSaving || preferences.reducedMotion}
          onChange={(full) => void save({ splashMode: full ? 'full' : 'reduced' })}
        />
      </SettingsPanel>

      {settingsUnavailable ? (
        <StatusNotice title="Settings service unavailable" tone="warning">
          Display preferences are using the last locally known values. Try again when Muse is ready.
        </StatusNotice>
      ) : null}
      {error === null ? null : (
        <StatusNotice title="Preference not saved" tone="danger" role="alert">
          {error}
        </StatusNotice>
      )}
    </SettingsSectionPage>
  );
}
