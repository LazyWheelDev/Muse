export const routePaths = {
  home: '/',
  wardrobe: '/wardrobe',
  addGarment: '/wardrobe/add',
  addGarmentDevice: '/wardrobe/add/device',
  addGarmentPhone: '/wardrobe/add/phone',
  clothingDetails: (garmentId: number) => `/wardrobe/${garmentId}` as const,
  outfitBuilder: '/outfit-builder',
  savedOutfits: '/saved-outfits',
  settings: '/settings',
} as const;

export const primaryRoutes = [
  {
    path: routePaths.wardrobe,
    title: 'Wardrobe',
    accessibleLabel: 'Open Wardrobe',
  },
  {
    path: routePaths.outfitBuilder,
    title: 'Outfit Builder',
    accessibleLabel: 'Open Outfit Builder',
  },
  {
    path: routePaths.savedOutfits,
    title: 'Saved Outfits',
    accessibleLabel: 'Open Saved Outfits',
  },
  {
    path: routePaths.settings,
    title: 'Settings',
    accessibleLabel: 'Open Settings',
  },
] as const;
