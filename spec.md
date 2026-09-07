# Implementation Spec: SkyCourt Two-Operator Overhaul

> **Codebase-reviewed revision — 2026-09-05**
> Baseline: `b4241a8`. Review evidence and reproduced defects: [engineering review](docs/reviews/two-operator-spec-review.md).
> This document defines the target and release gates. It does not claim that the overhaul is implemented, tested, or free of defects.

## 1. Product scope and decisions

Add authenticated, role-specific workflows while preserving the warehouse operator's current inventory functionality:

- **Warehouse operator:** existing inventory, categories, units, destinations, providers, scanning, adjustments and reporting; create leave orders; receive POs; view and close leave orders.
- **Office operator:** read-only inventory, dashboard and movement reports; create/print/void POs; view tickets; process returns and close tickets.
- **Admin:** explicitly provisioned support role with the union of both operators' permissions. No public registration or user-management UI in this release; show both workflow groups if an admin account is provisioned.
- **Offline capability:** retained as a target, subject to TASK-8's consistency and deployment gates.

### Review defaults requiring product acceptance

These make the implementation plan concrete; they are review recommendations, not previously approved decisions:

| Topic | Working decision |
|---|---|
| First release | Use the existing remote libSQL database as the authoritative writer. All stock-affecting operations are online-only until TASK-8 passes; do not queue local stock mutations and do not ship the unsafe original sync design. If both operators must write stock offline at launch, complete TASK-8 architecture first. |
| PO receipt | One final receipt, which can be short. Confirmation closes the PO; outstanding quantities are shown as unfulfilled, not an implicit backorder. Multiple deliveries require a different lifecycle and receipt model. |
| PO expiry | 48 elapsed hours from authoritative creation time. No receipt at or after expiry. |
| Ticket closure | Office and warehouse may close. Fully returned tickets close automatically. Manual closure with outstanding units requires a reason; it never adjusts stock. |
| Late returns | Office may process a bounded, audited return after manual closure, limited to the ticket's still-outstanding issued quantities and any additional product policy limits confirmed before acceptance; the ticket remains closed. This avoids making real returned stock impossible to record. |
| PO item selection | Existing active inventory items only. Office cannot create master items/providers through the PO form; warehouse creates missing metadata. |
| Trust boundary | Local Flask role enforcement assumes trusted workstations. If users must be unable to bypass restrictions using workstation credentials/files, a trusted central API is a prerequisite. |

Arabic RTL remains the interface language. Confirm company print identity, logo, address/contact information, currency and decimal scale before print acceptance; do not invent production business details.

## 2. Current contracts that must survive

The current application runs Flask on `127.0.0.1:5070`, serves `UI/dist` and opens a pywebview window. Vite proxies `/api` in development. Navigation is the `activePage` switch in `UI/src/App.tsx`; scanner state and dispatch live in `UI/src/context/AppContext.tsx`. There is no React Router requirement.

| Contract | Existing implementation | Preservation requirement |
|---|---|---|
| Item list/search | `app/routes/items_routes.py`, `app/models/item_model.py` | Preserve `{items, total_count}`, `page/page_size/search/sub_category_id` and `offset/limit/q` consumers. Active-only list and barcode lookup remain default. Validate positive pagination inputs. |
| Item identity | `database/schema.sql`, item service/model | Keep existing IDs, barcodes, quantities and status values `active`, `inactive`, `archived`. Do not hard-delete items or rewrite historical quantities. |
| Duplicate/restore workflow | `item_service.py`, `AddItemModal.tsx` | Preserve duplicate conflict response with `type: item_conflict`, `item_id`, and restoration into a selected category. Invalid input must not be mistaken for a duplicate. |
| Unit-change confirmation | `item_service.py`, `EditItemModal.tsx` | Preserve 409 `UNIT_CHANGE_CONFIRMATION` and explicit `force_unit_change` retry; new unresolved-order restriction in section 6 takes precedence. |
| Category hierarchy | `category_model.py`, `ItemsManagement.tsx` | Preserve 25-main-category limit, hierarchy/pagination, blocked deletion of categories with active items/children, and archiving inactive items when their category is deleted. |
| Manual stock adjustment | `AdjustQuantityModal.tsx`, item service | Keep addition/removal, provider/cost/person and destination inputs, positive integer stock handling and continuous scanning. Manual removals do not automatically become leave orders. |
| Movement reports | log routes/model, `MovementLog.tsx`, print components | Preserve paginated `{logs,total_count,page,page_size,total_pages}`, comma-separated action filtering, item/provider/destination/date filters and array response from `/all_filtered`. |
| Barcode printing | `barcode_service.py`, item barcode routes, `PrintableBarcode.tsx` | Preserve PNG and JSON/base64 endpoints and item-label printing. PO A4 printing is a separate layout. |
| Dashboard | summary API, stats service, dashboard | Existing Addition/Removal figures are counts of log events, not sums of quantities or money. Extend without silently redefining them. |
| Metadata deletion | unit/provider/destination models | Preserve existing in-use protections and extend them to new order relationships with actionable errors. |
| Startup/packaging | `run.py`, `run.spec`, `main.py` | Preserve fonts, SSL certificates, bundled UI, loopback hosting and remote lock check. `app_remote_settings` is absent from reference schema; preserve deployed settings if present. |

Authentication intentionally changes unauthenticated API access. Invalid or unsafe inputs that the old backend happened to accept are not compatibility requirements.

## 3. One implementation order

