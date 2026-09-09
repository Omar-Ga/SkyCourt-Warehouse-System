/* eslint-disable */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { itemsService, FetchItemsParams } from '../services/itemsService';
import { useAuth } from './useAuth';

export const useItems = (params: FetchItemsParams = {}, options: any = {}) => {
    const { isAuthenticated } = useAuth();

    return useQuery({
        queryKey: ['items', params],
        queryFn: ({ signal }) => itemsService.fetchItems(params, signal),
        placeholderData: keepPreviousData,
        staleTime: 1000 * 60, // 1 minute
        refetchInterval: 20000,
        refetchIntervalInBackground: false,
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });
};
