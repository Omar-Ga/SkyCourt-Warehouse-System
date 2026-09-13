# SkyCourt Warehouse System
# Pre-Production Architectural & Resilience Audit

**Audit date:** 2026-09-13  
**Target:** PyWebView + Flask + React/Vite + Turso/LibSQL cloud deployment  
**Scope:** `app/`, `database/`, `UI/src/`, `tests/`, `UI/tests/`, `run.py`, and the architecture/domain documents named by the work order  
**Auditor:** GPT-5.6 Sol High (OpenCode)

## 1. Executive Summary

### Verdict: NO-GO

The system has several sound foundations: conditional stock arithmetic, reservation-aware deductions, request-scoped Flask connections, session-bound CSRF, role decorators, canonical idempotency hashes, and transactional movement-log insertion. Those controls are not sufficient for production because the deployment boundary is not fail-closed and several workflows can lose audit fidelity or replay an uncertain mutation.

The release must not proceed to general production rollout until the Critical findings are corrected and the High release-gate tests pass against a real LibSQL/Turso-compatible environment. The most serious blockers are:

- Production can silently fall back to local in-memory SQLite and report successful mutations that are not durable in the authoritative database.
- The staging rehearsal command can run migrations against the configured live connection.
- Migration 003 fabricates Leave Order fulfillment and discards the meaning of legacy open tickets without corresponding stock or audit events.
- Stock adjustment idempotency is optional at the API boundary, and the UI generates a new key for retries after uncertain failures.
- Offline gating covers selected stock mutations but not all order lifecycle mutations.
- Movement-log append-only behavior is not enforced at the database boundary.

**Confidence:** High for source-confirmed code findings; medium for remote-driver behavior and production performance because no live Turso test was executed. The worktree was already substantially dirty before this audit. Existing changes were not reverted or modified except for adding this report.

## 2. Audit Method

- Read `CONTEXT.md`, `AGENTS.md`, `PROJECT.md`, and the complete work order before code review.
- Used the existing Graphify graph as a bounded navigation aid, then verified consequential findings against current source and tests. The graph should be treated as a navigation hint because the checkout contains many uncommitted and untracked files.
- Inspected Flask routes, services, models, validation, authentication, migrations, schema, staging tooling, React hooks/components/pages/services, and automated tests.
- Ran the available frontend tests, lint, production build, TypeScript check, and Python AST compilation.
- Attempted the backend test suite; the environment does not have `pytest` installed, so backend behavior was not executable in this environment.
- No live Turso/LibSQL mutation, concurrent remote test, desktop/PyWebView test, browser E2E test, or production-like migration rehearsal was executed.

## 3. Key Strengths

### Safety and persistence

- `app/models/item_model.py:131-179` uses conditional SQL for additions and removals. Removal checks `current_quantity - reserved_quantity >= ?`, protecting non-negative available stock under a single atomic update.
- `app/services/leave_order_service.py:47-54` reserves stock conditionally and checks the affected row count.
- Leave fulfillment deducts current and reserved quantities together and records a Removal movement log in the same caller transaction (`app/services/leave_order_service.py:101-115`).
- Multi-line services generally share one connection and roll back when an operation fails.
- `app/services/idempotency_service.py:48-115` canonicalizes request payloads and detects key reuse with a different operation type, actor, or payload.
- The schema has a uniqueness guard for `(operation_key, item_id, action_type)` (`database/schema.sql:281-282`).
- Flask teardown rolls back unfinished request work and closes request-owned connections (`app/models/db_utils.py:434-449`).
- Foreign keys are enabled on connections (`app/models/db_utils.py:385-390`, `database/schema.sql:4`).

### Security and authorization

- Protected routes consistently use `@require_role`; authentication re-resolves the user and role from the database on each protected request (`app/auth.py:187-221`).
- Passwords use Werkzeug hashing and public user responses do not expose password hashes.
- Session-version changes invalidate old sessions.
- CSRF and allowed-origin checks cover state-changing API requests (`app/main.py:100-113`).

### Frontend and operator experience

- The UI has a clear Arabic RTL baseline (`UI/src/App.tsx:70-75`, `UI/src/index.css:14-23`).
- Navigation has explicit role permissions, direct-navigation guards, canonical page normalization, and empty-group pruning (`UI/src/navigation.ts:31-95`, `UI/src/navigation.ts:263-294`).
- React Query provides authentication-aware queries, stale times, placeholder data for list navigation, and targeted invalidation after several mutations.
- Modal focus capture, focus restoration, Escape handling, focus wrapping, and modal-stack dismissal are implemented (`UI/src/components/Modal.tsx:81-177`).
- Create PO and Leave Order flows already persist uncertain submissions and reuse their stored keys (`UI/src/components/CreatePOModal.tsx:302-399`, `UI/src/components/CreateLeaveOrderModal.tsx:246-314`).

