import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../test/renderApp';

describe('AddGarmentMethodPage', () => {
  it('offers both upload methods and preserves the validated Wardrobe return context', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      '/wardrobe/add?returnTo=%2Fwardrobe%3Fcategory%3Dtop%26item%3D4%26preserveDraft%3D1',
    );

    expect(screen.getByRole('link', { name: /Upload on this device/u })).toBeVisible();
    expect(screen.getByRole('link', { name: /Upload from phone/u })).toBeVisible();

    await user.click(screen.getByRole('link', { name: /Upload from phone/u }));
    expect(router.state.location.pathname).toBe('/wardrobe/add/phone');
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe(
      '/wardrobe?category=top&item=4&preserveDraft=1',
    );
  });

  it('keeps the existing on-device flow directly available', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/wardrobe/add');
    await user.click(screen.getByRole('link', { name: /Upload on this device/u }));
    expect(router.state.location.pathname).toBe('/wardrobe/add/device');
    expect(screen.getByText('Choose a garment photograph')).toBeVisible();
  });
});
