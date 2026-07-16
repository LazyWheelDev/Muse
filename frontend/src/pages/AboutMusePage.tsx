import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsSectionPage,
} from '../components/settings/SettingsPrimitives';
import { useSettings } from '../features/settings/queries';
import styles from './SettingsSections.module.css';

export function AboutMusePage() {
  const settings = useSettings();
  return (
    <SettingsSectionPage title="About Muse">
      <SettingsPanel title="Muse">
        <div className={styles.aboutLockup}>
          <h2 aria-label="Muse">Muse</h2>
          <p>Your wardrobe, reimagined.</p>
        </div>
        <p className={styles.aboutCopy}>
          Muse is a dedicated, offline-first smart wardrobe for organizing garments, composing
          outfits, and keeping wardrobe data close at hand.
        </p>
      </SettingsPanel>

      <SettingsPanel title="Local-first privacy">
        <p className={styles.aboutCopy}>
          Muse stores your wardrobe, images, outfits, and preferences locally on your device. Core
          features do not require a cloud account or permanent Internet connection.
        </p>
      </SettingsPanel>

      <SettingsPanel title="Project information">
        <SettingsRows>
          <SettingsRow label="Application version" value="Muse 0.1.0" />
          <SettingsRow label="License" value="MIT" />
          <SettingsRow label="Created by" value="LazyWheelDev" />
          <SettingsRow label="Context" value="OpenAI Build Week project" />
          <SettingsRow label="Repository" value="github.com/LazyWheelDev/Muse" />
          <SettingsRow
            label="Last successful backup"
            value={
              settings.data?.lastSuccessfulBackup === null ||
              settings.data?.lastSuccessfulBackup === undefined
                ? 'No backup yet'
                : new Date(settings.data.lastSuccessfulBackup.createdAt).toLocaleString()
            }
          />
        </SettingsRows>
      </SettingsPanel>
    </SettingsSectionPage>
  );
}
