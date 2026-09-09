/* eslint-disable */
import { apiClient, generateIdempotencyKey } from './apiClient';
import { Item } from '../types';

export interface ItemsResponse {
    items: Item[];
    total_count: number;
}

export interface FetchItemsParams {
    page?: number;
    page_size?: number;
    search?: string;
    sub_category_id?: number;
    offset?: number;
    limit?: number;
}

export interface AdjustQuantityPayload {
    change_amount: number;
    adjustment_type: 'addition' | 'removal';
    person_name?: string | null;
    provider_id?: number | null;
    cost?: number | null;
    destination_id?: number | null;
}

export const itemsService = {
    fetchItems: async (params: FetchItemsParams = {}, signal?: AbortSignal): Promise<ItemsResponse | Item[]> => {
        const queryParams: Record<string, any> = {};
        if (params.page) queryParams.page = params.page;
        if (params.page_size) queryParams.page_size = params.page_size;
        if (params.search) queryParams.search = params.search;
        if (params.sub_category_id) queryParams.sub_category_id = params.sub_category_id;
        if (params.offset !== undefined) queryParams.offset = params.offset;
        if (params.limit !== undefined) queryParams.limit = params.limit;

        const queryString = new URLSearchParams(queryParams).toString();
        const endpoint = `/items/${queryString ? '?' + queryString : ''}`;

        return apiClient.get<ItemsResponse | Item[]>(endpoint, { signal });
    },

    getItem: (id: number) =>
        apiClient.get<Item>(`/items/${id}`),

    getItemLocation: (id: number, sub_category_id: number, page_size: number) =>
        apiClient.get<{ page: number, position: number }>(`/items/${id}/location?sub_category_id=${sub_category_id}&page_size=${page_size}`),

    createItem: (
        data: Omit<Item, 'id'> & {
            initial_quantity: number;
            provider_id?: number | null;
            cost?: number | null;
            person_name?: string | null;
        },
        idempotencyKey?: string
    ) =>
        apiClient.post<Item>('/items/', data, {
            headers: {
                'Idempotency-Key': idempotencyKey || generateIdempotencyKey()
            }
        }),

    updateItem: (id: number, data: Partial<Item> & { force_unit_change?: boolean, person_name?: string }) =>
        apiClient.put<Item>(`/items/${id}`, data),

    updateItemStatus: (id: number, status: 'active' | 'inactive' | 'archived', person_name?: string) =>
        apiClient.patch<Item>(`/items/${id}/status`, { status, person_name }),

    restoreItem: (id: number, sub_category_id: number, person_name?: string) =>
        apiClient.patch<Item>(`/items/${id}/restore`, { sub_category_id, person_name }),

    adjustItemQuantity: (id: number, data: AdjustQuantityPayload, idempotencyKey?: string) =>
        apiClient.post<Item>(`/items/${id}/adjust`, data, {
            headers: {
                'Idempotency-Key': idempotencyKey || generateIdempotencyKey()
            }
        }),

};
