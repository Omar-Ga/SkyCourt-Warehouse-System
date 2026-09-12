[EXECUTION DIRECTIVE: IMPLEMENT APPROVED PLAN]
The implementation plan below has been reviewed and explicitly approved by management.
You are authorized and commanded to execute all code changes, database migrations, tests, and UI updates described in this document.

[EXECUTION INSTRUCTIONS]
1. Follow the Phased Implementation Order methodically across all 11 phases.
2. Create migration 003_digital_two_operator_workflow.sql, update models, services, routes, and React components.
3. Completely eliminate barcodes, barcode scanning components, and barcode services across the repository.
4. Run tests and build checks locally (pytest, npm --prefix UI run build, etc.) to verify that all workflows pass.
5. Report a concise summary of changes and verification evidence when complete.

================================================================================

# Turn 1 Discovery & Architecture Plan

## Scope Confirmation

`work_order_plan_turn1.md` explicitly requires discovery and architecture planning only. No application code, migration, test, or UI files were modified during this turn.

The worktree already contained unrelated pre-existing modifications, including changes under `.gitignore`, `CONTEXT.md`, `UI/`, `docs/`, and tests. Those changes were not reverted or modified.

## Current Architecture Findings

The repository is currently midway between the intended two-operator model and the legacy single-operator workflow.

### Database baseline

- `database/migrations/001_initial_schema.sql` defines the original inventory schema.
- `database/migrations/002_two_operator_overhaul.sql` adds users, operations, order tables, return events, and movement-log audit columns.
- `app/migrations.py` currently reports schema version `2`.
- `database/schema.sql` is the fresh-install target schema, but it still contains barcode columns and the old order constraints.
- Existing migrations are checksum-protected and must not be edited after application. The overhaul must be migration `003`.

### Current leave-order behavior

`app/services/leave_order_service.py` currently:

- Allows the Warehouse role to create Leave Orders.
- Deducts stock during Leave Order creation.
- Writes `Removal` movement logs during creation.
- Does not reserve stock separately.
- Has no Warehouse fulfillment or rejection operation.
- Supports manual close, but close does not represent the required physical dispensing action.
- Uses `quantity` and `returned_quantity`; it has no requested-versus-dispensed distinction.

This directly conflicts with the required workflow, where Office creation only reserves availability and Warehouse fulfillment performs the stock deduction.

### Current purchase-order behavior

`app/services/purchase_order_service.py` currently:

- Creates POs immediately as `open`.
- Starts expiry at creation.
- Uses a 48-hour expiry window.
- Makes Warehouse receive lines individually with partial receipt and struck-off dispositions.
- Allows the Warehouse to alter received quantities during receipt.
- Does not support editable Office drafts.
- Uses `barcode` as an alternate PO identifier.
- Does not hide newly created POs from Warehouse before dispatch.

### Current authorization mismatch

Current backend and frontend permissions conflict with management decisions.

Examples:

- `POST /api/leave-orders` is currently Warehouse-only in `app/routes/order_routes.py`.
- `POST /api/purchase-orders/<id>/receive` is already Warehouse-only.
- `GET /api/purchase-orders` is visible to both roles without draft-specific filtering.
- `GET /api/tickets` is visible to both roles and currently represents Leave Orders generically.
- Frontend `LeaveOrders.tsx` allows Warehouse creation.
- Frontend `Tickets.tsx` gives Office return controls but does not provide Warehouse dispense/reject controls.
- `UI/src/navigation.ts` currently gives Warehouse `LeaveOrders` and `POScan`, while Office receives `Tickets`.

### Barcode surface area

Barcode behavior is distributed across the entire stack, not isolated to `barcode_service.py`.

Backend call sites include:

- `app/models/item_model.py`
- `app/models/purchase_order_model.py`
- `app/services/item_service.py`
- `app/services/purchase_order_service.py`
- `app/services/barcode_service.py`
- `app/routes/items_routes.py`
- `app/routes/order_routes.py`
- `app/staging.py`
- Migration schemas
- Barcode-specific tests and release qualification

Frontend call sites include:

- `UI/src/types.ts`
- `UI/src/services/itemsService.ts`
- `UI/src/services/poService.ts`
- `UI/src/context/AppContext.tsx`
- `UI/src/components/BarcodeScannerOverlay.tsx`
- `UI/src/components/PrintableBarcode.tsx`
- `UI/src/components/AddItemModal.tsx`
- `UI/src/components/EditItemModal.tsx`
- `UI/src/components/PODetailModal.tsx`
- `UI/src/components/PrintablePurchaseOrder.tsx`
- `UI/src/pages/POScan.tsx`
- `UI/src/pages/Dashboard.tsx`
- `UI/src/App.tsx`

