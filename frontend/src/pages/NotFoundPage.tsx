import { Link } from 'react-router-dom';

import { routePaths } from '../app/routeConfig';
import { PageHeader } from '../components/ui/PageHeader';
import styles from './PlaceholderPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Page not found" />
      <section className={styles.placeholderPanel} aria-labelledby="not-found-title">
        <p className={styles.eyebrow}>Navigation error</p>
        <h2 id="not-found-title">Muse could not find this page.</h2>
        <p>Return to Home to continue.</p>
        <nav className={styles.routeNavigation} aria-label="Recovery navigation">
          <Link to={routePaths.home}>Return to Home</Link>
        </nav>
      </section>
    </div>
  );
}