| Stage | Tasks | Exit gate |
|---|---|---|
| A | TASK-0: baseline tests, migration tooling, transaction/validation foundation; TASK-8 feasibility decision | Current workflows characterized; atomic writes and authoritative concurrency proven; offline architecture explicitly gated. |
| B | TASK-1: schema/auth + client request integration | Both roles can sign in; full API permission matrix passes; expiry/logout clears application state. |
| C | TASK-2/TASK-3: role navigation and preserved existing screens | Warehouse regression suite passes; office cannot reach mutation actions or invoke inventory writes. |
| D | TASK-6: leave orders and returns; TASK-7: ticket list/count | Atomic deductions/returns, replay protection, closure rules and two-client visibility pass. |
| E | TASK-4: PO creation/print; TASK-5: scan/receipt | Final receipt, expiry races, audit links, print and existing scanner regressions pass. |
| F | Integrated migration and Windows pilot | Restore rehearsal, two-workstation cutover, all release gates and operator acceptance pass. |
| G | TASK-8 implementation if deferred | Separate offline qualification and deployment; no automatic driver replacement in stages A–F. |

UI scaffolding may proceed after its contracts are fixed. Do not enable feature screens until their backend, migration and permission gates pass. Use this order instead of the conflicting schedules in the original handoff.

## TASK-0: Compatibility and transaction foundation

### 0.1 Database ownership

Keep `get_db()` and its compatibility argument available to existing callers. Models remain data access; services own business transactions; routes validate input and pass authenticated actor context explicitly.

For the initial remote mode, use a request-owned connection, or a tested pool with exclusive checkout for the entire transaction. Do not share the current singleton's transaction state between Flask request threads. If driver limitations require a dedicated database worker, route every database operation through it. Per-process locking is not cross-workstation stock protection.

Make `main.py` teardown match ownership: close/release only the request-owned resource, rolling back unfinished work. Keep the connection adapter until `dict(row)`, named and positional access, cursor iteration, `lastrowid`, `rowcount`, commit/rollback and exception mapping pass compatibility tests. Avoid import-time database access; permit test app creation without a built UI, pywebview window, remote lock query or live database.

### 0.2 One commit per business operation

Refactor `record_quantity_adjustment()` before adding multi-line workflows:

- Retain its public manual-adjustment behavior, with a service-owned transaction.
- Extract a primitive accepting an existing connection/cursor, actor, explicit stock direction/action and source references. It must not commit, rollback or fetch another connection.
- `add_log_entry()` already requires a caller-owned connection; preserve that rule.
- A PO receipt, leave-order creation or return owns exactly one transaction covering operation record, header/line updates, every stock change and every log. Any failure rolls everything back.
- Check existence, state, unit compatibility, line ownership and stock inside that transaction. Aggregate demand per item or reject duplicate lines before changing any stock.
- Use authoritative conditional arithmetic updates, for example `UPDATE items SET current_quantity = current_quantity - ? WHERE id = ? AND status = 'active' AND current_quantity >= ?`; require one affected row. Inbound updates add an amount atomically. Read resulting balances in the same transaction.
- Conditional header revision/state checks must serialize receive versus void/expiry, return versus close, and competing returns. Retry a transient database conflict only by rerunning the complete transaction with a bounded policy. Never retry only its final statement.

The default transient-conflict retry policy is at most three complete attempts with bounded backoff. Retry only errors classified as transient by the pinned driver; validation, authorization, state, stock, constraint and unknown errors are returned without retry. Each attempt reuses the same idempotency key and canonical payload, and a successful commit ends the retry loop.

This example is an online authoritative transaction rule, not a claim that replaying the same SQL independently on offline replicas preserves global stock invariants.

### 0.3 Input and retry contracts

Validate JSON object shape, allowed fields/enums, bounded text, existing foreign keys, and numbers on the server. Quantity changes and order quantities are positive integers; initial stock can be zero. Reject booleans, fractional values, negative values, NaN/infinity and numeric overflow. Prices are finite and nonnegative. Reject empty orders, duplicate line/item IDs and lines belonging to another order. Manual adjustments accept only `addition` or `removal`; returns are a dedicated service action.

All new order mutations and stock-affecting UI requests carry an `Idempotency-Key` generated once for a submission. Persist an `operations` row with unique key, actor, operation type, canonical payload fingerprint, response status/body and completion time in the same transaction as the operation. The implementation must reserve the key atomically before applying business changes and must not expose or replay an incomplete reservation. Identical retry returns the original result; different actor/type/payload with the same key returns 409. Concurrent duplicates must wait for the owner transaction or return a safe conflict, never run stock changes twice. Retain records for the audit lifetime; authorize before replaying any response.

Update existing first-party create-item/adjust requests to carry keys. Preserve body and response contracts; legacy missing-key compatibility, if temporarily supported during development, cannot pass the two-operator cutover gate. A lost response must be retried with the same key. An edited submission uses a new key only after the prior outcome has been resolved.

New errors use `{error, code, details?}`: 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing resource, 409 stale state/stock/duplicate conflict, 503 authoritative database unavailable. Preserve existing special conflict bodies. Do not expose database credentials or raw database exceptions to clients.

## TASK-1: Authentication and authorization

### 1.1 Users and sessions

Create users with integer primary key, case-insensitive unique username, password hash, constrained role, display name, boolean active flag, session version and UTC creation timestamp. Provision the two named roles (`office`, `warehouse`) through an explicit idempotent administrative seed command using unique supplied passwords and Werkzeug hashing. No literal `<hash>` inserts, default shared password, startup reset or registration endpoint. Existing usernames with unexpected roles cause a provisioning error rather than silent reassignment.

