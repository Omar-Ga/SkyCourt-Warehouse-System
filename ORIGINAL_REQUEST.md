# Original User Request

## 2026-09-13T15:42:04Z

This is a single self-contained fix; keep it small and focused. Fix three UX and performance issues in the SkyCourt Warehouse System, a production Python/Flask + React/TypeScript desktop app (PyWebView) backed by a remote Turso/LibSQL database. All subagents should be gemini flash 3.8 high thinking.

Working directory: /home/omar/Code Projects/SkyCourt-Warehouse-System
Integrity mode: development

## Codebase Context

**Architecture:**
- **Backend:** Python/Flask app at `app/` — routes in `app/routes/`, services in `app/services/`, models in `app/models/`. Entry point `run.py`. Uses `pywebview` to serve a local Flask server to a desktop browser window.
- **Frontend:** React/TypeScript (Vite) at `UI/src/`. Uses TanStack React Query v5 for data fetching. Styling via Tailwind CSS. All UI text is in Arabic (RTL).
- **Database:** Remote LibSQL on Turso (cloud-hosted). No local replica — every query hits the remote DB over HTTPS.
- **Tests:** Backend: `pytest` tests at `tests/` (run with `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System && python -m pytest tests/`). Frontend: Node test runner at `UI/tests/` (run with `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System/UI && npm test`).

**Key files for this task:**
- `UI/src/services/apiClient.ts` — Central HTTP client. Already has idempotency key auto-attachment, but only for items, stock adjusts, leave orders, and ticket operations. Categories, providers, destinations, and units are NOT covered.
- `UI/src/components/CategoryModal.tsx` — Example of a modal with NO `isSaving` guard. The submit button stays clickable during async requests.
- `UI/src/components/AddItemModal.tsx` — Example of a modal that DOES have `isSaving` correctly. Use as reference pattern.
- `UI/src/hooks/useMetadata.ts` — Units, categories, providers, destinations hooks. staleTime 5 minutes but no prefetching.
- `UI/src/hooks/useItems.ts` — Items hook. Polls every 20s.
- `UI/src/hooks/useLeaveOrders.ts` — Leave orders/tickets hooks. Tickets count polls every 5s, detail every 10s, lists every 15s.
- `UI/src/hooks/usePurchaseOrders.ts` — PO hooks. Lists poll every 15s, detail every 10s.
- `UI/src/hooks/useSyncStatus.ts` — Sync status. Polls every 5s.
- `UI/src/hooks/useDashboardStats.ts` — Dashboard hooks. Polls every 30s.
- `UI/src/hooks/useMovementLogs.ts` — Movement logs. Polls every 15s.
- `UI/src/components/SoftRefreshButton.tsx` — Manual refresh button. Invalidates 14 query keys then also calls `refetchQueries({ type: 'active' })`.
- `UI/src/main.tsx` — QueryClient config. Default staleTime 30s.
- `UI/src/components/Modal.tsx` — Base modal component. Supports `isPrimaryActionDisabled` prop.
- Backend routes at `app/routes/category_routes.py`, `app/routes/provider_routes.py`, `app/routes/destination_routes.py`, `app/routes/units_routes.py` — No idempotency protection on create/update/delete.
- `app/services/idempotency_service.py` — Existing idempotency service for reference pattern.
- `tests/test_idempotency.py` — Existing idempotency tests for reference.

**Domain invariants (from CONTEXT.md):**
- Idempotency: Client-initiated mutations require an `operation_key` (`Idempotency-Key` header) to prevent duplicate executions from double-clicks.
- Non-negative inventory: Stock can never go below zero.
- Audit trail immutability: Every stock change produces a movement log entry.
- The system is online-only — offline mutations are strictly gated.

## Requirements

### R1. Eliminate duplicate form submissions across all mutating forms

Every modal and form that performs a create, update, or delete operation must prevent duplicate submissions. This includes — but is not limited to — categories, sub-categories, providers, destinations, units, items, purchase orders, and leave orders.