## 4. Identified Risks

## CRITICAL: Showstoppers

### C1. Local SQLite fallback violates the authoritative-writer invariant

**Locations:** `app/models/db_utils.py:375-416`; `app/models/db_utils.py:50-75`; `app/services/item_service.py:183-244`; `app/routes/items_routes.py:96-132`, `277-313`.

**Risk mechanism:** If `libsql` is unavailable, `create_connection()` logs a warning and returns an in-memory SQLite connection. Explicit local `.db`, `.sqlite`, path, and `:memory:` targets are also accepted. `check_stock_mutation_allowed()` only checks offline flags and connection markers; it does not positively verify that a connection is an authenticated remote LibSQL connection. `add_item()` does not call the gate at all, and item adjustment routes allow the fallback connection to mutate.

**Impact:** A production workstation missing the driver, credentials, or correct target can report successful inventory changes that disappear on process exit or diverge from Turso. `get_sync_status()` can claim cloud mode while the actual write is local. This is direct data loss and violates `CONTEXT.md:24-29` and `AGENTS.md:5-10`.

**Remediation:** Remove the production fallback. Allow local SQLite only behind an explicit test-only configuration. Require a positively identified authenticated remote connection for every stock and order mutation; fail with HTTP 503 for missing driver, missing credentials, local target, or unavailable cloud. Gate initial item creation and every lifecycle mutation. Derive status from the actual connection mode. Add fail-closed tests for all of these conditions.

### C2. Staging rehearsal can migrate the configured live database

**Locations:** `app/staging.py:469-517`; `app/main.py:323-339`; `app/models/db_utils.py:419-431`.

**Risk mechanism:** `rehearse_staging_migration(conn)` takes an in-memory snapshot, validates a restored copy, and then calls `run_migrations(conn, ...)` on the original connection. The CLI obtains that connection through ordinary `get_db()`, which resolves to the configured database. No disposable-target check, production identity refusal, read-only source mode, environment guard, or explicit confirmation is enforced.

**Impact:** Running a command named `staging-rehearsal` against production can apply schema migrations to the authoritative database. The in-memory backup is not an operational rollback mechanism for a remote database.

**Remediation:** Require a separate staging target or verified disposable clone. Refuse to run when source and staging identities match, when the environment marker is absent, or when the target is not explicitly supplied. Inspect the source read-only and apply migrations only to the clone. Verify source schema version, IDs, row counts, balances, audit rows, and settings are unchanged.

### C3. Migration 003 fabricates Leave Order fulfillment and loses operational history

**Locations:** `database/migrations/003_digital_two_operator_workflow.sql:137-172`.

**Risk mechanism:** Every legacy Leave Order with status `open` is migrated to `closed` (`:141-144`). Every legacy line is migrated with `requested_quantity = quantity`, `dispensed_quantity = quantity`, and the existing `returned_quantity` (`:166-172`). No warehouse actor, fulfillment timestamp, stock deduction, Removal log, reservation release, or operation record is created. PO expiry and dispatch values are also reconstructed from `created_at` (`:66-74`) rather than preserving authoritative legacy values.

**Impact:** Existing tickets can appear fully fulfilled and closed while inventory and the immutable audit trail contain no corresponding execution. This is silent historical corruption and may cause incorrect return eligibility.

**Remediation:** Preserve legacy status and quantities unless a verified mapping exists. Use an explicit reconciliation state for ambiguous records and block unsafe workflow actions. Preserve timestamps and actor fields. Do not fabricate movement or actor records. Test migration on representative open, closed, rejected, partially processed, returned, and expired data while comparing all balances, statuses, quantities, timestamps, IDs, foreign keys, and audit rows.

### C4. Stock-adjustment idempotency is optional on the backend

**Locations:** `app/routes/items_routes.py:96-132`, `277-313`; `app/services/item_service.py:107-167`, `170-244`.

**Risk mechanism:** The item-create and stock-adjustment routes reserve and complete an operation only when an idempotency header is present. Missing keys are accepted, and service functions accept `operation_key=None`. A request that committed but lost its response can therefore be retried without a key and execute another stock update and movement log.

**Impact:** Duplicate additions/removals are possible from retries, double-clicks, or client failures. Conditional stock arithmetic prevents negative balances but does not prevent duplicate business execution.

**Remediation:** Require `Idempotency-Key` for every client-initiated stock-affecting request, reject missing keys before mutation, and enforce this again in service APIs. Persist the canonical payload, actor, operation type, and resource identity. Test lost responses, missing-key retries, concurrent duplicates, payload/actor conflicts, and process restart.

### C5. Offline gating is incomplete for order lifecycle mutations

