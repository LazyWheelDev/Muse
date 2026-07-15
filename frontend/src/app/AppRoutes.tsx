import { Route, Routes } from 'react-router-dom';

import { ApplicationLayout } from '../components/layout/ApplicationLayout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OutfitBuilderPage } from '../pages/OutfitBuilderPage';
import { SavedOutfitsPage } from '../pages/SavedOutfitsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { WardrobePage } from '../pages/WardrobePage';
import { routePaths } from './routeConfig';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<ApplicationLayout />}>
        <Route index element={<HomePage />} />
        <Route path={routePaths.wardrobe} element={<WardrobePage />} />
        <Route path={routePaths.outfitBuilder} element={<OutfitBuilderPage />} />
        <Route path={routePaths.savedOutfits} element={<SavedOutfitsPage />} />
        <Route path={routePaths.settings} element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
