import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../src/services/apiClient.ts';
import {
  getPurchaseOrders,
  getPurchaseOrderDetail,
  getPurchaseOrderByBarcode,
  getPurchaseOrderBarcode,
  createPurchaseOrder,
  voidPurchaseOrder,
  receivePurchaseOrder
} from '../src/services/poService.ts';

const originalFetch = globalThis.fetch;

describe('poService API Client Calls', () => {
  beforeEach(() => {
    apiClient.resetSession();
    apiClient.setOnUnauthorized(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('getPurchaseOrders formats query string and returns paginated result', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          purchase_orders: [{ id: 1, po_number: 'PO-000001', status: 'open' }],
          total_count: 1,
          page: 1,
          page_size: 15,
          total_pages: 1
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await getPurchaseOrders({ page: 2, page_size: 15, status: 'open', search: 'الأهرام' });
    assert.equal(res.purchase_orders.length, 1);
    assert.equal(res.total_count, 1);
    assert.match(capturedUrl, /\/api\/purchase-orders\?/);
    assert.match(capturedUrl, /page=2/);
    assert.match(capturedUrl, /page_size=15/);
    assert.match(capturedUrl, /status=open/);
    assert.match(capturedUrl, /search=%D8%A7%D9%84%D8%A3%D9%87%D8%B1%D8%A7%D9%85/);
  });

  test('getPurchaseOrderDetail fetches single PO by integer ID', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          id: 42,
          po_number: 'PO-000042',
          status: 'open',
          total_amount: '150.00',
          items: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await getPurchaseOrderDetail(42);
    assert.equal(res.id, 42);
    assert.equal(res.po_number, 'PO-000042');
    assert.equal(capturedUrl, '/api/purchase-orders/42');
  });

  test('getPurchaseOrderByBarcode URL-encodes barcode correctly', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          id: 7,
          po_number: 'PO-000007',
          barcode: 'PO-000007',
          status: 'open'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await getPurchaseOrderByBarcode('PO-000007');
    assert.equal(res.id, 7);
    assert.equal(capturedUrl, '/api/purchase-orders/by-barcode/PO-000007');
  });

  test('getPurchaseOrderBarcode returns base64 image data', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          barcodeValue: 'PO-000001',
          imageData: 'iVBORw0KGgoAAAANSUhEUgAA...',
          imageFormat: 'png'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await getPurchaseOrderBarcode(1);
    assert.equal(res.barcodeValue, 'PO-000001');
    assert.equal(res.imageFormat, 'png');
    assert.equal(capturedUrl, '/api/purchase-orders/1/barcode');
  });

  test('createPurchaseOrder carries Idempotency-Key header', async () => {
    const calls: { url: string; headers: any }[] = [];

    globalThis.fetch = async (url: any, config: any) => {
      calls.push({ url: String(url), headers: config?.headers });
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          id: 1,
          po_number: 'PO-000001',
          status: 'open',
          total_amount: '500.00'
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await createPurchaseOrder(
      {
        provider_id: 2,
        notes: 'Test notes',
        items: [{ item_id: 10, quantity: 5, unit_price: '100.00' }]
      },
      'custom-po-key-123'
    );

    assert.equal(res.id, 1);
    assert.equal(res.po_number, 'PO-000001');
    const poCall = calls.find((c) => c.url === '/api/purchase-orders');
    assert.ok(poCall);
    assert.equal(poCall?.headers['Idempotency-Key'], 'custom-po-key-123');
  });

  test('voidPurchaseOrder sends expected revision and reason', async () => {
    let capturedConfig: any = null;

    globalThis.fetch = async (url: any, config: any) => {
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      capturedConfig = config;
      return new Response(
        JSON.stringify({
          id: 5,
          po_number: 'PO-000005',
          status: 'void',
          revision: 1,
          void_reason: 'Testing cancellation'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await voidPurchaseOrder(
      5,
      { expected_revision: 0, reason: 'Testing cancellation' },
      'void-key-456'
    );

    assert.equal(res.status, 'void');
    assert.equal(res.revision, 1);
    const body = JSON.parse(capturedConfig.body);
    assert.equal(body.expected_revision, 0);
    assert.equal(body.reason, 'Testing cancellation');
    assert.equal(capturedConfig.headers['Idempotency-Key'], 'void-key-456');
  });

  test('receivePurchaseOrder sends expected revision, items, and Idempotency-Key', async () => {
    let capturedUrl = '';
    let capturedConfig: any = null;

    globalThis.fetch = async (url: any, config: any) => {
      capturedUrl = String(url);
      if (capturedUrl.includes('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      capturedConfig = config;
      return new Response(
        JSON.stringify({
          id: 12,
          po_number: 'PO-000012',
          status: 'closed',
          revision: 1,
          total_received_quantity: 6,
          receiver_name: 'Warehouse Operator',
          affected_balances: [
            {
              item_id: 1,
              name: 'Test Item',
              quantity_changed: 6,
              resulting_quantity: 26,
              action_type: 'Addition'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await receivePurchaseOrder(
      12,
      {
        expected_revision: 0,
        items: [
          { line_id: 101, received_quantity: 6, disposition: 'received' },
          { line_id: 102, received_quantity: 0, disposition: 'struck_off' }
        ]
      },
      'receive-key-789'
    );

    assert.equal(res.status, 'closed');
    assert.equal(res.revision, 1);
    assert.equal(res.total_received_quantity, 6);
    assert.equal(res.affected_balances.length, 1);
    assert.equal(capturedUrl, '/api/purchase-orders/12/receive');
    assert.equal(capturedConfig.headers['Idempotency-Key'], 'receive-key-789');
    const body = JSON.parse(capturedConfig.body);
    assert.equal(body.expected_revision, 0);
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0].received_quantity, 6);
    assert.equal(body.items[0].disposition, 'received');
    assert.equal(body.items[1].disposition, 'struck_off');
  });

  test('receivePurchaseOrder preserves empty affected_balances on zero-increment response', async () => {
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          id: 15,
          po_number: 'PO-000015',
          status: 'closed',
          revision: 1,
          total_received_quantity: 1,
          affected_balances: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await receivePurchaseOrder(
      15,
      { expected_revision: 0, items: [{ line_id: 1, received_quantity: 1, disposition: 'received' }] },
      'key-zero-inc'
    );
    assert.equal(res.status, 'closed');
    assert.deepEqual(res.affected_balances, []);
  });
});