**Locations:** `app/services/purchase_order_service.py:122-257`; `app/services/leave_order_service.py:124-197`; `app/main.py:100-113`.

**Risk mechanism:** The gate is called for PO receipt, Leave Order creation, fulfillment, and return, but not consistently for PO creation, edit, dispatch, void/expiry, Leave Order rejection, resubmission, or cancellation. The global hook validates CSRF/origin only.

**Impact:** During offline or non-authoritative operation, order state can still be changed even though `CONTEXT.md:26` explicitly makes order lifecycle changes online-only. This can leave workflow state out of sync with cloud stock state.

**Remediation:** Centralize authoritative-online mutation authorization and apply it to every order POST/PUT/PATCH/DELETE. Add a mutation classification table and parameterized tests for every endpoint under offline mode, missing driver, missing credentials, local target, timeout, and remote 503.

## HIGH

### H1. PO receipt cannot represent a short/final receipt

**Locations:** `app/routes/order_routes.py:126-137`; `app/services/purchase_order_service.py:260-299`; `database/schema.sql:135-151`.

**Risk mechanism:** The service rejects any receipt payload containing `items` with `PARTIAL_RECEIPT_NOT_ALLOWED` and then receives every positive ordered quantity. The schema permits zero ordered quantities and has no disposition state for received versus struck-off lines.

**Impact:** Warehouse staff cannot record a short delivery and line-out the missing quantity. The system either rejects the real receipt or falsely records the full order as received.

**Remediation:** Accept a complete, exactly-once outcome for every PO line. Validate received quantities against ordered quantities, persist immutable disposition/outcome data, and close atomically with movement logs. Add tests for short, zero, over, omitted, duplicate, and concurrent receipts.

### H2. Required Leave Order manual-close workflow is missing

**Locations:** `app/routes/order_routes.py:243-288`; `app/services/leave_order_service.py:232-233`; `database/schema.sql:158-179`.

**Risk mechanism:** No close endpoint is registered. `close_leave_order_service()` always raises `Manual leave-order close is not supported`. Automatic full-return handling changes status but does not record the required closure actor, timestamp, or reason.

**Impact:** The documented distinction between fully returned, manually closed with outstanding units, and late-return tickets cannot be represented. Office operators cannot complete the required workflow without incorrectly using another state.

**Remediation:** Implement the canonical close endpoint with role checks, revision checks, idempotency, and a required nonblank reason when outstanding units remain. Record actor/time/reason, preserve outstanding quantities without adding stock, support bounded late returns without reopening, and record automatic full-return closure metadata.

### H3. RBAC documentation and route behavior are inconsistent

**Locations:** `app/routes/order_routes.py:170-204`; `docs/specs/two-operator-overhaul-spec.md:122-136`, `260-267`; `CONTEXT.md:17-20`.

**Risk mechanism:** `CONTEXT.md` says Office initiates Leave Orders and the implementation allows Office creation (`:170-182`). The two-operator specification cited by the existing test/audit material instead assigns creation differently and expects shared ticket views, while `/api/tickets` is Warehouse-only (`:187-204`).

**Impact:** Operators, UI capabilities, tests, and API consumers can receive contradictory permissions. Navigation pruning is not a substitute for backend authorization.

**Remediation:** Resolve the product contradiction and publish one authoritative method/path/role matrix. Align route decorators, service capabilities, UI navigation, and tests. Cover Office, Warehouse, Admin, inactive users, and unauthenticated callers for every endpoint.

### H4. Some concurrent Leave Order transitions ignore affected-row counts

**Locations:** `app/services/leave_order_service.py:124-140`, `146-175`, `200-226`.

**Risk mechanism:** Rejection, resubmission, and return perform conditional parent updates but do not consistently verify `rowcount`. Rejection can insert an event after a zero-row parent update. Resubmission deletes/replaces lines and reserves stock while its parent update result is not checked.

**Impact:** A stale revision or competing transaction can produce events, reservations, child rows, or completed idempotency state that does not correspond to the parent order state.

**Remediation:** Require exactly one affected row for every conditional transition, include expected state as well as revision, and raise 409 on zero rows. Keep parent, child, reservation, return-event, movement-log, and operation changes in one rollback scope. Add concurrency tests for reject/reject, reject/resubmit, return/close, and return/return.

### H5. Transaction retry helper is not used by business mutations

**Locations:** `app/models/db_utils.py:473-519`; `app/services/item_service.py:107-244`; `app/services/purchase_order_service.py:122-299`; `app/services/leave_order_service.py:23-229`.

**Risk mechanism:** `run_in_transaction()` implements bounded retries, but business services perform direct transactions and do not use it. Transient remote stream, busy, and lock failures can surface directly and prompt unsafe client retries.

