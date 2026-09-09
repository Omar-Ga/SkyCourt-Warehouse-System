import { apiClient } from './apiClient.ts';

export interface CompanyIdentity {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo_url?: string;
}

export interface PurchaseOrderItem {
  id: number;
  po_id: number;
  item_id: number;
  item_name: string;
  unit_id: number;
  unit_name: string;
  line_description: string;
  ordered_quantity: number;
  received_quantity?: number | null;
  requested_quantity: number;
  disposition?: 'pending' | 'received' | 'struck_off';
  unit_price: string;
  unit_price_minor: number;
  line_total: string;
  line_total_minor: number;
  current_item_status?: string;
}

export interface PurchaseOrderSummary {
  id: number;
  po_number: string;
  provider_id: number;
  provider_name: string;
  status: 'draft' | 'open' | 'closed' | 'void' | 'expired';
  db_status: string;
  is_expired: boolean;
  notes?: string | null;
  created_by: number;
  creator_name?: string | null;
  created_at: string;
  expires_at?: string | null;
  dispatched_at?: string | null;
  revision: number;
  received_by?: number | null;
  receiver_name?: string | null;
  closed_at?: string | null;
  voided_by?: number | null;
  void_actor_name?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  currency: string;
  currency_scale: number;
  total_amount: string;
  total_amount_minor: number;
  line_count: number;
  total_ordered_quantity: number;
  total_received_quantity?: number | null;
  company: CompanyIdentity;
  allowed_actions: string[];
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  items: PurchaseOrderItem[];
}

export interface PaginatedPurchaseOrders {
  purchase_orders: PurchaseOrderSummary[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CreatePOItemInput {
  item_id: number;
  requested_quantity: number;
  ordered_quantity: number;
  unit_price: string;
  line_description?: string;
}

export interface CreatePOInput {
  provider_id: number;
  notes?: string;
  items: CreatePOItemInput[];
}

export interface VoidPOInput {
  expected_revision: number;
  reason: string;
}

export interface ReceivePOInput {
  expected_revision: number;
}

export interface AffectedBalance {
  item_id: number;
  name: string;
  quantity_changed: number;
  resulting_quantity: number;
  action_type: string;
}

export interface ReceivePOResponse extends PurchaseOrderDetail {
  affected_balances: AffectedBalance[];
}

export const getPurchaseOrders = async (params?: {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
}): Promise<PaginatedPurchaseOrders> => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', params.page.toString());
  if (params?.page_size) query.set('page_size', params.page_size.toString());
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);

  const qs = query.toString();
  return apiClient.get<PaginatedPurchaseOrders>(`/purchase-orders${qs ? `?${qs}` : ''}`);
};

export const getPurchaseOrderDetail = async (id: number): Promise<PurchaseOrderDetail> => {
  return apiClient.get<PurchaseOrderDetail>(`/purchase-orders/${id}`);
};

export const createPurchaseOrder = async (
  input: CreatePOInput,
  idempotencyKey?: string
): Promise<PurchaseOrderDetail> => {
  const key = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `po-${Date.now()}-${Math.random()}`);
  return apiClient.post<PurchaseOrderDetail>('/purchase-orders', input, {
    headers: { 'Idempotency-Key': key }
  });
};

export const voidPurchaseOrder = async (
  id: number,
  input: VoidPOInput,
  idempotencyKey?: string
): Promise<PurchaseOrderDetail> => {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  return apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/void`, input, {
    headers
  });
};

export const receivePurchaseOrder = async (
  id: number,
  input: ReceivePOInput,
  idempotencyKey?: string
): Promise<ReceivePOResponse> => {
  const key = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `po-recv-${Date.now()}-${Math.random()}`);
  return apiClient.post<ReceivePOResponse>(`/purchase-orders/${id}/receive`, input, {
    headers: { 'Idempotency-Key': key }
  });
};

export interface EditPOInput extends Omit<CreatePOInput, 'items'> {
  expected_revision: number;
  items: CreatePOItemInput[];
}

export const editPurchaseOrder = async (
  id: number,
  input: EditPOInput,
  idempotencyKey: string = crypto.randomUUID()
): Promise<PurchaseOrderDetail> => apiClient.put<PurchaseOrderDetail>(`/purchase-orders/${id}`, input, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const dispatchPurchaseOrder = async (
  id: number,
  expected_revision: number,
  idempotencyKey: string = crypto.randomUUID()
): Promise<PurchaseOrderDetail> => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/dispatch`, { expected_revision }, {
  headers: { 'Idempotency-Key': idempotencyKey }
});
