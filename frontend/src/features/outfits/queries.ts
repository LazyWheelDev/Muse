import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  createOutfit,
  DEFAULT_OUTFIT_PAGE_LIMIT,
  deleteOutfit,
  getOutfit,
  listOutfits,
  updateOutfit,
} from './outfitClient';
import type {
  OutfitCreatePayload,
  OutfitDetail,
  OutfitListOptions,
  OutfitPage,
  OutfitSummary,
  OutfitUpdatePayload,
} from './model';

function normalizedOptions(options: OutfitListOptions = {}) {
  return {
    limit: options.limit ?? DEFAULT_OUTFIT_PAGE_LIMIT,
    offset: options.offset ?? 0,
  };
}

export const outfitKeys = {
  all: ['outfits'] as const,
  lists: () => [...outfitKeys.all, 'list'] as const,
  list: (options: OutfitListOptions = {}) => {
    const normalized = normalizedOptions(options);
    return [...outfitKeys.lists(), normalized.limit, normalized.offset] as const;
  },
  details: () => [...outfitKeys.all, 'detail'] as const,
  detail: (outfitId: number) => [...outfitKeys.details(), outfitId] as const,
};

function summaryFromDetail(outfit: OutfitDetail): OutfitSummary {
  const { items, deletedAt, ...summary } = outfit;
  void items;
  void deletedAt;
  return summary;
}

function updateListCaches(queryClient: QueryClient, updater: (page: OutfitPage) => OutfitPage) {
  for (const [queryKey, page] of queryClient.getQueriesData<OutfitPage>({
    queryKey: outfitKeys.lists(),
  })) {
    if (page !== undefined) {
      queryClient.setQueryData(queryKey, updater(page));
    }
  }
}

export function useOutfitList(options: OutfitListOptions = {}) {
  const normalized = normalizedOptions(options);
  return useQuery({
    queryKey: outfitKeys.list(normalized),
    queryFn: ({ signal }) => listOutfits(normalized, signal),
  });
}

export function useOutfitDetail(outfitId: number, enabled = true) {
  return useQuery({
    queryKey: outfitKeys.detail(outfitId),
    queryFn: ({ signal }) => getOutfit(outfitId, signal),
    enabled: enabled && Number.isSafeInteger(outfitId) && outfitId > 0,
  });
}

export function useCreateOutfit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OutfitCreatePayload) => createOutfit(payload),
    onSuccess: async (outfit) => {
      queryClient.setQueryData(outfitKeys.detail(outfit.id), outfit);
      const summary = summaryFromDetail(outfit);
      updateListCaches(queryClient, (page) => {
        const existed = page.items.some((item) => item.id === outfit.id);
        const remaining = page.items.filter((item) => item.id !== outfit.id);
        return {
          ...page,
          items: page.offset === 0 ? [summary, ...remaining].slice(0, page.limit) : remaining,
          total: page.total + (existed ? 0 : 1),
        };
      });
      await queryClient.invalidateQueries({ queryKey: outfitKeys.lists() });
    },
  });
}

export interface UpdateOutfitVariables {
  outfitId: number;
  payload: OutfitUpdatePayload;
  signal?: AbortSignal;
}

export function useUpdateOutfit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ outfitId, payload, signal }: UpdateOutfitVariables) =>
      updateOutfit(outfitId, payload, signal),
    onSuccess: async (outfit) => {
      queryClient.setQueryData(outfitKeys.detail(outfit.id), outfit);
      const summary = summaryFromDetail(outfit);
      updateListCaches(queryClient, (page) => {
        const remaining = page.items.filter((item) => item.id !== outfit.id);
        return {
          ...page,
          items:
            page.offset === 0
              ? [summary, ...remaining].slice(0, page.limit)
              : page.items.map((item) => (item.id === outfit.id ? summary : item)),
        };
      });
      await queryClient.invalidateQueries({ queryKey: outfitKeys.lists() });
    },
  });
}

export interface DeleteOutfitVariables {
  outfitId: number;
  signal?: AbortSignal;
}

export function useDeleteOutfit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ outfitId, signal }: DeleteOutfitVariables) => deleteOutfit(outfitId, signal),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: outfitKeys.detail(variables.outfitId),
        exact: true,
      });
    },
    onSuccess: async (_, variables) => {
      // The active Builder removes its detail cache after navigation. Removing it here would
      // make an active observer refetch the newly deleted resource before the route unmounts.
      updateListCaches(queryClient, (page) => ({
        ...page,
        items: page.items.filter((item) => item.id !== variables.outfitId),
        total: Math.max(0, page.total - 1),
      }));
      await queryClient.invalidateQueries({ queryKey: outfitKeys.lists() });
    },
  });
}
