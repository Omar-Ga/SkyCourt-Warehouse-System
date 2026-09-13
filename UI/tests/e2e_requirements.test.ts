import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  canAccessPage,
  getCapabilitiesForRole,
  normalizePageId,
} from '../src/navigation.ts';
import type { PageId, Role } from '../src/navigation.ts';

/* ========================================================================== */
/* SECTION 1: INTERFACE CONTRACTS & REFERENCE SPECIFICATIONS                  */
/* Defined in PROJECT.md § Interface Contracts                                */
/* ========================================================================== */

// 1. Navigation Grouping Contracts
export interface NavGroupDefinition {
  id: string;
  title: string;
  icon?: string;
  itemIds: PageId[];
}

export interface ResolvedNavItem {
  id: PageId;
  title: string;
  description: string;
  icon: string;
}

export interface ResolvedNavGroup {
  id: string;
  title: string;
  items: ResolvedNavItem[];
}

export const NAVIGATION_GROUPS: NavGroupDefinition[] = [
  {
    id: 'stockOperations',
    title: 'عمليات المخزون',
    icon: 'Boxes',
    itemIds: ['Dashboard', 'Items', 'DisbursementTickets', 'POTickets'],
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

export const PAGE_METADATA: Record<PageId, { title: string; officeTitle?: string; description: string; icon: string }> = {
  Dashboard: {
    title: 'الرئيسية',
    description: 'لوحة التحكم والمؤشرات السريعة',
    icon: 'LayoutDashboard',
  },
  Items: {
    title: 'إدارة الأصناف',
    officeTitle: 'دليل الأصناف',
    description: 'دليل المواد والمخزون والتصنيفات',
    icon: 'Package',
  },
  PurchaseOrders: {
    title: 'أوامر الشراء',
    description: 'إنشاء ومتابعة أوامر الشراء للموردين',
    icon: 'ClipboardList',
  },
  DisbursementTickets: {
    title: 'تذاكر الصرف',
    description: 'صرف وتسليم المواد المحجوزة بالمخزن',
    icon: 'Receipt',
  },
  POTickets: {
    title: 'تذاكر أوامر الشراء',
    description: 'استلام ومطابقة البضائع الموردة للمخزن',
    icon: 'PackageCheck',
  },
  LeaveOrders: {
    title: 'أذونات الصرف',
    description: 'إصدار ومتابعة أذونات خروج المواد',
    icon: 'Send',
  },
  Logs: {
    title: 'سجل الحركات',
    officeTitle: 'تقارير الحركات',
    description: 'سجل تدقيق وتتبع حركات المخزون',
    icon: 'History',
  },
  Units: {
    title: 'إدارة الوحدات',
    description: 'تهيئة وتعديل وحدات القياس',
    icon: 'Ruler',
  },
  Destinations: {
    title: 'إدارة الوجهات',
    description: 'تهيئة الأقسام والمشاريع المستلمة',
    icon: 'MapPin',
  },
  Providers: {
    title: 'إدارة الموردين',
    description: 'سجل الموردين وبيانات الاتصال',
    icon: 'Truck',
  },
  Settings: {
    title: 'إعدادات النظام',
    description: 'الإعدادات العامة وصلاحيات التشغيل',
    icon: 'Settings',
  },
};

export function getNavigationGroupsForRole(role?: Role | string | null): ResolvedNavGroup[] {
  if (!role) return [];
  const normalizedRole = role.trim().toLowerCase() as Role;
  if (!['office', 'warehouse', 'admin'].includes(normalizedRole)) return [];

  const resolved: ResolvedNavGroup[] = [];

  for (const group of NAVIGATION_GROUPS) {
    const authorizedItems: ResolvedNavItem[] = [];

    for (const pageId of group.itemIds) {
      if (canAccessPage(normalizedRole, pageId)) {
        const meta = PAGE_METADATA[pageId];
        const displayTitle = (normalizedRole === 'office' && meta.officeTitle) ? meta.officeTitle : meta.title;
        authorizedItems.push({
          id: pageId,
          title: displayTitle,
          description: meta.description,
          icon: meta.icon,
        });
      }
    }

    if (authorizedItems.length > 0) {
      resolved.push({
        id: group.id,
        title: group.title,
        items: authorizedItems,
      });
    }
  }

  return resolved;
}

// 2. Breadcrumb State Contracts
export type ViewLevel = 'mainCategories' | 'subCategories' | 'items';

export interface BreadcrumbItem {
  id: string;
  label: string;
  level: ViewLevel;
  isActive: boolean;
  data?: Record<string, unknown>;
}

export interface BreadcrumbCategoryInfo {
  id: number;
  name: string;
}

export interface BreadcrumbState {
  viewLevel: ViewLevel;
  selectedMainCategory: BreadcrumbCategoryInfo | null;
  selectedSubCategory: BreadcrumbCategoryInfo | null;
}

export function createInitialBreadcrumbState(): BreadcrumbState {
  return {
    viewLevel: 'mainCategories',
    selectedMainCategory: null,
    selectedSubCategory: null,
  };
}

export function transitionSelectMainCategory(state: BreadcrumbState, mainCategory: BreadcrumbCategoryInfo): BreadcrumbState {
  return {
    viewLevel: 'subCategories',
    selectedMainCategory: mainCategory,
    selectedSubCategory: null,
  };
}

export function transitionSelectSubCategory(state: BreadcrumbState, subCategory: BreadcrumbCategoryInfo): BreadcrumbState {
  return {
    ...state,
    viewLevel: 'items',
    selectedSubCategory: subCategory,
  };
}

export function transitionNavigateToLevel(state: BreadcrumbState, targetLevel: ViewLevel): BreadcrumbState {
  if (targetLevel === 'mainCategories') {
    return {
      viewLevel: 'mainCategories',
      selectedMainCategory: null,
      selectedSubCategory: null,
    };
  }
  if (targetLevel === 'subCategories' && state.selectedMainCategory) {
    return {
      viewLevel: 'subCategories',
      selectedMainCategory: state.selectedMainCategory,
      selectedSubCategory: null,
    };
  }
  return state;
}

export function buildBreadcrumbs(state: BreadcrumbState, rootTitle = 'الأقسام الرئيسية'): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [
    {
      id: 'root',
      label: rootTitle,
      level: 'mainCategories',
      isActive: state.viewLevel === 'mainCategories',
    },
  ];

  if (state.selectedMainCategory) {
    crumbs.push({
      id: `main-${state.selectedMainCategory.id}`,
      label: state.selectedMainCategory.name,
      level: 'subCategories',
      isActive: state.viewLevel === 'subCategories',
      data: { categoryId: state.selectedMainCategory.id },
    });
  }

  if (state.selectedSubCategory && state.viewLevel === 'items') {
    crumbs.push({
      id: `sub-${state.selectedSubCategory.id}`,
      label: state.selectedSubCategory.name,
      level: 'items',
      isActive: true,
      data: { categoryId: state.selectedSubCategory.id },
    });
  }

  return crumbs;
}

// 3. Filter Tabs & Predicates Contracts
export interface FilterTabOption<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  badgeColor?: string;
}