Configure a cryptographically random persistent signing secret outside source/bundled assets. Store only user ID and session version in Flask session, never a password/hash or a trusted client-supplied role. Resolve the active user and current role per authenticated request. Administrative password reset/deactivation increments session version. Record the actor server-side on every new log; legacy logs keep a null actor, not a fabricated attribution.

Use HttpOnly, SameSite cookies and a defined finite session lifetime (review default: eight hours). Secure cookies require HTTPS; the existing loopback HTTP deployment needs an explicit development/desktop configuration. Add session-bound CSRF validation and allowed-Origin checks for all state-changing requests, including login/logout (expose a pre-login CSRF token endpoint). Login clears old session state and rotates CSRF state. Return generic credential errors and rate-limit repeated failed login attempts without logging passwords. Document timeout/recovery and administrative reset procedures.

Keep requests same-origin via the current Vite proxy/desktop server. If a cross-origin API deployment is chosen, configure credentials and explicit allowed origins together; do not combine credentialed requests with wildcard CORS.

**Security boundary:** a shared database credential in each desktop cannot enforce roles against someone who controls that desktop. Remove embedded credentials from source/configuration distribution and use protected installation configuration for a trusted-workstation deployment. Strict isolation additionally requires moving authenticated mutations and credential ownership to a trusted API. Merely moving the same token to an environment variable does not solve that boundary. Do not replicate password hashes to office/warehouse machines as an unexamined side effect of offline sync.

### 1.2 API matrix

`Any` below means any authenticated, active supported role. Admin has the union of permissions. Decorators use `functools.wraps`; route protection applies to the collection itself as well as child paths.

Register `auth_bp` at `/api/auth`: GET `/csrf` returns a session-bound bootstrap token; POST `/login` accepts username/password and returns the authenticated public user plus fresh CSRF state; GET `/me` returns `{user}` or 401; POST `/logout` clears the session and returns 204. Public user fields are ID, username, display name and role only. Never return password hashes. Client services must consistently unwrap these response shapes.

| API / method | Office | Warehouse |
|---|---|---|
| Auth CSRF token/login | Public with CSRF/origin rules | Public with CSRF/origin rules |
| Auth me/logout | Own session | Own session |
| Existing GET items/categories/units/providers/destinations/logs, barcode and report routes | Allow | Allow |
| Existing POST/PUT/PATCH/DELETE inventory/metadata routes | Deny | Allow |
| GET PO list/detail/barcode lookup/image | Allow | Allow |
| POST PO create/void | Allow | Deny |
| POST PO receive | Deny | Allow |
| GET leave-order list/detail/count | Allow | Allow |
| POST leave-order create | Deny | Allow |
| POST leave-order close | Allow | Allow |
| GET ticket list/detail | Allow | Allow for shared/admin views |
| POST ticket return | Allow | Deny |
| GET sync status; POST manual sync if enabled | Allow | Allow |

Protect both PATCH `/api/items/<id>/restore` and PATCH `/api/items/<id>/status`. Protect `/api/movement-logs`, `/all_filtered`, `/summary/today` and every barcode endpoint. Static UI assets and auth bootstrap remain accessible before login. Unknown `/api/*` paths must return JSON 404, never successful SPA HTML.

### 1.3 React integration

Use `QueryClientProvider > AuthProvider > authenticated AppProvider/layout`. Keep Login and Toaster available while application data providers are unmounted. AuthContext owns `/auth/me`, login/logout/loading and role capabilities; an optional `useAuth.ts` re-export must not create another context.

Gate queries and pollers on authenticated state. Do not retry 401/403 as transient network failures. On logout, expiry, revocation or account change: cancel in-flight queries, clear cached queries/mutations, abort fetches, reset active page, scanner, selected item/PO, modals and print data. Unmount or key AppProvider by authenticated identity. Late responses from an old session cannot populate the new session. Revalidate on focus and handle server 401 globally; `staleTime: Infinity` alone is insufficient.

Bring raw JSON fetch call sites under the common API helper and provide a sibling image/blob helper preserving cookie/CSRF/401 behavior. This includes AppContext, AddItemModal, EditItemModal's confirmation retry, AdjustQuantityModal, CategoryModal, Dashboard/MovementLog item selectors, PrintReportButton, PrintableBarcode and itemsService's PNG request. Keep `ApiError.status` and `data` for conflict dialogs. Escape user-controlled values in generated print HTML.

## 4. Schema and migration contract

Implement versioned, checked migrations under `database/migrations/` and a separate migration command. `database/schema.sql` remains the complete fresh-install representation after changes, not the upgrade mechanism. The tables below are the required logical contract; convert them into executable migrations and verify them before coding consumers.

### 4.1 New tables and fields

