
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

export const PAGE_ROUTES: Record<PageId, string> = {
  Dashboard: '/',
  Items: '/items',
  PurchaseOrders: '/purchase-orders',
  DisbursementTickets: '/disbursement-tickets',
  POTickets: '/po-tickets',
  LeaveOrders: '/leave-orders',
  Logs: '/logs',
  Units: '/units',
  Destinations: '/destinations',
  Providers: '/providers',
  Settings: '/settings',
};

export const CANONICAL_PAGE_ROUTES = PAGE_ROUTES;

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
  Object.create(null)
);

/**
 * Normalizes any page identifier string to its canonical PageId, supporting case-insensitivity
 * Page IDs are case-insensitive so direct navigation remains predictable.
 */
export const normalizePageId = (page?: string | null): PageId | null => {
  if (!page) return null;
  const key = page.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAGE_LOOKUP, key) ? PAGE_LOOKUP[key] : null;
};

/**
 * Validates whether a given role is permitted to access a specific page.
 */
export const canAccessPage = (role?: Role | string | null, page?: string | null): boolean => {
  if (!role || !page) return false;
  const validRole = role.trim().toLowerCase() as Role;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PAGE_PERMISSIONS, validRole)) return false;
  const allowed = ROLE_PAGE_PERMISSIONS[validRole];
  if (!Array.isArray(allowed)) return false;
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

export interface NavGroup {
  id: string;
  title: string;
  icon?: string;
  itemIds: PageId[];
}

export interface NavItemMeta {
  id: PageId;
  title: string;
  officeTitle?: string;
  description: string;
  officeDescription?: string;
  icon: string;
}

export interface ResolvedNavGroup {
  id: string;
  title: string;
  items: Array<{
    id: PageId;
    title: string;
    description: string;
    icon: string;
  }>;
}

export const NAV_ITEM_METAS: Record<PageId, NavItemMeta> = {
  Dashboard: {
    id: 'Dashboard',
    title: 'الرئيسية',
    description: 'نظرة عامة على حركة المخزون والعمليات اليومية والتذاكر العاجلة.',
    icon: 'LayoutDashboard',
  },
  Items: {
    id: 'Items',
    title: 'إدارة الأصناف',
    officeTitle: 'دليل الأصناف',
    description: 'إدارة وتصفح دليل الأصناف ومستويات الفئات وأرصدة المخزون.',
    officeDescription: 'تصفح دليل الأصناف والبحث عن الأرصدة المتوفرة ومتابعة حالتها.',
    icon: 'Package',
  },
  PurchaseOrders: {
    id: 'PurchaseOrders',
    title: 'أوامر الشراء',
    description: 'إنشاء ومتابعة أوامر الشراء للموردين وتتبع فترات الصلاحية والطباعة.',
    icon: 'ClipboardList',
  },
  DisbursementTickets: {
    id: 'DisbursementTickets',
    title: 'تذاكر الصرف',
    description: 'أذونات الصرف المحجوزة من المكتب وبانتظار الصرف الفعلي والإغلاق.',
    icon: 'Receipt',
  },
  POTickets: {
    id: 'POTickets',
    title: 'تذاكر أوامر الشراء',
    description: 'أوامر الشراء المفتوحة الواردة من الموردين وبانتظار الاستلام بالمخزن.',
    icon: 'PackageCheck',
  },
  LeaveOrders: {
    id: 'LeaveOrders',
    title: 'أذونات الصرف',
    description: 'إصدار ومتابعة أذونات الصرف للأقسام والجهات وتتبع المتبقي بالخارج.',
    icon: 'Send',
  },
  Logs: {
    id: 'Logs',
    title: 'سجل الحركات',
    officeTitle: 'تقارير الحركات',
    description: 'سجل تدقيق شامل وغير قابل للتعديل لجميع حركات الإضافة والصرف والمرتجع.',
    officeDescription: 'تقارير تدقيق حركات المواد وتحليل التوريدات والمنصرفات.',
    icon: 'History',
  },
  Units: {
    id: 'Units',
    title: 'إدارة الوحدات',
    description: 'تعريف وإدارة وحدات القياس المستخدمة للأصناف في المخزن.',
    icon: 'Ruler',
  },
  Destinations: {
    id: 'Destinations',
    title: 'إدارة الوجهات',
    description: 'إدارة جهات الصرف والأقسام المصرح لها باستلام المواد.',
    icon: 'MapPin',
  },
  Providers: {
    id: 'Providers',
    title: 'إدارة الموردين',
    description: 'إدارة بيانات الموردين المعتمدين لتوريد المواد للمستودع.',
    icon: 'Truck',
  },
  Settings: {
    id: 'Settings',
    title: 'إعدادات النظام',
    description: 'معلومات الخادم، حالة قاعدة البيانات، وفحص المزامنة وإصدار التطبيق.',
    icon: 'Settings',
  },
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'stockOperations',
    title: 'عمليات المخزون',
    icon: 'Boxes',
    itemIds: ['Items', 'DisbursementTickets', 'POTickets'],
  },
  {
    id: 'ordersDocuments',
    title: 'الأوامر والمستندات',
    icon: 'ClipboardList',
    itemIds: ['PurchaseOrders', 'LeaveOrders'],
  },
  {
    id: 'masterData',
    title: 'البيانات الأساسية',
    icon: 'Database',
    itemIds: ['Units', 'Destinations', 'Providers'],
  },
  {
    id: 'systemReports',
    title: 'النظام والتقارير',
    icon: 'Sliders',
    itemIds: ['Logs', 'Settings'],
  },
];

