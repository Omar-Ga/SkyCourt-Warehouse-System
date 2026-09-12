[PLANNING DIRECTIVE: DISCOVERY & ARCHITECTURE ONLY]
We are preparing to implement a major system overhaul: the 100% Digital Two-Operator Workflow and Complete Barcode Deprecation.
DO NOT modify any code during this turn. This is strictly a discovery, architectural analysis, and implementation planning turn.

[WORKER FOCUS]
You are a lead architect and senior full-stack Python/React engineer. Your goal is to analyze the codebase deeply and produce a comprehensive, watertight implementation plan for this overhaul.

[BACKGROUND & DECISIONS ALREADY SETTLED WITH MANAGEMENT]
1. Complete Barcode Deprecation:
   - Barcodes are completely removed across the entire system: no item barcodes, no PO barcodes, no barcode scanner overlay/screens, and no barcode printing services.
   - Items and orders are identified digitally by names, IDs, and human-readable numbers (e.g. PO-000042, LO-000042).

2. Office-Initiated Leave Orders (Disbursement Tickets):
   - Office operator initiates Leave Orders for items in stock.
   - Available stock check at creation: available_stock = current_quantity - sum(active_open_leave_orders). Office cannot over-allocate.
   - Dispatched to Warehouse operator as an open ticket in a dedicated "Disbursement Tickets" tab (تذاكر الصرف).
   - Stock deduction (Removal movement log) does NOT happen at creation; it happens ONLY when the Warehouse operator physically dispenses the items and closes the ticket.
   - All-or-nothing fulfillment rule: Warehouse operator must dispense the full quantity requested or reject the ticket back to Office with a mandatory non-blank rejection reason (rejected status).
   - If rejected, ticket returns to Office view with reason for adjustment or cancellation.
   - Returns (مرتجع): Unused disbursed items are returned to Office, which logs a Return and credits stock back as previously designed.

3. Draft Purchase Orders with Audit Strikethroughs & 30-Day Expiry:
   - Office operator creates a Purchase Order in draft status for items not in stock.
   - While in draft: visible ONLY to Office (hidden from Warehouse), has no expiration timer, and is freely editable.
   - Employees go buy items and return to Office. Office physically inspects the items.
   - Office edits Draft PO before dispatch:
     - Can adjust quantities. Unfound items remain with ordered_quantity = 0.
     - Visual line-out audit trace: both Office and Warehouse must render discrepancies as ~~requested~~ ordered (e.g. ~~5~~ 3 or ~~5~~ 0).
     - Can add new/substitute items if needed.
   - Office clicks "Send to Warehouse": status becomes open (dispatched to Warehouse).
   - 30-Day Expiry Timer: Starts at the moment of Warehouse dispatch.
   - Warehouse Intake: Warehouse receives the PO in a dedicated "PO Tickets" tab (تذاكر التوريد). Warehouse performs a single-click "Receive & Close" (استلام وإغلاق التذكرة), which atomically increments stock (Addition log), marks PO closed, and updates Office.

4. UI Navigation & Role Access:
   - Warehouse operator navigation:
     - Dashboard (الرئيسية)
     - Items (إدارة الأصناف)
     - Disbursement Tickets (تذاكر الصرف) - incoming Leave Orders from Office
     - PO Tickets (تذاكر التوريد) - incoming PO shipments from Office
     - Logs (سجل الحركات), Units, Destinations, Providers, Settings.
     - (Remove standalone POScan / LeaveOrders tabs).
   - Office operator navigation:
     - Dashboard (الرئيسية)
     - Items (دليل الأصناف)
     - Leave Orders (أذونات الصرف) - create, track, handle rejections, process returns
     - Purchase Orders (أوامر الشراء) - create drafts, audit/edit, dispatch, monitor
     - Logs (تقارير الحركات), Settings.

[CANDIDATE FILES & STARTING POINTS]
- High-level domain context: CONTEXT.md
- Database schema & migrations: database/schema.sql, database/migrations/
- Backend models: app/models/purchase_order_model.py, app/models/leave_order_model.py, app/models/item_model.py
- Backend services: app/services/purchase_order_service.py, app/services/leave_order_service.py, app/services/item_service.py, app/services/barcode_service.py
- Backend routes: app/routes/order_routes.py, app/routes/items_routes.py
- Frontend components & pages: UI/src/navigation.ts, UI/src/App.tsx, UI/src/components/Sidebar.tsx, UI/src/pages/Tickets.tsx, UI/src/pages/LeaveOrders.tsx, UI/src/pages/PurchaseOrders.tsx, UI/src/pages/POScan.tsx, UI/src/components/CreatePOModal.tsx, UI/src/components/CreateLeaveOrderModal.tsx, UI/src/components/PODetailModal.tsx, UI/src/components/POReceiptModal.tsx
- Test suites: tests/test_purchase_orders.py, tests/test_leave_orders.py, tests/test_permissions.py

[PLANNING REQUIREMENTS]
1. Map all database schema changes: new migration file for deprecating/removing barcodes, adding requested_quantity, introducing draft and rejected statuses, updating constraints, and indexes.
2. Outline backend changes: service layer transactions, atomic operations, available stock calculation, 30-day expiry handling, and route role decorators.
3. Outline frontend changes: routing, navigation permissions, dual ticket tabs for warehouse, strikethrough UI rendering for PO audit tracing, modal forms for draft editing and dispatching.
4. Detail testing and verification: list existing tests to update, new unit/integration tests to write, and verification commands.
5. Present a phased, step-by-step implementation order.

[ANTI-LAZINESS DIRECTIVES]
- Search and trace all call sites: Barcode removal affects item models, routes, React components, and printable views. Do not leave dangling imports or broken references.
- Invariant integrity: Ensure Non-Negative Inventory and Single-Writer cloud LibSQL atomicity are preserved in all stock operations.
- Do NOT edit code in this turn. Deliver a complete architectural implementation plan.
