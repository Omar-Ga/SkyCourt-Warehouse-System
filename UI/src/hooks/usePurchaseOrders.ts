/* eslint-disable */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  getPurchaseOrders,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  voidPurchaseOrder,
  receivePurchaseOrder,
  editPurchaseOrder,
  dispatchPurchaseOrder,
  CreatePOInput,
  VoidPOInput,
  ReceivePOInput,
  PaginatedPurchaseOrders,
  PurchaseOrderDetail
} from '../services/poService';

export const usePurchaseOrders = (
  params: { page?: number; page_size?: number; status?: string; search?: string } = {},
  options: any = {}
) => {
  const { isAuthenticated } = useAuth();
  return useQuery<PaginatedPurchaseOrders>({
    queryKey: ['purchase-orders', params],
    queryFn: () => getPurchaseOrders(params),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    enabled: isAuthenticated && options?.enabled !== false,
    ...options
  });
};

export const usePurchaseOrderDetail = (id: number | null, options: any = {}) => {
  const { isAuthenticated } = useAuth();
  return useQuery<PurchaseOrderDetail>({
    queryKey: ['purchase-order', id],
    queryFn: () => getPurchaseOrderDetail(id!),
    enabled: isAuthenticated && id !== null && options?.enabled !== false,
    staleTime: 1000 * 10,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    ...options
  });
};

export const useCreatePurchaseOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreatePOInput; idempotencyKey?: string }) =>
      createPurchaseOrder(input, idempotencyKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};

export const useVoidPurchaseOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
      idempotencyKey
    }: {
      id: number;
      input: VoidPOInput;
      idempotencyKey?: string;
    }) => voidPurchaseOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};

export const useReceivePurchaseOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
      idempotencyKey
    }: {
      id: number;
      input: ReceivePOInput;
      idempotencyKey?: string;
    }) => receivePurchaseOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};

export const useEditPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: number; input: Parameters<typeof editPurchaseOrder>[1]; idempotencyKey?: string }) =>
      editPurchaseOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] });
    }
  });
};

export const useDispatchPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_revision, idempotencyKey }: { id: number; expected_revision: number; idempotencyKey?: string }) =>
      dispatchPurchaseOrder(id, expected_revision, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] });
    }
  });
};
