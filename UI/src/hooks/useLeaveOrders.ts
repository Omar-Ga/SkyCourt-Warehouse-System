/* eslint-disable */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  getLeaveOrders,
  getLeaveOrderDetail,
  getTicketsCount,
  getTickets,
  returnTicketItems,
  createLeaveOrder,
  closeLeaveOrder,
  fulfillLeaveOrder,
  rejectLeaveOrder,
  resubmitLeaveOrder,
  cancelLeaveOrder,
  CreateLeaveOrderInput,
  PaginatedLeaveOrders,
  LeaveOrderDetail,
  LeaveOrderSummary,
  PaginatedTickets,
  TicketReturnInput
} from '../services/leaveOrderService';

export const useLeaveOrders = (
  params: { page?: number; page_size?: number; status?: string; search?: string } = {},
  options: any = {}
) => {
  const { isAuthenticated } = useAuth();
  return useQuery<PaginatedLeaveOrders>({
    queryKey: ['leave-orders', params],
    queryFn: () => getLeaveOrders(params),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 30, // 30 seconds
    enabled: isAuthenticated && options?.enabled !== false,
    ...options
  });
};

export const useLeaveOrderDetail = (id: number | null, options: any = {}) => {
  const { isAuthenticated } = useAuth();
  return useQuery<LeaveOrderDetail>({
    queryKey: ['leave-order', id],
    queryFn: () => getLeaveOrderDetail(id!),
    enabled: isAuthenticated && id !== null && options?.enabled !== false,
    staleTime: 1000 * 10,
    ...options
  });
};

export const useTicketsCount = (options: any = {}) => {
  const { isAuthenticated } = useAuth();
  return useQuery<{ count: number }>({
    queryKey: ['tickets-count'],
    queryFn: () => getTicketsCount(),
    enabled: isAuthenticated && options?.enabled !== false,
    staleTime: 2000,
    ...options
  });
};

export const useCreateLeaveOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { input: CreateLeaveOrderInput; idempotencyKey?: string } | CreateLeaveOrderInput) => {
      if ('input' in variables) {
        return createLeaveOrder(variables.input, variables.idempotencyKey);
      }
      return createLeaveOrder(variables);
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['leave-orders'] });
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      await queryClient.cancelQueries({ queryKey: ['tickets-count'] });

      const previousLeaveOrders = queryClient.getQueriesData<PaginatedLeaveOrders>({ queryKey: ['leave-orders'] });
      const previousTickets = queryClient.getQueriesData<PaginatedTickets>({ queryKey: ['tickets'] });
      const previousTicketsCount = queryClient.getQueryData<{ count: number }>(['tickets-count']);

      const input: CreateLeaveOrderInput = 'input' in variables ? variables.input : variables;
      const totalQty = (input.items || []).reduce((acc, item) => acc + (item.requested_quantity || 0), 0);

      const optimisticLO: LeaveOrderSummary = {
        id: -Date.now(),
        order_number: 'LO-DRAFT-TEMP',
        employee_name: input.employee_name,
        destination_id: input.destination_id,
        destination_name: 'جاري الحفظ...',
        status: 'open',
        notes: input.notes || null,
        created_by: 0,
        creator_name: 'المستخدم الحالي',
        created_at: new Date().toISOString(),
        revision: 1,
        items_count: input.items.length,
        total_quantity: totalQty,
        total_requested_quantity: totalQty,
        total_returned: 0,
        remaining_quantity: totalQty
      };

      queryClient.setQueriesData<PaginatedLeaveOrders>(
        { queryKey: ['leave-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            total_count: (old.total_count || 0) + 1,
            leave_orders: [optimisticLO, ...(old.leave_orders || [])]
          };
        }
      );

      queryClient.setQueryData<{ count: number }>(['tickets-count'], (old) => ({
        count: (old?.count || 0) + 1
      }));

      return { previousLeaveOrders, previousTickets, previousTicketsCount };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLeaveOrders) {
        for (const [key, data] of context.previousLeaveOrders) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTickets) {
        for (const [key, data] of context.previousTickets) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTicketsCount !== undefined) {
        queryClient.setQueryData(['tickets-count'], context.previousTicketsCount);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
      queryClient.invalidateQueries({ queryKey: ['tickets-count'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};

export const useCloseLeaveOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason, expected_revision }: { id: number; reason: string; expected_revision: number }) =>
      closeLeaveOrder(id, { reason, expected_revision }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
      queryClient.invalidateQueries({ queryKey: ['leave-order', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets-count'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};

const invalidateLeaveOrders = (
  queryClient: ReturnType<typeof useQueryClient>,
  id?: number,
  affectsStockAndLogs: boolean = false
) => {
  queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
  queryClient.invalidateQueries({ queryKey: ['tickets'] });
  queryClient.invalidateQueries({ queryKey: ['tickets-count'] });
  queryClient.invalidateQueries({ queryKey: ['items'] });
  if (affectsStockAndLogs) {
    queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
    queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
  }
  queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['leave-order', id] });
};

export const useFulfillLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_revision, idempotencyKey }: { id: number; expected_revision: number; idempotencyKey?: string }) =>
      fulfillLeaveOrder(id, expected_revision, idempotencyKey),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['leave-orders'] });
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      await queryClient.cancelQueries({ queryKey: ['tickets-count'] });
      await queryClient.cancelQueries({ queryKey: ['leave-order', id] });

      const previousLeaveOrders = queryClient.getQueriesData<PaginatedLeaveOrders>({ queryKey: ['leave-orders'] });
      const previousTickets = queryClient.getQueriesData<PaginatedTickets>({ queryKey: ['tickets'] });
      const previousTicketsCount = queryClient.getQueryData<{ count: number }>(['tickets-count']);
      const previousOrderDetail = queryClient.getQueryData<LeaveOrderDetail>(['leave-order', id]);

      queryClient.setQueriesData<PaginatedTickets>(
        { queryKey: ['tickets'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            total_count: Math.max(0, old.total_count - 1),
            tickets: old.tickets.filter((t) => t.id !== id)
          };
        }
      );

      queryClient.setQueriesData<PaginatedLeaveOrders>(
        { queryKey: ['leave-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            leave_orders: old.leave_orders.map((lo) => (lo.id === id ? { ...lo, status: 'closed' } : lo))
          };
        }
      );

      queryClient.setQueryData<{ count: number }>(['tickets-count'], (old) => ({
        count: Math.max(0, (old?.count || 1) - 1)
      }));

      queryClient.setQueryData<LeaveOrderDetail>(['leave-order', id], (old) => {
        if (!old) return old;
        return { ...old, status: 'closed' };
      });

      return { previousLeaveOrders, previousTickets, previousTicketsCount, previousOrderDetail };
    },
    onError: (_err, variables, context) => {
      if (context?.previousLeaveOrders) {
        for (const [key, data] of context.previousLeaveOrders) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTickets) {
        for (const [key, data] of context.previousTickets) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTicketsCount !== undefined) {
        queryClient.setQueryData(['tickets-count'], context.previousTicketsCount);
      }
      if (context?.previousOrderDetail) {
        queryClient.setQueryData(['leave-order', variables.id], context.previousOrderDetail);
      }
    },
    onSettled: (_data, _error, variables) => invalidateLeaveOrders(queryClient, variables.id, true)
  });
};

