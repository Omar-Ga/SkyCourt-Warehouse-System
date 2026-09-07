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
    staleTime: 1000 * 30,
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
    mutationFn: (input: CreateLeaveOrderInput) => createLeaveOrder(input),
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

export const useTickets = (
  params: { page?: number; page_size?: number; status?: string; search?: string } = {},
  options: any = {}
) => {
  const { isAuthenticated } = useAuth();
  return useQuery<PaginatedTickets>({
    queryKey: ['tickets', params],
    queryFn: () => getTickets(params),
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