Frontend: add `isSaving` state guards with button disabling and loading text on all forms that lack them (use `AddItemModal.tsx` as the reference pattern). Backend: extend `Idempotency-Key` auto-attachment in `apiClient.ts` to cover all POST/PUT/DELETE endpoints, and add idempotency support to the backend routes that currently lack it (categories, providers, destinations, units) using the existing `idempotency_service.py` pattern.

### R2. Reduce perceived page load time with client-side caching improvements

Implement metadata prefetching on login/app mount so that units, categories, providers, and destinations are pre-loaded before the user navigates to any page. Add optimistic updates on mutations so the UI reflects changes instantly before server confirmation. Implement smarter query invalidation — after a mutation, invalidate only the specific query keys that are actually affected (not all 14).

### R3. Coalesce sync polling into a single adaptive heartbeat

Replace the current 11+ independent `refetchInterval` timers with a single coordinated sync heartbeat. The heartbeat should refetch only queries that are currently mounted/active. The interval should be adaptive: shorter (e.g. 10-15s) when the user is actively interacting, longer (e.g. 30-60s) when idle. Remove all per-hook `refetchInterval` settings. The `SoftRefreshButton` should continue working but should not double-refetch.

## Acceptance Criteria

### Double-click protection
- [ ] Every modal/form in `UI/src/components/` that performs a mutating API call has an `isSaving` guard that disables the submit button during the async operation
- [ ] `apiClient.ts`'s `fetchWithProtection` auto-attaches `Idempotency-Key` headers to ALL POST, PUT, and DELETE requests (not just the currently hardcoded subset)
- [ ] Backend category, provider, destination, and unit create endpoints check the `Idempotency-Key` header and return the cached response on duplicate requests (using `idempotency_service.py`)
- [ ] Existing backend `tests/test_idempotency.py` tests still pass
- [ ] At least one new test verifies idempotency for category creation

### Caching & perceived performance
- [ ] Metadata (units, categories, providers, destinations) is prefetched on app mount (after authentication) so subsequent page navigations don't trigger fresh network requests for these
- [ ] At least one mutation (e.g. category create) uses optimistic cache updates so the new item appears in the UI before server response
- [ ] Mutation success handlers invalidate only affected query keys, not a blanket list of all keys
- [ ] The TypeScript project compiles without errors: `cd UI && npx tsc --noEmit`

### Sync consolidation
- [ ] No individual hook in `UI/src/hooks/` contains a `refetchInterval` setting — all periodic refetching is managed by a single coordinated mechanism
- [ ] The coordinated mechanism only refetches queries that are currently active/mounted
- [ ] The `SoftRefreshButton` invalidates and refetches without double-fetching (no `invalidateQueries` + `refetchQueries` on the same keys in sequence)
- [ ] The app remains functional — existing frontend tests pass: `cd UI && npm test`

### General
- [ ] No regressions: all backend tests pass (`python -m pytest tests/`)
- [ ] No new `eslint-disable` comments added
- [ ] All existing comments and docstrings preserved unless directly related to changed code

## Verification Resources

- Backend tests: `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System && python -m pytest tests/ -v`
- Frontend tests: `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System/UI && npm test`
- TypeScript compilation check: `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System/UI && npx tsc --noEmit`
- Frontend build check: `cd /home/omar/Code\ Projects/SkyCourt-Warehouse-System/UI && npm run build`

## 2026-09-13T16:29:18Z

User directive: Skip the remaining adversarial review rounds (Round 3, Round 4) and personal diff verification. The implementation is solid — 138 backend tests, 28 frontend tests, clean tsc and build. Go straight to the Victory Audit now. No more review passes needed.

## 2026-09-13T16:31:58Z

Use the full multi-agent team to modernize the SkyCourt Warehouse System frontend (`UI/`), focusing on intuitive, visual, and mistake-proof UI/UX tailored for non-technical warehouse and office staff.

Working directory: /home/omar/Code Projects/SkyCourt-Warehouse-System
Integrity mode: development

## Requirements

