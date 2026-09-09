# SkyCourt Warehouse System Context

## Domain Vocabulary

- **Item (`الصنف`):** A physical product tracked in inventory. Has a unique name, unit of measurement, current quantity, cost, and lifecycle status (`active`, `inactive`, `archived`). System is 100% digital with no barcodes.
- **Unit (`الوحدة`):** The unit of measurement for items (e.g., Piece, Box, Meter, Kilogram). Unique by name. Deletion is restricted if referenced by any item.
- **Category (`الفئة`):** A hierarchical classification with parent and sub-categories. An item may belong to a sub-category. Deletion is restricted if sub-categories exist.
- **Provider / Supplier (`المورد`):** An external entity supplying items. Associated with Purchase Orders and default item supplier references.
- **Destination (`جهة الصرف / الوجهة`):** An authorized external or internal recipient for disbursed items. Associated with Leave Orders and stock removals.
- **Movement Log (`سجل الحركة`):** An immutable audit entry recording every change in item stock, including action type, quantity change, resulting balance, actor, timestamps, and order linkage.
- **Stock Movement Actions:**
  - **Addition (`إضافة`):** Inbound stock movement increasing an active item's balance (e.g. manual restock or Warehouse receipt of a dispatched Purchase Order).
  - **Removal (`صرف`):** Outbound stock movement reducing an active item's balance (e.g. manual issuance or Warehouse fulfillment of a Leave Order ticket).
  - **Return (`مرتجع`):** Inbound stock movement restoring previously disbursed units from a Leave Order back into inventory. Allowed for active, inactive, or archived items. Managed by the Office operator.
- **Purchase Order (PO) (`أمر شراء`):** An office-originated document ordering items from a provider. Follows lifecycle `draft` -> `open` (dispatched to warehouse) -> `closed` (received) or `void` (expired after 30 days or manually voided). Includes visual line-out audit tracing (`~~requested~~ ordered`) for quantity discrepancies.
- **Leave Order (LO) / Ticket (`أمر صرف / تذكرة صرف`):** An office-originated disbursement document releasing items to a destination, dispatched as an open ticket to Warehouse. Fulfilled all-or-nothing by Warehouse (dispense full & close with stock deduction, or reject back to Office with reason). Tracks dispensed quantities and Office returns.
- **User / Operator Roles:**
  - **Office (`المكتب`):** Initiates Leave Orders, creates and edits Draft POs, inspects physical items, audits quantities, dispatches orders to Warehouse, monitors logs, and handles returns.
  - **Warehouse (`المخزن`):** Reviews incoming Leave Order tickets to dispense full or reject, reviews incoming PO tickets to receive and close into stock, and manages inventory stock.
  - **Admin (`المدير`):** Manages user accounts, credentials, and system settings.

## Core Invariants & Business Rules

1. **Non-Negative Inventory:** An item's physical and recorded quantity (`current_quantity`) can never drop below zero. Outbound disbursements exceeding available stock must be rejected.
2. **Authoritative Single Writer:** The cloud-hosted LibSQL/Turso database is the sole authoritative writer. All stock-affecting mutations are executed synchronously and atomically against this authoritative engine.
3. **Offline Gating & Online-Only Architecture:** Offline synchronization and embedded local replicas are permanently abandoned (ADR 0001, ADR 0002). Offline stock mutations are strictly disabled. When disconnected from the authoritative cloud database, operations fail fast (HTTP 503 `OFFLINE_MUTATION_GATED` or `DATABASE_UNAVAILABLE`) rather than queueing local uncommitted writes. Product limitation: during internet or network outages, stock mutations and order lifecycle changes cannot be performed until connectivity is restored.
4. **Atomic Multi-line Execution:** Multi-item transactions (such as Purchase Order receipt lines or multi-line Leave Orders) must commit atomically with their corresponding movement log entries and idempotency records in a single database transaction. Partial execution is forbidden.
5. **Audit Trail Immutability:** Every change to inventory balance must produce a linked movement log entry. Log records are append-only and cannot be altered or purged by application operators.
6. **Idempotency:** Client-initiated mutations require an operation key (`operation_key`) to prevent duplicate executions from network retries, duplicate submits, or double-clicks.
7. **Referential Integrity:** Deletions of providers, destinations, units, or categories are restricted if referenced by active items, unresolved orders, or audit logs.

## Architectural Boundaries

- **Clients:** Desktop client application instances running Python/Flask with PyWebView frontend on Office and Warehouse workstations.
- **Database Engine:** Remote LibSQL database hosted on Turso infrastructure, accessed over encrypted HTTPS/WSS.
- **Driver Abstraction:** `app/models/db_utils.py` provides connection wrapping (`LibSQLConnectionWrapper`, `LibSQLRow`) ensuring transparent compatibility with standard SQLite DB-API semantics.
- **Execution Scoping:** Database connections are strictly scoped to the lifecycle of each Flask request context (`g.db`), with automatic rollback and connection closure upon request teardown.
