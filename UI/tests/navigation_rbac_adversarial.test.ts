import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  canAccessPage,
  getCapabilitiesForRole,
  getNavigationGroupsForRole,
  normalizePageId,
} from '../src/navigation.ts';

import type { PageId, Role } from '../src/navigation.ts';

describe('Adversarial RBAC Route Exclusion & Security Boundaries', () => {
  const ALL_PAGES = Object.values(PAGES);

  const OFFICE_FORBIDDEN: PageId[] = [
    'DisbursementTickets',
    'POTickets',
    'Units',
    'Destinations',
    'Providers',
  ];

  const WAREHOUSE_FORBIDDEN: PageId[] = [
    'PurchaseOrders',
    'LeaveOrders',
  ];

  test('Office role strictly excludes all warehouse-exclusive pages from getNavigationGroupsForRole', () => {
    const groups = getNavigationGroupsForRole('office');
    const returnedPageIds = groups.flatMap((g) => g.items.map((i) => i.id));

    for (const forbidden of OFFICE_FORBIDDEN) {
      assert.ok(
        !returnedPageIds.includes(forbidden),
        `CRITICAL LEAK: Office navigation must NOT include ${forbidden}`
      );
      assert.equal(
        canAccessPage('office', forbidden),
        false,
        `CRITICAL RBAC BREACH: canAccessPage('office', '${forbidden}') must be false`
      );
    }
  });

  test('Warehouse role strictly excludes all office-exclusive pages from getNavigationGroupsForRole', () => {
    const groups = getNavigationGroupsForRole('warehouse');
    const returnedPageIds = groups.flatMap((g) => g.items.map((i) => i.id));

    for (const forbidden of WAREHOUSE_FORBIDDEN) {
      assert.ok(
        !returnedPageIds.includes(forbidden),
        `CRITICAL LEAK: Warehouse navigation must NOT include ${forbidden}`
      );
      assert.equal(
        canAccessPage('warehouse', forbidden),
        false,
        `CRITICAL RBAC BREACH: canAccessPage('warehouse', '${forbidden}') must be false`
      );
    }
  });

  test('Master Data section is completely absent from office navigation groups', () => {
    const groups = getNavigationGroupsForRole('office');
    const masterGroup = groups.find((g) => g.id === 'masterData');
    assert.equal(masterGroup, undefined, 'masterData section must be pruned for office');
  });

  test('Orders & Documents section is completely absent from warehouse navigation groups', () => {
    const groups = getNavigationGroupsForRole('warehouse');
    const ordersGroup = groups.find((g) => g.id === 'ordersDocuments');
    assert.equal(ordersGroup, undefined, 'ordersDocuments section must be pruned for warehouse');
  });

  test('Arbitrary unauthorized roles return 0 navigation groups and 0 page access', () => {
    const unauthorizedRoles = [
      'guest',
      'visitor',
      'auditor',
      'finance',
      'superadmin',
      'root',
      'anonymous',
      '',
    ];

    for (const role of unauthorizedRoles) {
      const groups = getNavigationGroupsForRole(role as Role);
      assert.deepEqual(groups, [], `Role '${role}' must receive empty navigation groups`);

      for (const page of ALL_PAGES) {
        assert.equal(
          canAccessPage(role, page),
          false,
          `Role '${role}' must NOT be allowed access to '${page}'`
        );
      }
    }
  });

  test('Null and undefined roles return 0 navigation groups and 0 page access', () => {
    assert.deepEqual(getNavigationGroupsForRole(null), []);
    assert.deepEqual(getNavigationGroupsForRole(undefined), []);
    assert.equal(canAccessPage(null, 'Dashboard'), false);
    assert.equal(canAccessPage(undefined, 'Dashboard'), false);
  });
});

