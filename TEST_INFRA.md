# SkyCourt Warehouse System — E2E Testing Infrastructure & Methodology (`TEST_INFRA.md`)

**Date:** 2026-09-14  
**Status:** Active & Authoritative  
**Target:** Frontend (`UI/`), Backend Performance (`app/models/db_utils.py`), & Full-Stack System Verification  
**Workspace Root:** `/home/omar/Code Projects/SkyCourt-Warehouse-System`  

---

## 1. Test Philosophy: Requirement-Driven Opaque-Box Testing

The SkyCourt Warehouse System is an Arabic-first (RTL) desktop application serving non-technical warehouse operators, office clerks, and administrators. The frontend (`UI/`) is powered by React 18, TypeScript, and TanStack React Query v5, served inside a PyWebView desktop container backed by a remote LibSQL cloud database.

To ensure long-term stability and rapid verifiable iteration across multi-agent development workflows, the E2E testing track follows a **strict requirement-driven opaque-box testing philosophy**:

1. **Opaque-Box Verification (Black-Box / Contract Testing):**
   - Tests evaluate system behavior from the perspective of external contracts, user requirements, and observable state transitions rather than private internal component state or fragile DOM selectors.
   - When a user navigates routes, adjusts stock quantities, creates purchase orders, or triggers cloud sync events, tests verify that the resulting data models, URL parameters, history stacks, and cache reconciliation semantics match the specification exactly.

2. **Progressive Testability:**
   - Tests decouple business rules, URL routing engines, connection pool semantics, optimistic cache engines, and design tokens into pure, exportable TypeScript/Node abstractions.
   - Tests are runnable and verifiable at any stage of milestone completion without waiting for downstream visual styling or browser rendering.

3. **Deterministic & High-Speed Execution:**
   - Tests run natively via the Node.js test runner (`node:test`) with `--experimental-strip-types` and `node:assert/strict`.
   - The entire 200-test suite executes in under **160 milliseconds**, enabling instant feedback on every commit or agent dispatch.

4. **Zero-Tolerance Quality & Type Safety:**
   - Test suites enforce strict TypeScript hygiene: zero `any` types (using strict interfaces, `unknown`, or generic types) and zero `eslint-disable` additions, fully compliant with ESLint 9 configuration.

---

## 2. Feature Inventory Mapping (UX Overhaul R1–R9 / F1–F23)

Every requirement and feature defined in `PROJECT.md` is mapped to its testing domain, tier level, and verification target:

| Feature ID | Feature Name | Requirement Source | Testing Domain | Target Suite |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | Horizontal Top Navigation Bar | ORIGINAL_REQUEST R1 | Navigation Layout & Header | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.2) |
| **F2** | Client-Side URL Routing | ORIGINAL_REQUEST R2 | Router & Canonical Paths | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.1) |
| **F3** | In-App Back Navigation Button | ORIGINAL_REQUEST R2 | History Stack & RTL Navigation | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.2) |
| **F4** | Hierarchical Items URL Routing | ORIGINAL_REQUEST R2 | Nested Category URL Paths | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.1) |
| **F5** | Elimination of sessionStorage Hacks | ORIGINAL_REQUEST R2 | URL State & Query Parameters | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.1) |
| **F6** | Standardized PageLayout Wrapper | ORIGINAL_REQUEST R3 | Page Layout Shell & Titles | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.3) |
| **F7** | Fixed Header Primary Action Slot | ORIGINAL_REQUEST R3 | Standard Action Placement | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.3) |
| **F8** | Items Grid Action Slot Conversion | ORIGINAL_REQUEST R3 | Action Hoisting Contract | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.3) |
| **F9** | Removal of Duplicate `<h1>` Tags | ORIGINAL_REQUEST R3 | Authoritative Title Validation | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.3) |
| **F10** | LibSQL Connection Pooling | ORIGINAL_REQUEST R4 | Connection Reuse & Capacity | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.4) |
| **F11** | Preserved Flask `g.db` Scoping | ORIGINAL_REQUEST R4 | Request Teardown Lifecycle | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.4) |
| **F12** | Local SQLite Test Isolation | ORIGINAL_REQUEST R4 | Pool Bypass for SQLite | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.4) |
| **F13** | Polling Heartbeat Reduction | ORIGINAL_REQUEST R9 | Adaptive Intervals (>=30s/60s)| `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.7) |
| **F14** | Optimistic UI for Items Mutations | ORIGINAL_REQUEST R5 | TanStack onMutate & Rollback | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.5) |
| **F15** | Optimistic UI for Orders & Tickets | ORIGINAL_REQUEST R5 | PO/LO/Ticket Mutations | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.5) |
| **F16** | Modal Unblocking & Feedback | ORIGINAL_REQUEST R5 | Non-Blocking Form Submissions | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.5) |
| **F17** | Tailwind-Only CSS Unification | ORIGINAL_REQUEST R6 | Elimination of Legacy Classes | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.7) |
| **F18** | Shared Table Component Upgrade | ORIGINAL_REQUEST R7 | Alignment, Skeletons, Empty | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.6) |
| **F19** | Table Standardization All Screens | ORIGINAL_REQUEST R7 | Generic Table Contracts | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.6) |
| **F20** | Brand Color Pivot to Logo Green | ORIGINAL_REQUEST R8 | `#1E7D46` vs `#4B1E78` | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.7) |
| **F21** | Western Arabic Numeral Standard | ORIGINAL_REQUEST R8 | `0-9` vs `٠-٩` Strict Policy | `UI/tests/e2e_ux_overhaul.test.ts` (Tier 1.7) |
| **F22** | Opaque-Box E2E Testing Suite | Project Pattern | 4-Tier Test Architecture | `UI/tests/e2e_ux_overhaul.test.ts` |
| **F23** | Milestone Verification & Audit | Project Pattern | 100% Pass Rate & Quality Gate | Full Suite (`npm test`) |

---

## 3. Test Architecture & Runner Specification

### 3.1 Test Runner Infrastructure
- **Engine:** Native Node.js Test Runner (`node:test`)
- **Assertion Framework:** `node:assert/strict` (strict equality, deep object comparison, exception pattern matching)
- **Runtime:** Node v26.8.1 with `--experimental-strip-types`
- **Primary Test Command:**
  ```bash
  cd UI && npm test
  ```
- **Unified Quality Gate:**
  ```bash
  cd UI && npm test && npx tsc --noEmit && npm run lint && npm run build
  ```

### 3.2 Test Suite Catalog (`UI/tests/`)
1. `UI/tests/e2e_ux_overhaul.test.ts` (**66 tests**) — The authoritative 4-Tier E2E UX overhaul test suite covering R1–R9 (F1–F23).
2. `UI/tests/e2e_requirements.test.ts` (**63 tests**) — The 4-Tier baseline E2E requirement suite verifying navigation grouping, breadcrumbs, filter chips, empty states, and validation rules.
3. `UI/tests/apiClient.test.ts` (**13 tests**) — Session epoch isolation, CSRF tokens, automatic idempotency key attachments, 401/409 error handling.
4. `UI/tests/navigation.test.ts` (**11 tests**) — Role-aligned navigation, permissions matrix, dynamic titles, and group pruning.
5. `UI/tests/navigation_rbac_adversarial.test.ts` (**16 tests**) — RBAC adversarial security boundaries, prototype pollution, whitespace normalization, role switching.
6. `UI/tests/breadcrumbNavigation.test.ts` (**5 tests**) — Breadcrumb state navigation and transition rules.
7. `UI/tests/breadcrumb_sidebar_adversarial.test.ts` (**16 tests**) — Adversarial breadcrumb hopping, deep trails, sidebar responsive rail stress tests.
8. `UI/tests/freshness.test.ts` (**5 tests**) — Actionable ticket polling contracts, sync status, ticket badge fallback logic, UTC-to-Cairo datetime transformations.
9. `UI/tests/poService.test.ts` (**4 tests**) — Purchase order draft generation, filter parameter serialization, revision-aware payloads.
10. `UI/tests/optimisticCategory.test.ts` (**2 tests**) — TanStack Query cache updates and query isolation for main and subcategories.

