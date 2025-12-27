import React from 'react';
import { RotateCw } from 'lucide-react';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';

interface SoftRefreshButtonProps {
    className?: string;
    label?: string;
}

export const SoftRefreshButton: React.FC<SoftRefreshButtonProps> = ({
    className = "",
    label = "تحديث"
}) => {
    const queryClient = useQueryClient();
    const isFetching = useIsFetching();

    const handleRefresh = async () => {
        // Invalidate all active queries to ensure the current view is fresh
        // We also specifically target the keys mentioned in the requirements
        const keysToInvalidate = [
            ['dashboard-stats'],
            ['recent-logs'],
            ['items'],
            ['sync-status'],
            ['categories'],
            ['units'],
            ['providers'],
            ['destinations'],
            ['movement-logs']
        ];

        keysToInvalidate.forEach(queryKey => {
            queryClient.invalidateQueries({ queryKey });
        });

        // Also invalidate any other active queries just in case
        queryClient.invalidateQueries({ type: 'active' });
    };

    return (
        <button
            onClick={handleRefresh}
            disabled={isFetching > 0}
            className={`flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
            title="تحديث البيانات"
        >
            <RotateCw
                size={18}
                className={`ml-2 rtl:ml-2 rtl:mr-0 ${isFetching > 0 ? 'animate-spin' : ''}`}
            />
            <span>{label}</span>
            {isFetching > 0 && (
                <span className="mr-2 text-xs text-gray-400 font-normal">
                    (جاري...)
                </span>
            )}
        </button>
    );
};
