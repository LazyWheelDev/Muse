import type { ReactNode } from 'react';

import { ActionButton } from './Buttons';
import styles from './AsyncState.module.css';

export function LoadingState({ label = 'Loading your wardrobe…' }: { label?: string }) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <span className={styles.skeleton} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface MessageStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  role?: 'status' | 'alert';
}

export function MessageState({ title, message, action, role = 'status' }: MessageStateProps) {
  return (
    <section className={styles.state} role={role}>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <ActionButton onClick={onRetry}>Try again</ActionButton>;
}
