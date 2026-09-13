import { useQuery } from '@tanstack/react-query';
import { statsService } from '../services/statsService';
import { useAuth } from './useAuth';

export const useDashboardStats = () => {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['dashboard-stats'],
        queryFn: async ({ signal }) => {
            const summaryData = await statsService.fetchDailySummary(signal);

            const additionsToday = summaryData.additions_today || 0;
            const withdrawalsToday = summaryData.withdrawals_today || 0;
            const returnsToday = summaryData.returns_today || 0;

            return {
                additionsToday,
                withdrawalsToday,
                returnsToday,
            };
        },
        enabled: isAuthenticated,
        staleTime: 1000 * 30, // 30 seconds
    });
};

export const useRecentLogs = (limit: number = 5) => {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['recent-logs', limit],
        queryFn: ({ signal }) => statsService.fetchRecentLogs(limit, signal),
        enabled: isAuthenticated,
        staleTime: 1000 * 30,
    });
};