/**
 * Returns grouped navigation items filtered strictly by role permissions.
 * Any group where the role has 0 authorized items is automatically pruned.
 */
export const getNavigationGroupsForRole = (role?: Role | string | null): ResolvedNavGroup[] => {
  if (!role) return [];
  const validRole = role.trim().toLowerCase() as Role;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PAGE_PERMISSIONS, validRole)) return [];
  if (!Array.isArray(ROLE_PAGE_PERMISSIONS[validRole])) return [];

  const isOffice = validRole === 'office';

  return NAV_GROUPS.map((group) => {
    const items = group.itemIds
      .filter((pageId) => canAccessPage(validRole, pageId))
      .map((pageId) => {
        const meta = NAV_ITEM_METAS[pageId];
        return {
          id: pageId,
          title: isOffice && meta.officeTitle ? meta.officeTitle : meta.title,
          description: isOffice && meta.officeDescription ? meta.officeDescription : meta.description,
          icon: meta.icon,
        };
      });

    return {
      id: group.id,
      title: group.title,
      items,
    };
  }).filter((group) => group.items.length > 0);
};

export interface ParsedRoute {
  pageId: PageId | null;
  path: string;
  categoryId?: number;
  subCategoryId?: number;
  queryParams: Record<string, string>;
}

export function resolveRoute(rawPath: string): ParsedRoute {
  const [pathOnly, queryString] = rawPath.split('?');
  const normalizedPath = pathOnly.replace(/\/+$/, '') || '/';
  const queryParams: Record<string, string> = {};

  if (queryString) {
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      queryParams[key] = value;
    }
  }

  // Exact canonical match
  for (const [pageId, routePath] of Object.entries(CANONICAL_PAGE_ROUTES) as [PageId, string][]) {
    if (normalizedPath === routePath) {
      return { pageId, path: normalizedPath, queryParams };
    }
  }

  // Hierarchical Items matching: /items/category/:categoryId/subcategory/:subCategoryId
  const subCategoryMatch = normalizedPath.match(/^\/items\/category\/(\d+)\/subcategory\/(\d+)$/);
  if (subCategoryMatch) {
    return {
      pageId: 'Items',
      path: normalizedPath,
      categoryId: parseInt(subCategoryMatch[1], 10),
      subCategoryId: parseInt(subCategoryMatch[2], 10),
      queryParams,
    };
  }

  // Hierarchical Items matching: /items/category/:categoryId
  const categoryMatch = normalizedPath.match(/^\/items\/category\/(\d+)$/);
  if (categoryMatch) {
    return {
      pageId: 'Items',
      path: normalizedPath,
      categoryId: parseInt(categoryMatch[1], 10),
      queryParams,
    };
  }

  // Fallback for non-numeric or invalid nested items paths
  if (normalizedPath.startsWith('/items/')) {
    return {
      pageId: 'Items',
      path: '/items',
      queryParams,
    };
  }

  return { pageId: null, path: normalizedPath, queryParams };
}

