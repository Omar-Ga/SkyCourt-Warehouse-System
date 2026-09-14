# Project: SkyCourt Warehouse System Deep Structural UX Overhaul

## Architecture
The SkyCourt Warehouse System is a Python/Flask + React 18 / TypeScript / Tailwind CSS desktop application running via PyWebView (EdgeChromium) connected to a remote Turso/LibSQL cloud database.
The frontend operates in Arabic (RTL) with strict Role-Based Access Control (`warehouse`, `office`, `admin`).

### Modernization Architectural Principles:
1. **Reclaimed Horizontal Real Estate**: Replace the 270px vertical right sidebar (`Sidebar.tsx`) with a slim 60px horizontal top navigation bar (`TopNavBar.tsx`), reclaiming 100% of horizontal viewport width for rich data tables on 1024x768 screens.
2. **First-Class URL Routing & In-App History**: Introduce `react-router-dom` with standard HTML5 History (`BrowserRouter`) backed by Flask's SPA catch-all. Every screen and category drill-down level has a bookmarkable URL path. Custom in-app back navigation (`navigate(-1)`) replaces missing browser buttons and eliminates all `sessionStorage` navigation hacks.
3. **Standardized Page Shell**: A single unified `PageLayout.tsx` wrapper for all 11 screens, enforcing a single authoritative `<h1>`, optional icon/subtitle, and a predictable fixed primary action slot in the header.
4. **Zero Cold-TLS Connection Overhead**: Implement thread-safe connection pooling (`LibSQLConnectionPool`) in `app/models/db_utils.py` to eliminate 700+ ms of TLS/Hrana handshake latency per request while preserving Flask `g.db` request isolation and unpooled local SQLite test execution.
5. **Instantaneous Optimistic Mutations**: TanStack Query `onMutate` cache snapshots and instant local updates for items, POs, Leave Orders, and tickets, with automatic rollback on error. Modals close immediately upon submission without blocking spinners.
6. **Pure Tailwind CSS & Green Brand Pivot**: Delete all 27 legacy custom classes from `index.css`. Pivot dominant brand color from purple (`#4B1E78`) to green derived from the SkyCourt logo petal palette (`#1E7D46` / `primary-600`). Standardize 100% on Western Arabic numerals (`0-9`).
7. **Unified Data Tables**: Standardize all tabular screens on an enhanced generic `Table.tsx` featuring column alignment, 5-row pulsing skeleton loaders, integrated empty states, and RTL-aware pagination.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Horizontal Top Navigation Bar | Replace `Sidebar.tsx` with `TopNavBar.tsx`: compact logo, role-grouped dropdowns, compact cloud sync icon with tooltip, user profile, logout | M3 | ORIGINAL_REQUEST R1 |
| F2 | Client-Side URL Routing | Install `react-router-dom`, define canonical URL routes for all 11 pages, preserve route on refresh | M3 | ORIGINAL_REQUEST R2 |
| F3 | In-App Back Navigation Button | RTL-aware back button in `TopNavBar` calling `navigate(-1)` when `window.history.state.idx > 0` | M3 | ORIGINAL_REQUEST R2 |
| F4 | Hierarchical Items URL Routing | Nested routes `/items`, `/items/category/:categoryId`, `/items/category/:categoryId/subcategory/:subCategoryId` | M3 | ORIGINAL_REQUEST R2 |
| F5 | Elimination of sessionStorage Hacks | Remove `dashboardSearchNavigation` and `itemsManagementState` in favor of declarative URL parameters | M3 | ORIGINAL_REQUEST R2 |
| F6 | Standardized PageLayout Wrapper | Single `PageLayout.tsx` wrapper across all 11 screens with single `<h1>`, subtitle, and icon | M3 | ORIGINAL_REQUEST R3 |
| F7 | Fixed Header Primary Action Slot | Standardized top-left (RTL visual top-right) action button slot across all screens | M3 | ORIGINAL_REQUEST R3 |
| F8 | Items Grid Action Slot Conversion | Convert "Add Main Category" card masquerading in grid into standard header action button | M3 | ORIGINAL_REQUEST R3 |
| F9 | Removal of Duplicate `<h1>` Tags | Eliminate 5 duplicate `<h1>` tags from `UnitManagement`, `ProviderManagement`, `DestinationManagement`, `Settings`, `OfficeDashboard` | M3 | ORIGINAL_REQUEST R3 |
| F10 | LibSQL Connection Pooling | Thread-safe `LibSQLConnectionPool` with `PooledConnection` proxies in `app/models/db_utils.py` | M1 | ORIGINAL_REQUEST R4 |
| F11 | Preserved Flask `g.db` Request Scoping | Request teardown safely returns connection to pool without severing remote socket | M1 | ORIGINAL_REQUEST R4 |
| F12 | Local SQLite Test Isolation | Ensure connection pool bypasses local SQLite files to prevent test pollution | M1 | ORIGINAL_REQUEST R4 |
| F13 | Polling Heartbeat Aggressiveness Reduction | Increase `useAdaptiveSyncHeartbeat.ts` intervals to >= 30s active / 60s idle with visibility pause | M1 | ORIGINAL_REQUEST R9 |
| F14 | Optimistic UI for Items Mutations | `onMutate` cache updates and error rollback for create, edit, and quantity adjustment | M4 | ORIGINAL_REQUEST R5 |
| F15 | Optimistic UI for Orders & Tickets | `onMutate` cache updates and error rollback for PO creation/receipt, Leave Order creation, and ticket fulfillment/rejection | M4 | ORIGINAL_REQUEST R5 |
| F16 | Modal Unblocking & Immediate Feedback | Remove blocking modal spinners; validate, mutate, close immediately, toast feedback | M4 | ORIGINAL_REQUEST R5 |
| F17 | Tailwind-Only CSS Unification | Delete all 27 legacy classes in `index.css` (lines 42–187) and migrate 21 files to Tailwind utilities | M2 | ORIGINAL_REQUEST R6 |
| F18 | Shared Table Component Enhancement | Upgrade `Table.tsx` with generic types, column alignment (`align`), pulsing skeletons, and empty state | M2 | ORIGINAL_REQUEST R7 |
| F19 | Table Standardization Across All Screens | Refactor `PurchaseOrders`, `LeaveOrders`, `POTickets`, `DisbursementTickets`, and Master Data to `Table.tsx` | M5 | ORIGINAL_REQUEST R7 |
| F20 | Brand Color Pivot to Logo Green | Pivot primary palette to green (`#1E7D46` / `primary-600`), deprecate `#4B1E78` and violet tokens | M2 | ORIGINAL_REQUEST R8 |
| F21 | Western Arabic Numeral Standardization | Standardize 100% of numbers and dates on Western Arabic numerals (`0-9`) across all screens | M2 | ORIGINAL_REQUEST R8 |
| F22 | Opaque-Box E2E Testing Suite | Multi-tier test suite covering navigation, routing, layout, pooling, optimistic UI, and styles | M-TEST | Project Pattern & Acceptance Criteria |
| F23 | Final Milestone Integration & Victory Audit | 100% pass on all test suites (unit, E2E Tiers 1–4, Tier 5 adversarial hardening) and Forensic Audit | M6 | Project Pattern |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-TEST | E2E Testing Suite Track | Design and implement opaque-box automated test suite for R1–R9 requirements across Tiers 1–4; publish `TEST_READY.md` | none | DONE |
| M1 | Backend Performance: Connection Pooling & Polling Heartbeat | Implement `LibSQLConnectionPool` in `app/models/db_utils.py`, verify latency drop >= 100ms, update `useAdaptiveSyncHeartbeat.ts` to >= 30s | none | DONE |
| M2 | Design System & Brand Pivot: Tailwind, Green Palette & Table.tsx | Update `tailwind.config.js` to green `#1E7D46`, purge legacy classes from `index.css`, upgrade `Table.tsx` with alignment and skeletons, standardize numerals | none | IN_PROGRESS |
| M3 | Navigation, Routing & Standardized PageLayout | Install `react-router-dom`, build `TopNavBar.tsx` and `PageLayout.tsx`, delete `Sidebar.tsx`/`TopHeader.tsx`, eliminate `sessionStorage` hacks, wire all 11 pages | M2 | PLANNED |
| M4 | Optimistic UI & Modal Unblocking | Implement TanStack Query `onMutate`/`onError`/`onSettled` for items, POs, Leave Orders, and tickets; unblock modals | M1, M3 | PLANNED |
| M5 | Table Screen Refactoring & Master Data Standardization | Standardize `PurchaseOrders`, `LeaveOrders`, `POTickets`, `DisbursementTickets`, `Units`, `Providers`, and `Destinations` onto shared `Table.tsx` | M2, M3 | PLANNED |
| M6 | Final Milestone: E2E Verification & Forensic Victory Audit | Pass 100% of E2E test suite (Tiers 1–4), adversarial coverage hardening (Tier 5), verify clean build & tests, and pass Forensic Audit | M-TEST, M4, M5 | PLANNED |