| Table | Required fields and constraints |
|---|---|
| `users` | As TASK-1. Unique case-insensitive username; checked role and active flag. Users are deactivated, never deleted from audit history. |
| `operations` | Unique text operation key; actor FK; operation type; request fingerprint; saved response status/body; UTC completion time. Reservation and completion must be atomic with the business operation; no committed incomplete stock operation or replayable incomplete response. |
| `purchase_orders` | Integer PK; unique `po_number`; unique barcode equal to that number; required provider FK and provider-name snapshot; checked `open/closed/void`; notes; creator FK; UTC created/expires times; revision default 0; receiver/closed time; void actor/time/reason (system expiry can have null actor with explicit reason); currency/scale and integer minor-unit ordered total. |
| `purchase_order_items` | Integer PK; required PO and item FKs; unique `(po_id,item_id)`; snapshot item name, unit ID/name; line description; positive ordered integer quantity; nonnegative integer minor-unit unit price; nullable received quantity while open, bounded `0..quantity` after receipt; checked disposition `pending/received/struck_off`. No independent conflicting `is_received` flag. |
| `leave_orders` | Integer PK; unique order number; required nonblank employee name and destination FK/name snapshot; checked `open/partially_returned/closed`; notes; creator FK/time; revision; nullable closer FK/time/reason. |
| `leave_order_items` | Integer PK; required order/item FKs; unique `(leave_order_id,item_id)`; snapshot item name and unit ID/name; positive integer quantity; returned quantity default 0, constrained `0..quantity`. Aggregate returned quantity is updated only from committed return events. |
| `return_events` | Integer PK; required leave-order FK, unique operation FK, actor FK, UTC timestamp and optional notes. One row per return submission, including late returns. |
| `return_event_items` | Required return-event and leave-line FKs; unique pair; positive integer delta. Service verifies line belongs to the event's order and validates remaining returnable quantity transactionally. |

PO receipt is one final event represented by header receiver/time, immutable line outcomes and operation-linked logs. If multiple deliveries are required, introduce receipt headers/lines and partial-PO state before implementation rather than overloading this representation.

Extend `movement_logs` additively with nullable `user_id`, actor-name snapshot, operation key, PO-line FK, leave-line FK, return-event FK and unit-name snapshot. Existing rows remain valid with null new fields. Each new stock log has an operation key; exactly the applicable order source fields are populated. Add uniqueness for operation/item/action to prevent duplicate stock logs within a submission (duplicate items are disallowed above). Non-stock legacy events remain representable. Never infer provenance solely from free-text `details`.

Use indexes for status/created-time list queries, foreign-key lookups, operation replay, logs by actor/source and return events by leave order. Validate representative query plans and paginated response times before adding speculative indexes. Derive line totals and quantity totals where possible; any stored header total must equal the line calculation in the same transaction. Define `total_items` only as summed ordered quantities if exposed; expose `line_count` separately and label mixed-unit quantity totals accordingly.

New POs store money in integer minor units with configured currency/scale; API prices/totals are decimal strings. Parse using Decimal, reject excess precision, compute on server and bound totals. Legacy `items.cost` and `movement_logs.cost_per_item` REAL fields remain compatible; convert at the logging boundary. Receipt prices do not silently overwrite item master cost/provider—current manual adjustments do not do so either.

Use restrictive deletion for new historical references and meaningful “in use by order” responses. Do not hard-delete completed orders, receipt/return history or users. Provider/destination snapshots preserve historical names after renaming. Keep old metadata deletion behavior where no new references exist.

### 4.2 Migrations and rollout

1. Inspect an authorized staging copy of the actual remote schema: tables/columns/indexes, existing IDs/quantities, foreign-key violations, barcode namespace collisions, timestamps, remote settings and remote engine. The checked-in schema is not proof of production state.
2. Back up and rehearse restore; record baseline row counts and stock balances. Preserve unknown tables/columns. Do not reseed inventory or rebuild historic stock from incomplete logs.
3. Apply numbered migrations through an explicit command with a version/checksum table and single migration ownership. Test fresh install, upgrade, rerun, interrupted migration recovery and unexpected existing schema. Avoid repeatedly issuing `ALTER TABLE ... ADD COLUMN` on startup.
4. Add nullable legacy log fields without backfilling guessed users/order links. New order tables start empty. Seed accounts only through the provisioning command.
5. Verify foreign keys on each runtime connection and all supported engine constraints. Validate new schema on the actual pinned driver, not only SQLite.
6. Start applications only against a compatible schema version; fail with an actionable upgrade message when incompatible. Never have every desktop race to migrate.
7. Cut over both workstations together in a maintenance window after draining writes. Retire old clients that can bypass auth or emit unaudited stock writes. Additive schema compatibility does not make old clients safe for continued operation.
8. Rollback means stop new writers and reconcile/retain new orders and logs. Before new writes, restore can use the verified backup. After new writes, prefer a forward fix or a reconciled restore plan; do not drop new tables or overwrite live balances blindly.

## TASK-2 / TASK-3: Role interfaces and shared navigation

Warehouse keeps Dashboard, ItemsManagement (including category navigation), MovementLog, UnitManagement, DestinationManagement, ProviderManagement and Settings. Add LeaveOrders and POScan/POConfirm pages. Office sees a read-only dashboard/inventory browser, PO management, Tickets, MovementLog and Settings.

Prefer capability props and shared browsing/table components to copying whole pages. Ensure office cannot open ItemActions, CategoryActions, edit/adjust/restore modals, dashboard adjustment shortcuts or the global scanned-item adjustment modal. Hiding sidebar entries alone is not authorization. Server permissions remain authoritative.

Keep the current navigation mechanism and define canonical page identifiers in one place. Register every new page in `App.tsx`. Use one role-aware Sidebar unless separate visual components materially simplify it; both must use the same capability map. Reset a no-longer-permitted active page to the role's dashboard. Admin can access both new workflow groups.

Office settings remains system information. Display actual database mode/version, not a hardcoded claim of SQLite 3. Both roles can print permitted reports; no cross-role state should survive logout.

## TASK-4: PO creation, expiry and print

### 4.1 API

New route paths below are canonical without trailing slash. Register compatible collection aliases or disable strict slashes consistently; do not rely on POST redirects. Keep existing route aliases working. `Any` has the meaning defined in TASK-1.

