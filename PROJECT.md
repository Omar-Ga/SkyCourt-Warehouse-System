# Project: SkyCourt Warehouse System UI Modernization

## Architecture
The SkyCourt Warehouse System is a Python/Flask + React/TypeScript (Vite) desktop application running via PyWebView and connected to a remote Turso/LibSQL cloud database.
The frontend (`UI/`) operates in Arabic (RTL) and serves non-technical warehouse and office staff with distinct Role-Based Access Control (`warehouse`, `office`, `admin`).

### Modernization Architectural Principles:
1. **Clear Information Architecture**: Move from flat navigation to grouped semantic sections with automatic role-based pruning of empty sections.
2. **Predictable Navigation**: Multi-tier breadcrumbs for drill-down catalog workflows, enabling 1-click returns to parent tiers.
3. **Visual Ergonomics & Mistake Prevention**: Reusable illustrated empty states with action buttons, status filter chips on data tables, prominent touch-friendly action buttons (min 40-44px target), and real-time inline form validation in plain Arabic.
4. **Strict Invariant Preservation**: Zero changes to backend API contracts or Turso/LibSQL database. Existing RBAC rules strictly preserved.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Grouped Sidebar Navigation | Restructure flat sidebar into 4 logical groups (عمليات المخزون, الأوامر والمستندات, البيانات الأساسية, النظام والتقارير) with legible headers and icons | M1 | Survey 1 & ORIGINAL_REQUEST R1 |
| F2 | Responsive / Collapsible Sidebar | Collapsible sidebar rail (w-20) with toggle button in Sidebar & TopHeader, touch-friendly, localStorage persistence | M1 | Survey 1 & ORIGINAL_REQUEST R1 |
| F3 | Multi-Tier Breadcrumbs | Clickable breadcrumbs for category/subcategory/item drill-down in ItemsManagement, single-click parent navigation | M1 | Survey 1 & ORIGINAL_REQUEST R1 |
| F4 | Role-Based Access Control Pruning | Ensure grouped navigation strictly prunes empty sections for `office` and `warehouse` without unauthorized links | M1 | Survey 1 & ORIGINAL_REQUEST R3 |
| F5 | Automated Navigation & Breadcrumb Tests | Automated unit tests in `UI/tests/` verifying role-filtered grouping and breadcrumb state transitions | M-TEST | Survey 3 & Acceptance Criteria |
| F6 | Reusable Empty State Component | Reusable `<EmptyState />` component with icons, clear Arabic explanations, and prominent action recovery button | M2 | Survey 2 & ORIGINAL_REQUEST R2 |
| F7 | Upgraded Table Empty States | Upgrade shared `Table.tsx` and custom tables (PO, Leave Orders, Logs) with interactive empty states | M2 | Survey 2 & ORIGINAL_REQUEST R2 |
| F8 | Inventory Status Filter Chips | Clickable status chips (الكل, متوفر, منخفض, نافد, غير نشط) on ItemsManagement table | M2 | Survey 2 & ORIGINAL_REQUEST R2 |
| F9 | Order Status Filter Tabs & Badges | Status filter tabs with count badges and colors for PurchaseOrders and LeaveOrders (including 'ملغي') | M2 | Survey 2 & ORIGINAL_REQUEST R2 |
| F10 | Touch-Friendly Action Controls | Standardize table row actions to min 40px and primary buttons to 44px (h-11) touch targets | M2 | Survey 2 & ORIGINAL_REQUEST R2 |
| F11 | Inline Line-Item Form Validation | Inline visual validation cues (red borders and localized Arabic error messages) in CreatePOModal and CreateLeaveOrderModal | M3 | Survey 2 & ORIGINAL_REQUEST R2 |
| F12 | Real-Time Stock Headroom Validation | Visual cues while typing quantities exceeding available stock before form submission | M3 | Survey 2 & ORIGINAL_REQUEST R2 |
| F13 | Lint & Type Hygiene Remediation | Fix 14 pre-existing `@typescript-eslint/no-explicit-any` errors in `useMetadata.ts` and `optimisticCategory.test.ts`, remove unused disable warning in `useDashboardStats.ts` so `npm run lint` passes 100% | M3 | Survey 3 & Acceptance Criteria |
| F14 | Comprehensive E2E Test Suite | 4-tier requirement-driven opaque-box test suite verifying all UI features and user acceptance criteria | M-TEST | Project Pattern & Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-TEST | E2E Testing Suite Track | Design and implement automated test suites verifying navigation groups, breadcrumbs, filter chips, empty states, and role permissions | none | DONE |
| M1 | Navigation & Breadcrumbs Architecture | Implement grouped navigation in `navigation.ts`, collapsible `Sidebar.tsx`, `TopHeader.tsx` toggle, breadcrumb state engine `breadcrumbNavigation.ts`, and `Breadcrumb.tsx` in `ItemsManagement.tsx` | none | PLANNED |
| M2 | Visual Ergonomics: Empty States & Filter Chips | Implement `EmptyState.tsx`, `FilterTabs.tsx`, upgrade `Table.tsx`, add filter chips to `ItemsManagement.tsx`, `PurchaseOrders.tsx`, `LeaveOrders.tsx`, and standardize button touch targets | M1 | PLANNED |
| M3 | Mistake Prevention, Form Validation & Lint Remediation | Implement line-item validation & stock headroom cues in modals, fix untranslated strings in `EditItemModal.tsx`, and remediate pre-existing lint errors for 100% clean `npm run lint` | M2 | PLANNED |
| M4 | Final Integration, E2E Pass & Forensic Audit | Verify 100% pass on all unit tests, E2E tests, build, lint, and obtain clean Forensic Auditor verdict | M-TEST, M3 | PLANNED |