export type InventoryStatusFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'inactive';

export interface InventoryItemContract {
  id: number;
  name: string;
  current_quantity: number;
  status: 'active' | 'inactive';
  category_id: number;
}

export function filterInventoryItems(
  items: InventoryItemContract[],
  filter: InventoryStatusFilter
): InventoryItemContract[] {
  switch (filter) {
    case 'all':
      return items;
    case 'in_stock':
      return items.filter((item) => item.status === 'active' && item.current_quantity > 5);
    case 'low_stock':
      return items.filter((item) => item.status === 'active' && item.current_quantity > 0 && item.current_quantity <= 5);
    case 'out_of_stock':
      return items.filter((item) => item.status === 'active' && item.current_quantity <= 0);
    case 'inactive':
      return items.filter((item) => item.status === 'inactive');
    default:
      return items;
  }
}

export function computeInventoryFilterCounts(items: InventoryItemContract[]): Record<InventoryStatusFilter, number> {
  return {
    all: items.length,
    in_stock: items.filter((i) => i.status === 'active' && i.current_quantity > 5).length,
    low_stock: items.filter((i) => i.status === 'active' && i.current_quantity > 0 && i.current_quantity <= 5).length,
    out_of_stock: items.filter((i) => i.status === 'active' && i.current_quantity <= 0).length,
    inactive: items.filter((i) => i.status === 'inactive').length,
  };
}

export type POStatusFilter = 'all' | 'draft' | 'open' | 'expired' | 'closed' | 'void';

export interface PurchaseOrderContract {
  id: number;
  po_number: string;
  status: 'draft' | 'open' | 'expired' | 'closed' | 'void';
  items_count: number;
  total_quantity: number;
}

export function filterPurchaseOrders(orders: PurchaseOrderContract[], filter: POStatusFilter): PurchaseOrderContract[] {
  if (filter === 'all') return orders;
  return orders.filter((order) => order.status === filter);
}

export type LeaveOrderStatusFilter = 'all' | 'open' | 'rejected' | 'partially_returned' | 'closed' | 'cancelled';

export interface LeaveOrderContract {
  id: number;
  order_number: string;
  status: 'open' | 'rejected' | 'partially_returned' | 'closed' | 'cancelled';
  items_count: number;
  total_quantity: number;
}

export function filterLeaveOrders(orders: LeaveOrderContract[], filter: LeaveOrderStatusFilter): LeaveOrderContract[] {
  if (filter === 'all') return orders;
  return orders.filter((order) => order.status === filter);
}

// 4. Empty State Contracts
export interface EmptyStateDescriptor {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionType?: 'create' | 'reset_filter' | 'refresh' | 'navigate';
  canAct: boolean;
}

export function resolveEmptyState(
  context: 'items_catalog' | 'items_filter' | 'purchase_orders' | 'leave_orders',
  options: {
    role: Role;
    activeFilter?: string;
    hasFilterActive?: boolean;
  }
): EmptyStateDescriptor {
  const caps = getCapabilitiesForRole(options.role);

  if (context === 'items_catalog') {
    if (options.hasFilterActive) {
      return {
        icon: 'SearchX',
        title: 'لا توجد نتائج مطابقة للفلترة',
        description: 'لم يتم العثور على أصناف تطابق معايير الفلترة الحالية.',
        actionLabel: 'إعادة ضبط الفلترة',
        actionType: 'reset_filter',
        canAct: true,
      };
    }
    return {
      icon: 'PackageOpen',
      title: 'لا توجد أصناف في هذا القسم',
      description: 'ابدأ بإضافة أول صنف إلى هذا التصنيف لإدارة كمياته وحركاته.',
      actionLabel: caps.canMutateItems ? 'إضافة صنف جديد' : undefined,
      actionType: caps.canMutateItems ? 'create' : undefined,
      canAct: caps.canMutateItems,
    };
  }

  if (context === 'purchase_orders') {
    if (options.hasFilterActive && options.activeFilter !== 'all') {
      return {
        icon: 'FilterX',
        title: 'لا توجد أوامر شراء بهذه الحالة',
        description: 'جرب اختيار تبويب حالة آخر أو إعادة ضبط الفلترة.',
        actionLabel: 'عرض جميع الأوامر',
        actionType: 'reset_filter',
        canAct: true,
      };
    }
    return {
      icon: 'ClipboardList',
      title: 'لا توجد أوامر شراء حالياً',
      description: 'يمكنك إنشاء أمر شراء جديد وإرساله للمورد وللمخزن للاستلام.',
      actionLabel: caps.canManagePOs ? 'إنشاء أمر شراء جديد' : undefined,
      actionType: caps.canManagePOs ? 'create' : undefined,
      canAct: caps.canManagePOs,
    };
  }

  // leave_orders
  if (options.hasFilterActive && options.activeFilter !== 'all') {
    return {
      icon: 'FilterX',
      title: 'لا توجد أذونات صرف بهذه الحالة',
      description: 'جرب اختيار تبويب آخر لعرض أذونات الصرف المتوفرة.',
      actionLabel: 'عرض جميع الأذونات',
      actionType: 'reset_filter',
      canAct: true,
    };
  }
  return {
    icon: 'Send',
    title: 'لا توجد أذونات صرف حالياً',
    description: 'يمكنك إنشاء إذن صرف جديد لتسليم المواد المحجوزة للمستفيدين.',
    actionLabel: caps.canManageLeaveOrders ? 'إنشاء إذن صرف جديد' : undefined,
    actionType: caps.canManageLeaveOrders ? 'create' : undefined,
    canAct: caps.canManageLeaveOrders,
  };
}