| Method | Path | Access | Contract |
|---|---|---|---|
| GET | `/api/purchase-orders` | Any | Filter status; bounded pagination; `{purchase_orders,total_count,page,page_size,total_pages}`. |
| GET | `/api/purchase-orders/<id>` | Any | Header, immutable snapshots, items, revision and allowed actions. |
| GET | `/api/purchase-orders/by-barcode/<barcode>` | Any | Same detail; unknown barcode 404. Closed/void/expired POs remain viewable. |
| POST | `/api/purchase-orders` | Office | Provider, notes, item IDs/positive quantities/decimal prices/descriptions. Server snapshots, numbers and totals. 201 detail. |
| POST | `/api/purchase-orders/<id>/void` | Office | Expected revision and reason; conditional open-to-void. 200 detail. |
| POST | `/api/purchase-orders/<id>/receive` | Warehouse | Expected revision and complete line outcomes; TASK-5. 200 detail. |
| GET | `/api/purchase-orders/<id>/barcode` | Any | JSON/base64 contract aligned with existing barcode service. |

Number allocation uses the primary-generated order ID, formatted with a minimum six-digit width (`PO-000042`, `LO-000042`); numbers may have gaps and grow beyond six digits. Allocate and finalize the number within the creating transaction, using a unique temporary internal value if the schema requires it. Never expose that placeholder. Do not use `MAX()+1`, client counts or local replica autoincrement for shared documents.

Reserve a collision-free PO namespace during preflight. Existing item barcodes are arbitrary; do not rename or misroute them. Choose a different new PO prefix if `PO-` already collides with legacy item codes, or maintain an explicitly tested lookup fallback. Prevent new ambiguous item/PO codes at creation and edit. URL-encode scanned values.

### 4.2 State and expiry

Create as open with `expires_at = authoritative_now + 48 hours`. Open can become closed by receipt or void by office/system expiry; `expired` is an effective/read classification of an open PO whose expiry instant has passed, not a fourth persisted status unless migrations explicitly add and support that state. Neither terminal state can receive again. Creation/void/expiry never changes stock.

Expiry must not run as incidental writes in every GET or each workstation's `before_request`. Use an authoritative scheduled worker if available, and always enforce expiry transactionally on mutation. Without a worker, compute effective expired/void status in read/list filters and persist the system-void transition when a mutation discovers expiry. Reads and actions must agree on expiry even when nobody has opened the app. If returning a conflict after persisting expiry, commit only that authorized expiry event and no stock changes. The exact boundary is inclusive: a receipt at or after `expires_at` is rejected.

Receive, explicit void and expiry must compete on the same authoritative state/revision. At the exact expiry instant, receipt is rejected. A retry of an already committed receipt still returns its saved result. Use UTC instants, not client clocks, for this decision.

### 4.3 Printing

Reuse `PrintReportButton`'s installed `react-to-print` `contentRef` pattern and a dedicated `PrintablePurchaseOrder`. Render an A4 Arabic RTL document containing configured company identity, logo, provider snapshot, PO number/date/status, Code128 barcode, line number/item/unit/description/ordered quantity/unit price/line total, currency total and signature area.

Correct the existing barcode font-resource mismatch as part of print integration: `barcode_service.py` resolves `assets/arial.ttf`, but the repository and PyInstaller bundle place it under `app/assets/arial.ttf`. Resolve from the module/bundle root rather than the process working directory, then verify both existing item labels and new PO barcodes. Code128 supporting the prefix does not prove the current image-generation path works in the executable.

Printing and reprinting have no inventory or order-state side effects. Only committed server data is printable. Wait for fonts/logo/barcode images to load and surface failures; do not use a fixed delay as proof that assets are ready. Repeat table headers on multiple pages, wrap long Arabic names, avoid clipping totals/signature, and keep digits/barcode legible. Clearly mark void/closed documents and show ordered versus received quantities on a receipt view without rewriting the original order. Cancelled print dialogs leave the PO available for reprint.

## TASK-5: PO scan and final receipt

Keep BarcodeScannerOverlay as the reusable input collector. Implement role-aware dispatch in `AppContext.handleBarcodeScan`, with selected PO barcode/detail and page state. Ordinary item scans retain active-item lookup, quantity adjustment and scanner reopening for warehouse. Office item scans, if exposed, open read-only details. PO scans open review for office and confirmation for warehouse. Prevent repeated Enter events while lookup/submission is in flight; close/reset overlays appropriately.

Receipt request example (header revision and line IDs come from current PO detail):

```json
{
  "expected_revision": 0,
  "items": [
    {"line_id": 41, "received_quantity": 6, "disposition": "received"},
    {"line_id": 42, "received_quantity": 0, "disposition": "struck_off"}
  ]
}
```

The Idempotency-Key is a header. Require every line once, at least one positive receipt, `received` quantity in `1..ordered`, and `struck_off` quantity zero. No silent default for omitted lines. If nothing arrived, leave open or ask office to void; do not create an empty closed receipt. Do not accept over-delivery in this release.

Inside one transaction: authorize, replay-check, verify open/unexpired/revision and active matching-unit item references, claim state, increment each received item's balance, set final line outcomes, log one Addition per received item with PO provider/price/actor/source, set receiver/closed timestamp, increment revision and persist response. No stock/log for struck-off lines. On error, rollback all changes. Return updated detail and affected item balances.

Present short receipt as final: outstanding amounts will not remain receivable. A failed or stale request preserves the operator's edits for review but fetches current state before resubmission. Show existing receipt details for duplicate scans, not another confirmation button.

