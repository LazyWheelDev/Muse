import { Outlet, useLocation } from 'react-router-dom';

import { BackendStatus } from '../diagnostics/BackendStatus';
import { BackgroundMonogram } from './BackgroundMonogram';
import styles from './ApplicationLayout.module.css';

export function ApplicationLayout() {
  const { search } = useLocation();
  const diagnosticsRequested = new URLSearchParams(search).get('diagnostics') === '1';
  const showBackendStatus = import.meta.env.MODE === 'development' || diagnosticsRequested;

  return (
    <div className={styles.applicationLayout} data-testid="application-shell">
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <BackgroundMonogram />
      <main className={styles.mainContent} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      {showBackendStatus ? <BackendStatus /> : null}
    </div>
  );
}
