import { describe, expect, it } from 'vitest';

import { ApiClientError } from '../api/ApiClientError';
import { createMuseQueryClient } from './queryClient';

describe('Muse QueryClient', () => {
  it('keeps local API queries online-independent, bounded, and free of focus refetches', () => {
    const queryClient = createMuseQueryClient();
    const queries = queryClient.getDefaultOptions().queries;
    const mutations = queryClient.getDefaultOptions().mutations;

    expect(queries).toMatchObject({
      networkMode: 'always',
      staleTime: 15_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
    });
    expect(mutations).toMatchObject({ networkMode: 'always', retry: false });

    if (typeof queries?.retry !== 'function') {
      throw new Error('Muse query retry policy must be a function.');
    }
    expect(
      queries.retry(
        0,
        new ApiClientError({ code: 'invalid_request', message: 'Invalid.', status: 400 }),
      ),
    ).toBe(false);
    expect(
      queries.retry(0, new ApiClientError({ code: 'backend_unavailable', message: 'Offline.' })),
    ).toBe(true);
    expect(queries.retry(1, new Error('Still unavailable.'))).toBe(false);
  });
});