## TASK-6: Leave orders, tickets and returns

A ticket is a view of a leave order; do not create a duplicate tickets table. New services are responsible for transactions; models do not call committing item services in loops.

| Method | Path | Access | Contract |
|---|---|---|---|
| GET | `/api/leave-orders` | Any | `{leave_orders,total_count,page,page_size,total_pages}`, status filter. |
| GET | `/api/leave-orders/<id>` | Any | Header, snapshot lines, return history, remaining quantities, revision. |
| POST | `/api/leave-orders` | Warehouse | Employee, destination, notes, unique item/quantity lines; 201 detail. |
| POST | `/api/leave-orders/<id>/close` | Office/Warehouse | Expected revision and reason; 200 detail. This is the canonical close endpoint for Tickets too. |
| GET | `/api/leave-orders/tickets/count` | Any | `{count}` for open plus partially_returned orders. |
| GET | `/api/tickets` | Any | Same resources with `{tickets,total_count,page,page_size,total_pages}`; status `actionable` means open plus partially_returned. |
| GET | `/api/tickets/<id>` | Any | Same leave-order detail; IDs are leave-order IDs. |
| POST | `/api/tickets/<id>/return` | Office | Expected revision, unique `{line_id,quantity}` positive return deltas, optional notes; 200 updated detail/history/balances. |

### Creation

Employee name and destination are required. Create against active items only; derive item/unit/destination snapshots from the database. Guard stock for all lines in one transaction; no partial deduction. Create header, lines and Removal logs with employee as `person_name`, authenticated warehouse user as actor and destination/source links. Status starts open. Failed creation leaves no order, logs, operation result or stock changes.

### Returns and closure

Return quantity is an increment for this submission, not a replacement cumulative total. For every supplied line validate `0 < delta <= quantity - returned_quantity` inside the transaction. Credit only that delta, add immutable return event/lines and Return logs, and update aggregates atomically. A retry cannot credit twice. The same office user can make several distinct partial returns; every event keeps its own actor/time. A late return is permitted only for a still-outstanding quantity and must use the same transaction, idempotency, unit validation and audit links as an on-time return; it must not silently reopen the ticket.

- Open + some returnable units remaining after return → partially_returned.
- Open/partially_returned + all units returned → closed, with actor/time and automatic-full-return reason.
- Manual close from open/partially_returned → closed; require a nonblank disposition reason for outstanding units. Preserve those outstanding quantities in history; do not add them to stock or pretend they were returned.
- Closed + permitted late return → closed, with a new return event and revised remaining quantities; preserve original closure actor/time/reason.
- A different close request against an already closed order returns a state conflict; retrying the original operation returns its saved success.

Show original quantity, cumulative returned, net issued and dated return history. Partial returns remain in the actionable badge. Only fully returned or explicitly closed tickets leave that count. Closed outstanding units represent the recorded disposition, not a new stock reservation.

### Item lifecycle and units

Resolve returns by stored item ID, not the active-only search/barcode endpoint. Inactive/archived items may receive legitimate ticket returns while retaining their status; make that state visible to office and warehouse so the existing warehouse restore workflow can make returned stock available again. Office does not gain item activation permission.

Snapshot units on PO/leave lines and logs. Prevent unit changes while an open PO references the item or any issued quantity remains returnable, including manually closed tickets with outstanding quantities. Preserve the existing confirmation flow for other unit changes. Reject a receipt/return if current unit no longer matches its source snapshot (including imported legacy inconsistencies); provide an actionable reconciliation message and do not guess conversions.

Preserve archive/category deletion workflows. Pending PO receipts against inactive/archived items require warehouse restoration before receipt. Extend metadata in-use checks to new tables and unit snapshots so deletion cannot leave broken references.

## TASK-7: Polling, cache consistency and reporting

Poll actionable ticket count every five seconds while authenticated and visible; list/detail polling is enabled only when their screens are mounted. Use paginated response types from TASK-6 rather than the original unpaginated array example. Include all filters/page values in query keys. Display last successful refresh and a stale/error indicator; a failed request must not show a reassuring zero count.

After committed creation/receipt/return/close/void invalidate the relevant prefixes:

- `items`, `movement-logs`, `dashboard-stats`, `recent-logs` for stock mutations.
- `purchase-orders`, `leave-orders`, `tickets` including affected details, lists and counts as applicable.
- Existing categories/units/providers/destinations when their metadata changes.

The existing global scan adjustment callback must also invalidate stock/log/dashboard queries. Invalidation after success is not an optimistic stock update; keep balances confirmed by the server. Never optimistically mark a financial/stock operation committed.

For cross-workstation visibility, refetch relevant active inventory/dashboard/PO/ticket queries on a bounded interval and on focus; preserve existing filters/pagination. A ticket-only poll does not refresh another workstation's item cache. In remote mode this reads the authoritative DB directly. If sync is later enabled, successful pull with a newer revision must signal invalidation; HTTP polling of unchanged local data is not remote synchronization.

SoftRefreshButton awaits authoritative refresh or the optional manual-sync endpoint before invalidating/refetching data. Bound waiting, avoid overlapping requests and report failures. Extend `useSyncStatus` and badge/Settings consumers together; preserve `connected` and `mode`, adding nullable `last_synced_at`, `last_error`, and a revision/pending-state contract when actually available. Do not infer connectivity from having created a connection once.

Add explicit Return labels/styles to Dashboard, MovementLog and PrintableReport. Add `returns_today` as a separate event count in summary API and stats types; keep Addition/Removal counts unchanged and Creation separate. Preserve positive quantity magnitudes with the action expressing direction. History includes actor and source order/return references while continuing to show legacy `person_name`.

