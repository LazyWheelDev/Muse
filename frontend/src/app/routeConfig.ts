export const routePaths = {
  home: '/',
  wardrobe: '/wardrobe',
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
