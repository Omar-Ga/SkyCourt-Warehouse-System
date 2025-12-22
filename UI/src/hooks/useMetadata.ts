import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { categoryService, FetchCategoriesParams } from '../services/categoryService';
import { Unit, Category, Provider, Destination } from '../types';

// Units Hook
export const useUnits = () => {
    return useQuery({
        queryKey: ['units'],
        queryFn: async () => {
            return apiClient.get<Unit[]>('/units');
        },
        staleTime: 1000 * 60 * 5, // 5 minutes (rarely changes)
    });
};

// Categories Hook
export const useCategories = (params: FetchCategoriesParams = {}, options: any = {}) => {
    return useQuery({
        queryKey: ['categories', params],
        queryFn: async () => {
            return categoryService.fetchCategories(params);
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        ...options,
    });
};

// Providers Hook
export const useProviders = () => {
    return useQuery({
        queryKey: ['providers'],
        queryFn: async () => {
            return apiClient.get<Provider[]>('/providers');
        },
        staleTime: 1000 * 60 * 5,
    });
};

// Destinations Hook
export const useDestinations = () => {
    return useQuery({
        queryKey: ['destinations'],
        queryFn: async () => {
            return apiClient.get<Destination[]>('/destinations');
        },
        staleTime: 1000 * 60 * 5,
    });
};
