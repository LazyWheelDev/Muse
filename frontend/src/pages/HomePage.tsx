import { Link } from 'react-router-dom';

import { primaryRoutes } from '../app/routeConfig';
import { PageHeader } from '../components/ui/PageHeader';
import styles from './PlaceholderPage.module.css';

export function HomePage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Muse" />
      <section className={styles.placeholderPanel} aria-labelledby="foundation-status-title">
        <p className={styles.eyebrow}>Frontend foundation</p>
        <h2 id="foundation-status-title">The Muse application shell is ready.</h2>
        <p>
          This milestone establishes offline typography, accessible navigation, and the shared
          touchscreen layout. Feature interfaces will be added in later milestones.
        </p>
        <nav className={styles.routeNavigation} aria-label="Primary navigation">
          <ul>
            {primaryRoutes.map((route) => (
              <li key={route.path}>
                <Link to={route.path} aria-label={route.accessibleLabel}>
                  {route.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}
