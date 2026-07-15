import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  QrCode,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../api/ApiClientError';
import { routePaths } from '../app/routeConfig';
import { LocalQrCode } from '../components/phone-upload/LocalQrCode';
import { ActionButton } from '../components/ui/Buttons';
import { PageHeader } from '../components/ui/PageHeader';
import { clothingKeys } from '../features/clothing/queries';
import {
  buildWardrobePath,
  parseWardrobePath,
  safeWardrobeReturnPath,
  withReturnTo,
} from '../features/clothing/wardrobeContext';
import {
  useCancelPhoneUploadSession,
  useCreatePhoneUploadSession,
  usePhoneUploadSession,
  useRegeneratePhoneUploadSession,
} from '../features/phone-upload/queries';
import {
  deviceSessionStatusCopy,
  permanentPhoneUploadStatuses,
  type PhoneUploadListenerStatus,
  type PhoneUploadSessionCreated,
  type PhoneUploadSessionStatus,
} from '../features/phone-upload/model';
import styles from './PhoneUploadPage.module.css';

function remainingLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function safeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  return 'Muse could not prepare phone upload. Check the local network and try again.';
}

const locallyExpirableStatuses = new Set<PhoneUploadSessionStatus>(['pending', 'opened', 'failed']);
type NetworkViewStatus = PhoneUploadListenerStatus | 'checking' | 'unknown';

const unavailableCreationCodes = new Set([
  'phone_upload_listener_unavailable',
  'phone_upload_network_unavailable',
  'phone_upload_unavailable',
]);

const networkStatusCopy: Record<NetworkViewStatus, string> = {
  checking: 'Checking phone upload connection',
  ready: 'Phone upload available',
  unavailable: 'Phone upload unavailable',
  unknown: 'Unable to check phone upload',
};

