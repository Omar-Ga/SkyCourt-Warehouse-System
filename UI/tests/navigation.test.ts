
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  NAV_GROUPS,
  canAccessPage,
  getCapabilitiesForRole,
  getDefaultPageForRole,
  getNavigationGroupsForRole,
  normalizePageId,
} from '../src/navigation.ts';
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

  test('NAV_GROUPS defines 4 distinct logical navigation sections', () => {
    assert.equal(NAV_GROUPS.length, 4);
    assert.deepEqual(
      NAV_GROUPS.map((g) => g.id),
      ['stockOperations', 'ordersDocuments', 'masterData', 'systemReports']
    );
  });

  test('getNavigationGroupsForRole prunes Orders & Documents for warehouse role', () => {
    const groups = getNavigationGroupsForRole('warehouse');
    const groupIds = groups.map((g) => g.id);

    assert.deepEqual(groupIds, ['stockOperations', 'masterData', 'systemReports']);
    assert.ok(!groupIds.includes('ordersDocuments'), 'Orders & Documents must not be shown to warehouse');

    const stockGroup = groups.find((g) => g.id === 'stockOperations');
    assert.deepEqual(stockGroup?.items.map((i) => i.id), ['Items', 'DisbursementTickets', 'POTickets']);
    assert.equal(stockGroup?.items[0].title, 'إدارة الأصناف');

    const masterData = groups.find((g) => g.id === 'masterData');
    assert.deepEqual(masterData?.items.map((i) => i.id), ['Units', 'Destinations', 'Providers']);

    const systemGroup = groups.find((g) => g.id === 'systemReports');
    assert.deepEqual(systemGroup?.items.map((i) => i.id), ['Logs', 'Settings']);
    assert.equal(systemGroup?.items[0].title, 'سجل الحركات');
  });

  test('getNavigationGroupsForRole prunes Master Data for office role and resolves office titles', () => {
    const groups = getNavigationGroupsForRole('office');
    const groupIds = groups.map((g) => g.id);

    assert.deepEqual(groupIds, ['stockOperations', 'ordersDocuments', 'systemReports']);
    assert.ok(!groupIds.includes('masterData'), 'Master Data must be pruned for office role');

    const stockGroup = groups.find((g) => g.id === 'stockOperations');
    assert.deepEqual(stockGroup?.items.map((i) => i.id), ['Items']);
    assert.equal(stockGroup?.items[0].title, 'دليل الأصناف');

    const ordersGroup = groups.find((g) => g.id === 'ordersDocuments');
    assert.deepEqual(ordersGroup?.items.map((i) => i.id), ['PurchaseOrders', 'LeaveOrders']);

    const systemGroup = groups.find((g) => g.id === 'systemReports');
    assert.deepEqual(systemGroup?.items.map((i) => i.id), ['Logs', 'Settings']);
    assert.equal(systemGroup?.items[0].title, 'تقارير الحركات');
  });

  test('getNavigationGroupsForRole returns all four groups for admin role', () => {
    const groups = getNavigationGroupsForRole('admin');
    assert.equal(groups.length, 4);
    assert.deepEqual(
      groups.map((g) => g.id),
      ['stockOperations', 'ordersDocuments', 'masterData', 'systemReports']
    );
  });

  test('getNavigationGroupsForRole returns empty array for null, undefined, or invalid role', () => {
    assert.deepEqual(getNavigationGroupsForRole(null), []);
    assert.deepEqual(getNavigationGroupsForRole(undefined), []);
    assert.deepEqual(getNavigationGroupsForRole('invalid-role' as Role), []);
  });
});

