import { Bookmark, Settings, Shirt } from 'lucide-react';
import { Link } from 'react-router-dom';

import { routePaths } from '../app/routeConfig';
import { HangerIcon } from '../components/icons/GarmentIcons';
import styles from './HomePage.module.css';

const actions = [
  {
    path: routePaths.wardrobe,
    title: 'Wardrobe',
    label: 'Open Wardrobe',
    icon: <HangerIcon />,
  },
  {
    path: routePaths.outfitBuilder,
    title: 'Outfit Builder',
    label: 'Open Outfit Builder',
    icon: <Shirt />,
  },
  {
    path: routePaths.savedOutfits,
    title: 'Saved Outfits',
    label: 'Open Saved Outfits',
    icon: <Bookmark />,
  },
  {
    path: routePaths.settings,
    title: 'Settings',
    label: 'Open Settings',
    icon: <Settings />,
  },
] as const;

export function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.brand}>
        <span className={styles.goldMonogram} aria-hidden="true">
          M
        </span>
        <h1>Muse</h1>
        <div className={styles.divider} aria-hidden="true">
          <span />
          <i />
          <span />
        </div>
        <p>Your wardrobe, reimagined.</p>
      </header>

      <nav className={styles.actionGrid} aria-label="Primary navigation">
        {actions.map((action) => (
          <Link
            key={action.path}
            className={styles.actionCard}
            to={action.path}
            aria-label={action.label}
          >
            <span className={styles.iconCircle} aria-hidden="true">
              {action.icon}
            </span>
            <span>{action.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
