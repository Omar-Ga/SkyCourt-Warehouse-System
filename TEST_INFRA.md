# SkyCourt Warehouse System — E2E Testing Infrastructure & Methodology (`TEST_INFRA.md`)

**Date:** 2026-09-13  
**Status:** Active & Authoritative  
**Target:** Frontend (`UI/`) & Full-Stack System Verification  
**Workspace Root:** `/home/omar/Code Projects/SkyCourt-Warehouse-System`  

---

## 1. Test Philosophy: Requirement-Driven Opaque-Box Testing

The SkyCourt Warehouse System is an Arabic-first (RTL) desktop application serving non-technical warehouse operators, office clerks, and administrators. The frontend (`UI/`) is powered by React 18, TypeScript, and TanStack React Query v5, served inside a PyWebView desktop container backed by a remote LibSQL cloud database.

To ensure long-term stability and rapid verifiable iteration across multi-agent development workflows, the E2E testing track follows a **strict requirement-driven opaque-box testing philosophy**:

1. **Opaque-Box Verification (Black-Box / Contract Testing):**
   - Tests do **not** depend on internal component implementation details, private React hook state, DOM layout quirks, or fragile CSS selectors.
   - Tests evaluate system behavior from the perspective of external contracts, user requirements, and observable state transitions.
   - When a user selects a filter chip, triggers a breadcrumb hop, or switches roles, tests verify that the resulting data models, navigation trees, and error contracts match the specification exactly.

2. **Progressive Testability:**
   - Tests are decoupled from DOM rendering engines (such as `jsdom` or browser instances) by modeling business rules, state machines, permissions, and data transformers as pure, exportable TypeScript abstractions.
   - Tests are runnable and verifiable at any stage of milestone completion without waiting for downstream visual styling.

3. **Deterministic & High-Speed Execution:**
   - Tests run natively via the Node.js test runner (`node:test`) with `--experimental-strip-types` and `node:assert/strict`.
   - The entire test suite executes in under **200 milliseconds**, enabling instant feedback on every commit or agent dispatch.

4. **Zero-Tolerance Quality & Type Safety:**
   - Test suites enforce strict TypeScript hygiene: **zero `any` types** (using strict interfaces, `unknown`, or generic types) and **zero `eslint-disable` additions**, ensuring full compliance with the repository's ESLint 9 configuration.

---

## 2. Feature Inventory Mapping

Every feature defined in `PROJECT.md` is mapped to its testing domain, tier level, and verification target:

| Feature ID | Feature Name | Requirement Source | Testing Domain | Target Suite |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | Grouped Sidebar Navigation | ORIGINAL_REQUEST R1, Survey 1 | Navigation & RBAC | `UI/tests/e2e_requirements.test.ts` |
| **F2** | Responsive / Collapsible Sidebar | ORIGINAL_REQUEST R1, Survey 1 | Navigation Layout & Rail | `UI/tests/e2e_requirements.test.ts` |
| **F3** | Multi-Tier Breadcrumbs | ORIGINAL_REQUEST R1, Survey 1 | Breadcrumb State Engine | `UI/tests/e2e_requirements.test.ts` |
| **F4** | Role-Based Access Control Pruning | ORIGINAL_REQUEST R3, Survey 1 | Navigation & Security | `UI/tests/e2e_requirements.test.ts` & `UI/tests/navigation.test.ts` |
| **F5** | Automated Navigation & Breadcrumb Tests | Acceptance Criteria, Survey 3 | Test Infrastructure | `UI/tests/e2e_requirements.test.ts` |
| **F6** | Reusable Empty State Component | ORIGINAL_REQUEST R2, Survey 2 | Visual Ergonomics | `UI/tests/e2e_requirements.test.ts` |
| **F7** | Upgraded Table Empty States | ORIGINAL_REQUEST R2, Survey 2 | Data Display Contracts | `UI/tests/e2e_requirements.test.ts` |
| **F8** | Inventory Status Filter Chips | ORIGINAL_REQUEST R2, Survey 2 | Inventory Filtering | `UI/tests/e2e_requirements.test.ts` |
| **F9** | Order Status Filter Tabs & Badges | ORIGINAL_REQUEST R2, Survey 2 | Orders & Tickets | `UI/tests/e2e_requirements.test.ts` |
| **F10** | Touch-Friendly Action Controls | ORIGINAL_REQUEST R2, Survey 2 | Ergonomics & Sizing | `UI/tests/e2e_requirements.test.ts` |
| **F11** | Inline Line-Item Form Validation | ORIGINAL_REQUEST R2, Survey 2 | Form Mistake Prevention | `UI/tests/e2e_requirements.test.ts` |
| **F12** | Real-Time Stock Headroom Validation | ORIGINAL_REQUEST R2, Survey 2 | Form Mistake Prevention | `UI/tests/e2e_requirements.test.ts` |
| **F13** | Lint & Type Hygiene Remediation | Acceptance Criteria, Survey 3 | Quality & Build | `npm run lint` & `npx tsc --noEmit` |
| **F14** | Comprehensive E2E Test Suite | Project Pattern, Survey 3 | E2E Architecture | `UI/tests/e2e_requirements.test.ts` |

