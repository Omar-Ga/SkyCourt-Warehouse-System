# SkyCourt Warehouse System - Development Roadmap

This roadmap outlines the journey from the current "Digital Inventory Ledger" to a fully-fledged, commercially viable Warehouse Management System (WMS) tailored for Small and Medium Businesses (SMBs). The goal is to shift from simply *counting items* to *orchestrating workflows, physical locations, and users*.

## Phase 1: Security & Fundamentals
*Target: Make the system secure and suitable for multi-employee environments.*

- [ ] **User Authentication:** Implement a robust login system.
- [ ] **Role-Based Access Control (RBAC):**
  - **Admin/Manager:** Full access (create items, view financial costs, manage users, generate reports).
  - **Warehouse Worker:** Restricted access (scan barcodes, log additions/removals, view locations, cannot see wholesale costs).
  - **View Only:** Can check stock levels (useful for sales reps).
- [ ] **Audit Trail Enhancement:** Bind all movement logs to the authenticated `user_id` rather than manual text entry of a "person name".

## Phase 2: Core Warehouse Logic & Spatial Awareness
*Target: Stop searching for items and automate inventory health.*

- [ ] **Physical Location Mapping:**
  - Add `aisle`, `rack`, `shelf`, and `bin` tracking to the database schema.
  - Update the UI so workers are directed exactly where to walk to find or put away an item.
- [ ] **Low Stock Alerts & Thresholds:**
  - Introduce a `reorder_point` (minimum quantity) column in the `items` table.
  - Create a dashboard widget for "Items Needing Reorder."
  - Implement automated in-app notifications when stock dips below the threshold.
- [ ] **Product Variants & SKUs:** Graduate from simple names and barcodes to formal SKUs to handle sizes, colors, and specific variations.

## Phase 3: Advanced Workflows (The True "WMS" Features)
*Target: Move away from manual additions/subtractions to order-driven orchestration.*

- [ ] **Order Orchestration (Purchase Orders & Pick Lists):**
  - **Inbound (Receiving):** Create a Purchase Order (PO) workflow. Instead of just "adding items," staff receive items against an expected PO.
  - **Outbound (Fulfillment):** Instead of manually "removing" items, staff fulfill formal requests or specific Pick Lists.
- [ ] **Pick/Pack Workflows:**
  - Generate a "Pick List" that sorts items by their physical location in the warehouse to optimize the worker's walking route.
  - Lock/reserve inventory quantities when an order is created so they aren't double-sold before leaving the warehouse.
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
- [ ] **Scanner-Friendly Mobile UI:** Optimize specific workflow views (picking, receiving) for rugged Android scanners or mobile phones.

## Phase 5: Cloud SaaS Transition (If Applicable)
*Target: If pivoting from a local desktop app to a hosted web product sold to multiple businesses.*

- [ ] **Multi-Tenant Database Architecture:** Add `tenant_id` or `company_id` to every table ensuring strict data isolation between different client companies.
- [ ] **Onboarding Flow:** Let users create their own company, invite their employees, and map their warehouse zones immediately upon signing up.

---

### 💡 Core Philosophy Going Forward:
A successful WMS prevents errors before they happen. It shouldn't just act as a ledger asking *"What did you do?"*; it should act as an active director telling the worker: *"Here is what you need to do, and here is exactly where you need to go."*
