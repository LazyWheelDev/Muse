import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { routePaths } from '../../app/routeConfig';
import { NavigationButton } from '../ui/Buttons';
import { PageHeader } from '../ui/PageHeader';
import styles from './SettingsPrimitives.module.css';

export function SettingsSectionPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        startAction={
          <NavigationButton to={routePaths.settings} aria-label="Back to Settings">
            <ArrowLeft aria-hidden="true" /> Back
          </NavigationButton>
        }
      />
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export function SettingsPanel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      <header className={styles.panelHeader}>
        <h2>{title}</h2>
        {description === undefined ? null : <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function SettingsRows({ children }: { children: ReactNode }) {
  return <dl className={styles.rows}>{children}</dl>;
}

export function SettingsRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function StatusNotice({
  title,
  children,
  tone = 'neutral',
  role = 'status',
}: {
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={role} aria-live="polite">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function ToggleControl({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={styles.toggleRow}>
      <span>
        <strong>{label}</strong>
        {description === undefined ? null : <small>{description}</small>}
      </span>
      <button
        className={styles.toggle}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
