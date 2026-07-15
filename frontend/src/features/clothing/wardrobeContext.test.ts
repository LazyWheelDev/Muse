import { describe, expect, it } from 'vitest';

import { buildWardrobePath, parseWardrobeContext, safeWardrobeReturnPath } from './wardrobeContext';

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

  it.each([
    'https://remote.example/wardrobe',
    '//remote.example/wardrobe',
    '/wardrobe/1',
    '/settings',
  ])('rejects unsafe or unrelated return path %s', (path) => {
    expect(safeWardrobeReturnPath(path)).toBe('/wardrobe');
  });
});