---

## 3. Test Architecture & Runner Specification

### 3.1 Test Runner Infrastructure
- **Engine:** Native Node.js Test Runner (`node:test`)
- **Assertion Framework:** `node:assert/strict` (strict value, deep object, and regex validation)
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
1. `UI/tests/apiClient.test.ts` (13 tests) — Session epoch isolation, CSRF tokens, automatic idempotency key attachments, 401/409 error handling.
2. `UI/tests/freshness.test.ts` (5 tests) — Actionable ticket polling contracts, sync status, ticket badge fallback logic, UTC-to-Cairo datetime transformations.
3. `UI/tests/navigation.test.ts` (6 tests) — Page catalog (`PAGES`), flat permissions matrix, role capabilities, page ID normalization.
4. `UI/tests/optimisticCategory.test.ts` (2 tests) — TanStack Query cache updates and query isolation for main and subcategories.
5. `UI/tests/poService.test.ts` (4 tests) — Purchase order draft generation, filter parameter serialization, revision-aware payloads.
6. `UI/tests/e2e_requirements.test.ts` (NEW) — The comprehensive 4-Tier E2E requirement suite verifying navigation grouping, breadcrumbs, filter chips, empty states, and validation rules.

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

### 4.1 Tier 1: Feature Coverage (Core Requirements)
Covers the primary behavioral contracts (≥5 test cases per feature domain):

1. **Navigation Grouping & Hierarchy (F1, F4):**
   - 4 logical visual groups: `stockOperations` (عمليات المخزون), `ordersDocuments` (الأوامر والمستندات), `masterData` (البيانات الأساسية), `systemReports` (النظام والتقارير).
   - Pruning empty groups: `office` role prunes Master Data (0 items); `warehouse` role prunes Orders & Documents (0 items).
   - Full access: `admin` role resolves all 4 groups with all 11 pages.
   - Canonical page metadata: labels, icons, and descriptions resolve correctly.
   - Dynamic page title mapping (e.g. "دليل الأصناف" for office vs "إدارة الأصناف" for warehouse).

2. **Breadcrumb State Machine (F3):**
   - Initial state starts at root level (`mainCategories`) with non-clickable root label.
   - Selecting a main category navigates to `subCategories` and makes root clickable.
   - Selecting a subcategory navigates to `items` and produces a 3-tier trail.
   - Single-click on main category crumb navigates back to `subCategories` and clears leaf.
   - Single-click on root crumb resets view level to `mainCategories` and clears all selections.

3. **Status Filter Chips & Tabs (F8, F9):**
   - Stock filter predicates:
     * `all`: returns all items without filtering.
     * `in_stock`: items where `current_quantity > 5`.
     * `low_stock`: items where `0 < current_quantity <= 5`.
     * `out_of_stock`: items where `current_quantity <= 0`.
     * `inactive`: items where `status !== 'active'`.
   - Order filter predicates for POs (`draft`, `open`, `expired`, `closed`, `void`).
   - Order filter predicates for Leave Orders (`open`, `rejected`, `partially_returned`, `closed`, `cancelled`).

4. **Empty State Contracts (F6, F7):**
   - Descriptors contain clear Arabic title, explanatory description, and primary action.
   - Distinct empty state descriptors for:
     * Category view (main category list empty).
     * Subcategory view (no subcategories under selected category).
     * Items view (empty catalog vs filter with no matches).
     * Purchase orders (zero orders vs zero filtered results).
     * Leave orders (zero orders vs zero filtered results).

5. **Inline Validation & Stock Headroom Cues (F11, F12):**
   - Item line validation: item selection required, quantity must be > 0.
   - Real-time stock headroom calculation: available stock vs requested quantity.
   - Inline visual cue descriptor: warning flag when quantity exceeds stock headroom.
   - Line-item total calculation and price formatting.
   - Prevention of duplicate items within the same order lines.

### 4.2 Tier 2: Boundary & Corner Cases
Ensures robust error prevention under extreme, unexpected, or empty inputs (≥5 test cases per domain):

1. **Navigation Boundaries:**
   - Unauthenticated or `null` role returns empty navigation list.
   - Unknown or invalid role strings return empty groups without throwing.
   - Case-insensitive role normalization (`WAREHOUSE`, `Office`, ` Admin `).
   - Missing page items in group definition do not crash group resolver.
   - Single-item group resolves without structural degradation.

2. **Breadcrumb Boundaries:**
   - Navigation to current active level is a safe no-op.
   - Navigation to target level with null selections degrades gracefully to root.
   - Category names with special characters, punctuation, and Arabic diacritics.
   - Extremely long category names (e.g. >100 characters) do not break state trail.
   - Re-selecting another main category while deep in items level resets subcategory state cleanly.

