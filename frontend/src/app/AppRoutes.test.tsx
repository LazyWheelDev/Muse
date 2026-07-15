import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/clothingFixtures';
import { renderApp } from '../test/renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Muse routes', () => {
  it.each([
    ['/', 'Muse'],
    ['/outfit-builder', 'Outfit Builder'],
    ['/saved-outfits', 'Saved Outfits'],
    ['/settings', 'Settings'],
    ['/wardrobe/add', 'Add Garment'],
    ['/wardrobe/add/device', 'Add Garment'],
  ] as const)('renders %s with the %s page heading', (path, heading) => {
    renderApp(path);
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  });

  it('navigates from Home to Wardrobe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, limit: 100, offset: 0 })),
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('link', { name: 'Open Wardrobe' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible();
  });

  it('keeps the shell available when diagnostics cannot reach the backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Backend unavailable')));
    renderApp('/?diagnostics=1');
    expect(screen.getByRole('heading', { level: 1, name: 'Muse' })).toBeVisible();
    expect(await screen.findByText('Local service: unavailable')).toBeVisible();
  });
});
