/* eslint-disable */
import { apiClient } from './apiClient.ts';

export interface LeaveOrderItem {
  id: number;
  leave_order_id: number;
  item_id: number;
  item_name: string;
  unit_id: number;
  unit_name: string;
  requested_quantity: number;
  dispensed_quantity: number;
  returned_quantity: number;
  remaining_quantity: number;
  current_item_status?: string;
}

export interface LeaveOrderSummary {
  id: number;
  order_number: string;
  employee_name: string;
  destination_id: number;
  destination_name: string;
  status: 'open' | 'rejected' | 'closed' | 'partially_returned' | 'cancelled';
  notes?: string | null;
  created_by: number;
  creator_name?: string | null;
  created_at: string;
  revision: number;
  closed_by?: number | null;
  closer_name?: string | null;
  closed_at?: string | null;
  close_reason?: string | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  items_count: number;
  total_quantity: number;
  total_returned: number;
  remaining_quantity: number;
}

export interface LeaveOrderDetail extends LeaveOrderSummary {
  items: LeaveOrderItem[];
  return_events?: any[];
}

export interface PaginatedLeaveOrders {
  leave_orders: LeaveOrderSummary[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CreateLeaveOrderItemInput {
  item_id: number;
  requested_quantity: number;
}

export interface CreateLeaveOrderInput {
  employee_name: string;
  destination_id: number;
  notes?: string;
  items: CreateLeaveOrderItemInput[];
}

export const getLeaveOrders = async (params?: {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
}): Promise<PaginatedLeaveOrders> => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', params.page.toString());
  if (params?.page_size) query.set('page_size', params.page_size.toString());
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);

  const qs = query.toString();
  return apiClient.get<PaginatedLeaveOrders>(`/leave-orders${qs ? `?${qs}` : ''}`);
};

export const getLeaveOrderDetail = async (id: number): Promise<LeaveOrderDetail> => {
  return apiClient.get<LeaveOrderDetail>(`/leave-orders/${id}`);
};

export const getTicketsCount = async (): Promise<{ count: number }> => {
  return apiClient.get<{ count: number }>('/leave-orders/tickets/count');
};

export const createLeaveOrder = async (input: CreateLeaveOrderInput): Promise<LeaveOrderDetail> => {
  return apiClient.post<LeaveOrderDetail>('/leave-orders', input, {
    headers: { 'Idempotency-Key': crypto.randomUUID() }
  });
};

export const fulfillLeaveOrder = async (
  id: number,
  expected_revision: number,
  idempotencyKey: string = crypto.randomUUID()
): Promise<LeaveOrderDetail> => apiClient.post<LeaveOrderDetail>(`/tickets/${id}/fulfill`, { expected_revision }, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const rejectLeaveOrder = async (
  id: number,
  input: { expected_revision: number; reason: string },
  idempotencyKey: string = crypto.randomUUID()
): Promise<LeaveOrderDetail> => apiClient.post<LeaveOrderDetail>(`/tickets/${id}/reject`, input, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const resubmitLeaveOrder = async (
  id: number,
  input: { expected_revision: number; items?: CreateLeaveOrderItemInput[]; notes?: string },
  idempotencyKey: string = crypto.randomUUID()
): Promise<LeaveOrderDetail> => apiClient.post<LeaveOrderDetail>(`/leave-orders/${id}/resubmit`, input, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const cancelLeaveOrder = async (
  id: number,
  expected_revision: number,
  idempotencyKey: string = crypto.randomUUID()
): Promise<LeaveOrderDetail> => apiClient.post<LeaveOrderDetail>(`/leave-orders/${id}/cancel`, { expected_revision }, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const closeLeaveOrder = async (
  id: number,
  input: { reason: string; expected_revision: number }
): Promise<LeaveOrderDetail> => {
  return apiClient.post<LeaveOrderDetail>(`/leave-orders/${id}/close`, input);
};

export interface TicketReturnLineInput {
  line_id: number;
  quantity: number;
}

export interface TicketReturnInput {
  expected_revision: number;
  items: TicketReturnLineInput[];
  notes?: string;
}

export interface PaginatedTickets {
  tickets: LeaveOrderSummary[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export const getTickets = async (params?: {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
}): Promise<PaginatedTickets> => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', params.page.toString());
  if (params?.page_size) query.set('page_size', params.page_size.toString());
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);

  const qs = query.toString();
  return apiClient.get<PaginatedTickets>(`/tickets${qs ? `?${qs}` : ''}`);
};

export const getTicketDetail = async (id: number): Promise<LeaveOrderDetail> => {
  return apiClient.get<LeaveOrderDetail>(`/tickets/${id}`);
};

export const returnTicketItems = async (
  ticketId: number,
  input: TicketReturnInput,
  idempotencyKey?: string
): Promise<LeaveOrderDetail> => {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return apiClient.post<LeaveOrderDetail>(`/tickets/${ticketId}/return`, input, {
    headers
  });
};
