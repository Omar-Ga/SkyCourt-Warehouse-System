import { apiClient } from './apiClient';
import { Category } from '../types';

export interface CategoriesResponse {
    categories: Category[];
    total_count?: number; // Optional depending on backend response for pagination
    // Backend might return just the list or a dict with categories key
}

export interface FetchCategoriesParams {
    parent_id?: number;
    level?: 'main';
    page?: number;
    page_size?: number;
}

export const categoryService = {
    fetchCategories: (params: FetchCategoriesParams = {}) => {
        const queryParams: Record<string, any> = {};
        if (params.parent_id) queryParams.parent_id = params.parent_id;
        if (params.level) queryParams.level = params.level;
        if (params.page) queryParams.page = params.page;
        if (params.page_size) queryParams.page_size = params.page_size;

        const queryString = new URLSearchParams(queryParams).toString();
        const endpoint = `/categories/${queryString ? '?' + queryString : ''}`;

        return apiClient.get<CategoriesResponse | Category[]>(endpoint);
    },

    createCategory: (data: { name: string, parent_id?: number | null }) =>
        apiClient.post<Category>('/categories/', data),

    updateCategory: (id: number, data: { name: string }) =>
        apiClient.put<Category>(`/categories/${id}`, data),

    deleteCategory: (id: number) =>
        apiClient.delete<{ message: string }>(`/categories/${id}`),
};
