import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, QueryClient } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient.ts';
import {
    categoryService,
    CategoriesResponse,
    FetchCategoriesParams,
    updateCategoryCacheOptimistically
} from '../services/categoryService.ts';
import { Unit, Category, Provider, Destination } from '../types.ts';
import { useAuth } from './useAuth.ts';

export { updateCategoryCacheOptimistically };

// Prefetch metadata (units, categories, providers, destinations)
export const prefetchMetadata = async (queryClient: QueryClient) => {
    await Promise.allSettled([
        queryClient.prefetchQuery({
            queryKey: ['units'],
            queryFn: ({ signal }) => apiClient.get<Unit[]>('/units', { signal }),
            staleTime: 1000 * 60 * 5,
        }),
        queryClient.prefetchQuery({
            queryKey: ['categories', { level: 'main' }],
            queryFn: ({ signal }) => categoryService.fetchCategories({ level: 'main' }, signal),
            staleTime: 1000 * 60 * 5,
        }),
        queryClient.prefetchQuery({
            queryKey: ['providers'],
            queryFn: ({ signal }) => apiClient.get<Provider[]>('/providers', { signal }),
            staleTime: 1000 * 60 * 5,
        }),
        queryClient.prefetchQuery({
            queryKey: ['destinations'],
            queryFn: ({ signal }) => apiClient.get<Destination[]>('/destinations', { signal }),
            staleTime: 1000 * 60 * 5,
        }),
    ]);
};

// Hook to trigger metadata prefetching on app mount / login
export const usePrefetchMetadata = () => {
    const queryClient = useQueryClient();
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        if (isAuthenticated) {
            prefetchMetadata(queryClient);
        }
    }, [isAuthenticated, queryClient]);
};

// Units Hook
export const useUnits = (options?: Record<string, unknown>) => {
    const { isAuthenticated } = useAuth();
    return useQuery<Unit[]>({
        queryKey: ['units'],
        queryFn: async ({ signal }) => {
            return apiClient.get<Unit[]>('/units', { signal });
        },
        staleTime: 1000 * 60 * 5, // 5 minutes (rarely changes)
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });
};

// Categories Hook
export const useCategories = (params: FetchCategoriesParams = {}, options?: Record<string, unknown>) => {
    const { isAuthenticated } = useAuth();
    return useQuery<CategoriesResponse | Category[]>({
        queryKey: ['categories', params],
        queryFn: async ({ signal }) => {
            return categoryService.fetchCategories(params, signal);
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });
};

// Category Create Mutation with Optimistic Cache Update
export const useCreateCategory = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: { name: string; parent_id?: number | null }) => {
            return apiClient.post<Category>('/categories', payload);
        },
        onMutate: async (newCat) => {
            // Cancel any outgoing refetches so they don't overwrite optimistic update
            await queryClient.cancelQueries({ queryKey: ['categories'] });

            // Optimistically update cache with new item
            const optimisticCategory: Category = {
                id: -Date.now(),
                name: newCat.name,
                parent_id: newCat.parent_id ?? null,
            };

            const previousQueries = updateCategoryCacheOptimistically(queryClient, newCat, optimisticCategory);

            return { previousQueries };
        },
        onError: (_err, _newCat, context) => {
            if (context?.previousQueries) {
                for (const [key, data] of context.previousQueries) {
                    queryClient.setQueryData(key, data);
                }
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
        },
    });
};

// Category Update Mutation
export const useUpdateCategory = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, name }: { id: number; name: string }) => {
            return apiClient.put<Category>(`/categories/${id}`, { name });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
        },
    });
};

// Providers Hook
export const useProviders = (options?: Record<string, unknown>) => {
    const { isAuthenticated } = useAuth();
    return useQuery<Provider[]>({
        queryKey: ['providers'],
        queryFn: async ({ signal }) => {
            return apiClient.get<Provider[]>('/providers', { signal });
        },
        staleTime: 1000 * 60 * 5,
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });
};

// Destinations Hook
export const useDestinations = (options?: Record<string, unknown>) => {
    const { isAuthenticated } = useAuth();
    return useQuery<Destination[]>({
        queryKey: ['destinations'],
        queryFn: async ({ signal }) => {
            return apiClient.get<Destination[]>('/destinations', { signal });
        },
        staleTime: 1000 * 60 * 5,
        enabled: isAuthenticated && (options?.enabled !== false),
        ...options,
    });
};
