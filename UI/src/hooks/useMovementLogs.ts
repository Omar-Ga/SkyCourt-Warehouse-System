import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { MovementLogEntry } from '../types';

export interface FetchLogsParams {
    page?: number;
    page_size?: number;
    date_from?: string;
    date_to?: string;
    item_id?: string;
    provider_id?: string;
    destination_id?: string;
}

export interface LogsResponse {
    logs: MovementLogEntry[];
    total_pages: number;
    total_records: number;
}

export const useMovementLogs = (params: FetchLogsParams = {}, options: any = {}) => {
    return useQuery({
        queryKey: ['movement-logs', params],
        queryFn: async () => {
            // Filter out empty params
            const queryParams: Record<string, string> = {};
            Object.entries(params).forEach(([key, value]) => {
                if (value !== '' && value !== undefined && value !== null) {
                    queryParams[key] = String(value);
                }
            });
            const queryString = new URLSearchParams(queryParams).toString();
            return apiClient.get<LogsResponse>(`/movement-logs?${queryString}`);
        },
        placeholderData: (previousData) => previousData, // Keep previous data while fetching new page
        staleTime: 1000 * 60 * 5, // 5 minutes cache
        ...options
    });
};