Use authoritative UTC for new order/audit timestamps and Africa/Cairo for display and day filters. Existing movement logs use naive local timestamps: preflight their provenance, preserve their original text, and implement/test a normalization strategy for date filtering across old and new rows. Do not reinterpret all legacy timestamps as UTC. Boundary/DST fixtures must verify “today,” date-range exports and PO expiry agree. Fix the missing `sqlite3` import/error mapping in summary code when changing its error path; failed summaries must not look like successful empty data.

## TASK-8: Offline sync feasibility and gated migration

### 8.1 Why a direct replacement is blocked

Current stock writes are absolute balance replacements and multiple tables use independent integer autoincrement identities. Two offline operators also share PO states and return aggregates. Turso documents last-push-wins conflict resolution and local-change replay; those mechanics do not by themselves prove this application's stock/receipt invariants. [Conflict resolution](https://docs.turso.tech/sync/conflict-resolution).

For example, both clients read 10; warehouse removes 3 and office returns 2. Independently writing 7 and 12 cannot establish the intended balance 9. A process mutex, five-second polling, pushing after HTTP success, or switching to UUIDs alone does not solve this.

Keep `libsql`, adapters and current remote mode for the recommended initial release. Do not apply the original unconditional `pyturso` replacement, wrapper deletion, native row-factory snippet or PyInstaller recipe.

### 8.2 Required architecture decision if offline writes are mandatory

Design and prove one authoritative reconciliation model before selecting a sync loop. Candidate approaches include a single inventory writer consuming durable office return commands, or an immutable operation ledger with global identities, deterministic materialization and explicit conflict handling. These are alternatives to investigate, not approved implementations.

The chosen design must specify:

- Whether an offline action is pending or final, who may finalize it, and how users see rejection/conflict and stock reconciliation.
- How nonnegative stock is guaranteed during partitions (for example by restricting stock ownership/allocations). Unrestricted disconnected withdrawals cannot all be promised final success against the same shared units.
- How receipts versus void/expiry, return limits and close/return races resolve without duplicated/lost inventory.
- Global identity allocation for every offline-inserted table, including existing items, metadata and logs; PO/LO numbering and foreign-key preservation.
- Durable idempotent command delivery, atomic audit linkage, recovery after crash/push timeout/replay, device retirement and conflict reporting.
- Offline authentication bootstrap, credential protection, expiry/deactivation delay, cached-user scope and clock trust.

Test convergence and invariants under both push orders, prolonged partitions, crashes, duplicate delivery and local/remote constraint failures. If any invariant cannot be guaranteed, keep the affected operation online-only and make that limitation explicit in product acceptance.

### 8.3 Driver and deployment spike

Pin Python/driver versions and verify the actual remote engine. Turso's Python reference distinguishes libSQL and Turso drivers; do not infer compatibility from the cloud brand. [Python reference](https://docs.turso.tech/sdk/python/reference).

Using a disposable database and both target operating systems, verify connection argument names, URL format, first bootstrap, DDL propagation, autoincrement behavior, foreign keys/checks, transaction isolation/rollback, row mappings, cursor APIs, exception types and thread ownership. Test a mapping adapter instead of assuming `sqlite3.Row` accepts the driver's cursor.

If sync is selected, use an absolute durable per-installation database path: Windows `%APPDATA%/SkyCourtWarehouse/warehouse.db`, Linux an application directory under `XDG_DATA_HOME` or its standard home fallback. Create directories, separate environments/database identities, enforce one owner per local file and retain sync/WAL sidecars. Never put writable data in `_MEIPASS`, the executable folder or the repository.

