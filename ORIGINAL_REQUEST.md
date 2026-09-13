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

