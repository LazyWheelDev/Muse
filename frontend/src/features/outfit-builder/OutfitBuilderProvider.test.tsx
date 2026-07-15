import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { rawClothingPage } from '../../test/clothingFixtures';
import { decodeClothingPage } from '../clothing/decoders';
import { useOutfitBuilder } from './context';
import { builderGarmentFromClothingItem } from './model';
import { OutfitBuilderProvider } from './OutfitBuilderProvider';

const clothingItem = decodeClothingPage(rawClothingPage).items[0];

if (clothingItem === undefined) {
  throw new Error('The clothing fixture must include one item.');
}

function wrapper({ children }: { children: ReactNode }) {
  return <OutfitBuilderProvider storage={window.sessionStorage}>{children}</OutfitBuilderProvider>;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('OutfitBuilderProvider', () => {
  it('exposes ergonomic actions and recovers the single provider-owned draft', () => {
    const first = renderHook(() => useOutfitBuilder(), { wrapper });

    act(() => {
      first.result.current.actions.startNew('/wardrobe?item=1');
      first.result.current.actions.addGarment(builderGarmentFromClothingItem(clothingItem));
      first.result.current.actions.renameOutfit('Recovered Look');
      first.result.current.actions.moveActiveTo(0.2, 0.8);
    });

    expect(first.result.current).toMatchObject({
      isDirty: true,
      activePlacement: { positionX: 0.2, positionY: 0.8 },
      state: { originReturnTo: '/wardrobe?item=1', name: 'Recovered Look' },
    });
    first.unmount();

    const recovered = renderHook(() => useOutfitBuilder(), { wrapper });
    expect(recovered.result.current).toMatchObject({
      isDirty: true,
      activePlacement: { key: 'clothing-1', positionX: 0.2, positionY: 0.8 },
      state: { name: 'Recovered Look', originReturnTo: '/wardrobe?item=1' },
    });

    act(() => recovered.result.current.actions.startNew());
    expect(recovered.result.current).toMatchObject({
      isDirty: false,
      activePlacement: null,
      state: { name: '', placements: [], outfitId: null, originReturnTo: null },
    });
  });
});
