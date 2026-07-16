import { useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { BackendStatus } from '../diagnostics/BackendStatus';
import { BackgroundMonogram } from './BackgroundMonogram';
import styles from './ApplicationLayout.module.css';

export function ApplicationLayout() {
  const { pathname, search } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const previousPathnameRef = useRef<string | null>(null);
  const diagnosticsRequested = new URLSearchParams(search).get('diagnostics') === '1';
  const showBackendStatus = import.meta.env.MODE === 'development' || diagnosticsRequested;

  useLayoutEffect(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    if (previousPathnameRef.current !== null && previousPathnameRef.current !== pathname) {
      mainRef.current?.focus({ preventScroll: true });
    }
    previousPathnameRef.current = pathname;
  }, [pathname]);

  return (
    <div className={styles.applicationLayout} data-testid="application-shell">
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <BackgroundMonogram />
      <main className={styles.mainContent} id="main-content" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      {showBackendStatus ? <BackendStatus /> : null}
    </div>
  );
}