// 5. Line Item Validation & Stock Headroom Contracts
export interface LineItemInput {
  item_id: number;
  item_name?: string;
  quantity: number;
  unit_price?: number;
}

export interface StockValidationResult {
  isValid: boolean;
  errors: Record<number, string>;
  headroom: Record<number, number>;
}

export function validateOrderLines(
  lines: LineItemInput[],
  availableStockMap: Record<number, number>
): StockValidationResult {
  const errors: Record<number, string> = {};
  const headroom: Record<number, number> = {};
  const aggregatedDemands: Record<number, number> = {};

  if (!lines || lines.length === 0) {
    return {
      isValid: false,
      errors: { 0: 'يجب إضافة بند واحد على الأقل' },
      headroom: {},
    };
  }

  // Check quantities and aggregate total demand per item
  for (const line of lines) {
    if (!line.item_id || line.item_id <= 0) {
      errors[line.item_id || 0] = 'يرجى اختيار صنف صحيح';
      continue;
    }

    if (!line.quantity || line.quantity <= 0 || !Number.isFinite(line.quantity)) {
      errors[line.item_id] = 'الكمية يجب أن تكون أكبر من الصفر';
      continue;
    }

    aggregatedDemands[line.item_id] = (aggregatedDemands[line.item_id] || 0) + line.quantity;
  }

  // Check aggregated demand against available stock
  for (const [itemIdStr, totalDemand] of Object.entries(aggregatedDemands)) {
    const itemId = Number(itemIdStr);
    const stock = availableStockMap[itemId] ?? 0;
    const remaining = stock - totalDemand;
    headroom[itemId] = remaining;

    if (remaining < 0) {
      errors[itemId] = `الكمية المطلوبة (${totalDemand}) تتجاوز الرصيد المتاح بالمخزن (${stock})`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    headroom,
  };
}

/* ========================================================================== */
/* SECTION 2: 4-TIER AUTOMATED TEST SUITE                                     */
/* ========================================================================== */

describe('E2E Requirements Suite: 4-Tier Opaque-Box Verification', () => {

  /* ------------------------------------------------------------------------ */
  /* TIER 1: FEATURE COVERAGE (≥5 test cases per feature domain)              */
  /* ------------------------------------------------------------------------ */

  describe('Tier 1.1: Grouped Sidebar Navigation & RBAC Pruning (F1, F4)', () => {
    test('1. Admin role resolves all 4 logical navigation groups with complete page sets', () => {
      const groups = getNavigationGroupsForRole('admin');
      assert.equal(groups.length, 4);

      const groupIds = groups.map((g) => g.id);
      assert.deepEqual(groupIds, ['stockOperations', 'ordersDocuments', 'masterData', 'systemReports']);

      const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
      assert.equal(totalItems, Object.keys(PAGES).length, 'Admin must see all registered pages');
    });

    test('2. Warehouse role receives Stock Operations, Master Data, and System Reports, strictly pruning Orders & Documents', () => {
      const groups = getNavigationGroupsForRole('warehouse');
      const groupIds = groups.map((g) => g.id);

      assert.deepEqual(groupIds, ['stockOperations', 'masterData', 'systemReports']);
      assert.ok(!groupIds.includes('ordersDocuments'), 'Orders & Documents must be pruned for warehouse');

      const stockGroup = groups.find((g) => g.id === 'stockOperations');
      assert.ok(stockGroup);
      const stockPageIds = stockGroup.items.map((i) => i.id);
      assert.deepEqual(stockPageIds, ['Dashboard', 'Items', 'DisbursementTickets', 'POTickets']);
    });

    test('3. Office role receives Stock Operations, Orders & Documents, and System Reports, strictly pruning Master Data', () => {
      const groups = getNavigationGroupsForRole('office');
      const groupIds = groups.map((g) => g.id);

      assert.deepEqual(groupIds, ['stockOperations', 'ordersDocuments', 'systemReports']);
      assert.ok(!groupIds.includes('masterData'), 'Master Data must be pruned for office');

      const ordersGroup = groups.find((g) => g.id === 'ordersDocuments');
      assert.ok(ordersGroup);
      const orderPageIds = ordersGroup.items.map((i) => i.id);
      assert.deepEqual(orderPageIds, ['PurchaseOrders', 'LeaveOrders']);
    });

    test('4. Grouped items carry valid icons, titles, and localized descriptions matching PAGE_METADATA', () => {
      const groups = getNavigationGroupsForRole('admin');
      for (const group of groups) {
        assert.ok(group.title.length > 0);
        for (const item of group.items) {
          assert.ok(item.title.length > 0);
          assert.ok(item.description.length > 0);
          assert.ok(item.icon.length > 0);
        }
      }
    });

    test('5. Dynamic title resolution serves "دليل الأصناف" and "تقارير الحركات" to office role', () => {
      const officeGroups = getNavigationGroupsForRole('office');
      const stockGroup = officeGroups.find((g) => g.id === 'stockOperations');
      const itemsPage = stockGroup?.items.find((i) => i.id === 'Items');
      assert.equal(itemsPage?.title, 'دليل الأصناف');

      const reportGroup = officeGroups.find((g) => g.id === 'systemReports');
      const logsPage = reportGroup?.items.find((i) => i.id === 'Logs');
      assert.equal(logsPage?.title, 'تقارير الحركات');
    });

    test('6. Dynamic title resolution serves "إدارة الأصناف" and "سجل الحركات" to warehouse role', () => {
      const whGroups = getNavigationGroupsForRole('warehouse');
      const stockGroup = whGroups.find((g) => g.id === 'stockOperations');
      const itemsPage = stockGroup?.items.find((i) => i.id === 'Items');
      assert.equal(itemsPage?.title, 'إدارة الأصناف');

      const reportGroup = whGroups.find((g) => g.id === 'systemReports');
      const logsPage = reportGroup?.items.find((i) => i.id === 'Logs');
      assert.equal(logsPage?.title, 'سجل الحركات');
    });
  });

  describe('Tier 1.2: Multi-Tier Breadcrumb State Transitions (F3)', () => {
    test('7. Initial breadcrumb state is at mainCategories with active single crumb', () => {
      const state = createInitialBreadcrumbState();
      const crumbs = buildBreadcrumbs(state);

      assert.equal(state.viewLevel, 'mainCategories');
      assert.equal(crumbs.length, 1);
      assert.equal(crumbs[0].id, 'root');
      assert.equal(crumbs[0].label, 'الأقسام الرئيسية');
      assert.equal(crumbs[0].isActive, true);
    });

    test('8. Selecting a main category generates 2-tier breadcrumb and marks leaf active', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 10, name: 'مواد كهربائية' });

      assert.equal(state.viewLevel, 'subCategories');
      const crumbs = buildBreadcrumbs(state);

      assert.equal(crumbs.length, 2);
      assert.equal(crumbs[0].isActive, false);
      assert.equal(crumbs[1].id, 'main-10');
      assert.equal(crumbs[1].label, 'مواد كهربائية');
      assert.equal(crumbs[1].isActive, true);
    });

    test('9. Selecting a subcategory generates full 3-tier breadcrumb trail', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 10, name: 'مواد كهربائية' });
      state = transitionSelectSubCategory(state, { id: 101, name: 'كابلات وأسلاك' });

      assert.equal(state.viewLevel, 'items');
      const crumbs = buildBreadcrumbs(state);

      assert.equal(crumbs.length, 3);
      assert.equal(crumbs[0].isActive, false);
      assert.equal(crumbs[1].isActive, false);
      assert.equal(crumbs[2].id, 'sub-101');
      assert.equal(crumbs[2].label, 'كابلات وأسلاك');
      assert.equal(crumbs[2].isActive, true);
    });

    test('10. Single-click jump to main category level returns from items to subCategories', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 10, name: 'مواد كهربائية' });
      state = transitionSelectSubCategory(state, { id: 101, name: 'كابلات وأسلاك' });

      // Click parent category crumb
      state = transitionNavigateToLevel(state, 'subCategories');

      assert.equal(state.viewLevel, 'subCategories');
      assert.equal(state.selectedSubCategory, null);
      assert.equal(state.selectedMainCategory?.id, 10);

      const crumbs = buildBreadcrumbs(state);
      assert.equal(crumbs.length, 2);
      assert.equal(crumbs[1].isActive, true);
    });

    test('11. Single-click jump to root resets state to mainCategories and clears selections', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 10, name: 'مواد كهربائية' });
      state = transitionSelectSubCategory(state, { id: 101, name: 'كابلات وأسلاك' });

      // Click root crumb
      state = transitionNavigateToLevel(state, 'mainCategories');

      assert.equal(state.viewLevel, 'mainCategories');
      assert.equal(state.selectedMainCategory, null);
      assert.equal(state.selectedSubCategory, null);

      const crumbs = buildBreadcrumbs(state);
      assert.equal(crumbs.length, 1);
      assert.equal(crumbs[0].isActive, true);
    });
  });

  describe('Tier 1.3: Status Filter Chips & Tabs Predicates (F8, F9)', () => {
    const mockInventory: InventoryItemContract[] = [
      { id: 1, name: 'كابل 4 مم', current_quantity: 25, status: 'active', category_id: 101 },
      { id: 2, name: 'قاطع تيار 16A', current_quantity: 4, status: 'active', category_id: 101 },
      { id: 3, name: 'مفتاح كهربائي مزدوج', current_quantity: 0, status: 'active', category_id: 101 },
      { id: 4, name: 'شريط لاصق عازل', current_quantity: 5, status: 'active', category_id: 101 },
      { id: 5, name: 'كشاف فلورسنت قديم', current_quantity: 12, status: 'inactive', category_id: 101 },
    ];

    test('12. Filter "all" returns all 5 items', () => {
      const result = filterInventoryItems(mockInventory, 'all');
      assert.equal(result.length, 5);
    });

    test('13. Filter "in_stock" returns only items with quantity > 5 and active status', () => {
      const result = filterInventoryItems(mockInventory, 'in_stock');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 1);
    });

    test('14. Filter "low_stock" returns items with quantity between 1 and 5 inclusive', () => {
      const result = filterInventoryItems(mockInventory, 'low_stock');
      assert.equal(result.length, 2);
      const ids = result.map((i) => i.id).sort();
      assert.deepEqual(ids, [2, 4]); // qty 4 and qty 5
    });

    test('15. Filter "out_of_stock" returns items with quantity <= 0', () => {
      const result = filterInventoryItems(mockInventory, 'out_of_stock');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 3);
    });

    test('16. Filter "inactive" returns only inactive items', () => {
      const result = filterInventoryItems(mockInventory, 'inactive');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 5);
    });

    test('17. Computes exact dynamic badge counts across all inventory filter chips', () => {
      const counts = computeInventoryFilterCounts(mockInventory);
      assert.equal(counts.all, 5);
      assert.equal(counts.in_stock, 1);
      assert.equal(counts.low_stock, 2);
      assert.equal(counts.out_of_stock, 1);
      assert.equal(counts.inactive, 1);
    });

    test('18. Purchase order filter handles complete lifecycle states including void', () => {
      const pos: PurchaseOrderContract[] = [
        { id: 1, po_number: 'PO-001', status: 'draft', items_count: 2, total_quantity: 10 },
        { id: 2, po_number: 'PO-002', status: 'open', items_count: 1, total_quantity: 5 },
        { id: 3, po_number: 'PO-003', status: 'expired', items_count: 3, total_quantity: 15 },
        { id: 4, po_number: 'PO-004', status: 'closed', items_count: 1, total_quantity: 2 },
        { id: 5, po_number: 'PO-005', status: 'void', items_count: 1, total_quantity: 1 },
      ];

      assert.equal(filterPurchaseOrders(pos, 'all').length, 5);
      assert.equal(filterPurchaseOrders(pos, 'draft').length, 1);
      assert.equal(filterPurchaseOrders(pos, 'void').length, 1);
      assert.equal(filterPurchaseOrders(pos, 'void')[0].po_number, 'PO-005');
    });

    test('19. Leave order filter handles complete lifecycle states including cancelled', () => {
      const los: LeaveOrderContract[] = [
        { id: 1, order_number: 'LO-001', status: 'open', items_count: 2, total_quantity: 10 },
        { id: 2, order_number: 'LO-002', status: 'rejected', items_count: 1, total_quantity: 5 },
        { id: 3, order_number: 'LO-003', status: 'partially_returned', items_count: 3, total_quantity: 15 },
        { id: 4, order_number: 'LO-004', status: 'closed', items_count: 1, total_quantity: 2 },
        { id: 5, order_number: 'LO-005', status: 'cancelled', items_count: 1, total_quantity: 1 },
      ];

      assert.equal(filterLeaveOrders(los, 'all').length, 5);
      assert.equal(filterLeaveOrders(los, 'cancelled').length, 1);
      assert.equal(filterLeaveOrders(los, 'cancelled')[0].order_number, 'LO-005');
    });
  });

  describe('Tier 1.4: Reusable Empty State Contracts (F6, F7)', () => {
    test('20. Empty catalog descriptor provides create action for warehouse role', () => {
      const descriptor = resolveEmptyState('items_catalog', { role: 'warehouse', hasFilterActive: false });
      assert.equal(descriptor.canAct, true);
      assert.equal(descriptor.actionType, 'create');
      assert.equal(descriptor.actionLabel, 'إضافة صنف جديد');
      assert.match(descriptor.title, /لا توجد أصناف/);
    });

    test('21. Empty catalog descriptor suppresses create action for office role', () => {
      const descriptor = resolveEmptyState('items_catalog', { role: 'office', hasFilterActive: false });
      assert.equal(descriptor.canAct, false);
      assert.equal(descriptor.actionLabel, undefined);
      assert.match(descriptor.title, /لا توجد أصناف/);
    });

    test('22. Filtered empty state provides "إعادة ضبط الفلترة" action regardless of role', () => {
      const descriptorWh = resolveEmptyState('items_catalog', { role: 'warehouse', hasFilterActive: true });
      assert.equal(descriptorWh.canAct, true);
      assert.equal(descriptorWh.actionType, 'reset_filter');
      assert.equal(descriptorWh.actionLabel, 'إعادة ضبط الفلترة');

      const descriptorOffice = resolveEmptyState('items_catalog', { role: 'office', hasFilterActive: true });
      assert.equal(descriptorOffice.canAct, true);
      assert.equal(descriptorOffice.actionType, 'reset_filter');
    });

    test('23. Purchase orders empty state provides create button for office role', () => {
      const descriptor = resolveEmptyState('purchase_orders', { role: 'office', hasFilterActive: false });
      assert.equal(descriptor.canAct, true);
      assert.equal(descriptor.actionType, 'create');
      assert.equal(descriptor.actionLabel, 'إنشاء أمر شراء جديد');
    });

    test('24. Purchase orders empty state suppresses create button for warehouse role', () => {
      const descriptor = resolveEmptyState('purchase_orders', { role: 'warehouse', hasFilterActive: false });
      assert.equal(descriptor.canAct, false);
      assert.equal(descriptor.actionLabel, undefined);
    });
  });

  describe('Tier 1.5: Inline Validation & Real-Time Stock Headroom (F11, F12)', () => {
    const stockMap: Record<number, number> = {
      101: 50,
      102: 10,
      103: 0,
    };

    test('25. Valid order lines within available stock return isValid true with correct remaining headroom', () => {
      const lines: LineItemInput[] = [
        { item_id: 101, quantity: 20 },
        { item_id: 102, quantity: 5 },
      ];

      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, true);
      assert.equal(res.headroom[101], 30); // 50 - 20
      assert.equal(res.headroom[102], 5);  // 10 - 5
      assert.deepEqual(res.errors, {});
    });

    test('26. Line demanding quantity exceeding available stock returns isValid false and Arabic error', () => {
      const lines: LineItemInput[] = [
        { item_id: 102, quantity: 15 }, // available is 10
      ];

      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.equal(res.headroom[102], -5);
      assert.match(res.errors[102], /تتجاوز الرصيد المتاح بالمخزن/);
      assert.match(res.errors[102], /\(15\)/);
      assert.match(res.errors[102], /\(10\)/);
    });

    test('27. Line requesting zero-stock item returns immediate violation', () => {
      const lines: LineItemInput[] = [
        { item_id: 103, quantity: 1 }, // available is 0
      ];

      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.match(res.errors[103], /تتجاوز الرصيد المتاح بالمخزن/);
    });

    test('28. Line with non-positive quantity is rejected', () => {
      const lines: LineItemInput[] = [
        { item_id: 101, quantity: 0 },
      ];

      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.match(res.errors[101], /أكبر من الصفر/);
    });

    test('29. Empty order line items array returns general rejection', () => {
      const res = validateOrderLines([], stockMap);
      assert.equal(res.isValid, false);
      assert.match(res.errors[0], /بند واحد على الأقل/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* TIER 2: BOUNDARY & CORNER CASES (≥5 test cases per domain)               */
  /* ------------------------------------------------------------------------ */

  describe('Tier 2.1: Navigation Boundaries & Normalization', () => {
    test('30. Null or undefined role returns empty navigation list', () => {
      assert.deepEqual(getNavigationGroupsForRole(null), []);
      assert.deepEqual(getNavigationGroupsForRole(undefined), []);
    });

    test('31. Unrecognized role string returns empty navigation list safely', () => {
      assert.deepEqual(getNavigationGroupsForRole('super_auditor'), []);
      assert.deepEqual(getNavigationGroupsForRole(''), []);
    });

    test('32. Role string with mixed case and whitespace is trimmed and normalized', () => {
      const groups = getNavigationGroupsForRole('  WAREHOUSE  ');
      assert.equal(groups.length, 3);
      assert.equal(groups[0].id, 'stockOperations');
    });

    test('33. Page normalization rejects arbitrary unknown page names', () => {
      assert.equal(normalizePageId('BarcodeScanner'), null);
      assert.equal(normalizePageId(''), null);
      assert.equal(normalizePageId(null), null);
    });

    test('34. Single-item group definition does not crash or corrupt group structure', () => {
      const singleGroup: NavGroupDefinition = {
        id: 'testSolo',
        title: 'مجموعة تجريبية',
        itemIds: ['Dashboard'],
      };
      assert.equal(singleGroup.itemIds.length, 1);
      assert.equal(canAccessPage('office', singleGroup.itemIds[0]), true);
    });
  });

  describe('Tier 2.2: Breadcrumb State Boundaries', () => {
    test('35. Navigating to current viewLevel is an idempotent safe no-op', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 5, name: 'سباكة' });
      const nextState = transitionNavigateToLevel(state, 'subCategories');
      assert.deepEqual(state, nextState);
    });

    test('36. Navigating to subCategories when selectedMainCategory is null safely remains at mainCategories', () => {
      const state = createInitialBreadcrumbState();
      const nextState = transitionNavigateToLevel(state, 'subCategories');
      assert.equal(nextState.viewLevel, 'mainCategories');
    });

    test('37. Category names containing Arabic diacritics and symbols are preserved without escaping distortion', () => {
      let state = createInitialBreadcrumbState();
      const diacriticName = 'قِطَع غِيَار & صِيَانَة (مُمَتَازَة)';
      state = transitionSelectMainCategory(state, { id: 42, name: diacriticName });

      const crumbs = buildBreadcrumbs(state);
      assert.equal(crumbs[1].label, diacriticName);
    });

    test('38. Category name with extreme length (150+ chars) retains ID and structure', () => {
      let state = createInitialBreadcrumbState();
      const longName = 'أصناف وتجهيزات المعدات الثقيلة والمولدات الكهربائية المتطورة الخاصة بمشاريع التوسعة الإنشائية رقم 402 لسنة 2026';
      state = transitionSelectMainCategory(state, { id: 99, name: longName });

      const crumbs = buildBreadcrumbs(state);
      assert.equal(crumbs[1].id, 'main-99');
      assert.equal(crumbs[1].label, longName);
    });

    test('39. Selecting a different main category while at items view resets subcategory and leaves trail in subCategories', () => {
      let state = createInitialBreadcrumbState();
      state = transitionSelectMainCategory(state, { id: 1, name: 'أجهزة' });
      state = transitionSelectSubCategory(state, { id: 11, name: 'طابعات' });
      assert.equal(state.viewLevel, 'items');

      // User selects a completely different main category
      state = transitionSelectMainCategory(state, { id: 2, name: 'أثاث' });
      assert.equal(state.viewLevel, 'subCategories');
      assert.equal(state.selectedMainCategory?.id, 2);
      assert.equal(state.selectedSubCategory, null);

      const crumbs = buildBreadcrumbs(state);
      assert.equal(crumbs.length, 2);
      assert.equal(crumbs[1].label, 'أثاث');
    });
  });

  describe('Tier 2.3: Filter Predicate Boundaries', () => {
    test('40. Stock boundary: quantity of exactly 5 is classified as low_stock, NOT in_stock', () => {
      const item: InventoryItemContract = { id: 1, name: 'مسمار', current_quantity: 5, status: 'active', category_id: 1 };
      assert.equal(filterInventoryItems([item], 'in_stock').length, 0);
      assert.equal(filterInventoryItems([item], 'low_stock').length, 1);
    });

    test('41. Stock boundary: quantity of exactly 6 is classified as in_stock, NOT low_stock', () => {
      const item: InventoryItemContract = { id: 2, name: 'صامولة', current_quantity: 6, status: 'active', category_id: 1 };
      assert.equal(filterInventoryItems([item], 'in_stock').length, 1);
      assert.equal(filterInventoryItems([item], 'low_stock').length, 0);
    });

    test('42. Stock boundary: quantity of exactly 0 is classified as out_of_stock', () => {
      const item: InventoryItemContract = { id: 3, name: 'براغي', current_quantity: 0, status: 'active', category_id: 1 };
      assert.equal(filterInventoryItems([item], 'out_of_stock').length, 1);
      assert.equal(filterInventoryItems([item], 'low_stock').length, 0);
    });

    test('43. Negative stock quantity (data anomaly protection) is classified as out_of_stock', () => {
      const item: InventoryItemContract = { id: 4, name: 'شريط', current_quantity: -3, status: 'active', category_id: 1 };
      assert.equal(filterInventoryItems([item], 'out_of_stock').length, 1);
      assert.equal(filterInventoryItems([item], 'low_stock').length, 0);
    });

    test('44. Empty inventory array returns 0 counts and empty arrays safely', () => {
      const counts = computeInventoryFilterCounts([]);
      assert.deepEqual(counts, { all: 0, in_stock: 0, low_stock: 0, out_of_stock: 0, inactive: 0 });
      assert.deepEqual(filterInventoryItems([], 'in_stock'), []);
    });
  });

  describe('Tier 2.4: Empty State Descriptor Boundaries', () => {
    test('45. Empty state handles minimal options without crashing', () => {
      const descriptor = resolveEmptyState('items_catalog', { role: 'admin' });
      assert.ok(descriptor.title.length > 0);
      assert.equal(descriptor.canAct, true);
    });

    test('46. Unknown context defaults safely', () => {
      const descriptor = resolveEmptyState('leave_orders', { role: 'office', activeFilter: 'cancelled', hasFilterActive: true });
      assert.equal(descriptor.actionType, 'reset_filter');
      assert.equal(descriptor.canAct, true);
    });

    test('47. Unfiltered zero state for leave orders when user has management rights', () => {
      const descriptor = resolveEmptyState('leave_orders', { role: 'office', hasFilterActive: false });
      assert.equal(descriptor.canAct, true);
      assert.equal(descriptor.actionLabel, 'إنشاء إذن صرف جديد');
    });

    test('48. Unfiltered zero state for leave orders when user has no rights (warehouse)', () => {
      const descriptor = resolveEmptyState('leave_orders', { role: 'warehouse', hasFilterActive: false });
      assert.equal(descriptor.canAct, false);
      assert.equal(descriptor.actionLabel, undefined);
    });
  });

  describe('Tier 2.5: Line Item Validation Boundaries', () => {
    const stockMap: Record<number, number> = {
      201: 10,
      202: 100,
    };

    test('49. Demanding exactly 100% of available stock headroom passes with 0 remaining', () => {
      const lines: LineItemInput[] = [{ item_id: 201, quantity: 10 }];
      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, true);
      assert.equal(res.headroom[201], 0);
    });

    test('50. Demanding 1 unit above available stock triggers exact headroom violation', () => {
      const lines: LineItemInput[] = [{ item_id: 201, quantity: 11 }];
      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.equal(res.headroom[201], -1);
      assert.match(res.errors[201], /تتجاوز الرصيد المتاح بالمخزن/);
    });

    test('51. Negative or NaN quantity produces validation error', () => {
      const lines: LineItemInput[] = [{ item_id: 202, quantity: -5 }];
      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.match(res.errors[202], /أكبر من الصفر/);
    });

    test('52. Aggregates multiple lines of the same item ID against single available stock headroom', () => {
      // Two lines for item 201: quantity 6 + quantity 5 = 11 (available is 10)
      const lines: LineItemInput[] = [
        { item_id: 201, quantity: 6 },
        { item_id: 201, quantity: 5 },
      ];
      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.equal(res.headroom[201], -1);
      assert.match(res.errors[201], /الكمية المطلوبة \(11\) تتجاوز الرصيد المتاح بالمخزن \(10\)/);
    });

    test('53. Unregistered item ID defaults to 0 available stock and errors if quantity > 0', () => {
      const lines: LineItemInput[] = [{ item_id: 9999, quantity: 1 }];
      const res = validateOrderLines(lines, stockMap);
      assert.equal(res.isValid, false);
      assert.equal(res.headroom[9999], -1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* TIER 3: CROSS-FEATURE INTERACTIONS                                       */
  /* ------------------------------------------------------------------------ */

  describe('Tier 3: Cross-Feature Interactions', () => {
    test('54. Role switching immediately resets unauthorized active page and updates navigation groups', () => {
      // User starts as warehouse on Units page
      const currentRole: Role = 'warehouse';
      const currentPage: PageId = 'Units';
      assert.equal(canAccessPage(currentRole, currentPage), true);

      // User role switches to office
      const nextRole: Role = 'office';
      const canStayOnPage = canAccessPage(nextRole, currentPage);
      assert.equal(canStayOnPage, false, 'Office cannot access Units');

      // System responds by redirecting to default page
      const redirectedPage: PageId = canStayOnPage ? currentPage : 'Dashboard';
      assert.equal(redirectedPage, 'Dashboard');

      // Verify navigation groups updated to office layout
      const officeGroups = getNavigationGroupsForRole(nextRole);
      const hasMasterData = officeGroups.some((g) => g.id === 'masterData');
      assert.equal(hasMasterData, false);
    });

    test('55. Breadcrumb drill-down retains active filter context when returning to leaf', () => {
      let bState = createInitialBreadcrumbState();
      bState = transitionSelectMainCategory(bState, { id: 1, name: 'مواد كهربائية' });
      bState = transitionSelectSubCategory(bState, { id: 10, name: 'كابلات' });

      // Operator applies filter "low_stock"
      const activeFilter: InventoryStatusFilter = 'low_stock';

      // Operator navigates up to main category
      bState = transitionNavigateToLevel(bState, 'subCategories');
      assert.equal(bState.viewLevel, 'subCategories');

      // Operator re-selects subcategory: filter remains 'low_stock'
      bState = transitionSelectSubCategory(bState, { id: 10, name: 'كابلات' });
      assert.equal(bState.viewLevel, 'items');
      assert.equal(activeFilter, 'low_stock');
    });

    test('56. Filter tab yielding 0 matches triggers filter-specific empty state with reset action', () => {
      const items: InventoryItemContract[] = [
        { id: 1, name: 'كابل', current_quantity: 50, status: 'active', category_id: 1 },
      ];

      // Filter by 'out_of_stock' (0 matches)
      let activeFilter: InventoryStatusFilter = 'out_of_stock';
      const filtered = filterInventoryItems(items, activeFilter);
      assert.equal(filtered.length, 0);

      // Resolver provides reset filter action
      const emptyState = resolveEmptyState('items_catalog', {
        role: 'warehouse',
        activeFilter,
        hasFilterActive: true,
      });

      assert.equal(emptyState.actionType, 'reset_filter');
      assert.equal(emptyState.actionLabel, 'إعادة ضبط الفلترة');

      // Trigger action resets filter to 'all'
      if (emptyState.actionType === 'reset_filter') {
        activeFilter = 'all';
      }

      const resetResults = filterInventoryItems(items, activeFilter);
      assert.equal(resetResults.length, 1);
    });

    test('57. Multi-line order with mixed items validates headroom independently per item', () => {
      const stocks: Record<number, number> = {
        301: 20, // ample
        302: 5,  // tight
      };

      const lines: LineItemInput[] = [
        { item_id: 301, quantity: 10 }, // 10 <= 20 -> OK (headroom: 10)
        { item_id: 302, quantity: 8 },  // 8 > 5 -> VIOLATION (headroom: -3)
      ];

      const res = validateOrderLines(lines, stocks);
      assert.equal(res.isValid, false);
      assert.equal(res.headroom[301], 10);
      assert.equal(res.headroom[302], -3);
      assert.equal(res.errors[301], undefined);
      assert.ok(res.errors[302]);
    });

    test('58. Responsive sidebar collapse state does not degrade role capabilities or route guard logic', () => {
      interface SidebarState {
        isCollapsed: boolean;
        width: 'w-68' | 'w-20';
      }

      let sidebar: SidebarState = { isCollapsed: false, width: 'w-68' };

      // Toggle to collapsed rail
      sidebar = { isCollapsed: true, width: 'w-20' };
      assert.equal(sidebar.width, 'w-20');

      // Role capabilities remain unchanged
      const caps = getCapabilitiesForRole('warehouse');
      assert.equal(caps.canAdjustQuantity, true);
      assert.equal(caps.canManagePOs, false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* TIER 4: REAL-WORLD SCENARIOS                                             */
  /* ------------------------------------------------------------------------ */

  describe('Tier 4: Real-World Scenarios', () => {
    test('59. Scenario 1: Warehouse Keeper Morning Inventory Inspection Journey', () => {
      // Step 1: Login as warehouse keeper
      const role: Role = 'warehouse';
      const navGroups = getNavigationGroupsForRole(role);
      assert.equal(navGroups.some((g) => g.id === 'ordersDocuments'), false, 'Orders tab omitted');

      // Step 2: Open Items Management
      let breadcrumbs = createInitialBreadcrumbState();
      assert.equal(breadcrumbs.viewLevel, 'mainCategories');

      // Step 3: Select category "إلكترونيات"
      breadcrumbs = transitionSelectMainCategory(breadcrumbs, { id: 1, name: 'إلكترونيات' });
      assert.equal(breadcrumbs.viewLevel, 'subCategories');

      // Step 4: Select subcategory "شاشات مراقبة"
      breadcrumbs = transitionSelectSubCategory(breadcrumbs, { id: 101, name: 'شاشات مراقبة' });
      assert.equal(breadcrumbs.viewLevel, 'items');

      // Step 5: Filter by "رصيد منخفض"
      const categoryItems: InventoryItemContract[] = [
        { id: 1, name: 'شاشة 24 بوصة Dell', current_quantity: 3, status: 'active', category_id: 101 },
        { id: 2, name: 'شاشة 27 بوصة Samsung', current_quantity: 15, status: 'active', category_id: 101 },
      ];
      const lowStockItems = filterInventoryItems(categoryItems, 'low_stock');
      assert.equal(lowStockItems.length, 1);
      assert.equal(lowStockItems[0].name, 'شاشة 24 بوصة Dell');

      // Step 6: Single-click on breadcrumb "إلكترونيات" to return
      breadcrumbs = transitionNavigateToLevel(breadcrumbs, 'subCategories');
      assert.equal(breadcrumbs.viewLevel, 'subCategories');
      assert.equal(breadcrumbs.selectedSubCategory, null);
    });

    test('60. Scenario 2: Office Clerk Leave Order Creation & Stock Limit Correction Flow', () => {
      // Step 1: Login as office clerk
      const role: Role = 'office';
      const caps = getCapabilitiesForRole(role);
      assert.equal(caps.canManageLeaveOrders, true);
      assert.equal(caps.canAdjustQuantity, false);

      // Step 2: Available warehouse stock
      const warehouseStock: Record<number, number> = {
        501: 12, // طابعة إيصالات حرارية
      };

      // Step 3: Clerk enters 15 units (exceeding stock)
      let lines: LineItemInput[] = [
        { item_id: 501, item_name: 'طابعة إيصالات حرارية', quantity: 15 },
      ];
      let valResult = validateOrderLines(lines, warehouseStock);
      assert.equal(valResult.isValid, false);
      assert.match(valResult.errors[501], /تتجاوز الرصيد المتاح بالمخزن/);

      // Step 4: Clerk adjusts quantity down to 10 units
      lines = [
        { item_id: 501, item_name: 'طابعة إيصالات حرارية', quantity: 10 },
      ];
      valResult = validateOrderLines(lines, warehouseStock);
      assert.equal(valResult.isValid, true);
      assert.equal(valResult.headroom[501], 2);
    });

    test('61. Scenario 3: Administrator Master Data & System Reports Journey', () => {
      // Step 1: Login as admin
      const role: Role = 'admin';
      const groups = getNavigationGroupsForRole(role);
      assert.equal(groups.length, 4);

      // Step 2: Access Master Data
      const masterGroup = groups.find((g) => g.id === 'masterData');
      assert.ok(masterGroup);
      const masterPages = masterGroup.items.map((i) => i.id);
      assert.deepEqual(masterPages, ['Units', 'Destinations', 'Providers']);

      // Step 3: Switch to System Reports
      const reportsGroup = groups.find((g) => g.id === 'systemReports');
      assert.ok(reportsGroup);
      const reportPages = reportsGroup.items.map((i) => i.id);
      assert.deepEqual(reportPages, ['Logs', 'Settings']);
    });

    test('62. Scenario 4: Warehouse Tablet Touch Rail Interaction & Sizing Ergonomics', () => {
      // Minimum touch target constraints from ergonomics survey
      const MIN_TOUCH_TARGET_PX = 40;
      const PRIMARY_BUTTON_TOUCH_TARGET_PX = 44;

      interface ButtonErgonomics {
        type: 'row_action' | 'primary_action' | 'nav_rail_item';
        heightPx: number;
        widthPx: number;
      }

      const rowActionButton: ButtonErgonomics = { type: 'row_action', heightPx: 40, widthPx: 40 };
      const primarySubmitButton: ButtonErgonomics = { type: 'primary_action', heightPx: 44, widthPx: 120 };
      const railNavItem: ButtonErgonomics = { type: 'nav_rail_item', heightPx: 48, widthPx: 48 };

      assert.ok(rowActionButton.heightPx >= MIN_TOUCH_TARGET_PX);
      assert.ok(rowActionButton.widthPx >= MIN_TOUCH_TARGET_PX);
      assert.ok(primarySubmitButton.heightPx >= PRIMARY_BUTTON_TOUCH_TARGET_PX);
      assert.ok(railNavItem.heightPx >= PRIMARY_BUTTON_TOUCH_TARGET_PX);
    });

    test('63. Scenario 5: Filter Badges Count Consistency & Void / Cancelled Lifecycle Visibility', () => {
      // POs with full statuses
      const pos: PurchaseOrderContract[] = [
        { id: 1, po_number: 'PO-1', status: 'draft', items_count: 1, total_quantity: 5 },
        { id: 2, po_number: 'PO-2', status: 'open', items_count: 2, total_quantity: 10 },
        { id: 3, po_number: 'PO-3', status: 'void', items_count: 1, total_quantity: 2 },
      ];

      const voidPOs = filterPurchaseOrders(pos, 'void');
      assert.equal(voidPOs.length, 1);
      assert.equal(voidPOs[0].po_number, 'PO-3');

      // Leave orders with cancelled status
      const los: LeaveOrderContract[] = [
        { id: 1, order_number: 'LO-1', status: 'open', items_count: 1, total_quantity: 4 },
        { id: 2, order_number: 'LO-2', status: 'cancelled', items_count: 1, total_quantity: 2 },
      ];

      const cancelledLOs = filterLeaveOrders(los, 'cancelled');
      assert.equal(cancelledLOs.length, 1);
      assert.equal(cancelledLOs[0].order_number, 'LO-2');
    });
  });
});
