import { Wifi, WifiOff } from 'lucide-react';

import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsSectionPage,
  StatusNotice,
} from '../components/settings/SettingsPrimitives';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { useCapabilities, useNetworkStatus } from '../features/settings/queries';
import styles from './SettingsSections.module.css';

const connectivityLabels = {
  connected: 'Connected',
  local_only: 'Local network only',
  offline: 'Offline',
  checking: 'Checking',
  listener_unavailable: 'Listener unavailable',
  address_unavailable: 'Address unavailable',
} as const;

export function NetworkSettingsPage() {
  const network = useNetworkStatus();
  const capabilities = useCapabilities();

  return (
    <SettingsSectionPage title="W & N">
      {network.isPending ? (
        <LoadingState label="Checking the local network…" />
      ) : network.isError || network.data === undefined ? (
        <MessageState
          role="alert"
          title="Network status is unavailable."
          message="Your wardrobe, outfits, and other local features remain available."
          action={<RetryButton onRetry={() => void network.refetch()} />}
        />
      ) : (
        <>
          <SettingsPanel
            title="Wi-Fi & Network"
            description="Muse works with or without Internet access."
          >
            <StatusNotice
              title={connectivityLabels[network.data.connectivity]}
              tone={
                network.data.connectivity === 'connected' ||
                network.data.connectivity === 'local_only'
                  ? 'success'
                  : 'warning'
              }
            >
              {network.data.connectivity === 'offline'
                ? 'Muse is offline. Your wardrobe, outfits, and local features remain available.'
                : 'Muse can use its current local network connection.'}
            </StatusNotice>
            <SettingsRows>
              <SettingsRow label="Device name" value={network.data.hostname} />
              <SettingsRow
                label="Preferred local address"
                value={network.data.preferredAddress ?? 'Address unavailable'}
              />
              <SettingsRow
                label="Active connection"
                value={network.data.activeInterface ?? 'Not detected'}
              />
              <SettingsRow
                label="Phone upload"
                value={network.data.phoneUploadAvailable ? 'Available' : 'Unavailable'}
              />
              <SettingsRow
                label="Phone upload address"
                value={network.data.advertisedPhoneUploadAddress ?? 'Address unavailable'}
              />
            </SettingsRows>
          </SettingsPanel>

          <SettingsPanel title="Network setup">
            <div className={styles.capabilityCard}>
              {capabilities.data?.wifiManagement.available ? (
                <Wifi aria-hidden="true" />
              ) : (
                <WifiOff aria-hidden="true" />
              )}
              <div>
                <strong>Changing Wi-Fi networks</strong>
                <p>
                  {capabilities.data?.wifiManagement.available
                    ? 'Wi-Fi management is available through the configured device adapter.'
                    : (capabilities.data?.wifiManagement.reason ??
                      'Wi-Fi configuration is completed during Raspberry Pi device setup.')}
                </p>
              </div>
            </div>
          </SettingsPanel>
        </>
      )}
    </SettingsSectionPage>
  );
}