### R1. Navigation & Clear Information Architecture
- Restructure the flat sidebar navigation into clear, logically grouped visual sections (e.g., عمليات المخزون [Stock Operations], الأوامر والمستندات [Orders & Documents], البيانات الأساسية [Master Data], النظام والتقارير [System & Reports]) with legible headers and icons.
- Provide a responsive sidebar with easy toggle behavior for tablet/smaller warehouse monitors without disrupting RTL flow.
- Add clear, clickable breadcrumb trails on multi-tier pages (such as category and subcategory drill-downs in Items management) so staff always know where they are and can return to previous screens with a single click.

### R2. Visual Clarity & Non-Technical Operator Ergonomics
- Replace hidden interactions or complex workflows with prominent, self-explanatory visual controls (large readable touch/mouse-friendly buttons, clear status tags, and obvious action indicators).
- Add clickable visual filter tabs/chips on data lists and tables (e.g., "الكل", "نشط", "مسودة", "معلق") enabling one-click filtering without typing complex queries.
- Implement helpful, illustrated empty states across tables and lists that explain what the empty screen means and offer a prominent button to take the next step.
- Enhance form validation with immediate, plain-language visual cues to prevent common input errors before submission.

### R3. Architectural Invariants & Role Gating Preservation
- All navigation sections and action buttons must strictly obey existing Role-Based Access Control (`office`, `warehouse`, `admin`) without showing unauthorized links.
- Existing backend API contracts and LibSQL cloud-authoritative database invariants must remain intact and unmodified.

## Acceptance Criteria

### Build & Quality
- [ ] Running `npm run build` in `UI/` completes successfully with zero TypeScript or bundling errors.
- [ ] Running `npm run lint` in `UI/` passes with zero linting errors.
- [ ] Existing test suite in `UI/` (`npm test`) passes with a 100% pass rate.
- [ ] New automated tests verify role-filtered navigation grouping and breadcrumb state transitions.

### Navigation & Information Architecture
- [ ] The sidebar displays grouped category headers with distinct spacing and icons, rendering only links permitted for the active user role (`office`, `warehouse`, `admin`).
- [ ] Collapsing/expanding the sidebar is toggled via an obvious on-screen button, keeping icons legible and touch-friendly.
- [ ] Navigating into categories, subcategories, or items displays clear breadcrumbs (e.g., `دليل الأصناف > الفئة الرئيسية > الفئة الفرعية`) allowing single-click navigation back to any parent level.

### Visual Ergonomics & Mistake Prevention
- [ ] Data tables include visible filter chips/tabs that filter data immediately on click.
- [ ] When tables or lists have zero items, a clear Arabic message with an appropriate icon and next-step action button is displayed instead of a blank container.
- [ ] Primary action buttons have distinct visual weight, clear labels, and prevent double-clicks during operations.

## 2026-09-14T13:35:04Z

Deep structural UX overhaul of the SkyCourt Warehouse System — a React 18 SPA (TypeScript, Tailwind CSS) served via PyWebView with a Flask/LibSQL backend. The operations manager has rejected the current UI as chaotic ("مهيصة"), confusing, and laggy. This overhaul replaces the sidebar with a top navigation bar, adds URL routing with browser history, standardizes action placement and page layouts across all 11 screens, fixes critical performance bottlenecks (cold TLS connections, no optimistic UI), and pivots the brand palette from purple to green.

Use a full team of agents. Use Gemini Flash model for all worker subagents — reserve the larger model for orchestration only.

Working directory: /home/omar/Code Projects/SkyCourt-Warehouse-System
Integrity mode: development

## Codebase Architecture (Essential Context)

