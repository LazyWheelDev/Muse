import { useEffect, useState } from 'react';

import { getHealth } from '../../api/healthClient';
import styles from './BackendStatus.module.css';

type BackendConnectionState = 'checking' | 'connected' | 'unavailable';

export interface BackendStatusProps {
  checkHealth?: typeof getHealth;
  timeoutMs?: number;
}

const statusLabels: Record<BackendConnectionState, string> = {
  checking: 'Local service: checking',
  connected: 'Local service: connected',
  unavailable: 'Local service: unavailable',
};

export function BackendStatus({ checkHealth = getHealth, timeoutMs = 3_000 }: BackendStatusProps) {
  const [connectionState, setConnectionState] = useState<BackendConnectionState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    void checkHealth({ signal: controller.signal })
      .then(() => {
        if (active) {
          setConnectionState('connected');
        }
      })
      .catch(() => {
        if (active) {
          setConnectionState('unavailable');
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [checkHealth, timeoutMs]);

  return (
    <p
      className={`${styles.status} ${styles[connectionState]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-backend-status={connectionState}
    >
      {statusLabels[connectionState]}
    </p>
  );
}