**Impact:** Avoidable failed operations and uncertain commit outcomes are more likely, especially over the Turso network. Blindly adding the helper would itself be unsafe because it currently retries commit exceptions as if no commit occurred.

**Remediation:** Route complete mutations through one transaction runner, retry only classified pre-commit transient failures, and reconcile operation state before replaying after uncertain commit outcomes. Add injected failures at every stage and two-connection concurrency tests.

### H6. Movement-log append-only behavior is not enforced at the database boundary

**Locations:** `database/schema.sql:245-282`; `database/migrations/003_digital_two_operator_workflow.sql:216-262`; `scripts/seed_fake_data.py:330-366`, `834-844`.

**Risk mechanism:** No `BEFORE UPDATE` or `BEFORE DELETE` triggers protect `movement_logs`. The seed cleanup path deletes movement logs using a normal application connection and has no production-identity guard.

**Impact:** A database credential or maintenance command can alter or purge the audit trail, contradicting `CONTEXT.md:28`. Application routes not exposing edits is insufficient protection for an audit invariant.

**Remediation:** Add database-level update/delete rejection triggers. Remove log deletion from normal utilities. If retention is required, use a separate audited archival process and credential. Make seeding refuse remote/production targets. Test direct SQL tampering and maintenance commands.

### H7. Provider/category deletion semantics can silently erase historical references

**Locations:** `database/schema.sql:64-72`, `266-272`; `app/models/provider_model.py:49-65`; `app/models/category_model.py:104-119`.

**Risk mechanism:** Item provider/category and provider movement-log references use `ON DELETE SET NULL`, while application-level preflight checks are raceable and do not protect direct SQL or maintenance operations.

**Impact:** A provider or category reference can disappear from active items or audit records, weakening traceability and violating the stated referential-integrity policy.

**Remediation:** Use `ON DELETE RESTRICT` where references must remain. Make deletion and final constraint enforcement transactional, preserve immutable snapshots where needed, and test insert-versus-delete races against the real engine.

### H8. Migration ownership and schema-chain validation are insufficient

**Locations:** `app/migrations.py:163-253`, `256-276`.

**Risk mechanism:** There is no authoritative migration lock. Two workstations can observe the same pending migration. `verify_schema_version()` checks only `MAX(version)`, so a database with version 3 recorded but version 1 or 2 missing can pass compatibility checks.

**Impact:** Concurrent startup/deployment can race schema changes, and a damaged or incomplete migration history can be accepted as compatible.

**Remediation:** Run migrations through one controlled owner or an authoritative lock. Reject gaps, duplicates, unexpected names, and incomplete version chains. Test concurrent runners, interruption, rollback, and recovery.

### H9. Backend error responses expose raw database details

**Locations:** `app/main.py:148-185`, `252-262`; `app/routes/items_routes.py:327-341`.

**Risk mechanism:** Database-unavailable, offline, value, and manual-sync paths place `str(error)` in response fields. Driver errors may include endpoint details, SQL, schema names, or service response content.

**Impact:** Internal deployment and database information can reach clients and logs/UI. It also makes client behavior dependent on unstable driver text.

**Remediation:** Log detailed exceptions server-side with correlation IDs and return stable safe codes/messages only. Add assertions that SQL, URLs, tokens, schema, and driver internals never appear in API responses.

### H10. UI retries can replay stock or lifecycle mutations with new keys

**Locations:** `UI/src/services/apiClient.ts:102-110`; `UI/src/components/AdjustQuantityModal.tsx:116-160`; `UI/src/pages/DisbursementTickets.tsx:25-51`; `UI/src/components/PODetailModal.tsx:39-52`; `UI/src/components/LeaveOrderDetailModal.tsx:115-188`; `UI/src/services/itemsService.ts:65-72`.

**Risk mechanism:** `apiClient` creates a key per HTTP request, and several handlers generate a key at click time. After a committed-but-lost response, a retry uses a different key. Item update/status/restore and some PO actions do not consistently preserve an operation key.

**Impact:** Server-side idempotency cannot identify the retry. Revision checks reduce duplicate lifecycle transitions in some cases but do not replace idempotency for stock adjustments.

**Remediation:** Model each operation as a persisted `{key, payload, target}` created once before the first request and reused until the outcome is certain. Preserve it across modal errors, close/reopen, and reload where practical. Add lost-response and key-reuse tests for every mutating flow.

### H11. Production UI tests are mostly duplicate reference-model tests, not UI tests

**Locations:** `UI/tests/e2e_requirements.test.ts:124-157`, `181-253`, `274-479`.

**Risk mechanism:** The purported opaque-box suite reimplements navigation, breadcrumb, filter, empty-state, and validation logic locally. It does not import production components and has no browser, React DOM, Playwright, Cypress, or Testing Library coverage.

