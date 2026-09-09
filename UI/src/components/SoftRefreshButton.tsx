/* eslint-disable */
import React, { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import toast from 'react-hot-toast';

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
    const [isSyncing, setIsSyncing] = useState(false);

    const handleRefresh = async () => {
        if (isSyncing || isFetching > 0) return;
        setIsSyncing(true);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
            // Await authoritative refresh / manual-sync endpoint
            await apiClient.post('/sync', {}, { signal: controller.signal });
            clearTimeout(timeoutId);

            const keysToInvalidate = [
                ['dashboard-stats'],
                ['recent-logs'],
                ['items'],
                ['sync-status'],
                ['categories'],
                ['units'],
                ['providers'],
                ['destinations'],
                ['movement-logs'],
                ['purchase-orders'],
                ['purchase-order'],
                ['leave-orders'],
                ['leave-order'],
                ['tickets'],
                ['tickets-count'],
            ];

            await Promise.all(
                keysToInvalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
            );

            await queryClient.refetchQueries({ type: 'active' });
            toast.success('تم تحديث البيانات بنجاح.');
        } catch (err: any) {
            clearTimeout(timeoutId);
            const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
            const errorMsg = isTimeout
                ? 'استغرق التحديث وقتاً أطول من المتوقع.'
                : (err?.message || 'فشل تحديث البيانات.');
            toast.error(errorMsg);

            // Even on error, invalidate sync-status and active views to reflect real state
            queryClient.invalidateQueries({ queryKey: ['sync-status'] });
            queryClient.refetchQueries({ type: 'active' });
        } finally {
            setIsSyncing(false);
        }
    };

    const isBusy = isSyncing || isFetching > 0;

    return (
        <button
            onClick={handleRefresh}
            disabled={isBusy}
            className={`flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
            title="تحديث البيانات"
        >
            <RotateCw
                size={18}
                className={`ml-2 rtl:ml-2 rtl:mr-0 ${isBusy ? 'animate-spin' : ''}`}
            />
            <span>{label}</span>
            {isBusy && (
                <span className="mr-2 text-xs text-gray-400 font-normal">
                    (جاري...)
                </span>
            )}
        </button>
    );
};
