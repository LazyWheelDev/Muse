import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelPhoneUploadSession,
  createPhoneUploadSession,
  getPhoneUploadSession,
  regeneratePhoneUploadSession,
} from './phoneUploadClient';
import { permanentPhoneUploadStatuses, type PhoneUploadSessionStatus } from './model';

export const phoneUploadKeys = {
  all: ['phone-upload-sessions'] as const,
  detail: (sessionId: string) => [...phoneUploadKeys.all, sessionId] as const,
};

export function phoneUploadRefetchInterval(
  current: PhoneUploadSessionStatus | undefined,
): number | false {
  if (current === undefined || permanentPhoneUploadStatuses.has(current)) {
    return false;
  }
  if (current === 'uploading' || current === 'processing') {
    return 1_250;
  }
  return current === 'failed' ? 5_000 : 2_000;
}

export function useCreatePhoneUploadSession() {
  return useMutation({
    mutationFn: () => createPhoneUploadSession(),
    gcTime: 0,
  });
}

export function usePhoneUploadSession(sessionId: string | null) {
  return useQuery({
    queryKey: phoneUploadKeys.detail(sessionId ?? 'inactive'),
    queryFn: ({ signal }) => getPhoneUploadSession(sessionId ?? '', signal),
    enabled: sessionId !== null,
    refetchInterval: (query) => phoneUploadRefetchInterval(query.state.data?.status),
    refetchIntervalInBackground: false,
  });
}

export function useCancelPhoneUploadSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, signal }: { sessionId: string; signal?: AbortSignal }) =>
      cancelPhoneUploadSession(sessionId, signal),
    onSuccess: async (_, { sessionId }) => {
      await queryClient.invalidateQueries({ queryKey: phoneUploadKeys.detail(sessionId) });
    },
  });
}

export function useRegeneratePhoneUploadSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, signal }: { sessionId: string; signal?: AbortSignal }) =>
      regeneratePhoneUploadSession(sessionId, signal),
    onSuccess: async (_, { sessionId }) => {
      queryClient.removeQueries({ queryKey: phoneUploadKeys.detail(sessionId) });
      await queryClient.invalidateQueries({ queryKey: phoneUploadKeys.all });
    },
  });
}
