import styles from './BackgroundMonogram.module.css';

export function BackgroundMonogram() {
  return (
    <div className={styles.monogramFrame} aria-hidden="true" data-testid="background-monogram">
      <span className={styles.monogram}>M</span>
    </div>
  );
}