Dependencies and documentation also reference barcode functionality:

- `requirements.txt`
- `README.md`
- `RoadMap.md`
- `CONTEXT.md`
- Barcode-specific tests
- PinchTab UI tests and release tests

## Target Domain State Machines

### Leave Order state machine

Target states:

- `open`
- `rejected`
- `closed`
- `partially_returned`

Target transitions:

- `open -> closed`: Warehouse dispenses the complete requested quantity.
- `open -> rejected`: Warehouse rejects the ticket with a mandatory non-blank reason.
- `rejected -> open`: Office adjusts or confirms the ticket and dispatches it again.
- `rejected -> cancelled`: Office cancels the rejected request.
- `closed -> partially_returned`: Office returns some, but not all, dispensed stock.
- `partially_returned -> closed`: All dispensed stock has been returned, or the order remains operationally closed with all return quantities reconciled.

No partial Warehouse fulfillment is allowed. There must not be an endpoint that accepts arbitrary partial dispensing.

### Purchase Order state machine

Target states:

- `draft`
- `open`
- `closed`
- `void`
- `expired`

Target transitions:

- `draft -> draft`: Office edits the draft.
- `draft -> open`: Office dispatches the draft to Warehouse.
- `draft -> void`: Office cancels the draft.
- `open -> closed`: Warehouse performs the single atomic Receive & Close action.
- `open -> void`: Office cancels an open PO if that operation remains part of the existing workflow.
- `open -> expired`: The 30-day timer elapses after dispatch.
- `expired` and `closed` are terminal.
- `void` is terminal.

Drafts must never have an expiry timer. `expires_at` is set only during dispatch.

## Database Plan

### Migration version

Create:

```text
database/migrations/003_digital_two_operator_workflow.sql
```

Update the migration runner’s required version from `2` to `3`, but do not alter `001` or `002`.

Update `database/schema.sql` so fresh installations match the final version-3 schema.

### Barcode removal

The target schema must remove:

- `items.barcode`
- `purchase_orders.barcode`
- Barcode-specific indexes
- Barcode lookup constraints
- PO-number versus item-barcode collision logic

The migration should use table reconstruction rather than assuming `ALTER TABLE ... DROP COLUMN` support is consistent across SQLite and LibSQL.

Migration sequence:

1. Disable foreign-key enforcement for the reconstruction transaction.
2. Create replacement tables with the target schema.
3. Copy all non-barcode data.
4. Rebuild dependent child tables in dependency order.
5. Drop the old tables.
6. Rename replacement tables.
7. Recreate indexes and foreign keys.
8. Re-enable foreign-key enforcement.
9. Run `PRAGMA foreign_key_check` and integrity validation before recording migration completion.

Barcode values are intentionally discarded. They must not be preserved as a migration invariant.

### Items table

Target additions and changes:

```text
items
- remove barcode
- add reserved_quantity INTEGER NOT NULL DEFAULT 0
- enforce reserved_quantity >= 0
- enforce reserved_quantity <= current_quantity
```

`reserved_quantity` is the transaction-safe reservation counter for open Leave Orders.

The API should expose:

```text
current_quantity
reserved_quantity
available_quantity = current_quantity - reserved_quantity
```

The canonical business formula remains:

```text
available_stock =
  current_quantity -
  SUM(requested_quantity for active open Leave Order lines)
```

The denormalized `reserved_quantity` must equal that sum. New mutation code should validate and update both representations atomically.

Add or retain indexes for:

- `items.status`
- `items.name`
- `items.sub_category_id`

### Purchase order header

Target fields:

```text
purchase_orders
- remove barcode
- status CHECK ('draft', 'open', 'closed', 'void', 'expired')
- expires_at nullable while draft
- dispatched_at nullable while draft
- dispatched_by nullable while draft
- received_by
- closed_at
- revision
- voided_by
- voided_at
- void_reason
```

Constraints:

- `expires_at IS NULL` while `status = 'draft'`.
- `expires_at IS NOT NULL` once dispatched.
- `dispatched_at` is the authoritative start of the 30-day timer.
- `expires_at = dispatched_at + 30 days`.

Recommended indexes:

```text
(status, created_at)
(status, dispatched_at)
(provider_id)
```

### Purchase order lines

Replace the current quantity semantics with:

```text
purchase_order_items
- requested_quantity INTEGER NOT NULL CHECK(requested_quantity >= 0)
- ordered_quantity INTEGER NOT NULL CHECK(ordered_quantity >= 0)
- received_quantity INTEGER NOT NULL DEFAULT 0
- unit_price
- line_total
```

Use the following semantics:

