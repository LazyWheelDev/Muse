import type { ReactNode } from 'react';

import styles from './PageHeader.module.css';

type PageHeaderProps = {
  title: string;
  startAction?: ReactNode;
  endAction?: ReactNode;
};

export function PageHeader({ title, startAction, endAction }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.startAction}>{startAction}</div>
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.divider} aria-hidden="true">
          <span />
          <i />
          <span />
        </div>
      </div>
      <div className={styles.endAction}>{endAction}</div>
    </header>
  );
}