**Impact:** The suite can pass while actual Sidebar, pages, modal event wiring, error states, and rendering are broken. It does not detect the dashboard PO detail crash or the missing inactive filter.

**Remediation:** Import production pure utilities directly and add component/browser tests that render actual pages under each role and interact with them. Cover submission errors, focus, RTL layout, pending mutation dismissal, filter behavior, and touch controls.

### H12. Query cancellation and search load are inadequate for cloud latency

**Locations:** `UI/src/pages/PurchaseOrders.tsx:25-35`; `UI/src/pages/LeaveOrders.tsx:15-26`; `UI/src/pages/DisbursementTickets.tsx:9-17`; `UI/src/hooks/usePurchaseOrders.ts:24-39`; `UI/src/hooks/useLeaveOrders.ts:28-45`, `152-165`; `UI/src/services/poService.ts:111-129`; `UI/src/services/leaveOrderService.ts:69-87`, `169-186`.

**Risk mechanism:** Search state is part of query keys and changes on every keystroke. Search fields are not debounced. Query functions omit React Query's `signal`, so obsolete requests continue over the network.

**Impact:** A single Arabic search can generate many serial cloud requests and retain obsolete in-flight work, increasing Turso latency/load and stale-response pressure.

**Remediation:** Debounce or submit search terms, pass `AbortSignal` through hooks/services/API calls, and test request count and cancellation.

## MEDIUM

### M1. Malformed types and query parameters can produce uncontrolled 500s or inconsistent 400s

**Locations:** `app/services/item_service.py:46-50`, `126-129`; `app/routes/items_routes.py:295-306`; `app/routes/log_routes.py:24-39`; `app/routes/category_routes.py:29-34`, `87-99`.

**Risk mechanism:** Action values call `.lower()` before type validation, and several IDs use bare `int(...)`. `None`, arrays, booleans, fractional values, overflow-like inputs, and malformed query values are not uniformly handled.

**Remediation:** Validate JSON shape, types, integer bounds, enums, and unknown fields at every boundary. Return structured localized 400 responses and add malformed-input tests.

### M2. Order schema permits invalid quantities and cannot encode receipt disposition

**Locations:** `database/schema.sql:135-151`; `database/migrations/003_digital_two_operator_workflow.sql:83-100`.

**Risk mechanism:** PO requested and ordered quantities allow zero. `received_quantity` is only bounded numerically and is not linked to a received/struck-off disposition.

**Remediation:** Require positive persisted order quantities, add disposition/outcome constraints, and test direct SQL constraints as well as service validation.

### M3. Durable `in_progress` operations can block a key forever

**Locations:** `database/schema.sql:79-92`; `app/services/idempotency_service.py:107-115`; `tests/test_idempotency.py:166-177`.

**Risk mechanism:** A committed `in_progress` row is treated as permanently blocking, with no timeout, ownership recovery, reconciliation, or administrative resolution.

**Remediation:** Ensure reservation and business work commit together, distinguish active transactions from stale durable records, and add recovery/reconciliation for crash boundaries.

### M4. Connections created outside Flask requests are not consistently closed

**Locations:** `app/models/db_utils.py:419-431`; `app/services/item_service.py:131-167`, `194-252`; `app/models/category_model.py:47-78`; `app/models/provider_model.py:5-30`; `app/models/unit_model.py:32-67`.

**Risk mechanism:** `get_db()` creates isolated connections outside requests, while several services/models commit without closing them.

**Remediation:** Use explicit context-managed ownership outside Flask. Make services either accept caller-owned connections or close connections they create. Add repeated CLI/background lifecycle tests.

### M5. Transaction wrapper may replay after an uncertain remote commit

**Location:** `app/models/db_utils.py:494-519`.

**Risk mechanism:** Exceptions from `commit()` are handled like body exceptions. A remote commit may have succeeded even when the client receives a timeout/stream error; retrying the whole operation can duplicate work unless operation state is reconciled.

**Remediation:** Separate pre-commit failures from uncertain outcomes and reconcile the operation key against the authoritative database before replay.

### M6. Reporting models represent database failures as empty/zero-shaped data

**Locations:** `app/models/movement_log_model.py:169-200`, `257-264`.

**Risk mechanism:** Query failures can return empty lists or zero counts plus an out-of-band `error` field. A caller that forgets to inspect the field presents a false successful report.

**Remediation:** Raise typed reporting/database exceptions and translate them only at the HTTP boundary. Never represent failure as a valid empty report.

### M7. Expired/open filtering semantics are inconsistent

**Locations:** `app/routes/log_routes.py:16-39`; `app/models/movement_log_model.py:107-157`; `app/models/purchase_order_model.py:69-82`; `app/services/purchase_order_service.py:34-85`.

