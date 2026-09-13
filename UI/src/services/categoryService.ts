/* eslint-disable */
import { apiClient } from './apiClient.ts';
import type { Category } from '../types.ts';

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

/**
 * Optimistically updates the TanStack Query cache for category creation,
 * ensuring strict hierarchical isolation (main categories do not pollute sub-category queries,
 * and sub-categories are only added to their designated parent query).
 */
export const updateCategoryCacheOptimistically = (
    queryClient: {
        getQueriesData: (filters: { queryKey: readonly unknown[] }) => [readonly unknown[], any][];
        setQueryData: (queryKey: readonly unknown[], updater: any) => void;
    },
    newCat: { name: string; parent_id?: number | null },
    optimisticCategory: Category
) => {
    const previousQueries = queryClient.getQueriesData({ queryKey: ['categories'] });

    for (const [key, old] of previousQueries) {
        if (!old) continue;
        const params = (key[1] || {}) as FetchCategoriesParams;

        if (!newCat.parent_id) {
            // Main category creation: only update queries that represent main categories
            const isMainCategoryQuery = params.level === 'main' || (!params.parent_id && !params.level);
            if (isMainCategoryQuery) {
                if (Array.isArray(old)) {
                    queryClient.setQueryData(key, [...old, optimisticCategory]);
                } else if (Array.isArray(old.categories)) {
                    queryClient.setQueryData(key, {
                        ...old,
                        categories: [...old.categories, optimisticCategory],
                        total_count: (old.total_count || 0) + 1,
                    });
                }
            }
        } else {
            // Sub-category creation: ONLY update queries matching this exact parent_id
            if (params.parent_id === newCat.parent_id) {
                if (Array.isArray(old.categories)) {
                    queryClient.setQueryData(key, {
                        ...old,
                        categories: [...old.categories, optimisticCategory],
                        total_count: (old.total_count || 0) + 1,
                    });
                } else if (Array.isArray(old)) {
                    queryClient.setQueryData(key, [...old, optimisticCategory]);
                }
            }
        }
    }

    return previousQueries;
};

export const categoryService = {
    fetchCategories: (params: FetchCategoriesParams = {}, signal?: AbortSignal) => {
        const queryParams: Record<string, any> = {};
        if (params.parent_id) queryParams.parent_id = params.parent_id;
        if (params.level) queryParams.level = params.level;
        if (params.page) queryParams.page = params.page;
        if (params.page_size) queryParams.page_size = params.page_size;

        const queryString = new URLSearchParams(queryParams).toString();
        const endpoint = `/categories/${queryString ? '?' + queryString : ''}`;

        return apiClient.get<CategoriesResponse | Category[]>(endpoint, { signal });
    },

    getCategoryById: (id: number) =>
        apiClient.get<Category>(`/categories/${id}`),

    createCategory: (data: { name: string, parent_id?: number | null }) =>
        apiClient.post<Category>('/categories/', data),

    updateCategory: (id: number, data: { name: string }) =>
        apiClient.put<Category>(`/categories/${id}`, data),

    deleteCategory: (id: number) =>
        apiClient.delete<{ message: string }>(`/categories/${id}`),
};
