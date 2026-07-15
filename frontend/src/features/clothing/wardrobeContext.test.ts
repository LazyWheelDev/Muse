import { describe, expect, it } from 'vitest';

import {
  buildWardrobePath,
  parseWardrobeContext,
  parseWardrobePath,
  safeWardrobeReturnPath,
} from './wardrobeContext';

describe('Wardrobe URL context', () => {
  it('round-trips the selected category, item, and grid view', () => {
    const state = parseWardrobeContext('?category=top&item=42&view=grid');
    expect(state).toEqual({ category: 'top', itemId: 42, view: 'grid' });
    expect(buildWardrobePath(state)).toBe('/wardrobe?category=top&item=42&view=grid');
  });

  it('normalizes invalid values to a safe Wardrobe state', () => {
    expect(parseWardrobeContext('?category=head&item=-2&view=fullscreen')).toEqual({
      category: 'all',
      itemId: null,
      view: 'carousel',
    });
  });

  it('preserves an explicit Outfit Builder draft round-trip marker', () => {
    const state = parseWardrobeContext('?category=top&item=42&view=grid&preserveDraft=1');
    expect(state).toEqual({
      category: 'top',
      itemId: 42,
      preserveOutfitDraft: true,
      view: 'grid',
    });
    expect(buildWardrobePath(state)).toBe(
      '/wardrobe?category=top&item=42&view=grid&preserveDraft=1',
    );
    expect(safeWardrobeReturnPath(buildWardrobePath(state))).toBe(
      '/wardrobe?category=top&item=42&view=grid&preserveDraft=1',
    );
    expect(parseWardrobePath(buildWardrobePath(state))).toEqual(state);
  });

  it.each([
    'https://remote.example/wardrobe',
    '//remote.example/wardrobe',
    '/wardrobe/1',
    '/settings',
  ])('rejects unsafe or unrelated return path %s', (path) => {
    expect(safeWardrobeReturnPath(path)).toBe('/wardrobe');
  });
});
