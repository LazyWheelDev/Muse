import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders an accessible page title', () => {
    render(<PageHeader title="Wardrobe" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible();
  });
});
