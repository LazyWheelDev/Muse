import { House, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import museValetUrl from '../assets/muse-valet.svg';
import { routePaths } from '../app/routeConfig';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { NavigationButton } from '../components/ui/Buttons';
import { PageHeader } from '../components/ui/PageHeader';
import type { OutfitSummary } from '../features/outfits/model';
import { useOutfitList } from '../features/outfits/queries';
import styles from './SavedOutfitsPage.module.css';

const SCROLL_STORAGE_KEY = 'muse:saved-outfits:scroll:v1';

function readSavedScrollPosition(): number {
  try {
    const value = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (value === null || !/^\d{1,7}$/u.test(value)) {
      return 0;
    }
    return Math.min(10_000_000, Number(value));
  } catch {
    return 0;
  }
}

function persistScrollPosition(value: number) {
  try {
    window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(Math.max(0, Math.round(value))));
  } catch {
    // Scroll restoration is a convenience and must never block outfit access.
  }
}

function builderPath(outfitId: number): string {
  const parameters = new URLSearchParams({
    outfitId: String(outfitId),
    returnTo: routePaths.savedOutfits,
  });
  return `${routePaths.outfitBuilder}?${parameters.toString()}`;
}

function OutfitPreview({ outfit, eager }: { outfit: OutfitSummary; eager: boolean }) {
  const [failed, setFailed] = useState(false);
  if (outfit.previewUrl === null || failed) {
    return (
      <div className={styles.previewFallback} aria-label={`${outfit.name} preview unavailable`}>
        <img src={museValetUrl} alt="" aria-hidden="true" />
        <span>Preview unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={outfit.previewUrl}
      alt={`${outfit.name} outfit preview`}
      width={outfit.previewWidth ?? 600}
      height={outfit.previewHeight ?? 750}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function SavedOutfitsPage() {
  const outfitsQuery = useOutfitList({ limit: 100, offset: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (outfitsQuery.data === undefined || scrollerRef.current === null) {
      return;
    }
    scrollerRef.current.scrollTop = readSavedScrollPosition();
  }, [outfitsQuery.data]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (scrollerRef.current !== null) {
        persistScrollPosition(scrollerRef.current.scrollTop);
      }
    },
    [],
  );

  function handleScroll() {
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (scrollerRef.current !== null) {
        persistScrollPosition(scrollerRef.current.scrollTop);
      }
    });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Saved Outfits"
        startAction={
          <NavigationButton to={routePaths.home} aria-label="Return to Home">
            <House aria-hidden="true" /> Home
          </NavigationButton>
        }
      />
      <div className={styles.content}>
        {outfitsQuery.isPending ? (
          <LoadingState label="Loading saved outfits…" />
        ) : outfitsQuery.isError ? (
          <MessageState
            role="alert"
            title="Muse could not load your saved outfits."
            message="The local service may be unavailable. Your outfits have not been changed."
            action={<RetryButton onRetry={() => void outfitsQuery.refetch()} />}
          />
        ) : outfitsQuery.data.items.length === 0 ? (
          <section className={styles.emptyState} aria-labelledby="empty-outfits-title">
            <div className={styles.emptyCard}>
              <img
                className={styles.emptySilhouette}
                src={museValetUrl}
                alt=""
                aria-hidden="true"
              />
              <h2 id="empty-outfits-title">No saved outfits yet.</h2>
              <p>Create your first look in Outfit Builder.</p>
              <NavigationButton to={routePaths.outfitBuilder} variant="primary">
                <Sparkles aria-hidden="true" /> Open Outfit Builder
              </NavigationButton>
            </div>
          </section>
        ) : (
          <div
            className={styles.gridScroller}
            ref={scrollerRef}
            onScroll={handleScroll}
            data-testid="saved-outfits-scroller"
          >
            <ul className={styles.outfitGrid} aria-label="Saved outfits">
              {outfitsQuery.data.items.map((outfit, index) => (
                <li key={outfit.id}>
                  <Link
                    className={styles.outfitCard}
                    to={builderPath(outfit.id)}
                    aria-label={`Open ${outfit.name} in Outfit Builder, ${outfit.itemCount} ${outfit.itemCount === 1 ? 'garment' : 'garments'}`}
                    onClick={() => persistScrollPosition(scrollerRef.current?.scrollTop ?? 0)}
                  >
                    <div className={styles.preview}>
                      <OutfitPreview outfit={outfit} eager={index < 9} />
                    </div>
                    <span className={styles.cardFooter}>
                      <strong>{outfit.name}</strong>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
