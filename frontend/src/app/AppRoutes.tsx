import type { RouteObject } from 'react-router-dom';

import { ApplicationLayout } from '../components/layout/ApplicationLayout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OutfitBuilderPage } from '../pages/OutfitBuilderPage';
import { SavedOutfitsPage } from '../pages/SavedOutfitsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { WardrobePage } from '../pages/WardrobePage';
import { AddGarmentPage } from '../pages/AddGarmentPage';
import { AddGarmentMethodPage } from '../pages/AddGarmentMethodPage';
import { ClothingDetailsPage } from '../pages/ClothingDetailsPage';
import { PhoneUploadPage } from '../pages/PhoneUploadPage';
import { routePaths } from './routeConfig';

export const museRoutes: RouteObject[] = [
  {
    path: routePaths.home,
    element: <ApplicationLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: routePaths.wardrobe, element: <WardrobePage /> },
      { path: routePaths.addGarment, element: <AddGarmentMethodPage /> },
      { path: routePaths.addGarmentDevice, element: <AddGarmentPage /> },
      { path: routePaths.addGarmentPhone, element: <PhoneUploadPage /> },
      { path: `${routePaths.wardrobe}/:garmentId`, element: <ClothingDetailsPage /> },
      { path: routePaths.outfitBuilder, element: <OutfitBuilderPage /> },
      { path: routePaths.savedOutfits, element: <SavedOutfitsPage /> },
      { path: routePaths.settings, element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
