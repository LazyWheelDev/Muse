import { Cpu, HardDrive, House, Info, Monitor, Power, Wifi } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { routePaths } from '../app/routeConfig';
import { ActionButton, NavigationButton } from '../components/ui/Buttons';
import { DialogActions, ModalDialog } from '../components/ui/ModalDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { useDisplayPreferences } from '../features/settings/displayPreferencesContext';
import type { DeviceAction } from '../features/settings/model';
import { useCapabilities, useScheduleDeviceAction } from '../features/settings/queries';
import styles from './SettingsPage.module.css';

const cards: ReadonlyArray<{
  path: string;
  label: string;
  accessibleLabel: string;
  icon: ReactNode;
  position: 'wide' | 'narrow';
}> = [
  {
    path: routePaths.settingsNetwork,
    label: 'W & N',
    accessibleLabel: 'Open Wi-Fi and Network settings',
    icon: <Wifi />,
    position: 'wide',
  },
  {
    path: routePaths.settingsDisplay,
    label: 'Display',
    accessibleLabel: 'Open Display settings',
    icon: <Monitor />,
    position: 'wide',
  },
  {
    path: routePaths.settingsData,
    label: 'Data',
    accessibleLabel: 'Open Data settings',
    icon: <HardDrive />,
    position: 'narrow',
  },
  {
    path: routePaths.settingsDevice,
    label: 'Device',
    accessibleLabel: 'Open Device settings',
    icon: <Cpu />,
    position: 'narrow',
  },
  {
    path: routePaths.settingsAbout,
    label: 'About Muse',
    accessibleLabel: 'Open About Muse',
    icon: <Info />,
    position: 'narrow',
  },
];

export function SettingsPage() {
  const [powerOpen, setPowerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<DeviceAction | null>(null);
  const [scheduledMessage, setScheduledMessage] = useState<string | null>(null);
  const { sleepDisplay } = useDisplayPreferences();
  const capabilities = useCapabilities();
  const scheduleAction = useScheduleDeviceAction();
  const reason =
    capabilities.data?.restartApplication.reason ??
    'This action requires Raspberry Pi deployment configuration.';
  const actionDetails: Record<DeviceAction, { label: string; description: string }> = {
    restart_application: {
      label: 'Restart Muse',
      description: 'Restart Muse services now? Active work must finish before restart begins.',
    },
    reboot_device: {
      label: 'Restart Device',
      description: 'Restart the Raspberry Pi now? Muse will return after the device boots.',
    },
    shutdown_device: {
      label: 'Shut Down',
      description: 'Shut down the Raspberry Pi now? Remove power only after the screen turns off.',
    },
  };

  function chooseAction(action: DeviceAction) {
    scheduleAction.reset();
    setPowerOpen(false);
    setPendingAction(action);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Settings"
        startAction={
          <NavigationButton to={routePaths.home} aria-label="Return to Home">
            <House aria-hidden="true" /> Home
          </NavigationButton>
        }
      />

      <nav className={styles.settingsGrid} aria-label="Settings sections">
        {cards.map((card) => (
          <Link
            key={card.path}
            className={`${styles.settingsCard} ${styles[card.position]}`}
            to={card.path}
            aria-label={card.accessibleLabel}
          >
            <span className={styles.iconCircle} aria-hidden="true">
              {card.icon}
            </span>
            <span>{card.label}</span>
          </Link>
        ))}
      </nav>

      <button
        className={styles.powerButton}
        type="button"
        aria-label="Open power options"
        onClick={() => setPowerOpen(true)}
      >
        <Power aria-hidden="true" />
      </button>

      {powerOpen ? (
        <ModalDialog
          title="Power options"
          description="Sleep keeps Muse running. Device actions remain unavailable until deployment is configured."
          onClose={() => setPowerOpen(false)}
        >
          <div className={styles.powerActions}>
            <ActionButton
              data-autofocus
              onClick={() => {
                setPowerOpen(false);
                sleepDisplay();
              }}
            >
              Sleep Display
            </ActionButton>
            <ActionButton
              disabled={!capabilities.data?.restartApplication.available}
              title={capabilities.data?.restartApplication.reason ?? undefined}
              onClick={() => chooseAction('restart_application')}
            >
              Restart Muse
            </ActionButton>
            <ActionButton
              disabled={!capabilities.data?.rebootDevice.available}
              title={capabilities.data?.rebootDevice.reason ?? undefined}
              onClick={() => chooseAction('reboot_device')}
            >
              Restart Device
            </ActionButton>
            <ActionButton
              disabled={!capabilities.data?.shutdownDevice.available}
              title={capabilities.data?.shutdownDevice.reason ?? undefined}
              onClick={() => chooseAction('shutdown_device')}
            >
              Shut Down
            </ActionButton>
          </div>
          <p className={styles.capabilityNotice} role="status">
            {capabilities.isError
              ? 'Device controls could not be checked. Privileged actions remain safely unavailable.'
              : reason}
          </p>
          <DialogActions>
            <ActionButton onClick={() => setPowerOpen(false)}>Cancel</ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}
      {pendingAction !== null ? (
        <ModalDialog
          title={actionDetails[pendingAction].label}
          description={actionDetails[pendingAction].description}
          onClose={() => {
            if (!scheduleAction.isPending) setPendingAction(null);
          }}
        >
          {scheduleAction.isError ? (
            <p role="alert">The device action could not be scheduled. No power action was taken.</p>
          ) : null}
          <DialogActions>
            <ActionButton
              data-autofocus
              disabled={scheduleAction.isPending}
              onClick={() => setPendingAction(null)}
            >
              Cancel
            </ActionButton>
            <ActionButton
              disabled={scheduleAction.isPending}
              onClick={() => {
                const action = pendingAction;
                scheduleAction.mutate(action, {
                  onSuccess: () => {
                    setScheduledMessage(`${actionDetails[action].label} scheduled.`);
                    setPendingAction(null);
                  },
                });
              }}
            >
              {scheduleAction.isPending ? 'Scheduling…' : actionDetails[pendingAction].label}
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}
      {scheduledMessage !== null ? <p role="status">{scheduledMessage}</p> : null}
    </div>
  );
}