- Original requested lines have `requested_quantity > 0`.
- Unfound items remain in the document with `ordered_quantity = 0`.
- Added or substitute lines may have `requested_quantity = 0` and `ordered_quantity > 0`.
- At least one line must have `ordered_quantity > 0` when dispatching.
- `received_quantity` remains zero until Warehouse Receive & Close.
- On successful receipt, every line is atomically set to its ordered quantity.
- The old partial-receipt `disposition` behavior should be removed or reduced to an internal compatibility field. The new workflow must not permit partial Warehouse receipt.

Preserve immutable line snapshots:

- Item name
- Unit ID
- Unit name
- Line description
- Provider snapshot as already implemented

Recommended indexes:

```text
(po_id)
(item_id)
(po_id, item_id)
```

### Leave order header

Target fields:

```text
leave_orders
- status CHECK ('open', 'rejected', 'closed', 'partially_returned', 'cancelled')
- rejection_reason nullable
- rejected_by nullable
- rejected_at nullable
- revision
- close metadata
```

`cancelled` is recommended even though the work order only explicitly requires `rejected`, because Office needs a durable cancellation result after a rejection.

Recommended index:

```text
(status, created_at)
```

### Leave order lines

Replace the current ambiguous `quantity` field with:

```text
leave_order_items
- requested_quantity INTEGER NOT NULL CHECK(requested_quantity > 0)
- dispensed_quantity INTEGER NOT NULL DEFAULT 0
- returned_quantity INTEGER NOT NULL DEFAULT 0
```

Constraints:

```text
dispensed_quantity >= 0
dispensed_quantity <= requested_quantity
returned_quantity >= 0
returned_quantity <= dispensed_quantity
```

Interpretation:

- At creation, `requested_quantity` is populated and `dispensed_quantity = 0`.
- At successful Warehouse fulfillment, `dispensed_quantity = requested_quantity`.
- At rejection, `dispensed_quantity` remains zero.
- Returns apply only to `dispensed_quantity`.
- Outstanding external quantity is `dispensed_quantity - returned_quantity`.

Recommended indexes:

```text
(leave_order_id)
(item_id)
(item_id, leave_order_id)
```

### Rejection audit

Header fields are sufficient for the latest rejection state, but rejection history should not be lost when Office resubmits.

Recommended append-only table:

```text
leave_order_rejection_events
- id
- leave_order_id
- reason
- rejected_by
- rejected_at
- revision
```

This table is not a stock ledger. It records workflow audit events and does not replace movement logs.

### Movement logs

Keep movement logs append-only and linked to order lines.

Required behavior:

- Leave Order creation produces no movement log.
- Leave Order rejection produces no movement log.
- Leave Order fulfillment produces one `Removal` log per line.
- PO receipt produces one `Addition` log per positive ordered line.
- Returns produce one `Return` log per returned line.
- Every stock mutation and its movement logs commit in the same transaction.
- Manual removals must not consume reserved quantities.

## Transaction Design

### Leave Order creation

`create_leave_order_service` must be redesigned as a reservation transaction.

Transaction sequence:

1. Validate Office actor, destination, non-empty unique lines, and idempotency key.
2. Validate all items are active.
3. Insert the Leave Order header as `open`.
4. Allocate the human-readable `LO-000042` number.
5. Insert line snapshots.
6. For each item, atomically increment `reserved_quantity` only if:

```text
current_quantity - reserved_quantity >= requested_quantity
```

7. If any reservation fails, roll back the entire order and all reservations.
8. Commit without changing `current_quantity`.
9. Return current and available quantities.

Concurrency requirement:

- The reservation update must be a single conditional SQL update.
- Do not rely on a prior read followed by an unconditional update.
- A competing reservation must fail with a stock conflict rather than creating a negative or over-allocated available balance.
- Use the existing LibSQL/SQLite transaction and retry patterns where appropriate.

### Warehouse fulfillment

Add a dedicated service operation, for example:

```text
fulfill_leave_order_service
```

Transaction sequence:

1. Require Warehouse or Admin role.
2. Require idempotency key and expected revision.
3. Load the order and require `status = 'open'`.
4. Verify every line is still reserved.
5. For each line, atomically execute:

```text
current_quantity = current_quantity - requested_quantity
reserved_quantity = reserved_quantity - requested_quantity
```

The update must require:

```text
current_quantity >= requested_quantity
reserved_quantity >= requested_quantity
status = 'active'
```

6. Write linked `Removal` movement logs.
7. Set each line’s `dispensed_quantity = requested_quantity`.
8. Set the order to `closed`.
9. Record Warehouse actor and close timestamp.
10. Complete idempotency and commit.

The stock update, reservation release, line updates, order closure, movement logs, and operation record must be one transaction.

### Warehouse rejection

Add a dedicated service operation, for example:

```text
reject_leave_order_service
```

Transaction sequence:

