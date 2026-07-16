import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cleanupTemporaryData,
  createBackup,
  deleteBackup,
  getBackups,
  getCapabilities,
  getDeviceStatus,
  getNetworkStatus,
  getMaintenanceStatus,
  getSettings,
  getStorageSummary,
  scheduleDeviceAction,
  stageBackupRestore,
  stageDeleteAllData,
  updateSettings,
} from './settingsClient';
import type { ApplicationPreferencesUpdate, DeviceAction } from './model';

export const settingsKeys = {
  all: ['settings'] as const,
  preferences: ['settings', 'preferences'] as const,
  network: ['settings', 'network'] as const,
  storage: ['settings', 'storage'] as const,
  device: ['settings', 'device'] as const,
  capabilities: ['settings', 'capabilities'] as const,
  backups: ['settings', 'backups'] as const,
  maintenance: ['settings', 'maintenance'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.preferences,
    queryFn: ({ signal }) => getSettings(signal),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: ApplicationPreferencesUpdate) => updateSettings(update),
    onSuccess: (settings) => queryClient.setQueryData(settingsKeys.preferences, settings),
  });
}

export function useNetworkStatus() {
  return useQuery({
    queryKey: settingsKeys.network,
    queryFn: ({ signal }) => getNetworkStatus(signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useStorageSummary() {
  return useQuery({
    queryKey: settingsKeys.storage,
    queryFn: ({ signal }) => getStorageSummary(signal),
    staleTime: 30_000,
  });
}

export function useDeviceStatus() {
  return useQuery({
    queryKey: settingsKeys.device,
    queryFn: ({ signal }) => getDeviceStatus(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useCapabilities() {
  return useQuery({
    queryKey: settingsKeys.capabilities,
    queryFn: ({ signal }) => getCapabilities(signal),
    staleTime: 5 * 60_000,
  });
}

export function useScheduleDeviceAction() {
  return useMutation({ mutationFn: (action: DeviceAction) => scheduleDeviceAction(action) });
}

export function useBackups() {
  return useQuery({
    queryKey: settingsKeys.backups,
    queryFn: ({ signal }) => getBackups(signal),
    staleTime: 15_000,
  });
}

export function useMaintenanceStatus() {
  return useQuery({
    queryKey: settingsKeys.maintenance,
    queryFn: ({ signal }) => getMaintenanceStatus(signal),
    staleTime: 15_000,
  });
}

function invalidateData(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: settingsKeys.backups });
  void queryClient.invalidateQueries({ queryKey: settingsKeys.storage });
  void queryClient.invalidateQueries({ queryKey: settingsKeys.preferences });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBackup,
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId }: { backupId: string }) => deleteBackup(backupId),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useStageBackupRestore() {
  return useMutation({
    mutationFn: ({ backupId }: { backupId: string }) => stageBackupRestore(backupId),
  });
}

export function useStageDeleteAllData() {
  return useMutation({ mutationFn: stageDeleteAllData });
}

export function useCleanupTemporaryData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cleanupTemporaryData,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: settingsKeys.storage }),
  });
}
