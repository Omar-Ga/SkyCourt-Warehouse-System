/* eslint-disable */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { useAuth } from './useAuth';

export interface SyncStatus {
    connected: boolean;
    mode: string;
    engine?: string;
    version?: string;
    authoritative_writer?: string;
    offline_mutations_allowed?: boolean;
    last_synced_at?: string | null;
    last_error?: string | null;
    revision?: number | string | null;
    pending_state?: {
        has_pending: boolean;
        pending_count: number;
        conflicts: number;
    } | null;
}

export const useSyncStatus = () => {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['sync-status'],
        queryFn: async ({ signal }) => {
            try {
                const data = await apiClient.get<SyncStatus>('/sync-status', { signal });
                return data;
            } catch (e: any) {
                const status = e?.status;
                if (status === 401 || status === 403) {
                    throw e;
                }
                console.error("Failed to fetch sync status", e);
                return {
                    connected: false,
                    mode: 'cloud',
                    last_error: e?.message || 'Connection failed'
                } as SyncStatus;
            }
        },
        enabled: isAuthenticated,
        refetchInterval: (query) => {
            if (!isAuthenticated) return false;
            const err = query.state.error;
            const status = (err as any)?.status;
            if (status === 401 || status === 403) {
                return false;
            }
            return 5000;
        },
        refetchIntervalInBackground: false,
        staleTime: 4000,
        placeholderData: { connected: false, mode: 'cloud' },
    });
};
