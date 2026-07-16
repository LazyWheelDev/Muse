import { Download, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ApiClientError } from '../api/ApiClientError';
import {
  SettingsPanel,
  SettingsSectionPage,
  StatusNotice,
} from '../components/settings/SettingsPrimitives';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { ActionButton } from '../components/ui/Buttons';
import { DialogActions, ModalDialog } from '../components/ui/ModalDialog';
import {
  useBackups,
  useCleanupTemporaryData,
  useCreateBackup,
  useDeleteBackup,
  useMaintenanceStatus,
  useStageBackupRestore,
  useStageDeleteAllData,
  useStorageSummary,
} from '../features/settings/queries';
import { backupDownloadUrl } from '../features/settings/settingsClient';
import type { BackupSummary, StagedMaintenanceResponse } from '../features/settings/model';
import { formatBytes } from '../features/settings/format';
import styles from './SettingsSections.module.css';

type Confirmation =
  | { type: 'restore'; backup: BackupSummary }
  | { type: 'delete-backup'; backup: BackupSummary }
  | { type: 'delete-all-warning' }
  | { type: 'delete-all' }
  | null;

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function DataSettingsPage() {
  const storage = useStorageSummary();
  const backups = useBackups();
  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const restore = useStageBackupRestore();
  const deleteAll = useStageDeleteAllData();
  const cleanup = useCleanupTemporaryData();
  const maintenance = useMaintenanceStatus();
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [acknowledgeBackupLoss, setAcknowledgeBackupLoss] = useState(false);
  const [staged, setStaged] = useState<StagedMaintenanceResponse | null>(null);

  function closeConfirmation() {
    if (restore.isPending || deleteBackup.isPending || deleteAll.isPending) return;
    resetConfirmation();
  }

  function resetConfirmation() {
    setConfirmation(null);
    setTypedConfirmation('');
    setAcknowledgeBackupLoss(false);
  }

  async function confirmAction() {
    try {
      if (confirmation?.type === 'restore' && typedConfirmation === 'RESTORE') {
        const result = await restore.mutateAsync({ backupId: confirmation.backup.id });
        setStaged(result);
        resetConfirmation();
      } else if (confirmation?.type === 'delete-backup') {
        await deleteBackup.mutateAsync({ backupId: confirmation.backup.id });
        resetConfirmation();
      } else if (
        confirmation?.type === 'delete-all' &&
        typedConfirmation === 'DELETE ALL MUSE DATA' &&
        acknowledgeBackupLoss
      ) {
        const result = await deleteAll.mutateAsync();
        setStaged(result);
        resetConfirmation();
      }
    } catch {
      // The safe mutation error is rendered while the confirmation remains available.
    }
  }

  const operationError =
    createBackup.error ?? deleteBackup.error ?? restore.error ?? deleteAll.error ?? cleanup.error;

  return (
    <SettingsSectionPage title="Data">
      {storage.isPending ? (
        <LoadingState label="Calculating local storage…" />
      ) : storage.isError || storage.data === undefined ? (
        <MessageState
          role="alert"
          title="Storage information is unavailable."
          message="Muse has not changed your local data."
          action={<RetryButton onRetry={() => void storage.refetch()} />}
        />
      ) : (
        <SettingsPanel title="Local storage" description="All values describe this Muse device.">
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <strong>{storage.data.clothingItems}</strong>
              <span>Active garments</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{storage.data.outfits}</strong>
              <span>Saved outfits</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{storage.data.softDeletedClothingItems}</strong>
              <span>Removed garments retained safely</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{formatBytes(storage.data.imageBytes)}</strong>
              <span>Garment images</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{formatBytes(storage.data.outfitPreviewBytes)}</strong>
              <span>Outfit previews</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{formatBytes(storage.data.backupBytes)}</strong>
              <span>Local backups</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{formatBytes(storage.data.diskFreeBytes)}</strong>
              <span>Available space</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{formatBytes(storage.data.databaseBytes)}</strong>
              <span>Database</span>
            </div>
            <div className={styles.summaryCard}>
              <strong>{storage.data.backupCount}</strong>
              <span>Backup archives</span>
            </div>
          </div>
        </SettingsPanel>
      )}

      <SettingsPanel
        title="Backups"
        description="A backup contains the Muse database, preferences, garment images, and outfit previews."
      >
        <div className={styles.actionRow}>
          <ActionButton
            variant="primary"
            disabled={createBackup.isPending}
            onClick={() => createBackup.mutate()}
          >
            <Download aria-hidden="true" />
            {createBackup.isPending ? 'Creating backup…' : 'Create backup'}
          </ActionButton>
        </div>
        {backups.isPending ? (
          <p role="status">Loading local backups…</p>
        ) : backups.isError || backups.data === undefined ? (
          <StatusNotice title="Backups unavailable" tone="warning">
            Muse could not list local backups. Try again before restoring or deleting anything.
          </StatusNotice>
        ) : backups.data.items.length === 0 ? (
          <StatusNotice title="No local backups yet">
            Create a backup before replacing or deleting local data.
          </StatusNotice>
        ) : (
          <ul className={styles.backupList} aria-label="Local backups">
            {backups.data.items.map((backup) => (
              <li className={styles.backupItem} key={backup.id}>
                <div>
                  <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
                  <p>
                    {formatBytes(backup.archiveBytes)} · {backup.clothingItems} garments ·{' '}
                    {backup.outfits} outfits
                  </p>
                </div>
                <div className={styles.backupActions}>
                  <a className={styles.downloadButton} href={backupDownloadUrl(backup.id)} download>
                    <Download aria-hidden="true" /> Download
                  </a>
                  <ActionButton onClick={() => setConfirmation({ type: 'restore', backup })}>
                    Restore
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    onClick={() => setConfirmation({ type: 'delete-backup', backup })}
                  >
                    <Trash2 aria-hidden="true" /> Delete
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsPanel>

      <SettingsPanel
        title="Maintenance"
        description="Only known temporary Muse files are eligible for cleanup."
      >
        <div className={styles.actionRow}>
          <ActionButton disabled={cleanup.isPending} onClick={() => cleanup.mutate()}>
            <RefreshCw aria-hidden="true" />
            {cleanup.isPending ? 'Cleaning…' : 'Clean temporary files'}
          </ActionButton>
          <ActionButton
            variant="danger"
            onClick={() => setConfirmation({ type: 'delete-all-warning' })}
          >
            <ShieldAlert aria-hidden="true" /> Delete all Muse data
          </ActionButton>
        </div>
        {cleanup.data === undefined ? null : (
          <StatusNotice title="Cleanup complete" tone="success">
            Removed {cleanup.data.temporaryImports} temporary imports and{' '}
            {cleanup.data.phoneUploadSessions} expired upload sessions.
          </StatusNotice>
        )}
      </SettingsPanel>

      {staged === null ? null : (
        <StatusNotice title="Safe restart required" tone="warning">
          Muse validated and staged the operation and created a safety backup. Data has not been
          replaced yet; activation will complete through the configured deployment restart flow.
        </StatusNotice>
      )}
      {maintenance.data?.status === 'staged_restart_required' && staged === null ? (
        <StatusNotice title="Maintenance staged" tone="warning">
          A validated {maintenance.data.operationType === 'restore' ? 'restore' : 'data deletion'}{' '}
          is waiting for the configured deployment restart flow.
        </StatusNotice>
      ) : null}
      {operationError === null ? null : (
        <StatusNotice title="Data operation not completed" tone="danger" role="alert">
          {safeMessage(operationError, 'Muse preserved the previous data. Please try again.')}
        </StatusNotice>
      )}

      {confirmation === null ? null : (
        <ModalDialog
          key={confirmation.type}
          title={
            confirmation.type === 'restore'
              ? 'Stage this backup for restore?'
              : confirmation.type === 'delete-backup'
                ? 'Delete this local backup?'
                : confirmation.type === 'delete-all-warning'
                  ? 'Delete all Muse data?'
                  : 'Final deletion confirmation'
          }
          description={
            confirmation.type === 'restore'
              ? 'Muse will validate and stage a replacement restore. Activation requires a safely coordinated restart.'
              : confirmation.type === 'delete-backup'
                ? 'This removes only the selected backup. Current wardrobe data remains unchanged.'
                : confirmation.type === 'delete-all-warning'
                  ? 'This includes garments, images, outfits, backups, and preferences. The application and operating system remain installed.'
                  : 'This is the final step. A safety backup is created before the deletion is staged.'
          }
          onClose={closeConfirmation}
        >
          {confirmation.type === 'restore' ? (
            <div className={styles.confirmationForm}>
              <label>
                Type RESTORE to continue
                <input
                  className={styles.confirmationInput}
                  value={typedConfirmation}
                  autoComplete="off"
                  onChange={(event) => setTypedConfirmation(event.target.value)}
                />
              </label>
            </div>
          ) : confirmation.type === 'delete-all' ? (
            <div className={styles.confirmationForm}>
              <label>
                Type DELETE ALL MUSE DATA to continue
                <input
                  className={styles.confirmationInput}
                  value={typedConfirmation}
                  autoComplete="off"
                  onChange={(event) => setTypedConfirmation(event.target.value)}
                />
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={acknowledgeBackupLoss}
                  onChange={(event) => setAcknowledgeBackupLoss(event.target.checked)}
                />
                I understand that local backups on this device are included.
              </label>
            </div>
          ) : null}
          <DialogActions>
            <ActionButton data-autofocus onClick={closeConfirmation}>
              Cancel
            </ActionButton>
            {confirmation.type === 'delete-all-warning' ? (
              <ActionButton
                variant="danger"
                onClick={() => setConfirmation({ type: 'delete-all' })}
              >
                Continue to final confirmation
              </ActionButton>
            ) : (
              <ActionButton
                variant="danger"
                disabled={
                  restore.isPending ||
                  deleteBackup.isPending ||
                  deleteAll.isPending ||
                  (confirmation.type === 'restore' && typedConfirmation !== 'RESTORE') ||
                  (confirmation.type === 'delete-all' &&
                    (typedConfirmation !== 'DELETE ALL MUSE DATA' || !acknowledgeBackupLoss))
                }
                onClick={() => void confirmAction()}
              >
                {confirmation.type === 'restore'
                  ? 'Stage restore'
                  : confirmation.type === 'delete-backup'
                    ? 'Delete backup'
                    : 'Stage data deletion'}
              </ActionButton>
            )}
          </DialogActions>
        </ModalDialog>
      )}
    </SettingsSectionPage>
  );
}
