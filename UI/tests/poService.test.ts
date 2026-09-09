
import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../src/services/apiClient.ts';
import { createPurchaseOrder, dispatchPurchaseOrder, editPurchaseOrder, getPurchaseOrders, receivePurchaseOrder } from '../src/services/poService.ts';

const originalFetch = globalThis.fetch;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('purchase order service contracts', () => {
  beforeEach(() => apiClient.resetSession());
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('lists drafts and encodes filters', async () => {
    let url = '';
    globalThis.fetch = async (request) => { url = String(request); return response({ purchase_orders: [], total_count: 0, page: 1, page_size: 15, total_pages: 1 }); };
    await getPurchaseOrders({ status: 'draft', search: 'مورد' });
    assert.match(url, /status=draft/);
    assert.match(url, /search=%D9%85%D9%88%D8%B1%D8%AF/);
  });

  test('creates a draft with requested and ordered quantities', async () => {
    let config: RequestInit | undefined;
    globalThis.fetch = async (request, init) => { if (String(request).includes('/auth/csrf')) return response({ csrf_token: 'csrf' }); config = init; return response({ id: 1, status: 'draft', po_number: 'PO-1' }, 201); };
    await createPurchaseOrder({ provider_id: 2, items: [{ item_id: 10, requested_quantity: 5, ordered_quantity: 5, unit_price: '10.00' }] }, 'create-key');
    assert.equal((config?.headers as Record<string, string>)['Idempotency-Key'], 'create-key');
    assert.equal(JSON.parse(String(config?.body)).items[0].requested_quantity, 5);
  });

  test('edits and dispatches a draft with revision-aware payloads', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = async (request, init) => { if (String(request).includes('/auth/csrf')) return response({ csrf_token: 'csrf' }); calls.push({ url: String(request), init }); return response({ id: 4, status: 'draft' }); };
    await editPurchaseOrder(4, { provider_id: 2, expected_revision: 2, items: [{ item_id: 10, requested_quantity: 5, ordered_quantity: 0, unit_price: '10.00' }] }, 'edit-key');
    await dispatchPurchaseOrder(4, 3, 'dispatch-key');
    assert.match(calls[0].url, /purchase-orders\/4$/);
    assert.equal(JSON.parse(String(calls[1].init?.body)).expected_revision, 3);
  });

  test('receives and closes without a client partial-receipt payload', async () => {
    let config: RequestInit | undefined;
    globalThis.fetch = async (request, init) => { if (String(request).includes('/auth/csrf')) return response({ csrf_token: 'csrf' }); config = init; return response({ id: 12, status: 'closed', affected_balances: [] }); };
    await receivePurchaseOrder(12, { expected_revision: 4 }, 'receive-key');
    assert.deepEqual(JSON.parse(String(config?.body)), { expected_revision: 4 });
    assert.equal((config?.headers as Record<string, string>)['Idempotency-Key'], 'receive-key');
  });
});
