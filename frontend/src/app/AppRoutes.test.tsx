import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './AppRoutes';

const routeCases = [
  ['/', 'Muse'],
  ['/wardrobe', 'Wardrobe'],
  ['/outfit-builder', 'Outfit Builder'],
  ['/saved-outfits', 'Saved Outfits'],
  ['/settings', 'Settings'],
] as const;

describe('AppRoutes', () => {
  it.each(routeCases)('renders %s with the %s page heading', (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  });

  it('navigates from the shell home route to Wardrobe', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: 'Open Wardrobe' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible();
  });
});
