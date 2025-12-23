import { useQuery } from '@tanstack/react-query';
import { statsService } from '../services/statsService';

export const useDashboardStats = () => {
    return useQuery({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const summaryData = await statsService.fetchDailySummary();

            const additionsToday = summaryData.additions_today || 0;
            const withdrawalsToday = summaryData.withdrawals_today || 0;

            return {
                additionsToday,
                withdrawalsToday,
            };
        },
        staleTime: 1000 * 30, // 30 seconds
        refetchInterval: 1000 * 60, // Background refresh every minute
    });
};

export const useRecentLogs = (limit: number = 5) => {
    return useQuery({
        queryKey: ['recent-logs', limit],
        queryFn: () => statsService.fetchRecentLogs(limit),
        staleTime: 1000 * 30,
    });
};
