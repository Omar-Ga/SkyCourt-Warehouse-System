import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  canAccessPage,
  getCapabilitiesForRole,
  ROLE_PAGE_PERMISSIONS,
  getDefaultPageForRole,
} from '../src/navigation.ts';
import type { PageId, Role } from '../src/navigation.ts';

describe('Navigation and Capability-Based Access Control', () => {
  test('Canonical page identifiers are registered and complete', () => {
    const expectedPages: PageId[] = [
      'Dashboard',
      'Items',
      'PurchaseOrders',
      'Tickets',
      'LeaveOrders',
      'POScan',
      'Logs',
      'Units',
      'Destinations',
      'Providers',
      'Settings',
    ];

    assert.equal(Object.keys(PAGES).length, expectedPages.length);
    for (const page of expectedPages) {
      assert.ok(Object.values(PAGES).includes(page), `Missing canonical page: ${page}`);
    }
  });

  test('Warehouse navigation permissions meet acceptance criteria', () => {
    // Warehouse must have: dashboard, inventory & metadata management, reporting, settings, leave orders, PO receiving
    const warehouseAllowed: PageId[] = [
      'Dashboard',
      'Items',
      'Units',
      'Destinations',
      'Providers',
      'Logs',
      'Settings',
      'LeaveOrders',
      'POScan',
    ];

    for (const page of warehouseAllowed) {
      assert.equal(
        canAccessPage('warehouse', page),
        true,
        `Warehouse should be allowed to access ${page}`
      );
    }

    // Warehouse must NOT access office-specific workflows (Purchase Orders, Tickets)
    const warehouseDisallowed: PageId[] = ['PurchaseOrders', 'Tickets'];
    for (const page of warehouseDisallowed) {
      assert.equal(
        canAccessPage('warehouse', page),
        false,
        `Warehouse should NOT be allowed to access ${page}`
      );
    }
  });

  test('Office navigation permissions meet acceptance criteria', () => {
    // Office must have: read-only inventory & dashboard, PO management, tickets, movement reports, settings
    const officeAllowed: PageId[] = [
      'Dashboard',
      'Items',
      'PurchaseOrders',
      'Tickets',
      'Logs',
      'Settings',
    ];

    for (const page of officeAllowed) {
      assert.equal(
        canAccessPage('office', page),
        true,
        `Office should be allowed to access ${page}`
      );
    }

    // Office must NOT access warehouse mutation / receiving / metadata pages
    const officeDisallowed: PageId[] = [
      'Units',
      'Destinations',
      'Providers',
      'LeaveOrders',
      'POScan',
    ];

    for (const page of officeDisallowed) {
      assert.equal(
        canAccessPage('office', page),
        false,
        `Office should NOT be allowed to access ${page}`
      );
    }
  });

  test('Admin navigation permissions allow both workflow groups', () => {
    const allPages: PageId[] = [
      'Dashboard',
      'Items',
      'PurchaseOrders',
      'Tickets',
      'LeaveOrders',
      'POScan',
      'Logs',
      'Units',
      'Destinations',
      'Providers',
      'Settings',
    ];

    for (const page of allPages) {
      assert.equal(
        canAccessPage('admin', page),
        true,
        `Admin should have access to ${page}`
      );
    }
  });

  test('Page access normalizes case-insensitively and rejects invalid values', () => {
    assert.equal(canAccessPage('WAREHOUSE', 'dashboard'), true);
    assert.equal(canAccessPage('Office', 'PURCHASEORDERS'), true);
    assert.equal(canAccessPage('office', 'poscan'), false);
    assert.equal(canAccessPage(null, 'Dashboard'), false);
    assert.equal(canAccessPage('warehouse', ''), false);
    assert.equal(canAccessPage('warehouse', null as any), false);
    assert.equal(canAccessPage('unknown_role' as Role, 'Dashboard'), false);
    assert.equal(canAccessPage('office', 'NonExistentPage'), false);
  });

  test('Office capabilities explicitly disable all mutation and adjustment controls', () => {
    const officeCaps = getCapabilitiesForRole('office');

    // Office cannot mutate items or categories
    assert.equal(officeCaps.canMutateItems, false);
    assert.equal(officeCaps.canMutateCategories, false);

    // Office cannot adjust quantity (dashboard adjustment shortcuts or scanned-item adjust modal)
    assert.equal(officeCaps.canAdjustQuantity, false);

    // Office can manage POs and tickets
    assert.equal(officeCaps.canManagePOs, true);
    assert.equal(officeCaps.canManageTickets, true);

    // Office cannot receive POs or manage leave orders / metadata
    assert.equal(officeCaps.canReceivePOs, false);
    assert.equal(officeCaps.canManageLeaveOrders, false);
    assert.equal(officeCaps.canManageMetadata, false);
  });

  test('Warehouse capabilities enable inventory mutations, receiving, and leave orders', () => {
    const whCaps = getCapabilitiesForRole('warehouse');

    assert.equal(whCaps.canMutateItems, true);
    assert.equal(whCaps.canMutateCategories, true);
    assert.equal(whCaps.canAdjustQuantity, true);
    assert.equal(whCaps.canManagePOs, false);
    assert.equal(whCaps.canReceivePOs, true);
    assert.equal(whCaps.canManageTickets, false);
    assert.equal(whCaps.canManageLeaveOrders, true);
    assert.equal(whCaps.canManageMetadata, true);
  });

  test('Admin capabilities enable all operational controls across both roles', () => {
    const adminCaps = getCapabilitiesForRole('admin');

    assert.equal(adminCaps.canMutateItems, true);
    assert.equal(adminCaps.canMutateCategories, true);
    assert.equal(adminCaps.canAdjustQuantity, true);
    assert.equal(adminCaps.canManagePOs, true);
    assert.equal(adminCaps.canReceivePOs, true);
    assert.equal(adminCaps.canManageTickets, true);
    assert.equal(adminCaps.canManageLeaveOrders, true);
    assert.equal(adminCaps.canManageMetadata, true);
  });

  test('Role change boundary: disallowed active pages must reset to default page', () => {
    // Simulate user being on 'Units' as warehouse, then role changes to 'office'
    const warehousePage: PageId = 'Units';
    assert.equal(canAccessPage('warehouse', warehousePage), true);
    assert.equal(canAccessPage('office', warehousePage), false);

    // Default fallback must be Dashboard
    const defaultPage = getDefaultPageForRole('office');
    assert.equal(defaultPage, 'Dashboard');
    assert.equal(canAccessPage('office', defaultPage), true);

    // Simulate user being on 'PurchaseOrders' as office, then role changes to 'warehouse'
    const officePage: PageId = 'PurchaseOrders';
    assert.equal(canAccessPage('office', officePage), true);
    assert.equal(canAccessPage('warehouse', officePage), false);

    const warehouseDefault = getDefaultPageForRole('warehouse');
    assert.equal(warehouseDefault, 'Dashboard');
    assert.equal(canAccessPage('warehouse', warehouseDefault), true);
  });

  test('normalizePageId correctly resolves canonical IDs, trims whitespace, handles aliases and invalid values', async () => {
    const { normalizePageId } = await import('../src/navigation.ts');

    // Exact matches
    assert.equal(normalizePageId('Dashboard'), 'Dashboard');
    assert.equal(normalizePageId('Items'), 'Items');
    assert.equal(normalizePageId('PurchaseOrders'), 'PurchaseOrders');
    assert.equal(normalizePageId('Tickets'), 'Tickets');
    assert.equal(normalizePageId('LeaveOrders'), 'LeaveOrders');
    assert.equal(normalizePageId('POScan'), 'POScan');
    assert.equal(normalizePageId('Logs'), 'Logs');
    assert.equal(normalizePageId('Units'), 'Units');
    assert.equal(normalizePageId('Destinations'), 'Destinations');
    assert.equal(normalizePageId('Providers'), 'Providers');
    assert.equal(normalizePageId('Settings'), 'Settings');

    // Case-insensitivity & whitespace trimming
    assert.equal(normalizePageId('  items  '), 'Items');
    assert.equal(normalizePageId('LOGS'), 'Logs');
    assert.equal(normalizePageId('purchaseorders'), 'PurchaseOrders');
    assert.equal(normalizePageId('poscan'), 'POScan');

    // POConfirm alias to POScan
    assert.equal(normalizePageId('POConfirm'), 'POScan');
    assert.equal(normalizePageId('poconfirm'), 'POScan');
    assert.equal(canAccessPage('warehouse', 'POConfirm'), true);
    assert.equal(canAccessPage('office', 'POConfirm'), false);

    // Invalid & null inputs
    assert.equal(normalizePageId(''), null);
    assert.equal(normalizePageId(null), null);
    assert.equal(normalizePageId(undefined), null);
    assert.equal(normalizePageId('NonExistentPage'), null);
  });
});
