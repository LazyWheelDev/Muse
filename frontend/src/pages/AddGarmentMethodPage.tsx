import { ArrowLeft, ImageUp, Smartphone } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { routePaths } from '../app/routeConfig';
import { NavigationButton } from '../components/ui/Buttons';
import { PageHeader } from '../components/ui/PageHeader';
import { safeWardrobeReturnPath, withReturnTo } from '../features/clothing/wardrobeContext';
import styles from './AddGarmentMethodPage.module.css';

export function AddGarmentMethodPage() {
  const [searchParameters] = useSearchParams();
  const returnTo = safeWardrobeReturnPath(searchParameters.get('returnTo'));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Add Garment"
        startAction={
          <NavigationButton to={returnTo} aria-label="Back to Wardrobe">
            <ArrowLeft aria-hidden="true" /> Back
          </NavigationButton>
        }
      />
      <section className={styles.choicePanel} aria-labelledby="upload-method-title">
        <div className={styles.introduction}>
          <p className={styles.eyebrow}>Choose an upload method</p>
          <h2 id="upload-method-title">How would you like to add this garment?</h2>
          <p>Both methods save your photograph and garment details only on Muse.</p>
        </div>
        <div className={styles.methodGrid}>
          <Link
            className={styles.methodCard}
            to={withReturnTo(routePaths.addGarmentDevice, returnTo)}
          >
            <span className={styles.iconCircle} aria-hidden="true">
              <ImageUp />
            </span>
            <strong>Upload on this device</strong>
            <span>Choose a photograph already available in this browser.</span>
          </Link>
          <Link
            className={styles.methodCard}
            to={withReturnTo(routePaths.addGarmentPhone, returnTo)}
          >
            <span className={styles.iconCircle} aria-hidden="true">
              <Smartphone />
            </span>
            <strong>Upload from phone</strong>
            <span>Scan a temporary code from a phone on the same local network.</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
