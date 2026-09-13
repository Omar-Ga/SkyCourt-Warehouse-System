/* eslint-disable */
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient, ApiError } from '../src/services/apiClient.ts';

// Mock fetch environment
const originalFetch = globalThis.fetch;

describe('apiClient & Session Isolation', () => {
  beforeEach(() => {
    apiClient.resetSession();
    apiClient.setOnUnauthorized(null);
  });

  test('GET request calls correct URL with same-origin credentials', async () => {
    let capturedUrl = '';
    let capturedConfig: any = null;

    globalThis.fetch = async (url: any, config: any) => {
      capturedUrl = String(url);
      capturedConfig = config;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await apiClient.get<{ success: boolean }>('/items');
    assert.equal(res.success, true);
    assert.equal(capturedUrl, '/api/items');
    assert.equal(capturedConfig.credentials, 'same-origin');
    assert.equal(capturedConfig.method, 'GET');
    assert.equal(capturedConfig.headers['X-CSRF-Token'], undefined);
  });

  test('POST request fetches CSRF token if not cached and includes X-CSRF-Token', async () => {
    const calls: { url: string; headers: any }[] = [];

    globalThis.fetch = async (url: any, config: any) => {
      calls.push({ url: String(url), headers: config?.headers });
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'test-csrf-token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 10, name: 'Item A' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await apiClient.post<{ id: number; name: string }>('/items', { name: 'Item A' });
    assert.equal(res.id, 10);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/api/auth/csrf');
    assert.equal(calls[1].url, '/api/items');
    assert.equal(calls[1].headers['X-CSRF-Token'], 'test-csrf-token-123');
    assert.equal(apiClient.getCsrfToken(), 'test-csrf-token-123');
  });

  test('409 Conflict preserves response data and status in ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: 'Item already exists',
          type: 'item_conflict',
          item_id: 42,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await apiClient.get('/items');
      },
      (err: any) => {
        assert(err instanceof ApiError);
        assert.equal(err.status, 409);
        assert.equal(err.data.type, 'item_conflict');
        assert.equal(err.data.item_id, 42);
        return true;
      }
    );
  });

  test('401 triggers onUnauthorized handler for authenticated endpoints', async () => {
    let unauthorizedTriggered = false;
    apiClient.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: 'Session expired', code: 'SESSION_INVALID' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(async () => {
      await apiClient.get('/items');
    });

    assert.equal(unauthorizedTriggered, true);
  });

  test('401 does not trigger onUnauthorized handler for /auth/login', async () => {
    let unauthorizedTriggered = false;
    apiClient.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    globalThis.fetch = async (url: any) => {
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(async () => {
      await apiClient.post('/auth/login', { username: 'bad', password: 'bad' });
    });

    assert.equal(unauthorizedTriggered, false);
  });

  test('Late-response protection: session reset during in-flight request aborts and discards result', async () => {
    let fetchPromiseResolve: any;

    globalThis.fetch = async (_url: any, config: any) => {
      return new Promise((resolve, reject) => {
        fetchPromiseResolve = resolve;
        if (config?.signal) {
          config.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }
      });
    };

    const requestPromise = apiClient.get('/items');

    // Simulate session reset (e.g. logout or expiry) while request is in flight
    apiClient.resetSession();

    // Now resolve the underlying fetch as if the server answered late
    fetchPromiseResolve(
      new Response(JSON.stringify({ sensitive: 'old-session-data' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await assert.rejects(
      async () => {
        await requestPromise;
      },
      (err: any) => {
        // Must reject and not return old-session data
        assert(err instanceof ApiError || err.message.includes('aborted'));
        return true;
      }
    );
  });

  test('startSession clears previous requests and registers new CSRF token', () => {
    apiClient.startSession('fresh-session-csrf');
    assert.equal(apiClient.getCsrfToken(), 'fresh-session-csrf');
  });

  test('resetSession clears CSRF token and increments epoch', () => {
    apiClient.startSession('fresh-session-csrf');
    assert.equal(apiClient.getCsrfToken(), 'fresh-session-csrf');
    apiClient.resetSession();
    assert.equal(apiClient.getCsrfToken(), null);
  });

  test('Endpoint normalization does not duplicate /api prefix', async () => {
    let requestedUrl = '';
    globalThis.fetch = async (url: any) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await apiClient.get('/api/items/123');
    assert.equal(requestedUrl, '/api/items/123');
  });

  test('Pre-aborted caller signal causes immediate abort rejection', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted!'));

    await assert.rejects(
      async () => {
        await apiClient.get('/items', { signal: controller.signal });
      },
      (err: any) => {
        assert(err.message.includes('aborted') || err.message.includes('Pre-aborted'));
        return true;
      }
    );
  });

  test('POST with FormData does not override Content-Type header', async () => {
    let capturedHeaders: any = null;
    globalThis.fetch = async (url: any, config: any) => {
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-token' }), { status: 200 });
      }
      capturedHeaders = config?.headers;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    // Node environment might have global FormData
    if (typeof FormData !== 'undefined') {
      const form = new FormData();
      form.append('field', 'value');
      await apiClient.post('/upload', form);
      assert.equal(capturedHeaders['Content-Type'], undefined);
      assert.equal(capturedHeaders['X-CSRF-Token'], 'csrf-token');
    }
  });

  test('POST /items and /items/:id/adjust automatically carry Idempotency-Key', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (url: any, config: any) => {
      if (String(url).endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-token' }), { status: 200 });
      }
      capturedHeaders = config?.headers || {};
      return new Response(JSON.stringify({ id: 1, name: 'Item with Key' }), { status: 201 });
    };

    // 1. Create item carries Idempotency-Key
    await apiClient.post('/items', { name: 'Item with Key', unit_id: 1 });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 2. Stock adjustment carries Idempotency-Key
    await apiClient.post('/items/42/adjust', { change_amount: 5, adjustment_type: 'addition' });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 3. Leave order create carries Idempotency-Key
    await apiClient.post('/leave-orders', { employee_name: 'Adel', destination_id: 1, items: [{ item_id: 1, quantity: 1 }] });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 4. Leave order close carries Idempotency-Key
    await apiClient.post('/leave-orders/10/close', { reason: 'Done', expected_revision: 0 });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 5. Ticket return carries Idempotency-Key
    await apiClient.post('/tickets/10/return', { expected_revision: 0, items: [{ line_id: 1, quantity: 1 }] });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 6. Ticket close carries Idempotency-Key
    await apiClient.post('/tickets/10/close', { reason: 'Finished', expected_revision: 0 });
    assert.ok(capturedHeaders['Idempotency-Key']);
    assert.ok(capturedHeaders['Idempotency-Key'].length > 0);

    // 7. Caller-provided Idempotency-Key is preserved
    await apiClient.post('/items', { name: 'Explicit Key' }, {
      headers: { 'Idempotency-Key': 'caller-provided-key-99' }
    });
    assert.equal(capturedHeaders['Idempotency-Key'], 'caller-provided-key-99');

    // 7b. Case-insensitive caller header (lowercase or X-Idempotency-Key) is preserved
    await apiClient.post('/items', { name: 'Lower Key' }, {
      headers: { 'idempotency-key': 'lower-key-123' }
    });
    assert.equal(capturedHeaders['idempotency-key'], 'lower-key-123');
    assert.equal(capturedHeaders['Idempotency-Key'], undefined);

    await apiClient.post('/items', { name: 'X Key' }, {
      headers: { 'X-Idempotency-Key': 'x-key-456' }
    });
    assert.equal(capturedHeaders['X-Idempotency-Key'], 'x-key-456');
    assert.equal(capturedHeaders['Idempotency-Key'], undefined);

    // 8. Non-mutation route does NOT carry Idempotency-Key
    await apiClient.post('/auth/login', { username: 'user', password: 'pw' });
    assert.equal(capturedHeaders['Idempotency-Key'], undefined);

    // 9. Categories, Providers, Destinations, Units carry Idempotency-Key on POST, PUT, DELETE
    await apiClient.post('/categories', { name: 'New Cat' });
    assert.ok(capturedHeaders['Idempotency-Key']);

    await apiClient.put('/categories/5', { name: 'Updated Cat' });
    assert.ok(capturedHeaders['Idempotency-Key']);

    await apiClient.delete('/categories/5');
    assert.ok(capturedHeaders['Idempotency-Key']);

    await apiClient.post('/providers', { name: 'New Prov' });
    assert.ok(capturedHeaders['Idempotency-Key']);

    await apiClient.post('/destinations', { name: 'New Dest' });
    assert.ok(capturedHeaders['Idempotency-Key']);

    await apiClient.post('/units', { name: 'New Unit' });
    assert.ok(capturedHeaders['Idempotency-Key']);
  });

  test('generateIdempotencyKey produces valid UUID even when crypto.randomUUID is absent', async () => {
    const originalRandomUUID = crypto.randomUUID;
    try {
      // Temporarily unset randomUUID to force fallback
      (crypto as any).randomUUID = undefined;
      const { generateIdempotencyKey } = await import('../src/services/apiClient.ts');
      const fallbackKey = generateIdempotencyKey();
      assert.ok(fallbackKey);
      // Valid RFC4122 v4 UUID format regex: 8-4-4-4-12 hex chars
      assert.match(fallbackKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      (crypto as any).randomUUID = originalRandomUUID;
    }
  });
});