---

## Interface Contracts

### 1. Route Table & Navigation Contract (`UI/src/navigation.ts`)
```typescript
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
```

### 2. Standardized `PageLayout.tsx` Component Contract
```typescript
export interface PageLayoutProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
```

### 3. Generic `Table.tsx` Component Contract
```typescript
export type Column<T = any> = {
  key: string;
  header: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  width?: string;
  align?: 'right' | 'center' | 'left';
  headerClassName?: string;
  cellClassName?: string;
};

export type TablePagination = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
};

export type TableProps<T = any> = {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T | string;
  onRowClick?: (row: T) => void;
  pagination?: TablePagination;
  isLoading?: boolean;
  skeletonRows?: number;
  rowClassName?: (row: T) => string;
  emptyState?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  emptyActionLabel?: string;
  emptyOnAction?: () => void;
};
```

### 4. LibSQL Connection Pool Contract (`app/models/db_utils.py`)
```python
class LibSQLConnectionPool:
    def __init__(self, max_size: int = 5, max_idle_seconds: float = 30.0, timeout: float = 10.0): ...
    def acquire(self, target_url: str, token: str) -> PooledConnection: ...
    def release(self, raw_conn: Any) -> None: ...
```

---

## Code Layout
- `app/models/db_utils.py`: `LibSQLConnectionPool`, `PooledConnection`, `get_db()`, `close_request_db()`.
- `UI/src/navigation.ts`: `PAGE_ROUTES`, route definitions, RBAC role permissions.
- `UI/src/components/TopNavBar.tsx`: Top navigation bar, compact logo, dropdowns, cloud sync tooltip, back button.
- `UI/src/components/PageLayout.tsx`: Standard page wrapper, single `<h1>`, header action slot.
- `UI/src/components/Table.tsx`: Generic data table with column alignment, pulsing skeletons, pagination.
- `UI/src/hooks/useAdaptiveSyncHeartbeat.ts`: Adaptive heartbeat polling (30s active / 60s idle).
- `UI/src/hooks/useItems.ts`: Optimistic items mutations (`useCreateItem`, `useUpdateItem`, `useAdjustItemQuantity`).
- `UI/src/hooks/usePurchaseOrders.ts`: Optimistic PO mutations (`useCreatePurchaseOrder`, `useReceivePurchaseOrder`).
- `UI/src/hooks/useLeaveOrders.ts`: Optimistic Leave Order & Ticket mutations.
- `UI/src/pages/`: All 11 pages updated to use `PageLayout` and router.
- `UI/src/index.css`: Cleaned Tailwind-only stylesheet (<60 lines).
- `UI/tailwind.config.js`: Green primary palette (`#1E7D46`).
