import { Outlet } from 'react-router-dom';

import { BackgroundMonogram } from './BackgroundMonogram';
import styles from './ApplicationLayout.module.css';

export function ApplicationLayout() {
  return (
    <div className={styles.applicationLayout} data-testid="application-shell">
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <BackgroundMonogram />
      <main className={styles.mainContent} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