**Risk mechanism:** PO formatting derives an effective `expired` status, but list filtering can use stored `open` status. Log IDs and pagination/filter values also lack consistent positive validation.

**Remediation:** Define effective expiry once and use it consistently in list, detail, and action paths. Validate all IDs and pagination values.

### M8. UI operational failures are confused with empty data or lack recovery

**Locations:** `UI/src/pages/POTickets.tsx:7-13`, `64-78`; `UI/src/pages/LeaveOrders.tsx:21-35`, `99-122`; `UI/src/pages/DisbursementTickets.tsx:16-23`, `93-112`.

**Risk mechanism:** PO tickets do not inspect `isError`, so a failed query displays “no open purchase orders.” Leave Orders and Disbursement Tickets show error text but do not expose a page-level retry action.

**Impact:** Warehouse staff can interpret a network/database outage as an empty queue and delay receiving or fulfillment.

**Remediation:** Render explicit error states with `refetch` actions and distinguish failed loads from genuine empty results. Test failure and recovery for every operational list.

### M9. Several UI mutation errors become unhandled or invisible

**Locations:** `UI/src/components/PODetailModal.tsx:39-52`; `UI/src/pages/DisbursementTickets.tsx:41-51`.

**Risk mechanism:** PO void/dispatch and ticket rejection await `mutateAsync()` without `try/catch`; no localized mutation error is rendered.

**Remediation:** Catch `ApiError`, preserve the form/modal state, show conflict/503 messages, and provide a stable retry using the same key.

### M10. Adaptive heartbeat defeats query freshness policy

**Location:** `UI/src/hooks/useAdaptiveSyncHeartbeat.ts:52-68`.

**Risk mechanism:** Every active query is refetched every 12 or 45 seconds, including metadata with a five-minute stale time and detail queries. This bypasses targeted cache policy.

**Remediation:** Refetch only freshness-sensitive operational keys, respect stale time, or invalidate targeted query families. Add key-selection tests.

### M11. Inventory status and Leave Order lifecycle filters are incomplete

**Locations:** `UI/src/pages/ItemsManagement.tsx:91-93`, `217-229`; `UI/src/pages/LeaveOrders.tsx:41-65`.

**Risk mechanism:** Inventory filters omit `inactive`, and stock predicates do not require active status. Leave Order tabs omit `cancelled` even though rows render that status.

**Remediation:** Add inactive and cancelled filters with counts and server requests where appropriate; ensure stock filters exclude inactive items. Test rendered controls, not just local predicates.

### M12. Real-time stock headroom feedback is absent from the actual Leave Order form

**Locations:** `UI/src/components/CreateLeaveOrderModal.tsx:138-146`, `220-229`, `504-515`.

**Risk mechanism:** Validation occurs on submit, not on line/item/quantity changes. The local E2E test models the requirement but does not render the production form.

**Remediation:** Compute and display inline Arabic headroom warnings as the user types while retaining server-side validation as authoritative.

### M13. Frontend quantity input can truncate or accept fractions inconsistently

**Locations:** `UI/src/components/AdjustQuantityModal.tsx:86-114`, `266-274`; `UI/src/components/AddItemModal.tsx:52-75`, `187-195`; `UI/src/components/CreateLeaveOrderModal.tsx:138-145`.

**Risk mechanism:** Some forms check only `Number(...) > 0` and omit `Number.isInteger`/`step="1"`; Leave Order input uses `parseInt`, silently converting `1.5` to `1`.

**Remediation:** Preserve raw input, validate finite positive integers, set `step="1"`, and show an inline error instead of truncating.

### M14. Manual removal UI checks current rather than available stock

**Location:** `UI/src/components/AdjustQuantityModal.tsx:95-97`.

**Risk mechanism:** The UI compares removal against `current_quantity`, not `current_quantity - reserved_quantity`, unlike Leave Order reservation logic.

**Remediation:** Use available-stock semantics in the UI and retain the backend conditional check.

### M15. Touch targets and modal accessibility do not consistently meet the UX contract

**Locations:** `UI/src/index.css:47-73`; `UI/src/components/ItemActions.tsx:29-55`; `UI/src/components/CategoryActions.tsx:28-43`; `UI/src/components/ManagementItemCard.tsx:19-31`; `UI/src/components/FilterTabs.tsx:32-42`; `UI/src/components/Modal.tsx:216-231`.

**Risk mechanism:** `.btn-sm` is 36px, several icon controls are approximately 18px plus padding, filter tabs are under 40px, and modal instances all use `id="modal-title"`. Some icon-only buttons rely on `title` rather than `aria-label`.

**Remediation:** Establish reusable 40px row-action and 44px primary targets, give every icon-only button an accessible name, and generate unique dialog title IDs. Add DOM/accessibility tests.