---

## Interface Contracts

### 1. Navigation Grouping Contract (`UI/src/navigation.ts`)
```typescript
export interface NavGroup {
  id: string;
  title: string;
  icon?: string;
  itemIds: PageId[];
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

export function getNavigationGroupsForRole(role: Role): ResolvedNavGroup[];
```

### 2. Breadcrumb State Contract (`UI/src/utils/breadcrumbNavigation.ts`)
```typescript
export interface BreadcrumbItem {
  id: string;
  label: string;
  level: 'mainCategories' | 'subCategories' | 'items';
  isActive: boolean;
  data?: any;
}

export interface BreadcrumbState {
  viewLevel: 'mainCategories' | 'subCategories' | 'items';
  selectedMainCategory: { id: number; name: string } | null;
  selectedSubCategory: { id: number; name: string } | null;
}

export function buildBreadcrumbs(state: BreadcrumbState, rootTitle: string): BreadcrumbItem[];
export function transitionNavigateToLevel(state: BreadcrumbState, targetLevel: 'mainCategories' | 'subCategories' | 'items'): BreadcrumbState;
```

### 3. EmptyState Component Contract (`UI/src/components/EmptyState.tsx`)
```typescript
export interface EmptyStateProps {
  icon?: LucideIcon | ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: LucideIcon;
  className?: string;
}
```

### 4. FilterTabs Component Contract (`UI/src/components/FilterTabs.tsx`)
```typescript
export interface FilterTabOption<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  badgeColor?: string;
}

export interface FilterTabsProps<T extends string = string> {
  options: FilterTabOption<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
}
```

---

## Code Layout
- `UI/src/navigation.ts` — Navigation group definitions, RBAC role permissions, `getNavigationGroupsForRole`.
- `UI/src/utils/breadcrumbNavigation.ts` — Pure TypeScript breadcrumb state transition engine.
- `UI/src/components/Sidebar.tsx` — Responsive, grouped, collapsible sidebar with touch-friendly rail.
- `UI/src/components/TopHeader.tsx` — Top bar with sidebar collapse/expand toggle button.
- `UI/src/components/Breadcrumb.tsx` — Reusable Arabic breadcrumb bar with RTL ChevronLeft separator.
- `UI/src/components/EmptyState.tsx` — Reusable illustrated empty state with action recovery button.
- `UI/src/components/FilterTabs.tsx` — Reusable horizontal filter chips/tabs with badge counts.
- `UI/src/components/Table.tsx` — Shared table upgraded to support `emptyState` prop and fallback to `EmptyState`.
- `UI/src/pages/ItemsManagement.tsx` — Upgraded with breadcrumbs, status filter chips, and touch buttons.
- `UI/src/pages/PurchaseOrders.tsx` — Upgraded with FilterTabs (including 'ملغي') and EmptyState with create button.
- `UI/src/pages/LeaveOrders.tsx` — Upgraded with FilterTabs (including 'ملغي') and EmptyState with reset action.
- `UI/src/components/CreatePOModal.tsx` & `CreateLeaveOrderModal.tsx` — Inline line-item validation & stock headroom cues.
- `UI/tests/navigation.test.ts` — Automated tests for grouped navigation & RBAC pruning.
- `UI/tests/breadcrumbNavigation.test.ts` — Automated tests for breadcrumb state transitions.
- `UI/tests/filterAndEmptyState.test.ts` — Automated tests for filter options and empty state configurations.
