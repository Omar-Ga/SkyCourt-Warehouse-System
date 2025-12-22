import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { itemsService, FetchItemsParams } from '../services/itemsService';

export const useItems = (params: FetchItemsParams = {}, options: any = {}) => {
    return useQuery({
        queryKey: ['items', params],
        queryFn: () => itemsService.fetchItems(params),
        placeholderData: keepPreviousData,
        staleTime: 1000 * 60, // 1 minute
        ...options,
    });
};
