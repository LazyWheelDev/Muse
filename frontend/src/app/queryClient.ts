import { QueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../api/ApiClientError';

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) {
    return false;
  }

  return !(error instanceof ApiClientError && error.status !== null && error.status < 500);
}

export function createMuseQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: shouldRetry,
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        networkMode: 'always',
        retry: false,
      },
    },
  });
}
