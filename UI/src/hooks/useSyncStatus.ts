import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export interface SyncStatus {
    connected: boolean;
    mode: string;
}

export const useSyncStatus = () => {
    return useQuery({
        queryKey: ['sync-status'],
        queryFn: async () => {
            try {
                const data = await apiClient.get<SyncStatus>('/sync-status');
                return data;
            } catch (e) {
                console.error("Failed to fetch sync status", e);
                return { connected: false, mode: 'cloud' } as SyncStatus;
            }
        },
        refetchInterval: 30000,
        staleTime: 1000 * 25, // Slightly less than refetch interval
        initialData: { connected: true, mode: 'cloud' },
    });
};
