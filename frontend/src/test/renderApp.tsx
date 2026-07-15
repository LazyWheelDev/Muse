import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { museRoutes } from '../app/AppRoutes';
import { createMuseQueryClient } from '../features/clothing/queries';

export function renderApp(initialEntry: string) {
  const queryClient = createMuseQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const router = createMemoryRouter(museRoutes, { initialEntries: [initialEntry] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}
