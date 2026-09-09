
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, canAccessPage, getCapabilitiesForRole, getDefaultPageForRole, normalizePageId } from '../src/navigation.ts';
import type { PageId, Role } from '../src/navigation.ts';

describe('role-aligned navigation', () => {
  test('registers only the current workflow pages', () => {
    const expected: PageId[] = ['Dashboard', 'Items', 'PurchaseOrders', 'DisbursementTickets', 'POTickets', 'LeaveOrders', 'Logs', 'Units', 'Destinations', 'Providers', 'Settings'];
    assert.deepEqual(Object.values(PAGES), expected);
    assert.equal(normalizePageId('POScan'), null);
  });

  test('warehouse receives operational ticket pages, not office pages', () => {
    for (const page of ['Dashboard', 'Items', 'DisbursementTickets', 'POTickets', 'Logs', 'Units', 'Destinations', 'Providers', 'Settings']) assert.equal(canAccessPage('warehouse', page), true);
    for (const page of ['PurchaseOrders', 'LeaveOrders']) assert.equal(canAccessPage('warehouse', page), false);
  });

  test('office receives preparation pages, not warehouse ticket pages', () => {
    for (const page of ['Dashboard', 'Items', 'LeaveOrders', 'PurchaseOrders', 'Logs', 'Settings']) assert.equal(canAccessPage('office', page), true);
    for (const page of ['DisbursementTickets', 'POTickets', 'Units', 'Destinations', 'Providers']) assert.equal(canAccessPage('office', page), false);
  });

  test('admin receives the union', () => {
    for (const page of Object.values(PAGES)) assert.equal(canAccessPage('admin', page), true);
  });

  test('capabilities match the workflow owners', () => {
    const office = getCapabilitiesForRole('office');
    const warehouse = getCapabilitiesForRole('warehouse');
    assert.equal(office.canManagePOs, true);
    assert.equal(office.canManageLeaveOrders, true);
    assert.equal(office.canManageDisbursementTickets, false);
    assert.equal(warehouse.canManagePOs, false);
    assert.equal(warehouse.canManageLeaveOrders, false);
    assert.equal(warehouse.canManageDisbursementTickets, true);
    assert.equal(getCapabilitiesForRole('admin').canManageDisbursementTickets, true);
  });

  test('normalizes valid IDs and rejects removed IDs', () => {
    assert.equal(normalizePageId('  potickets '), 'POTickets');
    assert.equal(normalizePageId('DisbursementTickets'), 'DisbursementTickets');
    assert.equal(canAccessPage('unknown' as Role, 'Dashboard'), false);
    assert.equal(getDefaultPageForRole('office'), 'Dashboard');
  });
});