1. Require Warehouse or Admin role.
2. Require expected revision and idempotency key.
3. Require `status = 'open'`.
4. Validate a trimmed, non-blank rejection reason.
5. Decrement each line’s reservation.
6. Set status to `rejected`.
7. Store latest rejection metadata.
8. Append a rejection event.
9. Write no stock movement log.
10. Commit atomically.

### Office rejected-order handling

Add operations for:

- Editing a rejected order.
- Resubmitting it as `open`.
- Cancelling it as `cancelled`.

Editing must be allowed only for `rejected` orders. Resubmission must perform the same atomic availability check as initial creation.

### Returns

Retain the existing return transaction pattern but change validation to use:

```text
remaining_returnable = dispensed_quantity - returned_quantity
```

Do not allow returns against merely requested or rejected quantities.

Return processing must:

- Remain Office-only.
- Require idempotency and revision.
- Validate line ownership.
- Allow returns to active, inactive, or archived items as currently designed.
- Increment current stock without affecting reserved stock.
- Create `Return` movement logs.
- Update returned quantities and return-event rows atomically.

### Manual inventory removal

Update `item_model.subtract_item_quantity_conditional` so manual removal requires:

```text
current_quantity - reserved_quantity >= amount
```

A Warehouse operator must not be able to manually remove stock already reserved for an open Leave Order.

### Purchase order draft creation

`create_purchase_order_service` must:

- Require Office role.
- Create status `draft`.
- Set `expires_at = NULL`.
- Set `dispatched_at = NULL`.
- Preserve requested quantities.
- Avoid any stock mutation.
- Avoid barcode or collision logic.
- Require idempotency.

### Purchase order draft editing

Add a draft update operation that:

- Requires Office role.
- Requires expected revision and idempotency key.
- Allows provider, notes, lines, quantities, prices, descriptions, and substitute lines to change.
- Preserves `requested_quantity` as the audit baseline.
- Allows `ordered_quantity = 0`.
- Requires unique item IDs per PO.
- Rejects edits after dispatch.
- Recomputes line totals and header total server-side.
- Increments revision.

The simplest safe API shape is a full replacement of draft lines inside one transaction, rather than many independent line mutations.

### Purchase order dispatch

Add:

```text
POST /api/purchase-orders/<id>/dispatch
```

The service must:

- Require Office role.
- Require `status = 'draft'`.
- Validate all line references and snapshots.
- Require at least one positive `ordered_quantity`.
- Set `status = 'open'`.
- Set `dispatched_at` to authoritative UTC time.
- Set `expires_at` to exactly 30 days after dispatch.
- Set `dispatched_by`.
- Increment revision.
- Commit without changing inventory.

### Purchase order expiry

The 30-day timer must be based on `dispatched_at`, never `created_at`.

Use the existing effective-status approach for reads, but centralize it in one service/model helper:

- Drafts always remain non-expiring.
- Open orders with `expires_at <= now` are expired.
- Warehouse ticket lists exclude expired orders.
- Receive attempts at or after expiry atomically persist `expired` and reject the receipt.
- The expiry reason must be recorded.
- Expiry must never alter inventory.

### Purchase order receive and close

Replace the current partial receipt API with a single-click operation:

```text
POST /api/purchase-orders/<id>/receive
{
  "expected_revision": 2
}
```

Transaction sequence:

1. Require Warehouse or Admin role.
2. Require idempotency key.
3. Require `status = 'open'`.
4. Check the 30-day expiry boundary.
5. Set every line’s `received_quantity = ordered_quantity`.
6. Atomically increment active item stock for every positive ordered line.
7. Write linked `Addition` logs.
8. Set PO status to `closed`.
9. Record receiver and close timestamp.
10. Increment revision.
11. Complete idempotency and commit.

There must be no client-provided received quantities and no partial close path.

## Backend File Impact

### Models

Update:

- `app/models/item_model.py`
- `app/models/purchase_order_model.py`
- `app/models/leave_order_model.py`
- `app/models/movement_log_model.py` only as needed for new linkage
- Add a small model module for rejection events only if that keeps the existing model manageable

Remove model functions related to:

- Item barcode lookup
- Barcode existence checks
- PO barcode lookup
- PO barcode collision checking
- PO barcode updates

### Services

Update:

- `app/services/item_service.py`
- `app/services/purchase_order_service.py`
- `app/services/leave_order_service.py`
- `app/services/idempotency_service.py` only if new operations need additional response/replay handling

Delete:

- `app/services/barcode_service.py`

Ensure every new operation has a unique `operation_type`, such as:

```text
purchase_order_create_draft
purchase_order_edit_draft
purchase_order_dispatch
purchase_order_receive
purchase_order_void
leave_order_create
leave_order_fulfill
leave_order_reject
leave_order_edit_rejected
leave_order_resubmit
leave_order_cancel
leave_order_return
```