**Total Active Frontend Test Count:** **200 tests across 36 suites (100% PASS RATE)**.

---

## 4. The 4-Tier Coverage Methodology

The test suite structure is divided into four distinct verification tiers:

```
┌─────────────────────────────────────────────────────────────┐
│                 Tier 4: Real-World Scenarios                │
│       (Simulated Operator Workflows & End-to-End Journeys)  │
├─────────────────────────────────────────────────────────────┤
│              Tier 3: Cross-Feature Interactions             │
│   (Role Switching + Navigation, Filter + Empty State, etc.)  │
├─────────────────────────────────────────────────────────────┤
│              Tier 2: Boundary & Corner Cases                │
│    (Empty Sets, Zero/Negative Quantities, Edge Truncation)  │
├─────────────────────────────────────────────────────────────┤
│                 Tier 1: Feature Coverage                    │
│     (Core Happy Paths for all Interface Contracts ≥5 each)  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Tier 1: Feature Coverage (Core Requirements — 38 Tests)
- **Tier 1.1: URL Routing & Canonical Routes (F2, F4, F5)** (6 tests):
  - 11 canonical routes (`/`, `/items`, `/purchase-orders`, `/disbursement-tickets`, `/po-tickets`, `/leave-orders`, `/logs`, `/units`, `/destinations`, `/providers`, `/settings`).
  - Hierarchical category route (`/items/category/5`).
  - Hierarchical subcategory route (`/items/category/5/subcategory/12`).
  - URL query parameters driving search and highlight without `sessionStorage`.
  - Route builder contract for parameter and query serialization.
  - Route persistence on page refresh simulation.
- **Tier 1.2: Horizontal TopNavBar & In-App Back Navigation (F1, F3)** (6 tests):
  - Role-filtered navigation dropdown groups (Office vs Warehouse vs Admin).
  - Compact cloud sync indicator icon without persistent text pill.
  - Arabic cloud sync tooltip ("متصل بالسحابة" / "غير متصل").
  - In-app back button hidden at root (history index 0).
  - In-app back button visible on navigation and triggers `navigate(-1)`.
  - RTL-aware back button orientation.
- **Tier 1.3: Standardized PageLayout Wrapper & Action Slot (F6, F7, F8, F9)** (5 tests):
  - Single authoritative `<h1>` validation.
  - Rejection of duplicate `<h1>` tags in page body.
  - Standardized fixed primary action slot in header (`mr-auto` RTL placement).
  - Hoisting "Add Main Category" card from grid into standard header button.
  - Non-empty page title validation.
- **Tier 1.4: LibSQL Connection Pooling Mechanics (F10, F11, F12)** (6 tests):
  - Warm connection acquisition and reuse without re-establishing TLS sockets.
  - Bounded connection pool capacity up to `max_size`.
  - Local SQLite isolation bypassing pool for test isolation.
  - Eviction of idle connections exceeding `max_idle_seconds`.
  - Clean `close_all` teardown on server shutdown.
  - Timestamp update on connection release.
- **Tier 1.5: Optimistic UI Cache Updates & Modal Unblocking (F14, F15, F16)** (5 tests):
  - Instant optimistic item creation with temporary ID.
  - Instant item quantity adjustment in cache.
  - Instant purchase order draft creation.
  - Instant ticket fulfillment and badge count decrement.
  - Modal unblocking: dialog closes immediately upon dispatch without blocking spinners.
- **Tier 1.6: Generic Table Component, Skeletons & Alignment (F18, F19)** (5 tests):
  - Column text alignment mapping (`right`, `center`, `left`).
  - Default 5-row pulsing skeleton rendering when `isLoading = true`.
  - Integrated empty state rendering when `data.length === 0`.
  - Accurate pagination range and item offset calculation.
  - Final page clamp calculation.
- **Tier 1.7: Brand Green Palette, CSS & Numeral Standards (F17, F20, F21, F13)** (5 tests):
  - Primary brand token centered at logo green `#1E7D46` (`primary-600`).
  - Royal violet (`#4B1E78`) deprecated from primary CTAs.
  - Absence of legacy CSS utility classes (`.btn`, `.card`, `.table`, `.input`, `.badge`).
  - Strict Western Arabic numeral enforcement (`0-9`), rejecting Eastern Arabic numerals.
  - Adaptive polling intervals configured to >= 30s active / >= 60s idle.