### M16. Draft PO dashboard detail can receive summary data instead of detail data

**Locations:** `UI/src/pages/office/OfficeDashboard.tsx:52-54`, `350-356`; `UI/src/components/PODetailModal.tsx:112-173`.

**Risk mechanism:** A summary PO is passed to a modal that unconditionally reads `order.items.length` and maps `order.items`.

**Impact:** Selecting “view/edit” for a draft can throw at runtime and block a core Office workflow.

**Remediation:** Pass only an ID and fetch detail before rendering, or make the modal explicitly handle loading/detail types. Remove the `as any` cast and add an interaction test.

### M17. Metadata failures appear as empty selectors

**Locations:** `UI/src/components/CreatePOModal.tsx:90-91`, `493-505`; `UI/src/components/CreateLeaveOrderModal.tsx:72-73`, `416-427`.

**Risk mechanism:** Provider/destination query errors are ignored, so a failed request is indistinguishable from no configured metadata.

**Remediation:** Show localized loading/error states with retry and disable submission with an explanatory message when required metadata is unavailable.

### M18. Initial frontend bundle is monolithic

**Locations:** `UI/src/main.tsx:3-12`; `UI/src/App.tsx:1-22`; `UI/vite.config.ts:5-18`.

**Evidence:** `vite build` produced a `565.12 kB` minified JavaScript chunk and emitted the default 500 kB warning.

**Remediation:** Lazy-load pages and heavy reporting/printing dependencies and configure route-level chunks. Do not simply raise the warning threshold.

### M19. TypeScript validation is not part of the package scripts and currently fails

**Location:** `UI/src/pages/ItemsManagement.tsx:272`; `UI/tsconfig.app.json:18-21`; `UI/package.json:6-12`.

**Evidence:** `npx tsc -p tsconfig.app.json --noEmit` fails because `handleBack` is declared but unused, while the package has no type-check script.

**Remediation:** Wire or remove `handleBack`, add a `typecheck` script, and run it in CI/release validation.

## LOW / Hygiene

### L1. Login rate limiting is process-local and IP buckets are not reset on success

**Locations:** `app/auth.py:75-110`; `app/routes/auth_routes.py:66-88`.

Use a bounded shared limiter where deployment topology requires it, evict inactive keys, and test shared workstation/NAT behavior.

### L2. Secret-key persistence failure falls back to an ephemeral key

**Location:** `app/auth.py:48-72`.

Production should require an externally managed or successfully persisted secret and fail startup when it cannot be loaded. Ephemeral keys should be test-only.

### L3. PO ticket dates are rendered as raw server timestamps

**Location:** `UI/src/pages/POTickets.tsx:104-114`.

Use the shared Arabic/timezone-safe formatter and test UTC/SQLite-naive values.

### L4. Search and clear controls have inconsistent accessible names/types

**Locations:** `UI/src/components/SearchBar.tsx:33-38`; `UI/src/pages/PurchaseOrders.tsx:127-141`; `UI/src/pages/LeaveOrders.tsx:70-83`.

Add `type="button"` to clear controls and explicit Arabic `aria-label` values to icon-only search controls.

### L5. Settings exposes abandoned local/offline modes

**Location:** `UI/src/pages/Settings.tsx:37-46`.

Present the cloud-only architecture and a clear disconnected/read-only status rather than suggesting local mutation support.

## 5. Performance and Scalability Assessment

### Database and network

- Primary item/order lookup and status columns have indexes in `database/schema.sql`: item status/category, PO status/created/provider, Leave Order status/created, child order IDs/item IDs, and movement-log item/timestamp/operation fields.
- `po_number` and `order_number` are unique and therefore indexed by the database. The main weakness is not a missing basic index; it is network behavior and query semantics. Search uses wildcard `LIKE` over names and string-cast IDs (`app/models/item_model.py:17-19`), which is not index-friendly for leading wildcards and will degrade with catalog growth.
- The UI makes multiple round trips for list/detail flows and metadata. This is acceptable at small scale but should be measured against EU-West Turso latency, especially on every-keystroke search and broad heartbeat refetches.
- The services do not consistently use the bounded transaction retry helper, and the remote commit uncertainty path is not reconciled. This increases both latency and operational retry risk.
- No live query plans, remote latency samples, connection/session metrics, or concurrent LibSQL measurements were available. Production capacity is therefore unqualified.

### Frontend

- Inventory is paginated at 10 items and async item selection is paginated, which is a good baseline for large catalogs.
- PO/Leave/Ticket lists use fixed page sizes, but ticket pages request up to 50 records and broad active-query polling can repeatedly refresh all mounted lists/details.
- Search is not debounced and requests are not cancellable in the affected hooks/services. This is the highest immediate frontend load risk.
- The initial chunk is 565.12 kB minified, before browser cache and parse/evaluation cost. PyWebView workstations should receive page-level code splitting for reporting, printing, and infrequently used management screens.
- The cache strategy has sensible stale times in isolation, but the adaptive heartbeat currently defeats them by refetching every active query. It should target operational freshness rather than bypassing the cache globally.