export function PhoneUploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParameters] = useSearchParams();
  const returnTo = safeWardrobeReturnPath(searchParameters.get('returnTo'));
  const createMutation = useCreatePhoneUploadSession();
  const cancelMutation = useCancelPhoneUploadSession();
  const regenerateMutation = useRegeneratePhoneUploadSession();
  const createStarted = useRef(false);
  const completionHandled = useRef(false);
  const [credentials, setCredentials] = useState<PhoneUploadSessionCreated | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionQuery = usePhoneUploadSession(credentials?.id ?? null);

  useEffect(() => {
    if (createStarted.current) {
      return;
    }
    createStarted.current = true;
    void createMutation
      .mutateAsync()
      .then(setCredentials)
      .catch(() => undefined);
  }, [createMutation]);

  useEffect(() => {
    if (credentials === null) {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [credentials]);

  const authoritativeStatus = sessionQuery.data?.status ?? credentials?.status ?? 'pending';
  const remainingMilliseconds =
    credentials === null ? 0 : Math.max(0, Date.parse(credentials.expiresAt) - now);
  const displayedStatus: PhoneUploadSessionStatus =
    credentials !== null &&
    remainingMilliseconds === 0 &&
    locallyExpirableStatuses.has(authoritativeStatus)
      ? 'expired'
      : authoritativeStatus;
  const statusCopy = deviceSessionStatusCopy[displayedStatus];
  const networkStatus: NetworkViewStatus = (() => {
    if (credentials === null) {
      if (createMutation.error instanceof ApiClientError) {
        return unavailableCreationCodes.has(createMutation.error.code) ? 'unavailable' : 'unknown';
      }
      return 'checking';
    }
    if (sessionQuery.isError) {
      return 'unknown';
    }
    return sessionQuery.data?.listenerStatus ?? credentials.listenerStatus;
  })();

  useEffect(() => {
    const clothingItemId = sessionQuery.data?.clothingItemId;
    if (
      displayedStatus !== 'completed' ||
      clothingItemId === null ||
      clothingItemId === undefined ||
      completionHandled.current
    ) {
      return;
    }
    completionHandled.current = true;
    void queryClient.invalidateQueries({ queryKey: clothingKeys.all });
    const context = parseWardrobePath(returnTo);
    const wardrobePath = buildWardrobePath({
      ...context,
      category: 'all',
      itemId: clothingItemId,
      view: 'carousel',
    });
    const timer = window.setTimeout(() => {
      void navigate(withReturnTo(routePaths.clothingDetails(clothingItemId), wardrobePath), {
        replace: true,
      });
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [displayedStatus, navigate, queryClient, returnTo, sessionQuery.data?.clothingItemId]);

  const creationError = createMutation.error === null ? null : safeError(createMutation.error);
  const actionError = useMemo(() => {
    const error = cancelMutation.error ?? regenerateMutation.error;
    return error === null ? null : safeError(error);
  }, [cancelMutation.error, regenerateMutation.error]);

  async function cancelAndReturn() {
    if (
      credentials !== null &&
      !permanentPhoneUploadStatuses.has(authoritativeStatus) &&
      !cancelMutation.isPending
    ) {
      try {
        await cancelMutation.mutateAsync({ sessionId: credentials.id });
      } catch {
        return;
      }
    }
    void navigate(returnTo, { replace: true });
  }

  async function regenerate() {
    if (credentials === null) {
      createMutation.reset();
      createStarted.current = true;
      try {
        setCredentials(await createMutation.mutateAsync());
      } catch {
        // The mutation exposes a safe retry state.
      }
      return;
    }
    try {
      const next = await regenerateMutation.mutateAsync({ sessionId: credentials.id });
      completionHandled.current = false;
      setNow(Date.now());
      setCredentials(next);
    } catch {
      // The mutation exposes a safe retry state.
    }
  }

  const canRegenerate = authoritativeStatus !== 'uploading' && authoritativeStatus !== 'processing';
  const generateIsPending = createMutation.isPending || regenerateMutation.isPending;
  const generateLabel =
    credentials === null
      ? createMutation.isPending
        ? 'Checking…'
        : createMutation.isError
          ? 'Retry connection'
          : 'Generate new code'
      : regenerateMutation.isPending
        ? 'Generating…'
        : 'Generate new code';

  return (
    <div className={styles.page}>
      <PageHeader
        title="Add Garment"
        startAction={
          <ActionButton onClick={() => void cancelAndReturn()} disabled={cancelMutation.isPending}>
            <ArrowLeft aria-hidden="true" /> Back
          </ActionButton>
        }
      />

      <section className={styles.sessionPanel} aria-labelledby="phone-upload-title">
        <div className={styles.qrColumn}>
          <div className={styles.sectionHeading}>
            <span className={styles.headingIcon} aria-hidden="true">
              <QrCode />
            </span>
            <div>
              <p className={styles.eyebrow}>Upload from phone</p>
              <h2 id="phone-upload-title">Scan with your phone</h2>
            </div>
          </div>

          {credentials === null ? (
            <div className={styles.qrPlaceholder} role="status" aria-live="polite">
              {createMutation.isPending ? (
                <>
                  <RefreshCw className={styles.spinner} aria-hidden="true" />
                  <span>Preparing a secure local code…</span>
                </>
              ) : (
                <>
                  <CircleAlert aria-hidden="true" />
                  <span>{creationError ?? 'A phone upload code is not available.'}</span>
                </>
              )}
            </div>
          ) : (
            <>
              <div className={styles.qrFrame}>
                <LocalQrCode value={credentials.qrPayload} />
              </div>
              <div className={styles.readableUrl}>
                <span>Local address</span>
                <code>{credentials.uploadUrl}</code>
                {credentials.fallbackUploadUrl === null ||
                credentials.fallbackUploadUrl === credentials.uploadUrl ? null : (
                  <>
                    <span>Direct-IP alternative</span>
                    <code>{credentials.fallbackUploadUrl}</code>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className={styles.statusColumn}>
          <div
            className={`${styles.networkStatus} ${styles[`network_${networkStatus}`]}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {networkStatus === 'ready' ? (
              <Wifi aria-hidden="true" />
            ) : networkStatus === 'checking' ? (
              <RefreshCw className={styles.spinner} aria-hidden="true" />
            ) : (
              <WifiOff aria-hidden="true" />
            )}
            <span>{networkStatusCopy[networkStatus]}</span>
          </div>
          {credentials !== null && networkStatus === 'unavailable' ? (
            <p className={styles.networkNotice} role="alert">
              Muse cannot currently reach phone upload. It will retry automatically, and this code
              remains valid until it expires.
            </p>
          ) : null}
          <div
            className={`${styles.liveStatus} ${styles[`status_${displayedStatus}`]}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {displayedStatus === 'completed' ? (
              <CheckCircle2 aria-hidden="true" />
            ) : displayedStatus === 'failed' ||
              displayedStatus === 'cancelled' ||
              displayedStatus === 'expired' ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <RefreshCw
                className={
                  displayedStatus === 'uploading' || displayedStatus === 'processing'
                    ? styles.spinner
                    : undefined
                }
                aria-hidden="true"
              />
            )}
            <div>
              <h3>{statusCopy.title}</h3>
              <p>{statusCopy.description}</p>
            </div>
          </div>

          {credentials === null ? null : (
            <div className={styles.expiry}>
              <span>Code expires in</span>
              <strong aria-hidden="true">{remainingLabel(remainingMilliseconds)}</strong>
              <span className={styles.visuallyHidden}>
                This code expires at {new Date(credentials.expiresAt).toLocaleTimeString()}.
              </span>
            </div>
          )}

          <ol className={styles.instructions}>
            <li>Keep your phone connected to the same Wi-Fi or local network as Muse.</li>
            <li>Scan the code and choose or take one garment photograph.</li>
            <li>Add its name and category, then keep the page open until complete.</li>
          </ol>

          {sessionQuery.isError ? (
            <p className={styles.error} role="alert">
              Muse is reconnecting to the local upload session.
            </p>
          ) : null}
          {actionError === null ? null : (
            <p className={styles.error} role="alert">
              {actionError}
            </p>
          )}

          <div className={styles.actions}>
            <ActionButton
              variant="danger"
              onClick={() => void cancelAndReturn()}
              disabled={credentials === null || cancelMutation.isPending}
            >
              <X aria-hidden="true" />
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel session'}
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={() => void regenerate()}
              disabled={generateIsPending || !canRegenerate}
            >
              <RefreshCw aria-hidden="true" />
              {generateLabel}
            </ActionButton>
          </div>
        </div>
      </section>
    </div>
  );
}
