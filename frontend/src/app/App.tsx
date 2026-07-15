import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { OutfitBuilderProvider } from '../features/outfit-builder/OutfitBuilderProvider';
import { museRoutes } from './AppRoutes';
import { createMuseQueryClient } from './queryClient';

const queryClient = createMuseQueryClient();
const router = createBrowserRouter(museRoutes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OutfitBuilderProvider>
        <RouterProvider router={router} />
      </OutfitBuilderProvider>
    </QueryClientProvider>
  );
}