A fresh install needs an explicit bootstrap state. Do not open an empty warehouse UI or seed a new inventory if first synchronization fails. Test returning offline startup separately from first install; the documented default bootstrap requires the remote to be reachable. [Sync usage](https://docs.turso.tech/sync/usage).

### 8.4 Sync lifecycle after qualification

A single database owner coordinates application transactions and push/pull/checkpoint. Define commit-before-sync, non-overlap, retry/backoff, timeouts and error reporting for the chosen model. Trigger sync from committed domain writes; `after_request` alone also sees login/logout, failed business responses and non-writing POSTs and is not a durability boundary.

Optional authenticated `POST /api/sync` must return whether work completed or was merely queued; Soft Refresh must obey that contract. Expose real pending/conflict/freshness state, not just a green connection icon. Persist pending work through crashes. Bounded exit flush is best-effort; `atexit` is not the only durability mechanism. Explicit webview shutdown must stop/join the worker and release resources safely.

Migrate schema on one authoritative primary and verify propagation to every qualified replica as a deployment policy. Validate supported DDL for the pinned version; do not assume a documentation-independent universal rule. Never let desktop instances apply competing migrations or push stale schema after restore.

Preserve `check_remote_lock()` semantics: a fresh successful remote locked result prevents startup; unavailable remote or missing table currently allows startup. Any change to that fail-open policy is a separate product decision. Share lifecycle ownership so the lock check cannot independently open/sync the live local file against another owner or accidentally push pending inventory. Bound network wait.

Package the actual import modules/native extensions discovered in the pinned wheel, collecting both data and binaries into PyInstaller Analysis. Do not assume `collect_all('pyturso')` is correct because that is the pip distribution name. Preserve certifi, Arabic fonts and UI assets. Test the frozen Windows executable on a clean machine without Python; include upgrade, shutdown/restart and offline/reconnect scenarios.

## 5. File integration map

Paths below are relative to this repository. This map includes omissions in the original handoff; create only the abstractions needed by the final architecture.

| Area | New files | Existing integration points |
|---|---|---|
| Auth | `app/models/user_model.py`, `app/routes/auth_routes.py`, `app/decorators.py`, provisioning command | `app/main.py`, `app/config.py`, **all** route modules including `log_routes.py` |
| Transactions/migrations | migration runner, `database/migrations/`, operation model/service, focused tests | `db_utils.py`, `item_service.py`, `item_model.py`, `movement_log_model.py`, metadata deletion guards, `database/schema.sql` |
| POs | `app/models/po_model.py`, `app/services/po_service.py`, `app/routes/po_routes.py` | barcode service (including font path), transaction primitive and log model |
| Leave orders/returns | `app/models/leave_order_model.py`, return-event data access, `app/services/leave_order_service.py`, `app/routes/leave_order_routes.py`, **`app/routes/ticket_routes.py`** | transaction primitive, log model, metadata guards |
| Auth UI | `AuthContext.tsx`, `Login.tsx`, `authService.ts`, optional `useAuth.ts` re-export | `main.tsx`, `App.tsx`, **`context/AppContext.tsx`**, **`services/apiClient.ts`**, all raw fetch call sites |
| Role UI | office read-only browser/dashboard as needed, shared capability map | Sidebar, ItemsManagement, Dashboard, ItemActions/CategoryActions, Settings |
| PO UI | PurchaseOrders, CreatePOModal, POScanScreen, **POConfirmScreen**, **POItemRow**, PrintablePurchaseOrder, `poService.ts`, `usePurchaseOrders.ts` | scanner dispatch, page switch, print components, types |
| Ticket UI | LeaveOrders, CreateLeaveOrderModal, TicketsPage, ReturnModal, `leaveOrderService.ts`, `useLeaveOrders.ts`, `useTickets.ts` | sidebar badge, types, shared modal/table/item selectors |
| Reporting/freshness | shared action labels and invalidation helpers if useful | Dashboard, MovementLog, PrintableReport, PrintReportButton, statsService, useDashboardStats, useMovementLogs, useSyncStatus, SoftRefreshButton |
| Optional sync | qualified owner/worker implementation | `requirements.txt`, `config.py`, `db_utils.py`, `main.py`, `run.py`, `run.spec`, Settings/status hooks |

## 6. Required verification and release gates

Add meaningful automated tests before implementing the affected behavior. Tests use isolated SQLite fixtures for domain logic and disposable real-driver databases for integration; never use embedded production credentials. Separate app construction from desktop launch so Flask's test client can exercise routes without GUI/network startup side effects.

| Gate | Required scenarios and assertions |
|---|---|
| Legacy characterization | Item add/search/detail, both pagination styles, duplicate/restore 409, barcode lookup/PNG/base64/label print, unit-change confirmation, categories/limit/archive/restore, metadata in-use errors, manual additions/removals, report filters/export and scanner reopen behavior. |
| Atomicity | Fail second line or log insertion in a receipt, leave order and return: no first-line balance/log/header survives. Explicit Return adds stock. Reject negative/fractional/boolean values and unknown action types at API and service boundaries. |
| Concurrency/retry | Two independent connections compete for last units; total stock never negative. Concurrent returns cannot exceed issued stock. Receipt versus void/expiry has exactly one legal winner. Duplicate key, lost response, restart and changed-payload replay cannot duplicate effects. |
| Auth | Every method/path in permission matrix, root/slash aliases, PATCH, exports/barcodes, direct API attacks, inactive users, session expiry/version change, CSRF, logout/login across roles and late in-flight responses. No protected-data polling before authentication. |
| Orders | Empty/duplicate/foreign lines, missing provider/destination, deleted metadata, inactive/archived items, unit mismatch, one short final receipt, all-zero rejection, over-receipt, expiry boundary, partial/full/repeated/late returns, manual closure reason and badge membership. |
| Reporting | Return action/actor/source on screen and printed output; Addition/Removal counts unchanged; legacy null actors and historical timestamps; Cairo date boundaries; no successful zero summary on database error. |
| Freshness | Office creates PO visible at warehouse; warehouse creates leave order visible in office badge/list; office return changes warehouse balance/log/dashboard after refetch. Errors show stale state; account changes reveal no previous user's data. |
| Migration | Fresh install and staging-copy upgrade, repeat/interrupted run, FK validation, preserved old stock/IDs/logs/remote settings, seeded credentials, schema mismatch message and restore rehearsal. |
| Desktop/print | Clean Windows packaged launch, Arabic fonts/certificates, login/cookies, scanner input, A4 single/multi-page print and cancel/reprint, existing item labels/reports, graceful exit and restart. |
| Offline if enabled | Two-device partitions, opposite sync orders, ID collisions, receipt/void races, failed bootstrap, restart with pending writes, push failure/replay, migration propagation and conflict recovery. Passing simple disconnect/reconnect CRUD alone is insufficient. |

Run frontend build and lint from `UI/`, plus an explicit TypeScript check (`tsc -b` with the installed project toolchain); `vite build` alone does not type-check. Record existing failures separately from regressions. Pin/install dependencies reproducibly and capture the Python test command and real-driver test configuration in the implementation PR.

The release is acceptable only after the relevant gates pass on a migrated staging copy and both operators complete the supported workflows. Remaining offline/security architecture decisions must be explicit in that release's scope. A reviewed spec reduces known risks; it cannot replace implementation verification.