describe('Adversarial Dynamic Role Switching & State Transitions', () => {
  test('Role transition: Office to Warehouse revokes PO access and grants ticket access', () => {
    let currentRole: Role = 'office';
    let currentActivePage: PageId = 'PurchaseOrders';

    // 1. Initial office state
    assert.equal(canAccessPage(currentRole, currentActivePage), true);

    // 2. Role dynamically switches to warehouse
    currentRole = 'warehouse';

    // Verify currentActivePage is now unauthorized
    const isAuthorizedAfterSwitch = canAccessPage(currentRole, currentActivePage);
    assert.equal(isAuthorizedAfterSwitch, false);

    // Fallback logic
    if (!isAuthorizedAfterSwitch) {
      currentActivePage = 'Dashboard';
    }
    assert.equal(currentActivePage, 'Dashboard');
    assert.equal(canAccessPage(currentRole, currentActivePage), true);

    // Verify warehouse capabilities
    const groups = getNavigationGroupsForRole(currentRole);
    const pageIds = groups.flatMap((g) => g.items.map((i) => i.id));
    assert.ok(pageIds.includes('DisbursementTickets'));
    assert.ok(!pageIds.includes('PurchaseOrders'));
  });

  test('Role transition: Warehouse to Office revokes Master Data and grants PO access', () => {
    let currentRole: Role = 'warehouse';
    const currentActivePage: PageId = 'Units';

    assert.equal(canAccessPage(currentRole, currentActivePage), true);

    // Dynamically switch to office
    currentRole = 'office';
    assert.equal(canAccessPage(currentRole, currentActivePage), false);

    const groups = getNavigationGroupsForRole(currentRole);
    const pageIds = groups.flatMap((g) => g.items.map((i) => i.id));
    assert.ok(!pageIds.includes('Units'));
    assert.ok(pageIds.includes('PurchaseOrders'));
  });

  test('Role transition: Logout immediately revokes all pages and drops navigation', () => {
    let currentRole: Role | null = 'admin';
    assert.equal(getNavigationGroupsForRole(currentRole).length, 4);

    // User logs out
    currentRole = null;
    assert.equal(getNavigationGroupsForRole(currentRole).length, 0);
    assert.equal(canAccessPage(currentRole, 'Dashboard'), false);
  });
});

describe('Adversarial Input Sanitization & Special Characters', () => {
  test('Page normalization handles case variations and whitespace', () => {
    assert.equal(normalizePageId('  items  '), 'Items');
    assert.equal(normalizePageId('PURCHASEORDERS'), 'PurchaseOrders');
    assert.equal(normalizePageId('disbursementtickets'), 'DisbursementTickets');
    assert.equal(normalizePageId('  LOGS '), 'Logs');
  });

  test('Malicious page identifiers are safely rejected', () => {
    const malicious = [
      '<script>alert("xss")</script>',
      '../../../etc/passwd',
      "Items'; DROP TABLE users; --",
      'Items\0.js',
      'undefined',
      'null',
      'NaN',
      '   ',
    ];

    for (const id of malicious) {
      assert.equal(normalizePageId(id), null, `Malicious identifier '${id}' must normalize to null`);
      assert.equal(canAccessPage('admin', id), false, `Malicious identifier '${id}' must be rejected`);
    }
  });

  test('Capabilities object methods reject malformed page inputs', () => {
    const caps = getCapabilitiesForRole('office');
    assert.equal(caps.canAccessPage(''), false);
    assert.equal(caps.canAccessPage('<script>'), false);
    assert.equal(caps.canAccessPage('unknown_page'), false);
  });
});

describe('Adversarial Prototype Pollution & Whitespace Normalization Vulnerabilities', () => {
  test('Role prototype keys (constructor, __proto__) must not throw TypeError and must return false in canAccessPage', () => {
    assert.doesNotThrow(() => canAccessPage('constructor', 'Dashboard'));
    assert.equal(canAccessPage('constructor', 'Dashboard'), false);

    assert.doesNotThrow(() => canAccessPage('__proto__', 'Dashboard'));
    assert.equal(canAccessPage('__proto__', 'Dashboard'), false);
  });

  test('Role prototype keys (constructor, __proto__) must not throw TypeError and must return empty array in getNavigationGroupsForRole', () => {
    assert.doesNotThrow(() => getNavigationGroupsForRole('constructor'));
    assert.deepEqual(getNavigationGroupsForRole('constructor'), []);

    assert.doesNotThrow(() => getNavigationGroupsForRole('__proto__'));
    assert.deepEqual(getNavigationGroupsForRole('__proto__'), []);
  });

  test('Page normalization must return null for prototype keys (constructor, __proto__)', () => {
    assert.equal(normalizePageId('constructor'), null);
    assert.equal(normalizePageId('__proto__'), null);
  });

  test('Role string with surrounding whitespace must be trimmed and recognized', () => {
    assert.equal(canAccessPage('  warehouse  ', 'Dashboard'), true);
    assert.equal(canAccessPage('  office  ', 'Dashboard'), true);
    assert.equal(canAccessPage('  admin  ', 'Dashboard'), true);

    const warehouseGroups = getNavigationGroupsForRole('  warehouse  ');
    assert.equal(warehouseGroups.length, 3);

    const officeGroups = getNavigationGroupsForRole('  office  ');
    assert.equal(officeGroups.length, 3);
  });
});

