import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { createMuseQueryClient } from '../features/clothing/queries';
import { museRoutes } from './AppRoutes';

const queryClient = createMuseQueryClient();
const router = createBrowserRouter(museRoutes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
