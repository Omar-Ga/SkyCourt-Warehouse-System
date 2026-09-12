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
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
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
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    ...options
  });
};

export const useTicketsCount = (options: any = {}) => {
  const { isAuthenticated } = useAuth();
  return useQuery<{ count: number }>({
    queryKey: ['tickets-count'],
    queryFn: () => getTicketsCount(),
    refetchInterval: 5000, // Poll every 5 seconds per spec
    refetchIntervalInBackground: false, // only while visible
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
    onSuccess: () => {
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

const invalidateLeaveOrders = (queryClient: ReturnType<typeof useQueryClient>, id?: number) => {
  queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
  queryClient.invalidateQueries({ queryKey: ['tickets'] });
  queryClient.invalidateQueries({ queryKey: ['tickets-count'] });
  queryClient.invalidateQueries({ queryKey: ['items'] });
  queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['leave-order', id] });
};

export const useFulfillLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_revision, idempotencyKey }: { id: number; expected_revision: number; idempotencyKey?: string }) =>
      fulfillLeaveOrder(id, expected_revision, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id)
  });
};

export const useRejectLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: number; input: { expected_revision: number; reason: string }; idempotencyKey?: string }) =>
      rejectLeaveOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id)
  });
};

export const useResubmitLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: number; input: Parameters<typeof resubmitLeaveOrder>[1]; idempotencyKey?: string }) =>
      resubmitLeaveOrder(id, input, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id)
  });
};

export const useCancelLeaveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_revision, idempotencyKey }: { id: number; expected_revision: number; idempotencyKey?: string }) =>
      cancelLeaveOrder(id, expected_revision, idempotencyKey),
    onSuccess: (_data, variables) => invalidateLeaveOrders(queryClient, variables.id)
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
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
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
