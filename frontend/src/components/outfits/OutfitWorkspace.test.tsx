import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasSpies } from '../../test/canvasMock';
import { OutfitWorkspace } from './OutfitWorkspace';
import type { WorkspacePlacement } from './OutfitWorkspace.types';

function placement(
  clientId: string,
  name: string,
  layerIndex: number,
  overrides: Partial<WorkspacePlacement> = {},
): WorkspacePlacement {
  return {
    bodyZone: 'upper_body',
    clientId,
    deleted: false,
    imageCandidates: [],
    layerIndex,
    name,
    positionX: 0.5,
    positionY: 0.37,
    rotation: 0,
    scale: 1,
    ...overrides,
  };
}

beforeEach(() => {
  for (const spy of Object.values(canvasSpies)) {
    spy.mockClear();
  }
});

describe('OutfitWorkspace', () => {
  it('renders an accessible empty Canvas workspace without requiring a browser Canvas backend', () => {
    render(
      <OutfitWorkspace
        placements={[]}
        activePlacementId={null}
        onActivate={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: /Outfit workspace with 0 garments/u })).toBeVisible();
    expect(screen.getByText('Choose a category to add your first garment.')).toBeVisible();
    expect(canvasSpies.clearRect).toHaveBeenCalledWith(0, 0, 640, 800);
  });

  it('draws in layer order and identifies unavailable garments with a local placeholder', () => {
    render(
      <OutfitWorkspace
        placements={[
          placement('front', 'Unavailable Coat', 8, { deleted: true }),
          placement('back', 'Linen Shirt', 2),
        ]}
        activePlacementId="front"
        onActivate={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    const labels = canvasSpies.fillText.mock.calls.map(([label]) => label);
    expect(labels).toEqual(['Image unavailable', 'Unavailable garment']);
    expect(canvasSpies.setLineDash).toHaveBeenCalledWith([10, 7]);
  });

  it('selects the topmost hit garment and reports normalized drag coordinates', () => {
    const onActivate = vi.fn();
    const onMove = vi.fn();
    render(
      <OutfitWorkspace
        placements={[placement('back', 'Linen Shirt', 0), placement('front', 'Linen Jacket', 1)]}
        activePlacementId="back"
        onActivate={onActivate}
        onMove={onMove}
      />,
    );
    const canvas = screen.getByRole('img', {
      name: /Outfit workspace with 2 garments/u,
    });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 640,
      top: 0,
      width: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 296, pointerId: 7 });
    fireEvent.pointerMove(canvas, { clientX: 384, clientY: 376, pointerId: 7 });
    fireEvent.pointerUp(canvas, { clientX: 384, clientY: 376, pointerId: 7 });

    expect(onActivate).toHaveBeenCalledWith('front');
    expect(onMove).toHaveBeenCalledWith('front', 0.6, 0.47);
    expect(canvas.hasPointerCapture(7)).toBe(false);
  });
});
