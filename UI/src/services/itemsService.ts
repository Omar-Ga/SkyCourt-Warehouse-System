import { apiClient } from './apiClient';
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

export const itemsService = {
    fetchItems: async (params: FetchItemsParams = {}): Promise<ItemsResponse | Item[]> => {
        const queryParams: Record<string, any> = {};
        if (params.page) queryParams.page = params.page;
        if (params.page_size) queryParams.page_size = params.page_size;
        if (params.search) queryParams.search = params.search;
        if (params.sub_category_id) queryParams.sub_category_id = params.sub_category_id;
        if (params.offset !== undefined) queryParams.offset = params.offset;
        if (params.limit !== undefined) queryParams.limit = params.limit;

        const queryString = new URLSearchParams(queryParams).toString();
        const endpoint = `/items/${queryString ? '?' + queryString : ''}`;

        return apiClient.get<ItemsResponse | Item[]>(endpoint);
    },

    getItem: (id: number) =>
        apiClient.get<Item>(`/items/${id}`),

    getItemByBarcode: (barcode: string) =>
        apiClient.get<Item>(`/items/by-barcode/${barcode}`),

    createItem: (data: Omit<Item, 'id'> & { initial_quantity: number, provider_id?: number, person_name?: string }) =>
        apiClient.post<Item>('/items/', data),

    updateItem: (id: number, data: Partial<Item> & { force_unit_change?: boolean, person_name?: string }) =>
        apiClient.put<Item>(`/items/${id}`, data),

    updateItemStatus: (id: number, status: 'active' | 'inactive' | 'archived', person_name?: string) =>
        apiClient.patch<Item>(`/items/${id}/status`, { status, person_name }),

    restoreItem: (id: number, sub_category_id: number, person_name?: string) =>
        apiClient.patch<Item>(`/items/${id}/restore`, { sub_category_id, person_name }),

    adjustItemQuantity: (id: number, data: { quantity_change: number, reason: string, person_name?: string }) =>
        apiClient.post<{ new_quantity: number, log_id: number }>(`/items/${id}/adjust`, data),

    getBarcodeImage: async (id: number): Promise<Blob> => {
        const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/items/${id}/barcode`);
        if (!response.ok) throw new Error('Failed to fetch barcode');
        return response.blob();
    }
};
