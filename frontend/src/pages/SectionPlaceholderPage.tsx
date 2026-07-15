import { Link } from 'react-router-dom';

import { routePaths } from '../app/routeConfig';
import { PageHeader } from '../components/ui/PageHeader';
import styles from './PlaceholderPage.module.css';

type SectionPlaceholderPageProps = {
  title: string;
  description: string;
};

export function SectionPlaceholderPage({ title, description }: SectionPlaceholderPageProps) {
  const statusTitleId = `${title.toLowerCase().replaceAll(' ', '-')}-status-title`;

  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        startAction={
          <Link className={styles.homeLink} to={routePaths.home} aria-label="Return to Home">
            Home
          </Link>
        }
      />
      <section className={styles.placeholderPanel} aria-labelledby={statusTitleId}>
        <p className={styles.eyebrow}>Route placeholder</p>
        <h2 id={statusTitleId}>{title} foundation</h2>
        <p>{description}</p>
      </section>
    </div>
  );
}