## 6. Verification Results

| Check | Result | Notes |
|---|---|---|
| `npm test` in `UI/` | PASS | 134 tests passed, 0 failed. Several requirement tests are model-level rather than rendered UI tests. |
| `npm run lint` in `UI/` | PASS | Clean rerun after an earlier transient generated-config timestamp error. |
| `npm run build` in `UI/` | PASS with warning | Vite built successfully; 565.12 kB minified JS chunk; outdated `caniuse-lite` warning. |
| `npx tsc -p tsconfig.app.json --noEmit` in `UI/` | FAIL | `UI/src/pages/ItemsManagement.tsx:272`: unused `handleBack`. |
| `pytest -q` | NOT RUN | `pytest: command not found`. |
| `python -m pytest -q` | NOT RUN | Python environment has no `pytest` module. |
| Python AST/bytecode compilation | PASS | `python -m compileall -q app tests`; AST parse passed for 33 app Python files. |
| Live Turso/LibSQL tests | NOT RUN | No remote mutation/concurrency test executed. |
| Browser/PyWebView E2E | NOT RUN | No browser/component test runner is configured in `UI/package.json`. |

The backend suite must be run in an isolated environment with the pinned application dependencies before release. A passing local SQLite suite alone cannot qualify the authoritative remote writer, offline gate, cloud commit behavior, or remote migration safety.

## 7. Pre-Production Punch List

1. Remove the production local SQLite/in-memory fallback and make all mutations fail closed unless the connection is authenticated remote LibSQL/Turso.
2. Apply authoritative-online gating to every stock-affecting and order-lifecycle mutation, including create/edit/dispatch/void/reject/resubmit/cancel.
3. Make `Idempotency-Key` mandatory at every stock mutation boundary and enforce it in both routes and services.
4. Redesign frontend mutation handling to create one durable key per logical operation and reuse it after uncertain responses, including adjustment, item status/detail changes, PO actions, and Leave Order actions.
5. Make staging rehearsal require a verified disposable clone and refuse the configured production database.
6. Stop and redesign migration 003 so it never fabricates fulfillment, quantities, actors, timestamps, or audit events; migrate ambiguous legacy records to reconciliation state.
7. Implement short/final PO receipt dispositions and test atomic line outcomes, discrepancy audit, over-receipt, omitted lines, and concurrent receipt/void/expiry.
8. Implement the documented Leave Order close endpoint, reasons, actor/timestamp metadata, automatic-return closure metadata, and bounded late-return behavior.
9. Resolve the Office/Warehouse permission-matrix contradiction and publish one authoritative API/UI role contract.
10. Check affected-row counts on every revision/state transition and add concurrent two-connection tests for all competing workflows.
11. Add database-level append-only triggers for movement logs and production safeguards for seed/cleanup utilities.
12. Correct provider/category deletion actions and test referential-integrity races against the real database engine.
13. Add migration ownership locking and full contiguous version-chain validation; test concurrent and interrupted migrations.
14. Replace raw exception details in HTTP responses with safe stable codes/messages and correlation-ID server logging.
15. Install the pinned Python test dependencies and run the complete backend suite, including transaction, idempotency, offline, permission, migration, and staging tests.
16. Add real LibSQL/Turso qualification tests for concurrent stock, uncertain commit, network failure, retry, connection lifecycle, and remote schema behavior.
17. Replace duplicate UI requirement models with actual component/browser tests for navigation, forms, errors, pending mutations, filters, RTL, accessibility, and touch targets.
18. Add explicit retry actions and failure/empty-state separation to every operational list, especially PO tickets.
19. Debounce search, propagate `AbortSignal`, target heartbeat refetches, and measure request volume/latency under realistic operator journeys.
20. Fix the draft PO summary/detail runtime path, real-time headroom feedback, inactive/cancelled filters, quantity integer handling, and metadata error states.
21. Enforce 40-44px control targets and unique accessible modal IDs/labels.
22. Add page-level code splitting and run the TypeScript check in CI; resolve the unused `handleBack` failure.
23. Require persistent production secrets and make secret persistence failure fail closed.
24. Re-run this audit after the blockers are addressed, with a clean worktree or an explicit reviewed change set, and attach test evidence for the release decision.

## 8. Final Release Decision

**NO-GO for general production deployment.** The application should remain in development/staging until the authoritative database boundary, migration safety, idempotency, offline gating, audit immutability, and release test infrastructure are corrected and demonstrated with remote/concurrent evidence.
