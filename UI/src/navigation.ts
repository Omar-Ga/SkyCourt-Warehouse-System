
export type PageId =
  | 'Dashboard'
  | 'Items'
  | 'PurchaseOrders'
  | 'DisbursementTickets'
  | 'POTickets'
  | 'LeaveOrders'
  | 'Logs'
  | 'Units'
  | 'Destinations'
  | 'Providers'
  | 'Settings';

export const PAGES: Record<string, PageId> = {
  DASHBOARD: 'Dashboard',
  ITEMS: 'Items',
  PURCHASE_ORDERS: 'PurchaseOrders',
  DISBURSEMENT_TICKETS: 'DisbursementTickets',
  PO_TICKETS: 'POTickets',
  LEAVE_ORDERS: 'LeaveOrders',
  LOGS: 'Logs',
  UNITS: 'Units',
  DESTINATIONS: 'Destinations',
  PROVIDERS: 'Providers',
  SETTINGS: 'Settings',
};

export type Role = 'office' | 'warehouse' | 'admin';

export const ROLE_PAGE_PERMISSIONS: Record<Role, PageId[]> = {
  warehouse: [
    'Dashboard',
    'Items',
    'DisbursementTickets',
    'POTickets',
    'Logs',
    'Units',
    'Destinations',
    'Providers',
    'Settings',
  ],
  office: [
    'Dashboard',
    'Items',
    'PurchaseOrders',
    'LeaveOrders',
    'Logs',
    'Settings',
  ],
  admin: [
    'Dashboard',
    'Items',
    'PurchaseOrders',
    'DisbursementTickets',
    'LeaveOrders',
    'POTickets',
    'Logs',
    'Units',
    'Destinations',
    'Providers',
    'Settings',
  ],
};

const PAGE_LOOKUP = Object.values(PAGES).reduce<Record<string, PageId>>(
  (acc, p) => {
    acc[p.toLowerCase()] = p;
    return acc;
  },
  {}
);

/**
 * Normalizes any page identifier string to its canonical PageId, supporting case-insensitivity
 * Page IDs are case-insensitive so direct navigation remains predictable.
 */
export const normalizePageId = (page?: string | null): PageId | null =>
  page ? PAGE_LOOKUP[page.trim().toLowerCase()] || null : null;

/**
 * Validates whether a given role is permitted to access a specific page.
 */
export const canAccessPage = (role?: Role | string | null, page?: string | null): boolean => {
  if (!role || !page) return false;
  const validRole = role.toLowerCase() as Role;
  const allowed = ROLE_PAGE_PERMISSIONS[validRole];
  if (!allowed) return false;
  const canonical = normalizePageId(page);
  return canonical ? allowed.includes(canonical) : false;
};

export const getDefaultPageForRole = (): PageId => 'Dashboard';

export interface RoleCapabilities {
  canAccessPage: (page: PageId | string) => boolean;
  canMutateItems: boolean;
  canMutateCategories: boolean;
  canAdjustQuantity: boolean;
  canManagePOs: boolean;
  canReceivePOs: boolean;
  canManageDisbursementTickets: boolean;
  canManageLeaveOrders: boolean;
  canManageMetadata: boolean;
}

/**
 * Returns the capability flags for a given role.
 * Office owns leave-order and purchase-order preparation. Warehouse owns
 * physical fulfillment and receiving.
 * Admin has access to both workflow groups.
 */
export const getCapabilitiesForRole = (role?: Role | string | null): RoleCapabilities => {
  const normRole = role?.toLowerCase();
  const isAdmin = normRole === 'admin';
  const isWarehouse = normRole === 'warehouse' || isAdmin;
  const isOffice = normRole === 'office' || isAdmin;

  return {
    canAccessPage: (page: PageId | string) => canAccessPage(normRole, page),
    canMutateItems: isWarehouse,
    canMutateCategories: isWarehouse,
    canAdjustQuantity: isWarehouse,
    canManagePOs: isOffice,
    canReceivePOs: isWarehouse,
    canManageDisbursementTickets: isWarehouse,
    canManageLeaveOrders: isOffice,
    canManageMetadata: isWarehouse,
  };
};