3. **Filter Logic Boundaries:**
   - Exact boundary thresholds: quantity = 0 (`out_of_stock`), quantity = 5 (`low_stock`), quantity = 6 (`in_stock`).
   - Negative inventory values (corrupt data defense) classify as `out_of_stock`.
   - Floating-point quantities (e.g. 5.0001 vs 4.9999) evaluate strictly.
   - Empty item collections return empty arrays across all filter chips without error.
   - Filter queries with whitespace or mixed Arabic casing match correctly.

4. **Empty State Boundaries:**
   - Empty state components render valid defaults when optional fields (`description`, `actionLabel`, `onAction`) are omitted.
   - Filter reset action is provided only when active filter is not `all`.
   - Empty state action callback execution does not throw if invoked multiple times.
   - Handling of null icons and custom styling class strings.

5. **Validation Boundaries:**
   - Quantity of exactly 0 is flagged as invalid.
   - Quantity equal to exact available stock headroom is valid (0 remaining headroom).
   - Quantity exceeding stock by exactly 1 unit triggers headroom error.
   - Line items array with 0 items is rejected.
   - Multiple lines requesting the same item aggregate total demanded quantity against stock headroom.

### 4.3 Tier 3: Cross-Feature Interactions
Validates state transitions and invariants across multiple cooperating modules:

1. **Role Switching & Navigation State Isolation:**
   - When a user session changes from `warehouse` to `office`, active page and navigation groups must immediately re-prune. If the previous page was `Units` (unauthorized for office), state resets to `Dashboard`.
2. **Breadcrumb Drill-Down Combined with Status Filter Chips:**
   - Filtering by `low_stock` while at items level, then clicking main category breadcrumb resets view to `subCategories` while preserving filter state for subsequent item views.
3. **Filter Tab Selection Combined with Empty State Triggers:**
   - An items list with 50 items has 0 `out_of_stock` items. Clicking `out_of_stock` filter chip transitions table into "Filtered Zero State" with a "Reset Filter" action button, NOT "Create New Item".
4. **Multi-Line Order Headroom Aggregation:**
   - A leave order contains two separate line items for the same item ID (e.g. standard packaging + loose units). The stock headroom validation must evaluate total demanded quantity across all lines against single available warehouse stock.

### 4.4 Tier 4: Real-World Scenarios
Simulates realistic daily operator workflows end-to-end:

1. **Scenario 1: Warehouse Keeper Morning Inventory Inspection:**
   - Log in as `warehouse` -> Verify sidebar groups (Stock Operations, Master Data, System Reports; Orders hidden) -> Navigate to Items -> Select "إلكترونيات" -> Drill down to "شاشات" -> Apply "رصيد منخفض" filter -> Inspect items -> Click "إلكترونيات" breadcrumb to return -> Select "كابلات" -> Confirm return.
2. **Scenario 2: Office Clerk Leave Order Dispatch & Stock Check:**
   - Log in as `office` -> Verify sidebar groups (Stock Operations, Orders & Documents, System Reports; Master Data hidden) -> Navigate to Leave Orders -> Filter tabs -> Create new order with 2 line items -> Attempt line exceeding stock -> Validation warning appears -> Adjust quantity -> Confirm valid payload.
3. **Scenario 3: Administrator Master Data Configuration & Audit Trail:**
   - Log in as `admin` -> All 4 groups available -> Access Master Data -> Navigate between Units and Providers -> Navigate to System Logs -> Confirm audit trail accessibility.
4. **Scenario 4: Warehouse Tablet Touch Ergonomics & Responsive Rail:**
   - Toggle sidebar collapse state -> Width transitions from `w-68` (272px) to `w-20` (80px) -> Navigation links remain touch-friendly icon targets (min 44px) -> Verify row actions satisfy touch ergonomics standards.

---

## 5. Verification Commands & Execution Guide

### Running Automated Test Suites:
```bash
# Run all frontend tests (fast Node runner)
cd UI && npm test

# Run the E2E requirement suite specifically
cd UI && node --test --experimental-strip-types 'tests/e2e_requirements.test.ts'
```

### Running Type Check & Linting:
```bash
# TypeScript type check (src/ & vite.config.ts)
cd UI && npx tsc --noEmit

# Linting check
cd UI && npm run lint
```

### Full Production Build:
```bash
cd UI && npm run build
```

---

## 6. Maintenance & Extensibility Protocol

- When new UI features or modal dialogs are created, add corresponding requirement contracts to `UI/tests/e2e_requirements.test.ts` under the relevant tier.
- Maintain strict typing: any new test helper or mock must define explicit TypeScript interfaces without using `any`.
- Keep assertions deterministic and fast: avoid `setTimeout` or arbitrary sleeps; use synchronous state transition models.
