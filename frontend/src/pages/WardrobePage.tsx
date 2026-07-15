import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleEllipsis,
  Grid2X2,
  House,
  Info,
  Maximize2,
  Minimize2,
  Plus,
  Shirt,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError } from '../api/ApiClientError';
import {
  AccessoryIcon,
  DressIcon,
  HangerIcon,
  HatIcon,
  PantsIcon,
  ScarfIcon,
  ShoeIcon,
} from '../components/icons/GarmentIcons';
import { LoadingState, MessageState, RetryButton } from '../components/ui/AsyncState';
import { ActionButton, NavigationButton, RoundAction } from '../components/ui/Buttons';
import { GarmentImage } from '../components/ui/GarmentImage';
import { DialogActions, DialogError, ModalDialog } from '../components/ui/ModalDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { useHorizontalSwipe } from '../components/ui/useHorizontalSwipe';
import { routePaths } from '../app/routeConfig';
import {
  selectSummaryDisplayImage,
  selectSummaryThumbnail,
} from '../features/clothing/imageSelection';
import { categoryLabels } from '../features/clothing/model';
import type { ClothingItemSummary, GarmentCategory } from '../features/clothing/model';
import { useClothingList, useDeleteClothing } from '../features/clothing/queries';
import {
  buildWardrobePath,
  useWardrobeContext,
  withReturnTo,
} from '../features/clothing/wardrobeContext';
import styles from './WardrobePage.module.css';

const primaryCategories: readonly GarmentCategory[] = ['hat', 'scarf', 'top', 'dress'];
const moreCategories: readonly GarmentCategory[] = [
  'pants',
  'shoes',
  'outerwear',
  'accessory',
  'other',
];

const categoryIcons: Record<GarmentCategory, ReactNode> = {
  hat: <HatIcon />,
  scarf: <ScarfIcon />,
  top: <Shirt />,
  dress: <DressIcon />,
  pants: <PantsIcon />,
  shoes: <ShoeIcon />,
  outerwear: <Shirt />,
  accessory: <AccessoryIcon />,
  other: <CircleEllipsis />,
};

function ProcessingNotice({ item }: { item: ClothingItemSummary }) {
  if (item.imageProcessingState === 'pending' || item.imageProcessingState === 'processing') {
    return (
      <p className={styles.processingNotice} role="status">
        Preparing garment image…
      </p>
    );
  }
  if (
    item.imageProcessingState === 'completed_with_fallback' ||
    item.imageProcessingState === 'failed'
  ) {
    return (
      <p className={styles.processingNotice} role="status">
        Background cleanup unavailable. This garment is still ready to use.
      </p>
    );
  }
  return null;
}

