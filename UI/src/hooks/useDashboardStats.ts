import { useQuery } from '@tanstack/react-query';
import { itemsService } from '../services/itemsService';
import { statsService } from '../services/statsService';

export const useDashboardStats = () => {
    return useQuery({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const [itemsData, summaryData] = await Promise.all([
                itemsService.fetchItems({ page_size: 1 }),
                statsService.fetchDailySummary(),
            ]);

            // Handle potential different response structures if needed, 
            // but assuming services return what we expect based on Dashboard.tsx
            const totalItems = 'total_count' in itemsData ? itemsData.total_count : 0;
            const additionsToday = summaryData.additions_today || 0;
            const withdrawalsToday = summaryData.withdrawals_today || 0;

            return {
                totalItems,
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