- **Frontend:** React 18.3.1 + TypeScript 5.5.3 + Tailwind CSS 3.4, built with Vite 5.4.2. Source in `UI/src/`.
- **Desktop shell:** PyWebView with EdgeChromium renderer. Flask serves compiled SPA from `UI/dist/`. Entry: `run.py` and `app/main.py`.
- **Backend DB:** Remote LibSQL/Turso at `libsql://skycourt-warehouse-v2-omargamal.aws-eu-west-1.turso.io`. Connection logic in `app/models/db_utils.py`.
- **Current navigation:** Pure in-memory React Context (`AppContext.tsx` → `setActivePage(pageId)`). No URL router. No browser history support. URL is always `http://127.0.0.1:5070/`.
- **Current layout:** Right-side sidebar (RTL layout, 270px expanded / 80px collapsed) + persistent TopHeader with page title, sync status, and refresh button.
- **Pages (11 total):** Dashboard, Items, PurchaseOrders, DisbursementTickets, POTickets, LeaveOrders, Logs, Units, Destinations, Providers, Settings.
- **Roles:** `warehouse`, `office`, `admin` — role-based page visibility defined in `UI/src/navigation.ts`.
- **Language/Direction:** Arabic UI, RTL layout throughout.
- **Existing shared components:** `UI/src/components/Table.tsx` (underused), `UI/src/components/Breadcrumb.tsx` (only wired to Items), `UI/src/components/TopHeader.tsx`, `UI/src/components/Sidebar.tsx`.

## Requirements

### R1. Replace Sidebar with Top Navigation Bar
Remove the right-side sidebar (`Sidebar.tsx`) and replace it with a horizontal top navigation bar. The top bar should contain: the SkyCourt logo (compact), navigation links grouped by role (same groups as current sidebar), a simplified cloud sync indicator (a small icon that shows a hover tooltip with "متصل بالسحابة" or "غير متصل" — not a persistent text pill), the user profile/role indicator, and a logout action. The current `TopHeader.tsx` (page title, icon, subtitle, refresh button) should merge into this top bar or sit directly below it as a slim page header strip — not as a separate heavy component. The result should feel like a clean toolbar, not a dashboard.

### R2. URL Routing with In-App Back Navigation
Introduce a client-side router (e.g., React Router or TanStack Router) so each page has its own URL path (e.g., `/items`, `/purchase-orders`, `/items/category/5/subcategory/12`). **Important context: this app runs inside PyWebView (EdgeChromium), not a browser — there are no browser back/forward buttons.** The URL router is needed for three reasons: (1) page refresh preserves the current screen instead of dumping to Dashboard, (2) category drill-down state lives in the URL naturally (eliminating sessionStorage hacks), and (3) the router's history stack enables a custom **in-app back button** in the top navigation bar that calls `navigate(-1)`. Add this back button (e.g., a left arrow icon, since the UI is RTL this appears on the right) that appears when there is navigation history to go back to. Remove all `sessionStorage` navigation hacks (`dashboardSearchNavigation`, `itemsManagementState`) and replace with URL-based state.

### R3. Standardized Page Layout with Fixed Action Slot
Create a single `PageLayout` wrapper component that every page uses. It should provide: a consistent page title area (using the existing TopHeader title — remove all duplicate `<h1>` tags from page bodies), a fixed "primary action" slot in the top-right of the page header (this is where every "Add" / "Create" button goes — same position on every screen), and a content area below. All 11 pages must use this layout. The "Add Main Category" card that masquerades as content in the Items grid must become a button in the standard action slot.

### R4. Connection Pooling for LibSQL/Turso
Replace the per-request `libsql.connect()` / `close()` pattern in `app/models/db_utils.py` with a connection pool or long-lived connection that persists across requests. The current code creates a fresh TLS connection (DNS + handshake + auth) on every HTTP request and tears it down at the end — this adds 150-350ms of overhead per call. The pool should handle connection health checks and automatic reconnection on failure. Do not break the existing `g.db` request-scoping pattern for the Flask routes — the pool provides connections, request teardown returns them.