export function buildRoute(
  pageId: PageId,
  options?: { categoryId?: number; subCategoryId?: number; query?: Record<string, string> }
): string {
  let base = CANONICAL_PAGE_ROUTES[pageId];
  if (pageId === 'Items' && options?.categoryId) {
    base = `/items/category/${options.categoryId}`;
    if (options.subCategoryId) {
      base += `/subcategory/${options.subCategoryId}`;
    }
  }
  if (options?.query && Object.keys(options.query).length > 0) {
    const searchParams = new URLSearchParams(options.query);
    return `${base}?${searchParams.toString()}`;
  }
  return base;
}

export interface ResolvedTopNavGroup {
  id: string;
  title: string;
  items: Array<{
    pageId: PageId;
    title: string;
    path: string;
  }>;
}

export function resolveTopNavGroupsForRole(role?: Role | string | null): ResolvedTopNavGroup[] {
  if (!role) return [];
  const validRole = role.trim().toLowerCase() as Role;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PAGE_PERMISSIONS, validRole)) return [];

  const groups = [
    {
      id: 'stockOperations',
      title: 'عمليات المخزون',
      items: [
        { pageId: 'Dashboard' as PageId, title: 'الرئيسية' },
        { pageId: 'Items' as PageId, title: validRole === 'office' ? 'دليل الأصناف' : 'إدارة الأصناف' },
        { pageId: 'DisbursementTickets' as PageId, title: 'تذاكر الصرف' },
        { pageId: 'POTickets' as PageId, title: 'تذاكر أوامر الشراء' },
      ],
    },
    {
      id: 'ordersDocuments',
      title: 'الأوامر والمستندات',
      items: [
        { pageId: 'PurchaseOrders' as PageId, title: 'أوامر الشراء' },
        { pageId: 'LeaveOrders' as PageId, title: 'أذونات الصرف' },
      ],
    },
    {
      id: 'masterData',
      title: 'البيانات الأساسية',
      items: [
        { pageId: 'Units' as PageId, title: 'إدارة الوحدات' },
        { pageId: 'Destinations' as PageId, title: 'إدارة الوجهات' },
        { pageId: 'Providers' as PageId, title: 'إدارة الموردين' },
      ],
    },
    {
      id: 'systemReports',
      title: 'النظام والتقارير',
      items: [
        { pageId: 'Logs' as PageId, title: validRole === 'office' ? 'تقارير الحركات' : 'سجل الحركات' },
        { pageId: 'Settings' as PageId, title: 'إعدادات النظام' },
      ],
    },
  ];

  return groups
    .map((group) => {
      const allowedItems = group.items
        .filter((item) => canAccessPage(validRole, item.pageId))
        .map((item) => ({
          pageId: item.pageId,
          title: item.title,
          path: CANONICAL_PAGE_ROUTES[item.pageId],
        }));

      return {
        id: group.id,
        title: group.title,
        items: allowedItems,
      };
    })
    .filter((group) => group.items.length > 0);
}

export function getSyncIndicator(isOnline: boolean) {
  return {
    isCompactIcon: true,
    hasPersistentTextPill: false,
    tooltip: isOnline ? 'متصل بالسحابة' : 'غير متصل',
    status: isOnline ? 'connected' : 'disconnected',
    colorClass: isOnline ? 'text-status-success' : 'text-status-danger',
  };
}

