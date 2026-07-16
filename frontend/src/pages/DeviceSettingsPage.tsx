import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsSectionPage,
  StatusNotice,
} from '../components/settings/SettingsPrimitives';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { useCapabilities, useDeviceStatus } from '../features/settings/queries';
import { formatBytes, formatDuration } from '../features/settings/format';
import { useDisplayPreferences } from '../features/settings/displayPreferencesContext';
import styles from './SettingsSections.module.css';

const capabilityLabels = {
  wifiManagement: 'Wi-Fi management',
  hardwareBrightness: 'Hardware brightness',
  displaySleep: 'Display sleep',
  restartApplication: 'Restart Muse',
  rebootDevice: 'Restart device',
  shutdownDevice: 'Shut down device',
  backupRestore: 'Backup restore',
} as const;

function capabilityState(state: string): string {
  return state.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

export function DeviceSettingsPage() {
  const device = useDeviceStatus();
  const capabilities = useCapabilities();
  const { preferences, isSaving, savePreferences } = useDisplayPreferences();
  const [deviceName, setDeviceName] = useState(preferences.deviceName);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameId = useId();

  async function saveDeviceName() {
    const normalizedName = deviceName.trim();
    if (normalizedName.length === 0 || normalizedName.length > 48) {
      setNameError('Enter a device name between 1 and 48 characters.');
      return;
    }
    setNameError(null);
    try {
      await savePreferences({ deviceName: normalizedName });
      setDeviceName(normalizedName);
    } catch {
      setNameError('Muse could not save the device name. The previous name is still active.');
    }
  }

  return (
    <SettingsSectionPage title="Device">
      <SettingsPanel
        title="Device identity"
        description="This friendly name appears inside Muse. It does not rename the network host."
      >
        <div className={styles.deviceNameForm}>
          <label htmlFor={nameId}>Device name</label>
          <div>
            <input
              id={nameId}
              className={styles.textInput}
              value={deviceName}
              maxLength={48}
              aria-describedby={nameError === null ? undefined : `${nameId}-error`}
              aria-invalid={nameError !== null}
              disabled={isSaving}
              onChange={(event) => {
                setDeviceName(event.target.value);
                if (nameError !== null) setNameError(null);
              }}
            />
            <ActionButton
              variant="primary"
              disabled={isSaving || deviceName.trim() === preferences.deviceName}
              onClick={() => void saveDeviceName()}
            >
              {isSaving ? 'Saving…' : 'Save name'}
            </ActionButton>
          </div>
          {nameError === null ? null : (
            <p className={styles.fieldError} id={`${nameId}-error`} role="alert">
              {nameError}
            </p>
          )}
        </div>
      </SettingsPanel>

      {device.isPending ? (
        <LoadingState label="Checking this Muse device…" />
      ) : device.isError || device.data === undefined ? (
        <MessageState
          role="alert"
          title="Device information is unavailable."
          message="Muse has not changed any device setting."
          action={<RetryButton onRetry={() => void device.refetch()} />}
        />
      ) : (
        <>
          <SettingsPanel title="Muse status">
            <StatusNotice
              title={device.data.mainReadiness === 'ready' ? 'Muse is ready' : 'Muse is starting'}
              tone={device.data.mainReadiness === 'ready' ? 'success' : 'warning'}
            >
              {device.data.mainReadiness === 'ready'
                ? 'The local database, storage, and application are available.'
                : 'Some local foundations are not ready yet.'}
            </StatusNotice>
            <SettingsRows>
              <SettingsRow label="Device name" value={device.data.deviceName} />
              <SettingsRow label="Muse version" value={device.data.appVersion} />
              <SettingsRow label="Backend version" value={device.data.backendVersion} />
              <SettingsRow label="Operating system" value={device.data.operatingSystem} />
              <SettingsRow label="Python version" value={device.data.pythonVersion} />
              <SettingsRow label="Operating mode" value={device.data.operatingMode} />
              <SettingsRow
                label="Database"
                value={device.data.migrationsCurrent ? 'Ready' : 'Needs attention'}
              />
              <SettingsRow
                label="Phone upload listener"
                value={capabilityState(device.data.listenerReadiness)}
              />
              <SettingsRow
                label="Frontend build"
                value={device.data.frontendBuildAvailable ? 'Available' : 'Unavailable'}
              />
              <SettingsRow
                label="Started"
                value={new Date(device.data.startedAt).toLocaleString()}
              />
              <SettingsRow
                label="Device time"
                value={new Date(device.data.currentTime).toLocaleString()}
              />
              <SettingsRow
                label="Last successful backup"
                value={
                  device.data.lastSuccessfulBackup === null
                    ? 'No backup yet'
                    : new Date(device.data.lastSuccessfulBackup.createdAt).toLocaleString()
                }
              />
            </SettingsRows>
          </SettingsPanel>

          <SettingsPanel title="Device resources">
            <div className={styles.deviceGrid}>
              <div className={styles.summaryCard}>
                <strong>{device.data.architecture}</strong>
                <span>Architecture</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>{formatBytes(device.data.storageFreeBytes)}</strong>
                <span>Storage available</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>{formatBytes(device.data.storageTotalBytes)}</strong>
                <span>Total storage</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>
                  {device.data.memoryAvailableBytes === null
                    ? 'Unavailable'
                    : formatBytes(device.data.memoryAvailableBytes)}
                </strong>
                <span>Memory available</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>
                  {device.data.memoryTotalBytes === null
                    ? 'Unavailable'
                    : formatBytes(device.data.memoryTotalBytes)}
                </strong>
                <span>Total memory</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>
                  {device.data.temperatureCelsius === null
                    ? 'Unavailable'
                    : `${device.data.temperatureCelsius.toFixed(1)} °C`}
                </strong>
                <span>CPU temperature</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>{capabilityState(device.data.throttlingStatus)}</strong>
                <span>Throttling</span>
              </div>
              <div className={styles.summaryCard}>
                <strong>{formatDuration(device.data.uptimeSeconds)}</strong>
                <span>Uptime</span>
              </div>
            </div>
          </SettingsPanel>
        </>
      )}

      <SettingsPanel
        title="Device capabilities"
        description="Unavailable actions are never simulated."
      >
        {capabilities.isPending ? (
          <p role="status">Checking device capabilities…</p>
        ) : capabilities.isError || capabilities.data === undefined ? (
          <StatusNotice title="Capabilities unavailable" tone="warning">
            Privileged controls remain safely disabled.
          </StatusNotice>
        ) : (
          <SettingsRows>
            {(Object.keys(capabilityLabels) as Array<keyof typeof capabilityLabels>).map((key) => {
              const capability = capabilities.data[key];
              return (
                <SettingsRow
                  key={key}
                  label={capabilityLabels[key]}
                  value={capability.available ? 'Available' : capabilityState(capability.state)}
                />
              );
            })}
          </SettingsRows>
        )}
      </SettingsPanel>
    </SettingsSectionPage>
  );
}
import { useId, useState } from 'react';

import { ActionButton } from '../components/ui/Buttons';