### Routes

Update `app/routes/order_routes.py`:

- PO list/detail:
  - Office sees all permitted PO states.
  - Warehouse sees dispatched open/closed/expired/void POs as appropriate.
  - Warehouse never receives draft POs.
- PO creation remains Office-only.
- Add draft edit endpoint, Office-only.
- Add dispatch endpoint, Office-only.
- Simplify receive endpoint to Warehouse/Admin single-click semantics.
- Retain or revise void endpoint according to the final cancellation policy.
- Remove `/by-barcode/...`.
- Remove `/<po_id>/barcode`.
- Change Leave Order creation to Office-only.
- Add Warehouse fulfill endpoint.
- Add Warehouse reject endpoint.
- Add Office rejected-order edit/resubmit/cancel endpoints.
- Keep return endpoint Office-only.
- Remove generic close endpoints that allow either role to bypass the physical fulfillment workflow.
- Replace generic ticket list behavior with role-specific disbursement-ticket queries.

Update `app/routes/items_routes.py`:

- Remove barcode imports.
- Remove barcode request fields from allowlists.
- Remove item barcode lookup.
- Remove item barcode image generation.
- Remove base64 barcode generation.
- Ensure search uses name and numeric ID only.
- Preserve Warehouse item creation and editing without barcode fields.

### Role decorators

Route decorators must enforce the final matrix at the API boundary, not only in React:

- Office:
  - Create/edit/dispatch POs
  - Create/edit/resubmit/cancel Leave Orders
  - Process returns
  - Read Office-side history and logs
- Warehouse:
  - Fulfill or reject disbursement tickets
  - Receive and close dispatched POs
  - Manage item stock and metadata
  - Read Warehouse ticket views
- Admin:
  - Union of Office and Warehouse capabilities
- Both roles may read shared item and audit information where permitted.
- Draft PO filtering must still occur inside the service/model even if a client bypasses the UI.

## Frontend Plan

### Navigation model

Replace the current `PageId` set with role-aligned pages:

Warehouse:

- `Dashboard`
- `Items`
- `DisbursementTickets`
- `POTickets`
- `Logs`
- `Units`
- `Destinations`
- `Providers`
- `Settings`

Office:

- `Dashboard`
- `Items`
- `LeaveOrders`
- `PurchaseOrders`
- `Logs`
- `Settings`

Admin may receive the union.

Remove:

- `POScan`
- The old generic `Tickets` role assignment
- Warehouse access to the Office `LeaveOrders` management page
- Office access to Warehouse ticket processing pages

Update:

- `UI/src/navigation.ts`
- `UI/src/components/Sidebar.tsx`
- `UI/src/App.tsx`
- `UI/src/hooks/useCapabilities.ts`
- Navigation tests

### Barcode removal from frontend

Remove:

- `UI/src/components/BarcodeScannerOverlay.tsx`
- `UI/src/components/PrintableBarcode.tsx`
- Global scanner state from `UI/src/context/AppContext.tsx`
- `openScanner`
- `closeScanner`
- `handleBarcodeScan`
- `scannedItem`
- Barcode-related adjustment flow
- `POScan.tsx`
- Dashboard scanner controls
- Barcode generation controls from `AddItemModal.tsx`
- Barcode editing and printing controls from `EditItemModal.tsx`

Retain manual inventory adjustment for Warehouse through an explicit item selection flow if that workflow remains required.

Update `UI/src/types.ts` to remove `Item.barcode`.

Update `UI/src/services/itemsService.ts` and `UI/src/services/poService.ts` to remove barcode methods and types.

### Office Leave Orders page

Refactor `UI/src/pages/LeaveOrders.tsx` to:

- Show Office-created requests.
- Display `open`, `rejected`, `closed`, `partially_returned`, and `cancelled`.
- Show available stock before submission.
- Create orders without suggesting immediate stock deduction.
- Show rejection reasons.
- Allow editing and resubmission of rejected tickets.
- Allow cancellation of rejected tickets.
- Allow Office return processing only for dispensed quantities.
- Refresh item availability after creation, rejection, fulfillment, and returns.

Update `CreateLeaveOrderModal.tsx`:

- Use `available_quantity`, not `current_quantity`, for client-side guidance.
- Treat server validation as authoritative.
- Change the submit label from immediate disbursement to request dispatch.
- Add an explicit warning that Warehouse must fulfill the ticket.

### Warehouse Disbursement Tickets page

Create a dedicated Warehouse page, either by renaming/adapting `Tickets.tsx` or adding a new `DisbursementTickets.tsx`.

It must:

- List only `open` disbursement tickets.
- Show requested quantities and current reserved quantities.
- Show item and destination snapshots.
- Provide one “Dispense & Close” action.
- Provide one “Reject” action.
- Require a non-blank rejection reason.
- Never expose partial quantity inputs.
- Handle revision conflicts by refreshing the ticket.
- Show the outcome and affected stock balances after fulfillment.

### Office Purchase Orders page

Update `PurchaseOrders.tsx` to:

- Show drafts, open, closed, void, and expired POs.
- Restrict creation and editing to Office/Admin.
- Show draft status without an expiry timer.
- Show the dispatch date and 30-day expiry after dispatch.
- Open a draft editor.
- Dispatch a completed draft.
- Show rejection/void/expiry reasons where applicable.
- Render quantity discrepancies as:
  - `~~5~~ 3`
  - `~~5~~ 0`
  - `3` for unchanged lines
  - A clear “new/substitute” marker for lines with requested quantity zero and ordered quantity greater than zero.

### Office draft editing modal

Extend `CreatePOModal.tsx` or introduce `EditPOModal.tsx`.

Required fields:

- Provider
- Notes
- Item
- Requested quantity, read-only for existing lines
- Ordered quantity, editable
- Unit price
- Description

Required behavior:

- Add substitute lines.
- Keep unfound lines at ordered quantity zero.
- Prevent duplicate items.
- Recalculate totals locally for usability.
- Recalculate totals server-side for authority.
- Require revision and idempotency on save.
- Permit saving without dispatching.
- Require a separate explicit dispatch action.

### Warehouse PO Tickets page

Create `POTickets.tsx`.

It must:

- Show only dispatched open POs.
- Never show drafts.
- Show the requested-versus-ordered audit trace.
- Show provider, dispatch date, expiry date, and line snapshots.
- Provide a single “Receive & Close” action.
- Not allow per-line quantity edits.
- Not allow partial receipts.
- Refresh after receipt and update item balances, dashboards, and logs.

`POReceiptModal.tsx` should be replaced or reduced to a confirmation modal without quantity editing.

### PO detail and printable output

`PODetailModal.tsx` should:

- Remove barcode prefetching and barcode state.
- Retain human-readable PO number display.
- Retain ordinary printable PO output if required.
- Add draft edit and dispatch actions for Office.
- Add audit quantity rendering.

`PrintablePurchaseOrder.tsx` should:

- Remove `BarcodeResponse`.
- Remove barcode image and barcode label.
- Display the PO number prominently as human-readable text.
- Display requested and ordered quantities with the same audit semantics as the application view.
- Show dispatch and expiry metadata only after dispatch.

## Barcode Dependency Cleanup

Remove from `requirements.txt`:

- `python-barcode`
- `python-escpos`

Verify whether any other code uses `escpos` before removal. The repository search found it in the dependency and barcode qualification surface, but this must be confirmed during implementation.

Update:

- `README.md`
- `RoadMap.md`
- `CONTEXT.md`
- `app/staging.py`
- Release qualification tests
- Legacy characterization tests
- All barcode-related test fixtures and comments

The idempotency rule in `CONTEXT.md` currently mentions barcode scanner rereads. Replace that example with generic retry, duplicate-submit, and network-retry behavior.

## Legacy Data Migration Strategy

This needs to be explicit because the current production semantics differ from the target semantics.

### Existing Leave Orders

Under the current system, creation already deducted stock. Therefore, existing `open` Leave Orders cannot safely be treated as newly created reservations.

Migration policy:

- Convert existing legacy `open` orders to `closed` with `dispensed_quantity = quantity`.
- Convert existing `partially_returned` orders to `partially_returned` with:
  - `requested_quantity = quantity`
  - `dispensed_quantity = quantity`
  - Existing returned quantity preserved.
- Set `reserved_quantity = 0` for migrated legacy orders.
- Preserve existing movement logs.
- Record migration treatment in the migration log or an administrative note.

This prevents the new Warehouse fulfillment operation from deducting legacy stock a second time.

### Existing Purchase Orders

For existing POs:

- Set `requested_quantity = ordered_quantity`.
- Preserve line snapshots and financial values.
- Treat historical creation as dispatch:
  - `dispatched_at = created_at`
  - `dispatched_by = created_by` where appropriate
- Recalculate the expiry policy according to the approved migration decision:
  - Either preserve historical expiry for audit compatibility, or
  - Rebase open orders to a 30-day window from historical creation.
- Existing closed POs remain closed.
- Any historically partially received but still open PO must be resolved during migration, because the target workflow does not support partial receipt continuation.

The implementation should include a staging rehearsal that reports ambiguous rows before production rollout.

## Test Plan

### Migration tests

Update `tests/test_migrations.py`:

- Fresh install applies `[1, 2, 3]`.
- Required schema version is `3`.
- Barcode columns are absent.
- New status constraints exist.
- `requested_quantity`, `dispensed_quantity`, `returned_quantity`, and `reserved_quantity` exist.
- Draft POs allow null expiry.
- Open POs require dispatch metadata.
- Legacy item quantities remain unchanged.
- Legacy barcode values are intentionally absent.
- Legacy Leave Orders are mapped without double-deduction risk.
- Foreign-key and integrity checks pass.
- Migration rerun remains idempotent.
- Broken migration rolls back completely.
- Migration checksum validation remains enforced.

### Purchase-order tests

Update and extend `tests/test_purchase_orders.py`:

- Office creation returns `draft`.
- Draft creation does not set expiry.
- Draft creation does not affect inventory.
- Warehouse cannot list or fetch Office-only drafts.
- Office can edit a draft.
- Existing requested quantities remain unchanged after edits.
- Ordered quantities can be reduced to zero.
- Added/substitute lines are accepted.
- Draft dispatch starts the 30-day timer.
- Dispatch is Office-only.
- Expiry is based on dispatch time.
- Expired POs cannot be received.
- Warehouse receives a PO through one atomic action.
- Receipt increments every ordered item exactly once.
- Receipt creates Addition logs.
- Receipt closes the PO and increments revision.
- Partial receipt payloads are rejected or no longer accepted.
- Idempotent receipt replay does not duplicate stock or logs.
- Revision conflicts are handled.
- Barcode endpoints return 404 because they no longer exist.
- PO response contains no barcode field.

The following existing barcode-specific tests must be removed or replaced:

- `test_po_barcode_endpoints`
- `test_reserved_po_barcode_prefix_on_items`
- `test_po_number_collision_fallback`

### Leave-order tests

Update and extend `tests/test_leave_orders.py`:

- Office can create a Leave Order.
- Warehouse cannot create a Leave Order.
- Creation does not change `current_quantity`.
- Creation increments reservation state.
- Available stock is current quantity minus active reservations.
- Multiple open Leave Orders cannot over-allocate an item.
- Concurrent creation allows only one request to consume the final availability.
- Warehouse can fulfill an open ticket.
- Fulfillment deducts stock exactly once.
- Fulfillment releases reservation exactly once.
- Fulfillment creates Removal logs only at fulfillment time.
- Warehouse can reject an open ticket.
- Blank rejection reasons are rejected.
- Rejection creates no stock movement.
- Rejection releases reservations.
- Office sees rejection reason.
- Rejected tickets can be edited and resubmitted.
- Office can cancel rejected tickets.
- Partial fulfillment is impossible.
- Returns cannot exceed dispensed quantity.
- Returns credit stock and create Return logs.
- Inactive and archived item returns remain supported.
- Idempotency and revision conflict behavior is preserved.

### Permission tests

Update `tests/test_permissions.py`:

- Test every new route with Office, Warehouse, Admin, and unauthenticated clients.
- Verify Warehouse cannot create, edit, dispatch, or cancel POs.
- Verify Warehouse cannot create or edit Leave Orders.
- Verify Office cannot fulfill or reject Leave Orders.
- Verify Office cannot receive POs.
- Verify drafts are not visible to Warehouse even through direct API access.
- Verify removed barcode routes are unavailable.
- Verify removed POScan functionality is not represented in navigation.
- Verify Office and Warehouse ticket counts are role-specific.

### Barcode and release tests

Update:

- `tests/test_legacy_characterization.py`
- `tests/test_release_qualification.py`
- `tests/test_staging_rehearsal.py`

Remove barcode generation imports, fixtures, assertions, and dependency checks.

Replace staging barcode preservation assertions with:

- Intentional barcode removal verification.
- Item ID preservation.
- Stock balance preservation.
- Movement log preservation.
- Reservation consistency validation.
- Order migration consistency validation.

### Frontend tests

Update:

- `UI/tests/navigation.test.ts`
- `UI/tests/poService.test.ts`
- `UI/tests/freshness.test.ts`

Add coverage for:

- Role-specific page lists.
- Absence of `POScan`.
- Warehouse sees Disbursement Tickets and PO Tickets.
- Office sees Leave Orders and Purchase Orders.
- PO service payloads for draft creation, draft edit, dispatch, and single-click receive.
- Barcode methods and fields are absent.
- Requested-versus-ordered rendering.
- Draft expiry display behavior.
- Rejected Leave Order rendering.
- No partial fulfillment controls.

Update `tests/test_pinchtab_automated_suite.py` to match the new Arabic navigation labels and exercise:

- Office creates a Leave Order.
- Warehouse sees a Disbursement Ticket.
- Warehouse fulfills or rejects it.
- Office sees rejection reason and resubmits.
- Office creates and edits a draft PO.
- Office dispatches it.
- Warehouse sees it in PO Tickets.
- Warehouse receives and closes it.
- No scanner or barcode UI exists.

## Phased Implementation Order

### Phase 1: Freeze target contracts

Document and approve:

- Final status values.
- Legacy migration policy.
- Whether manual PO void remains available after dispatch.
- Whether `cancelled` is included for Leave Orders.
- Exact role visibility for closed and expired POs.
- Whether ordinary human-readable PO printing remains supported.

Do not begin code changes until these are fixed.

### Phase 2: Build and rehearse migration

Implement migration `003` in isolation.

Verify:

- Fresh install.
- Legacy upgrade.
- Table reconstruction.
- Barcode removal.
- Reservation consistency.
- Legacy Leave Order conversion.
- Foreign-key integrity.
- Rollback behavior.

Run staging rehearsal against a realistic legacy copy before changing services.

### Phase 3: Implement domain and model changes

Update models and low-level stock operations first:

- Item availability and reservation operations.
- PO draft fields and queries.
- Leave Order requested/dispensed fields.
- Rejection metadata.
- Visibility filters.
- Movement log linkage.

Add unit tests at this layer before route work.

### Phase 4: Implement backend services

Implement in this order:

1. Leave Order reservation creation.
2. Leave Order fulfillment.
3. Leave Order rejection.
4. Rejected-order editing and resubmission.
5. Returns based on dispensed quantities.
6. PO draft creation.
7. PO draft editing.
8. PO dispatch and expiry.
9. Atomic PO Receive & Close.
10. Manual stock-adjustment protection for reserved inventory.
11. Barcode route and service removal.

### Phase 5: Update backend routes and permissions

Add and remove endpoints according to the final matrix.

Verify direct HTTP access independently of the UI.

### Phase 6: Refactor frontend navigation

Remove scanner and barcode state first, then introduce the role-specific navigation pages.

This avoids leaving old global context paths referenced by newly changed components.

### Phase 7: Implement Office workflow UI

Implement:

- Office Leave Orders.
- Rejected-order handling.
- Returns.
- Draft PO creation.
- Draft editing.
- Dispatch.
- Audit quantity rendering.

### Phase 8: Implement Warehouse workflow UI

Implement:

- Disbursement Tickets.
- Full dispense.
- Mandatory rejection.
- PO Tickets.
- Single-click Receive & Close.

### Phase 9: Update printable and reporting surfaces

Retain only human-readable documents.

Update:

- Printable PO output.
- Movement logs.
- Dashboard stock and availability displays.
- Freshness/reporting output.
- Any CSV or print views that still select barcode columns.

### Phase 10: Remove dependencies and stale references

Delete barcode services and components after all consumers are removed.

Run repository-wide searches for:

```text
barcode
Barcode
scanner
Scanner
POScan
by-barcode
generate-barcode
python-barcode
escpos
```

No production source, test, dependency, or documentation reference should remain unless it explicitly describes the historical migration.

### Phase 11: Full verification

Recommended commands after implementation:

```bash
pytest
npm --prefix UI run lint
npm --prefix UI run test
npm --prefix UI run build
python -m app.migrations --check
```

Run the staging rehearsal:

```bash
flask --app app.main staging-rehearsal
```

Perform a final role matrix check using both API tests and the PinchTab qualification suite.

## Acceptance Criteria

The overhaul is complete only when all of the following are true:

- No barcode columns, endpoints, services, scanner overlays, or barcode printing paths remain.
- Items and orders are found by names, IDs, and human-readable numbers.
- Office creates Leave Orders.
- Leave Order creation changes reservations, not physical stock.
- Available stock cannot be over-allocated, including under concurrency.
- Warehouse either dispenses the complete ticket or rejects it with a reason.
- Removal logs occur only at physical fulfillment.
- Rejected tickets return to Office with the reason.
- Returns credit stock based only on actually dispensed quantities.
- Office-created POs begin as drafts.
- Draft POs are invisible to Warehouse.
- Drafts have no expiry timer.
- Office can edit quantities and add substitute lines.
- Requested quantities remain auditable.
- Dispatch starts the exact 30-day expiry timer.
- Warehouse sees dispatched POs in PO Tickets.
- Receive & Close atomically updates all ordered stock and logs.
- Inventory never becomes negative.
- Reserved inventory cannot be removed through manual adjustment.
- Every mutation remains idempotent and revision-aware.
- All role rules are enforced server-side.
- Migration preserves legitimate inventory and audit data while intentionally removing barcode data.
- Fresh-install, legacy-upgrade, API, frontend, staging, and end-to-end verification all pass.

