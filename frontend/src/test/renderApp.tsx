import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { museRoutes } from '../app/AppRoutes';
import { createMuseQueryClient } from '../app/queryClient';
import { OutfitBuilderProvider } from '../features/outfit-builder/OutfitBuilderProvider';
import { DisplayPreferencesProvider } from '../features/settings/DisplayPreferencesProvider';
import { defaultApplicationPreferences } from '../features/settings/model';
import { settingsKeys } from '../features/settings/queries';

export function renderApp(initialEntry: string) {
  const queryClient = createMuseQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  queryClient.setQueryData(settingsKeys.preferences, {
    preferences: defaultApplicationPreferences,
    lastSuccessfulBackup: null,
  });
  const router = createMemoryRouter(museRoutes, { initialEntries: [initialEntry] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <DisplayPreferencesProvider>
        <OutfitBuilderProvider>
          <RouterProvider router={router} />
        </OutfitBuilderProvider>
      </DisplayPreferencesProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}