function CarouselPosition({ current, total }: { current: number; total: number }) {
  if (total > 8) {
    return (
      <p className={styles.positionText} aria-live="polite">
        {current + 1} of {total}
      </p>
    );
  }
  return (
    <div className={styles.indicators} aria-label={`Garment ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={index === current ? styles.indicatorActive : ''} />
      ))}
    </div>
  );
}

function DeleteGarmentDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: ClothingItemSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deletion = useDeleteClothing();
  return (
    <ModalDialog
      title={`Delete ${item.name}?`}
      description="This garment will disappear from Wardrobe. Saved outfits may still retain a reference to it. Its original image will not be permanently purged."
      onClose={onClose}
    >
      {deletion.error === null ? null : (
        <DialogError>
          {deletion.error instanceof ApiClientError
            ? deletion.error.message
            : 'Muse could not delete this garment.'}
        </DialogError>
      )}
      <DialogActions>
        <ActionButton data-autofocus onClick={onClose} disabled={deletion.isPending}>
          Keep garment
        </ActionButton>
        <ActionButton
          variant="danger"
          disabled={deletion.isPending}
          onClick={() => deletion.mutate({ itemId: item.id }, { onSuccess: onDeleted })}
        >
          <Trash2 aria-hidden="true" /> {deletion.isPending ? 'Deleting…' : 'Delete garment'}
        </ActionButton>
      </DialogActions>
    </ModalDialog>
  );
}

export function WardrobePage() {
  const navigate = useNavigate();
  const { state, update } = useWardrobeContext();
  const wardrobeQuery = useClothingList(state.category);
  const [showMore, setShowMore] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ClothingItemSummary | null>(null);
  const items = useMemo(() => wardrobeQuery.data?.items ?? [], [wardrobeQuery.data?.items]);
  const selectedIndex = Math.max(
    0,
    state.itemId === null ? 0 : items.findIndex((item) => item.id === state.itemId),
  );
  const selectedItem = items[selectedIndex] ?? null;
  const wardrobePath = buildWardrobePath(state);

  useEffect(() => {
    if (wardrobeQuery.data === undefined) {
      return;
    }
    const requestedExists = items.some((item) => item.id === state.itemId);
    const nextItemId = requestedExists ? state.itemId : (items[0]?.id ?? null);
    if (nextItemId !== state.itemId) {
      update({ ...state, itemId: nextItemId }, true);
    }
  }, [items, state, update, wardrobeQuery.data]);

  const outfitBuilderPath = useMemo(() => {
    const parameters = new URLSearchParams({ returnTo: wardrobePath });
    if (selectedItem !== null) {
      parameters.set('garment', String(selectedItem.id));
    }
    return `${routePaths.outfitBuilder}?${parameters.toString()}`;
  }, [selectedItem, wardrobePath]);

  function selectCategory(category: GarmentCategory | 'all') {
    update({ category, itemId: null, view: 'carousel' });
    setShowMore(false);
  }

  function selectRelative(offset: number) {
    if (items.length === 0) {
      return;
    }
    const nextIndex = (selectedIndex + offset + items.length) % items.length;
    update({ ...state, itemId: items[nextIndex]?.id ?? null });
  }

  function openDetails(itemId: number) {
    void navigate(withReturnTo(routePaths.clothingDetails(itemId), wardrobePath));
  }

  function selectFromGrid(itemId: number) {
    update({ ...state, itemId, view: 'carousel' });
  }

  const swipeHandlers = useHorizontalSwipe(
    () => selectRelative(-1),
    () => selectRelative(1),
    items.length <= 1,
  );

  const addGarmentPath = withReturnTo(routePaths.addGarment, wardrobePath);
  const moreActive = state.category !== 'all' && moreCategories.includes(state.category);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Wardrobe"
        startAction={
          <NavigationButton to={routePaths.home} aria-label="Return to Home">
            <House aria-hidden="true" /> Home
          </NavigationButton>
        }
        endAction={
          <NavigationButton to={routePaths.savedOutfits}>
            <Bookmark aria-hidden="true" /> Saved Outfits
          </NavigationButton>
        }
      />

      {wardrobeQuery.isPending ? (
        <LoadingState />
      ) : wardrobeQuery.isError ? (
        <MessageState
          role="alert"
          title="Muse could not load your wardrobe."
          message="The local service may be unavailable. Your saved garments have not been changed."
          action={<RetryButton onRetry={() => void wardrobeQuery.refetch()} />}
        />
      ) : state.view === 'grid' ? (
        <section className={styles.gridView} aria-labelledby="garment-grid-title">
          <div className={styles.gridToolbar}>
            <ActionButton onClick={() => update({ ...state, view: 'carousel' })}>
              <ArrowLeft aria-hidden="true" /> Return to wardrobe
            </ActionButton>
            <h2 id="garment-grid-title">
              {state.category === 'all' ? 'All garments' : categoryLabels[state.category]}
            </h2>
            <NavigationButton to={addGarmentPath} variant="primary">
              <Plus aria-hidden="true" /> Add Garment
            </NavigationButton>
          </div>
          {items.length === 0 ? (
            <MessageState
              title={
                state.category === 'all'
                  ? 'Your wardrobe is empty.'
                  : 'No garments in this category yet.'
              }
              message="Add a garment to begin building your wardrobe."
              action={<NavigationButton to={addGarmentPath}>Add garment</NavigationButton>}
            />
          ) : (
            <ul className={styles.garmentGrid}>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => selectFromGrid(item.id)}>
                    <GarmentImage
                      image={selectSummaryThumbnail(item)}
                      fallbackImages={item.displayImage === null ? [] : [item.displayImage]}
                      alt={item.name}
                      loading="lazy"
                    />
                    <span>{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className={styles.mainLayout} data-testid="wardrobe-split-layout">
          <section className={styles.previewPanel} aria-label="Selected garment">
            {selectedItem === null ? (
              <div className={styles.emptyPreview}>
                <HangerIcon width={64} height={64} />
                <h2>
                  {state.category === 'all'
                    ? 'Your wardrobe is empty.'
                    : 'No garments in this category yet.'}
                </h2>
                <p>Add your first garment to begin.</p>
              </div>
            ) : (
              <>
                <div
                  className={styles.previewImageArea}
                  aria-roledescription="carousel"
                  {...swipeHandlers}
                >
                  <GarmentImage
                    image={selectSummaryDisplayImage(selectedItem)}
                    fallbackImages={
                      selectedItem.thumbnailImage === null ? [] : [selectedItem.thumbnailImage]
                    }
                    alt={selectedItem.name}
                  />
                  <ActionButton
                    className={`${styles.carouselArrow} ${styles.previousArrow}`}
                    iconOnly
                    aria-label="Previous garment"
                    disabled={items.length <= 1}
                    onClick={() => selectRelative(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </ActionButton>
                  <ActionButton
                    className={`${styles.carouselArrow} ${styles.nextArrow}`}
                    iconOnly
                    aria-label="Next garment"
                    disabled={items.length <= 1}
                    onClick={() => selectRelative(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </ActionButton>
                </div>
                <div className={styles.nameRow}>
                  <div>
                    <CarouselPosition current={selectedIndex} total={items.length} />
                    <h2 aria-live="polite">{selectedItem.name}</h2>
                  </div>
                  <ActionButton
                    iconOnly
                    aria-label="Open garment fullscreen"
                    onClick={() => setShowFullscreen(true)}
                  >
                    <Maximize2 aria-hidden="true" />
                  </ActionButton>
                </div>
                <ProcessingNotice item={selectedItem} />
                <NavigationButton to={outfitBuilderPath} fullWidth>
                  <HangerIcon /> Open in Outfit Builder
                </NavigationButton>
                <div className={styles.quickActions}>
                  <RoundAction
                    icon={<Info />}
                    label="Info"
                    onClick={() => openDetails(selectedItem.id)}
                  />
                  <RoundAction
                    icon={<Trash2 />}
                    label="Delete"
                    onClick={() => setDeleteItem(selectedItem)}
                  />
                  <RoundAction
                    icon={<Grid2X2 />}
                    label="Grid View"
                    onClick={() => update({ ...state, view: 'grid' })}
                  />
                </div>
              </>
            )}
          </section>

          <section className={styles.categoryPanel} aria-labelledby="category-title">
            <h2 className={styles.visuallyHidden} id="category-title">
              Garment category
            </h2>
            <div className={styles.primaryCategories}>
              {primaryCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={styles.categoryCard}
                  aria-pressed={state.category === category}
                  onClick={() => selectCategory(category)}
                >
                  <span aria-hidden="true">{categoryIcons[category]}</span>
                  {categoryLabels[category]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.wideCategory}
              aria-pressed={moreActive}
              onClick={() => setShowMore(true)}
            >
              <CircleEllipsis aria-hidden="true" /> More
            </button>
            <div className={styles.categoryDivider} aria-hidden="true">
              <span />
              <i />
              <span />
            </div>
            <button
              type="button"
              className={styles.wideCategory}
              aria-pressed={state.category === 'all'}
              onClick={() => selectCategory('all')}
            >
              <HangerIcon /> All
            </button>
          </section>
        </div>
      )}

      {state.view === 'carousel' ? (
        <NavigationButton className={styles.addGarment} to={addGarmentPath} variant="primary">
          <Plus aria-hidden="true" /> Add Garment
        </NavigationButton>
      ) : null}

      {showMore ? (
        <ModalDialog
          title="More categories"
          description="Choose a garment category."
          onClose={() => setShowMore(false)}
        >
          <div className={styles.moreCategoryGrid}>
            {moreCategories.map((category) => (
              <ActionButton
                key={category}
                data-autofocus={state.category === category || undefined}
                variant={state.category === category ? 'primary' : 'secondary'}
                onClick={() => selectCategory(category)}
              >
                {categoryIcons[category]} {categoryLabels[category]}
              </ActionButton>
            ))}
          </div>
        </ModalDialog>
      ) : null}

      {showFullscreen && selectedItem !== null ? (
        <ModalDialog
          className={styles.fullscreenDialog}
          title={selectedItem.name}
          onClose={() => setShowFullscreen(false)}
        >
          <div className={styles.fullscreenImage} {...swipeHandlers}>
            <GarmentImage
              image={selectSummaryDisplayImage(selectedItem)}
              fallbackImages={
                selectedItem.thumbnailImage === null ? [] : [selectedItem.thumbnailImage]
              }
              alt={selectedItem.name}
            />
            <ActionButton
              className={`${styles.carouselArrow} ${styles.previousArrow}`}
              iconOnly
              aria-label="Previous garment"
              disabled={items.length <= 1}
              onClick={() => selectRelative(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </ActionButton>
            <ActionButton
              className={`${styles.carouselArrow} ${styles.nextArrow}`}
              iconOnly
              aria-label="Next garment"
              disabled={items.length <= 1}
              onClick={() => selectRelative(1)}
            >
              <ChevronRight aria-hidden="true" />
            </ActionButton>
          </div>
          <CarouselPosition current={selectedIndex} total={items.length} />
          <DialogActions>
            <ActionButton data-autofocus onClick={() => setShowFullscreen(false)}>
              <Minimize2 aria-hidden="true" /> Reduce view
            </ActionButton>
          </DialogActions>
        </ModalDialog>
      ) : null}

      {deleteItem === null ? null : (
        <DeleteGarmentDialog
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onDeleted={() => {
            setDeleteItem(null);
            update({ ...state, itemId: null }, true);
          }}
        />
      )}
    </div>
  );
}
