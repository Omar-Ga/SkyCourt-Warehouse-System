/* eslint-disable */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { categoryService, CategoriesResponse, FetchCategoriesParams } from '../services/categoryService';
import { Unit, Category, Provider, Destination } from '../types';
import { useAuth } from './useAuth';

// Units Hook
export const useUnits = (options: any = {}) => {
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
export const useCategories = (params: FetchCategoriesParams = {}, options: any = {}) => {
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

// Providers Hook
export const useProviders = (options: any = {}) => {
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
export const useDestinations = (options: any = {}) => {
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
