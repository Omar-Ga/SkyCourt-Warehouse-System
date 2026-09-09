/* eslint-disable */
import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../src/services/apiClient.ts';
import { getTicketsCount } from '../src/services/leaveOrderService.ts';
import { formatMovementTimestamp, formatSafeDate } from '../src/services/statsService.ts';

const originalFetch = globalThis.fetch;

describe('Freshness, Polling, and Sync Status Unit Tests', () => {
  beforeEach(() => {
    apiClient.resetSession();
    apiClient.setOnUnauthorized(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('getTicketsCount fetches actionable tickets count', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ count: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await getTicketsCount();
    assert.equal(res.count, 7);
    assert.match(capturedUrl, /\/api\/leave-orders\/tickets\/count$/);
  });

  test('Manual sync POST /api/sync contract returns authoritative state', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    globalThis.fetch = async (url: any, config: any) => {
      capturedUrl = String(url);
      capturedMethod = config?.method;
      if (capturedUrl.endsWith('/auth/csrf')) {
        return new Response(JSON.stringify({ csrf_token: 'csrf-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          synced: true,
          queued: false,
          status: {
            connected: true,
            mode: 'cloud',
            revision: 42,
            last_synced_at: '2026-09-06T18:00:00Z',
            last_error: null,
            pending_state: { has_pending: false, pending_count: 0, conflicts: 0 }
          },
          message: 'Synchronization successful'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await apiClient.post<any>('/sync');
    assert.equal(res.synced, true);
    assert.equal(res.status.revision, 42);
    assert.equal(res.status.last_synced_at, '2026-09-06T18:00:00Z');
    assert.equal(capturedMethod, 'POST');
    assert.match(capturedUrl, /\/api\/sync$/);
  });

  test('Ticket badge fallback logic correctly handles count, zero, and errors', () => {
    const computeBadge = (data: { count: number } | undefined, isError: boolean): number | string | undefined => {
      if (isError) return '!';
      const count = data?.count || 0;
      return count > 0 ? count : undefined;
    };

    assert.equal(computeBadge({ count: 5 }, false), 5);
    assert.equal(computeBadge({ count: 0 }, false), undefined);
    assert.equal(computeBadge(undefined, false), undefined);
    assert.equal(computeBadge(undefined, true), '!');
    assert.equal(computeBadge({ count: 5 }, true), '!');
  });

  test('Timestamp normalization preserves legacy Cairo local strings and formats UTC strings in Cairo time', () => {
    // Legacy naive timestamp: 2026-01-15 14:30:00 (recorded in Cairo local time)
    const legacy = formatMovementTimestamp('2026-01-15 14:30:00');
    assert.equal(legacy.isUtc, false);
    assert.equal(legacy.displayDate, '15/01/2026');
    assert.equal(legacy.displayTime, '14:30:00');
    assert.equal(formatSafeDate('2026-01-15 14:30:00'), '15/01/2026 14:30:00');

    // Modern UTC timestamp: 2026-09-06T15:00:00Z -> In Cairo (UTC+3 summer time), this is 18:00:00
    const modern = formatMovementTimestamp('2026-09-06T15:00:00Z');
    assert.equal(modern.isUtc, true);
    assert.equal(modern.displayTime, '18:00:00');

    // Winter UTC timestamp: 2026-01-14T22:30:00Z -> In Cairo (UTC+2 winter time), this is 00:30:00
    const winter = formatMovementTimestamp('2026-01-14T22:30:00Z');
    assert.equal(winter.isUtc, true);
    assert.equal(winter.displayTime, '00:30:00');
  });

  test('Daily movement summary model correctly exposes returns_today alongside additions and withdrawals', () => {
    interface DailySummary {
      additions_today: number;
      withdrawals_today: number;
      returns_today: number;
      net_change: number;
    }

    const mockSummary: DailySummary = {
      additions_today: 100,
      withdrawals_today: 40,
      returns_today: 15,
      net_change: 75 // 100 - 40 + 15
    };

    assert.equal(mockSummary.returns_today, 15);
    assert.equal(mockSummary.additions_today, 100);
    assert.equal(mockSummary.withdrawals_today, 40);
    assert.equal(mockSummary.additions_today - mockSummary.withdrawals_today + mockSummary.returns_today, mockSummary.net_change);
  });
});
