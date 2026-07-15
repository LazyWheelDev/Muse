import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { garmentCategories } from './model';
import type { GarmentCategory } from './model';

export type WardrobeCategory = GarmentCategory | 'all';
export type WardrobeView = 'carousel' | 'grid';

export interface WardrobeContextState {
  category: WardrobeCategory;
  itemId: number | null;
  view: WardrobeView;
}

function parseCategory(value: string | null): WardrobeCategory {
  return value !== null && garmentCategories.includes(value as GarmentCategory)
    ? (value as GarmentCategory)
    : 'all';
}

function parseItemId(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }
  const itemId = Number(value);
  return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null;
}

export function parseWardrobeContext(search: string | URLSearchParams): WardrobeContextState {
  const parameters = typeof search === 'string' ? new URLSearchParams(search) : search;
  return {
    category: parseCategory(parameters.get('category')),
    itemId: parseItemId(parameters.get('item')),
    view: parameters.get('view') === 'grid' ? 'grid' : 'carousel',
  };
}

export function buildWardrobePath(state: WardrobeContextState): string {
  const parameters = new URLSearchParams();
  if (state.category !== 'all') {
    parameters.set('category', state.category);
  }
  if (state.itemId !== null) {
    parameters.set('item', String(state.itemId));
  }
  if (state.view === 'grid') {
    parameters.set('view', 'grid');
  }
  const search = parameters.toString();
  return search ? `/wardrobe?${search}` : '/wardrobe';
}

export function safeWardrobeReturnPath(value: string | null | undefined): string {
  if (value === null || value === undefined || !value.startsWith('/wardrobe')) {
    return '/wardrobe';
  }
  let parsed: URL;
  try {
    parsed = new URL(value, 'http://muse.local');
  } catch {
    return '/wardrobe';
  }
  if (parsed.origin !== 'http://muse.local' || parsed.pathname !== '/wardrobe') {
    return '/wardrobe';
  }
  return buildWardrobePath(parseWardrobeContext(parsed.searchParams));
}

export function withReturnTo(path: string, returnTo: string): string {
  const parameters = new URLSearchParams({ returnTo: safeWardrobeReturnPath(returnTo) });
  return `${path}?${parameters.toString()}`;
}

export function useWardrobeContext() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const state = useMemo(() => parseWardrobeContext(searchParameters), [searchParameters]);
  const update = useCallback(
    (next: WardrobeContextState, replace = false) => {
      const path = buildWardrobePath(next);
      const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
      setSearchParameters(query, { replace });
    },
    [setSearchParameters],
  );
  return { state, update };
}
