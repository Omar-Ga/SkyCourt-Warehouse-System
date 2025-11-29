import { apiClient } from './apiClient';
import { MovementLogEntry } from '../types';

export interface DailySummary {
    additions_today: number;
    withdrawals_today: number;
}

export const statsService = {
    fetchDailySummary: () =>
        apiClient.get<DailySummary>('/movement-logs/summary/today'),

    fetchRecentLogs: async (limit: number = 5): Promise<MovementLogEntry[]> => {
        const response = await apiClient.get<{ logs: MovementLogEntry[] }>(`/movement-logs?page=1&page_size=${limit}`);
        return response.logs;
    }
};
