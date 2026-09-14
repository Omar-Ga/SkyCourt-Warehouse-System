/* eslint-disable */
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { itemsService, FetchItemsParams, ItemsResponse, AdjustQuantityPayload } from '../services/itemsService';
import { useAuth } from './useAuth';
import { Item } from '../types';

export const useItems = (params: FetchItemsParams = {}, options: any = {}) => {
    const { isAuthenticated } = useAuth();

    const query = useQuery({
        queryKey: ['items', params],
        queryFn: ({ signal }) => itemsService.fetchItems(params, signal),
        placeholderData: keepPreviousData,
        staleTime: 1000 * 60, // 1 minute
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });

    const data = query.data;
    const items: Item[] = Array.isArray(data) ? data : (data as ItemsResponse)?.items || [];
    const total: number = Array.isArray(data) ? data.length : (data as ItemsResponse)?.total_count || 0;

    return {
        ...query,
        items,
        total,
    };
};

export const useCreateItem = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            data,
            idempotencyKey,
        }: {
            data: Omit<Item, 'id'> & {
                initial_quantity: number;
                provider_id?: number | null;
                cost?: number | null;
                person_name?: string | null;
            };
            idempotencyKey?: string;
        }) => itemsService.createItem(data, idempotencyKey),
        onMutate: async ({ data: newItem }) => {
            await queryClient.cancelQueries({ queryKey: ['items'] });
            const previousQueries = queryClient.getQueriesData({ queryKey: ['items'] });

            const optimisticItem: Item = {
                id: -Date.now(),
                name: newItem.name,
                current_quantity: newItem.initial_quantity,
                unit_id: newItem.unit_id,
                unit_name: newItem.unit_name || '',
                sub_category_id: newItem.sub_category_id,
                main_category_id: newItem.main_category_id,
                status: 'active',
            };

            queryClient.setQueriesData({ queryKey: ['items'] }, (old: any) => {
                if (!old) return old;
                if (Array.isArray(old)) {
                    return [optimisticItem, ...old];
                }
                if (old && typeof old === 'object' && 'items' in old) {
                    return {
                        ...old,
                        total_count: (old.total_count || 0) + 1,
                        items: [optimisticItem, ...(old.items || [])],
                    };
                }
                return old;
            });

            return { previousQueries };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousQueries) {
                for (const [key, data] of context.previousQueries) {
                    queryClient.setQueryData(key, data);
                }
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
        },
    });
};

export const useAdjustItemQuantity = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            id,
            data,
            idempotencyKey,
        }: {
            id: number;
            data: AdjustQuantityPayload;
            idempotencyKey?: string;
        }) => itemsService.adjustItemQuantity(id, data, idempotencyKey),
        onMutate: async ({ id, data }) => {
            await queryClient.cancelQueries({ queryKey: ['items'] });
            const previousQueries = queryClient.getQueriesData({ queryKey: ['items'] });

            const delta = data.adjustment_type === 'addition' ? data.change_amount : -data.change_amount;

            queryClient.setQueriesData({ queryKey: ['items'] }, (old: any) => {
                if (!old) return old;
                const updateList = (list: Item[]) =>
                    list.map((item) => {
                        if (item.id === id) {
                            const newQty = Math.max(0, (item.current_quantity ?? 0) + delta);
                            return {
                                ...item,
                                current_quantity: newQty,
                            };
                        }
                        return item;
                    });

                if (Array.isArray(old)) {
                    return updateList(old);
                }
                if (old && typeof old === 'object' && 'items' in old) {
                    return {
                        ...old,
                        items: updateList(old.items || []),
                    };
                }
                return old;
            });

            return { previousQueries };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousQueries) {
                for (const [key, data] of context.previousQueries) {
                    queryClient.setQueryData(key, data);
                }
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
        },
    });
};

export const useUpdateItem = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            id,
            data,
        }: {
            id: number;
            data: Partial<Item> & { force_unit_change?: boolean; person_name?: string };
        }) => itemsService.updateItem(id, data),
        onMutate: async ({ id, data }) => {
            await queryClient.cancelQueries({ queryKey: ['items'] });
            const previousQueries = queryClient.getQueriesData({ queryKey: ['items'] });

            queryClient.setQueriesData({ queryKey: ['items'] }, (old: any) => {
                if (!old) return old;
                const updateList = (list: Item[]) =>
                    list.map((item) => (item.id === id ? { ...item, ...data } : item));

                if (Array.isArray(old)) {
                    return updateList(old);
                }
                if (old && typeof old === 'object' && 'items' in old) {
                    return {
                        ...old,
                        items: updateList(old.items || []),
                    };
                }
                return old;
            });

            return { previousQueries };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousQueries) {
                for (const [key, data] of context.previousQueries) {
                    queryClient.setQueryData(key, data);
                }
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
        },
    });
};