export const useRejectLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: number; input: { expected_revision: number; reason: string }; idempotencyKey?: string }) =>
      rejectLeaveOrder(id, input, idempotencyKey),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: ['leave-orders'] });
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      await queryClient.cancelQueries({ queryKey: ['tickets-count'] });
      await queryClient.cancelQueries({ queryKey: ['leave-order', id] });

      const previousLeaveOrders = queryClient.getQueriesData<PaginatedLeaveOrders>({ queryKey: ['leave-orders'] });
      const previousTickets = queryClient.getQueriesData<PaginatedTickets>({ queryKey: ['tickets'] });
      const previousTicketsCount = queryClient.getQueryData<{ count: number }>(['tickets-count']);
      const previousOrderDetail = queryClient.getQueryData<LeaveOrderDetail>(['leave-order', id]);

      queryClient.setQueriesData<PaginatedTickets>(
        { queryKey: ['tickets'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            total_count: Math.max(0, old.total_count - 1),
            tickets: old.tickets.filter((t) => t.id !== id)
          };
        }
      );

      queryClient.setQueriesData<PaginatedLeaveOrders>(
        { queryKey: ['leave-orders'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            leave_orders: old.leave_orders.map((lo) =>
              lo.id === id ? { ...lo, status: 'rejected', rejection_reason: input.reason } : lo
            )
          };
        }
      );

      queryClient.setQueryData<{ count: number }>(['tickets-count'], (old) => ({
        count: Math.max(0, (old?.count || 1) - 1)
      }));

      queryClient.setQueryData<LeaveOrderDetail>(['leave-order', id], (old) => {
        if (!old) return old;
        return { ...old, status: 'rejected', rejection_reason: input.reason };
      });

      return { previousLeaveOrders, previousTickets, previousTicketsCount, previousOrderDetail };
    },
    onError: (_err, variables, context) => {
      if (context?.previousLeaveOrders) {
        for (const [key, data] of context.previousLeaveOrders) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTickets) {
        for (const [key, data] of context.previousTickets) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousTicketsCount !== undefined) {
        queryClient.setQueryData(['tickets-count'], context.previousTicketsCount);
      }
      if (context?.previousOrderDetail) {
        queryClient.setQueryData(['leave-order', variables.id], context.previousOrderDetail);
      }
    },
    onSettled: (_data, _error, variables) => invalidateLeaveOrders(queryClient, variables.id, false)
  });
};

export const useResubmitLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: number; input: Parameters<typeof resubmitLeaveOrder>[1]; idempotencyKey?: string }) =>
      resubmitLeaveOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id, false)
  });
};

export const useCancelLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_revision, idempotencyKey }: { id: number; expected_revision: number; idempotencyKey?: string }) =>
      cancelLeaveOrder(id, expected_revision, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id, false)
  });
};

export const useTickets = (
  params: { page?: number; page_size?: number; status?: string; search?: string } | string = {},
  options: any = {}
) => {
  const { isAuthenticated } = useAuth();
  const normalizedParams = typeof params === 'string' ? { status: params } : (params || {});
  return useQuery<PaginatedTickets>({
    queryKey: ['tickets', normalizedParams],
    queryFn: () => getTickets(normalizedParams),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 15,
    enabled: isAuthenticated && options?.enabled !== false,
    ...options
  });
};

export const useReturnTicket = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ticketId,
      input,
      idempotencyKey
    }: {
      ticketId: number;
      input: TicketReturnInput;
      idempotencyKey?: string;
    }) => returnTicketItems(ticketId, input, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
      queryClient.invalidateQueries({ queryKey: ['leave-order', variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets-count'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    }
  });
};