### R5. Optimistic UI for Mutations
Implement optimistic cache updates for the primary mutation flows: adding/editing items, adjusting quantities, creating Purchase Orders, creating Leave Orders, and fulfilling/rejecting tickets. When a user submits a form, the UI should immediately reflect the change in the displayed data (optimistic update via React Query's `onMutate`), show a subtle success indicator, and silently reconcile with the server response. On server error, roll back the optimistic update and show an error notification. The current pattern of disabling the entire modal with a spinner until the round-trip completes must be replaced.

### R6. Unify CSS to Tailwind-Only
Remove all legacy utility classes from `UI/src/index.css` (`.btn`, `.btn-primary`, `.card`, `.table`, `.input`, `.badge` — lines 42-140) and replace all usages across the codebase with Tailwind utility classes or Tailwind `@apply` component classes. The dual CSS system creates visual inconsistency — some screens look Tailwind-styled, others look legacy-styled. After this change, `index.css` should contain only Tailwind directives, CSS custom properties, font imports, and global resets.

### R7. Standardize All Tables on Shared Table Component
The shared `UI/src/components/Table.tsx` component exists but is ignored by PurchaseOrders, LeaveOrders, DisbursementTickets, and POTickets — all of which hand-roll their own `<table>` elements with copy-pasted classes, headers, empty states, and pagination. Refactor all table-based screens to use the shared `Table.tsx` component (or enhance it if needed). This includes consistent empty states, loading skeletons, pagination controls, and responsive behavior.

### R8. Brand Color Pivot — Purple to Green
The manager rejects the purple (`brand-violet: #4B1E78`) dominant palette. Pivot the primary brand color to a green derived from the SkyCourt logo's green petal. The existing brand tokens `brand-lime: #44B935` and `brand-marine: #2D8F55` are available — choose or blend an appropriate green as the new primary. Update the `tailwind.config.js` color tokens, all hardcoded purple/violet hex values in components, and the `primary` color scale. The magenta accent (`brand-magenta`) can remain as a secondary accent. Ensure all status colors (success, warning, danger, info) retain sufficient contrast against the new palette.

### R9. Reduce Polling Aggressiveness
The `useAdaptiveSyncHeartbeat.ts` hook refetches all active queries every 12 seconds, saturating the network and competing with user interactions. Increase the interval to a more reasonable cadence (e.g., 30-60 seconds) or switch to a smarter invalidation strategy where polling only runs when the tab is visible and the user is idle. With optimistic UI in place (R5), aggressive polling becomes unnecessary.

## Acceptance Criteria

### Navigation & Layout
- [ ] The sidebar is completely removed. A horizontal top navigation bar is present on all screens.
- [ ] The cloud sync indicator is a compact icon with a hover tooltip ("متصل بالسحابة" / "غير متصل"), not a persistent text pill.
- [ ] Every page has a unique URL path. Refreshing the page stays on the current screen, not the Dashboard.
- [ ] An in-app back button appears in the top navigation bar when there is history to go back to. Clicking it navigates to the previous screen.
- [ ] The Items hierarchy (categories → subcategories → items) uses nested URL segments (e.g., `/items/category/5`). Breadcrumbs reflect the current position.
- [ ] All 11 pages use the same `PageLayout` wrapper. The primary action button ("Add", "Create") appears in the same fixed position on every screen that has one.
- [ ] No duplicate `<h1>` page titles exist — the page title appears exactly once, in the layout header.
- [ ] All `sessionStorage` navigation hacks are removed.

### Performance
- [ ] `app/models/db_utils.py` uses connection pooling. A quick benchmark shows response times for simple queries drop by at least 100ms compared to the current cold-connect pattern.
- [ ] Adding an item, adjusting quantity, and creating a PO each show an immediate UI update (optimistic) before the server response arrives. On simulated server error, the UI rolls back.
- [ ] The polling heartbeat interval is ≥ 30 seconds (up from 12 seconds).

### Visual Consistency
- [ ] No legacy `.btn`, `.btn-primary`, `.card`, `.table`, `.input`, or `.badge` classes remain in `index.css` or are referenced in any component.
- [ ] All table-based screens (PurchaseOrders, LeaveOrders, DisbursementTickets, POTickets, Items, Units, Destinations, Providers, MovementLog) use the shared Table component or a single standardized table pattern.
- [ ] The primary brand color throughout the app is green (derived from logo), not purple. No hardcoded `#4B1E78` or `brand-violet` references remain in component code (the token definition in tailwind config may remain as documentation).
- [ ] Eastern Arabic-Indic numerals vs Western numerals are consistent across all screens (pick one system).

### Verification
- [ ] `npm run build` completes with zero TypeScript errors and zero warnings.
- [ ] The Flask backend starts without errors: `python run.py` launches successfully.
- [ ] All existing API endpoints continue to function — no regressions in backend routes.


