import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../../api/ApiClientError';
import {
  deleteClothingItem,
  getClothingItem,
  importClothingItem,
  listClothingItems,
  updateClothingItem,
} from './clothingClient';
import type { ImportClothingOptions } from './clothingClient';
import type {
  ClothingItemDetail,
  ClothingItemSummary,
  ClothingPage,
  ClothingUpdatePayload,
  GarmentCategory,
} from './model';

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

export const clothingKeys = {
  all: ['clothing'] as const,
  lists: () => [...clothingKeys.all, 'list'] as const,
  list: (category: GarmentCategory | 'all') => [...clothingKeys.lists(), category] as const,
  details: () => [...clothingKeys.all, 'detail'] as const,
  detail: (itemId: number) => [...clothingKeys.details(), itemId] as const,
};

export function useClothingList(category: GarmentCategory | 'all') {
  return useQuery({
    queryKey: clothingKeys.list(category),
    queryFn: ({ signal }) => listClothingItems(category, signal),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) =>
          item.imageProcessingState === 'pending' || item.imageProcessingState === 'processing',
      )
        ? 2_000
        : false,
  });
}

function updateListCaches(
  queryClient: QueryClient,
  updater: (page: ClothingPage, category: GarmentCategory | 'all') => ClothingPage,
) {
  for (const [queryKey, page] of queryClient.getQueriesData<ClothingPage>({
    queryKey: clothingKeys.lists(),
  })) {
    const category = queryKey[2];
    if (page !== undefined && (category === 'all' || typeof category === 'string')) {
      queryClient.setQueryData(queryKey, updater(page, category as GarmentCategory | 'all'));
    }
  }
}

function summaryFromDetail(item: ClothingItemDetail): ClothingItemSummary {
  const { imageGroups, ...summary } = item;
  void imageGroups;
  return summary;
}

export function useClothingDetail(itemId: number) {
  return useQuery({
    queryKey: clothingKeys.detail(itemId),
    queryFn: ({ signal }) => getClothingItem(itemId, signal),
    enabled: Number.isSafeInteger(itemId) && itemId > 0,
    refetchInterval: (query) => {
      const state = query.state.data?.imageProcessingState;
      return state === 'pending' || state === 'processing' ? 2_000 : false;
    },
  });
}

export function useImportClothing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: ImportClothingOptions) => importClothingItem(options),
    onSuccess: async (item) => {
      queryClient.setQueryData(clothingKeys.detail(item.id), item);
      const summary = summaryFromDetail(item);
      updateListCaches(queryClient, (page, category) => {
        if (category !== 'all' && category !== item.garmentCategory) {
          return page;
        }
        const existed = page.items.some((existing) => existing.id === item.id);
        const items = [summary, ...page.items.filter((existing) => existing.id !== item.id)];
        return {
          ...page,
          items: items.slice(0, page.limit),
          total: page.total + (existed ? 0 : 1),
        };
      });
      await queryClient.invalidateQueries({ queryKey: clothingKeys.lists() });
    },
  });
}

export function useUpdateClothing(itemId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, signal }: { payload: ClothingUpdatePayload; signal?: AbortSignal }) =>
      updateClothingItem(itemId, payload, signal),
    onSuccess: async (item) => {
      queryClient.setQueryData(clothingKeys.detail(item.id), item);
      const summary = summaryFromDetail(item);
      updateListCaches(queryClient, (page, category) => {
        const existed = page.items.some((existing) => existing.id === item.id);
        const belongs = category === 'all' || category === item.garmentCategory;
        const remaining = page.items.filter((existing) => existing.id !== item.id);
        const items = belongs ? [summary, ...remaining] : remaining;
        return {
          ...page,
          items: items.slice(0, page.limit),
          total: Math.max(0, page.total + (belongs && !existed ? 1 : !belongs && existed ? -1 : 0)),
        };
      });
      await queryClient.invalidateQueries({ queryKey: clothingKeys.lists() });
    },
  });
}

export function useDeleteClothing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, signal }: { itemId: number; signal?: AbortSignal }) =>
      deleteClothingItem(itemId, signal),
    onSuccess: async (_, variables) => {
      queryClient.removeQueries({ queryKey: clothingKeys.detail(variables.itemId) });
      updateListCaches(queryClient, (page) => {
        const existed = page.items.some((existing) => existing.id === variables.itemId);
        return {
          ...page,
          items: page.items.filter((existing) => existing.id !== variables.itemId),
          total: Math.max(0, page.total - (existed ? 1 : 0)),
        };
      });
      await queryClient.invalidateQueries({ queryKey: clothingKeys.lists() });
    },
  });
}
