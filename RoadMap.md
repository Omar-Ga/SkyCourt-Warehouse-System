# SkyCourt Warehouse System - Development Roadmap

This roadmap outlines the journey from the current "Digital Inventory Ledger" to a fully-fledged, commercially viable Warehouse Management System (WMS) tailored for Small and Medium Businesses (SMBs). The goal is to shift from simply *counting items* to *orchestrating workflows, physical locations, and users*.

## Phase 1: Security & Fundamentals (Completed)
*Target: Make the system secure and suitable for multi-employee environments.*

- [x] **User Authentication:** Implemented robust session authentication with bcrypt password hashing and session version invalidation.
- [x] **Role-Based Access Control (RBAC):**
  - **Admin:** Full access (user management, settings, cross-workflow visibility).
  - **Warehouse Operator:** Operational access (process disbursement tickets, receive PO tickets, manage item catalog & units/destinations/providers, cannot access office PO drafting or leave order initiation).
  - **Office Operator:** Order origination access (create draft POs with line-out audit trails, initiate leave orders, manage returns, inspect catalogs, view movement reports).
- [x] **Audit Trail Binding:** Bound all movement logs immutably to the authenticated `user_id` with Cairo timezone normalization.

## Phase 2: Core Warehouse Logic & Spatial Awareness
*Target: Stop searching for items and automate inventory health.*

- [ ] **Physical Location Mapping:**
  - Add `aisle`, `rack`, `shelf`, and `bin` tracking to the database schema.
  - Update the UI so workers are directed exactly where to walk to find or put away an item.
- [ ] **Low Stock Alerts & Thresholds:**
  - Introduce a `reorder_point` (minimum quantity) column in the `items` table.
  - Create a dashboard widget for "Items Needing Reorder."
  - Implement automated in-app notifications when stock dips below the threshold.
- [ ] **Product Variants & SKUs:** Graduate from simple names to formal SKUs to handle sizes, colors, and specific variations.

## Phase 3: Digital Two-Operator Workflows & Order Orchestration (Completed)
*Target: Move away from manual additions/subtractions to order-driven orchestration.*

- [x] **Order Orchestration (Purchase Orders & Leave Order Tickets):**
  - **Inbound (Receiving):** Office creates Draft POs, edits quantities with visual line-out audit traces (`~~requested~~ ordered`), and dispatches to Warehouse with a 30-day auto-expiry timer. Warehouse receives and atomically closes into stock with a single click.
  - **Outbound (Fulfillment):** Office initiates Leave Orders with available stock reservations (`available_stock = current_quantity - sum(active_open_leave_orders)`). Dispatched to Warehouse as open disbursement tickets.
  - **All-or-Nothing Fulfillment & Rejections:** Warehouse dispenses full quantity or rejects back to Office with a mandatory reason, releasing stock reservations cleanly.
  - **Returns Management:** Office manages returns for disbursed items, atomically crediting inventory and writing linked Return movement logs.
  - **100% Digital Identification & Barcode Deprecation:** Completely retired barcodes, barcode scanners, and barcode services in favor of digital IDs and human-readable order numbers.
  - **Cloud-Authoritative Writer & Offline Mutation Gating:** Sole authoritative Turso LibSQL database writer; offline mutations gated to prevent data divergence (ADR 0001, ADR 0002).
- [ ] **Pick/Pack Workflows:**
  - Generate a "Pick List" that sorts items by their physical location in the warehouse to optimize the worker's walking route.
- [ ] **Batch/Lot & Serial Number Tracking:**
  - Required for businesses moving perishables (food/pharma) or electronics by tracking individual unit serials or batch expiration dates.
  - Support FIFO (First-In-First-Out) picking logic.

## Phase 4: Integrations & Reporting
*Target: Connect the warehouse to the rest of the business.*

- [ ] **E-commerce & Accounting Integrations:**
  - Webhooks and REST API endpoints to sync live inventory with Shopify, WooCommerce, or accounting software like QuickBooks.
- [ ] **Advanced Analytics:**
  - Track worker productivity (e.g., "Picks per hour").
  - Identify "dead stock" (items that haven't moved in months to avoid tying up capital).
  - Calculate inventory valuation dynamically based on current wholesale costs.
- [ ] **Mobile Warehouse UI:** Optimize ticket views (picking, receiving) for rugged Android devices or mobile phones.

## Phase 5: Cloud SaaS Transition (If Applicable)
*Target: If pivoting from a local desktop app to a hosted web product sold to multiple businesses.*

- [ ] **Multi-Tenant Database Architecture:** Add `tenant_id` or `company_id` to every table ensuring strict data isolation between different client companies.
- [ ] **Onboarding Flow:** Let users create their own company, invite their employees, and map their warehouse zones immediately upon signing up.

---

### 💡 Core Philosophy Going Forward:
A successful WMS prevents errors before they happen. It shouldn't just act as a ledger asking *"What did you do?"*; it should act as an active director telling the worker: *"Here is what you need to do, and here is exactly where you need to go."*