### 4.2 Tier 2: Boundary & Corner Cases (15 Tests)
- Trailing slashes and redundant path normalization.
- Non-numeric category ID in URL fallback to `/items`.
- Excessively deep nested route truncation defense.
- Unauthorized direct route access redirection to default route.
- Custom empty state action callback execution with 0 rows.
- Negative or zero skeleton row count graceful fallback to default 5.
- Pagination bounds when total items is 0.
- Pagination clamp when requesting page index beyond total pages.
- Complete rollback of optimistic item creation on HTTP 500 error.
- Quantity adjustment rollback on network timeout without drift.
- Ticket fulfillment rollback restoring pending count on failure.
- Connection pool exhaustion defense and error throwing.
- Releasing connections unblocking pending pool acquisitions.
- Rapid back navigation when history is empty is an idempotent safe no-op.
- Strict rejection of mixed strings containing Eastern Arabic numerals.

### 4.3 Tier 3: Cross-Feature Combinations (8 Tests)
- In-flight optimistic mutations preserved across route navigation hops.
- Declarative URL search query and highlight parameters driving table filtering and row highlight.
- Dynamic role switching reconfiguring TopNavBar groups and redirecting forbidden active paths.
- Table layout stability across loading skeleton -> loaded data -> empty state transitions.
- Multi-tier category drill-down history stack enabling step-by-step in-app back navigation.
- Polling heartbeat pause on hidden tab visibility coordinating with optimistic cache.
- Flask request lifecycle connection acquisition and safe release on teardown.
- Cloud sync offline transition updating TopNavBar indicator and gating stock mutations.

### 4.4 Tier 4: Real-World Scenarios (5 Comprehensive End-to-End Journeys)
- **Scenario 1:** Warehouse Keeper Inventory Inspection, Category Drill-down, and Stock Adjustment.
- **Scenario 2:** Office Clerk Purchase Order Draft Creation & Table Verification.
- **Scenario 3:** Warehouse Receiving Clerk POTicket Matching & In-App Navigation.
- **Scenario 4:** Administrator Master Data Management with Aligned Tables & Breadcrumbs.
- **Scenario 5:** Network Disruption & Optimistic Error Recovery Journey.

---

## 5. Verification Commands & Quality Gates

### Running All Automated Tests:
```bash
cd UI && npm test
```

### Running Specific Test Suites:
```bash
# UX Overhaul E2E Suite (66 tests)
cd UI && node --test --experimental-strip-types 'tests/e2e_ux_overhaul.test.ts'

# Legacy Requirements E2E Suite (63 tests)
cd UI && node --test --experimental-strip-types 'tests/e2e_requirements.test.ts'
```

### Type Checking & Linting:
```bash
cd UI && npx tsc --noEmit
cd UI && npm run lint
```

### Production Build:
```bash
cd UI && npm run build
```

### Backend Test Suite:
```bash
.venv/bin/pytest tests/ -v
```

---

## 6. Maintenance & Extensibility Protocol

- When modifying or adding routes, update `CANONICAL_PAGE_ROUTES` in `UI/tests/e2e_ux_overhaul.test.ts` and ensure corresponding canonical paths are covered.
- When new mutations are added, implement optimistic snapshotting, rollback, and selective invalidation assertions.
- Maintain strict typing: zero `any` types and zero `eslint-disable` additions.
- Ensure all test assertions remain fully deterministic with zero reliance on non-deterministic sleeps or live cloud network calls.
