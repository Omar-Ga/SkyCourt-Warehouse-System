/* eslint-disable */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { MovementLogEntry } from '../types';
import { useAuth } from './useAuth';

export interface FetchLogsParams {
    page?: number;
    page_size?: number;
    date_from?: string;
    date_to?: string;
    item_id?: string;
    provider_id?: string;
    destination_id?: string;
    action_type?: string;
}

export interface LogsResponse {
    logs: MovementLogEntry[];
    total_pages: number;
    total_count: number;
}

export const useMovementLogs = (params: FetchLogsParams = {}, options: any = {}) => {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: ['movement-logs', params],
        queryFn: async ({ signal }) => {
            // Filter out empty params
            const queryParams: Record<string, string> = {};
            Object.entries(params).forEach(([key, value]) => {
                if (value !== '' && value !== undefined && value !== null) {
                    queryParams[key] = String(value);
                }
            });
            const queryString = new URLSearchParams(queryParams).toString();
            return apiClient.get<LogsResponse>(`/movement-logs?${queryString}`, { signal });
        },
        placeholderData: (previousData) => previousData, // Keep previous data while fetching new page
        staleTime: 1000 * 30,
        refetchInterval: 15000,
        refetchIntervalInBackground: false,
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options
    });
};
