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
  PurchaseOrderDetail,
  PurchaseOrderSummary
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
    ...options
  });
};

export const useCreatePurchaseOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreatePOInput; idempotencyKey?: string }) =>
      createPurchaseOrder(input, idempotencyKey),
    onMutate: async ({ input }) => {
      await queryClient.cancelQueries({ queryKey: ['purchase-orders'] });
      const previousQueries = queryClient.getQueriesData<PaginatedPurchaseOrders>({ queryKey: ['purchase-orders'] });

      const optimisticPO: PurchaseOrderSummary = {
        id: -Date.now(),
        po_number: 'PO-DRAFT-TEMP',
        provider_id: input.provider_id,
        provider_name: 'جاري الحفظ...',
        status: 'draft',
        db_status: 'draft',
        is_expired: false,
        notes: input.notes || null,
        created_by: 0,
        creator_name: 'المستخدم الحالي',
        created_at: new Date().toISOString(),
        revision: 1,
        currency: 'EGP',
        currency_scale: 2,
        total_amount: '0.00',
        total_amount_minor: 0,
        line_count: input.items.length,
        total_ordered_quantity: input.items.reduce((acc, item) => acc + (item.ordered_quantity || 0), 0),
        company: { name: '', address: '', phone: '', email: '' },
        allowed_actions: ['edit', 'dispatch']
      };

      queryClient.setQueriesData<PaginatedPurchaseOrders>(
        { queryKey: ['purchase-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            total_count: (old.total_count || 0) + 1,
            purchase_orders: [optimisticPO, ...(old.purchase_orders || [])]
          };
        }
      );

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
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
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
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: ['purchase-orders'] });
      await queryClient.cancelQueries({ queryKey: ['purchase-order', id] });
      const previousPOList = queryClient.getQueriesData<PaginatedPurchaseOrders>({ queryKey: ['purchase-orders'] });
      const previousPODetail = queryClient.getQueryData<PurchaseOrderDetail>(['purchase-order', id]);

      queryClient.setQueriesData<PaginatedPurchaseOrders>(
        { queryKey: ['purchase-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            purchase_orders: old.purchase_orders.map((po) =>
              po.id === id ? { ...po, status: 'void', void_reason: input.reason } : po
            )
          };
        }
      );

      queryClient.setQueryData<PurchaseOrderDetail>(['purchase-order', id], (old) => {
        if (!old) return old;
        return { ...old, status: 'void', void_reason: input.reason };
      });

      return { previousPOList, previousPODetail };
    },
    onError: (_err, variables, context) => {
      if (context?.previousPOList) {
        for (const [key, data] of context.previousPOList) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousPODetail) {
        queryClient.setQueryData(['purchase-order', variables.id], context.previousPODetail);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
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
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['purchase-orders'] });
      await queryClient.cancelQueries({ queryKey: ['purchase-order', id] });
      const previousPOList = queryClient.getQueriesData<PaginatedPurchaseOrders>({ queryKey: ['purchase-orders'] });
      const previousPODetail = queryClient.getQueryData<PurchaseOrderDetail>(['purchase-order', id]);

      queryClient.setQueriesData<PaginatedPurchaseOrders>(
        { queryKey: ['purchase-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            purchase_orders: old.purchase_orders.map((po) =>
              po.id === id ? { ...po, status: 'closed' } : po
            )
          };
        }
      );

      queryClient.setQueryData<PurchaseOrderDetail>(['purchase-order', id], (old) => {
        if (!old) return old;
        return { ...old, status: 'closed' };
      });

      return { previousPOList, previousPODetail };
    },
    onError: (_err, variables, context) => {
      if (context?.previousPOList) {
        for (const [key, data] of context.previousPOList) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousPODetail) {
        queryClient.setQueryData(['purchase-order', variables.id], context.previousPODetail);
      }
    },
    onSettled: (_data, _error, variables) => {
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
