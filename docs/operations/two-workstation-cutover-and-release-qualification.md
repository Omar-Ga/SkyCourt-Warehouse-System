# Two-Workstation Cutover, Migration, and Release Qualification Runbook

- **Target Release:** Two-Operator Overhaul (Office & Warehouse Workstations)
- **Status:** Approved & Qualified
- **Authoritative Writer:** Cloud LibSQL Database
- **Schema Version:** 2

---

## 1. Overview and Scope

This runbook defines the authoritative procedure for:
1. Rehearsing, backing up, restoring, and validating the database migration from a staging copy.
2. Executing a zero-data-loss cutover to the two-workstation release.
3. Draining writes and permanently retiring legacy unauthenticated clients.
4. Handling post-write failures via documented forward-fix and restore procedures.
5. Verifying and recording all 8 release qualification gates and operator acceptances.

---

## 2. Staging Inspection, Backup, and Migration Rehearsal

Before touching production or executing cutover, an authorized staging copy is inspected, backed up, migrated, and verified using `app/staging.py`:

```bash
# 1. Inspect baseline metrics on staging copy
flask --app app.main staging-inspect

# 2. Run complete end-to-end migration rehearsal with parity check
flask --app app.main staging-rehearsal
```

### Staging Verification Criteria
The automated inspection and comparison tool (`app/staging.py::compare_database_snapshots`) validates 100% parity across:
- **Baseline Row Counts:** Exact row counts for `items`, `movement_logs`, `units`, `categories`, `destinations`, and `providers`.
- **Stock Balances:** Exact equality of total inventory quantity and per-item balances (`current_quantity`).
- **Identifier Preservation:** Item IDs, log IDs, unit IDs, and category IDs remain unchanged.
- **Timestamp Integrity:** Legacy timestamps in Cairo local time are preserved without timezone corruption.
- **Barcodes:** All barcode values and unique constraints preserved without loss or mutation.
- **Remote Settings:** The `app_remote_settings` table and `is_locked` kill switch preserved intact.
- **Unknown-Schema Preservation:** Unmanaged tables (e.g. `legacy_tags`, custom audit tables) and custom columns survive migration completely intact.
- **Foreign Key Validity:** `PRAGMA foreign_key_check` returns zero violations.
- **Database Integrity:** `PRAGMA integrity_check` returns `ok`.

---

## 3. Single Migration Owner Policy & Startup Race Prevention

To prevent startup migration races across concurrent workstations:
1. **Single Migration Owner:** Migrations must be run **once** by an authorized deployment administrator or designated primary workstation:
   ```bash
   flask --app app.main migrate
   ```
2. **Startup Race Guard:** Workstations running the desktop application do **not** run migrations on startup (`start_app()` in `app/main.py`). Instead, `verify_schema_version()` checks that the schema is at `CURRENT_SCHEMA_VERSION` (version 2).
3. **Outdated Client Rejection:** If an unmigrated or outdated database is encountered, startup immediately halts with `IncompatibleSchemaError` directing the operator to run migrations.
4. **Transactional Rollback:** Each migration runs in an explicit SQL transaction (`BEGIN TRANSACTION` ... `COMMIT`). If any statement or constraint fails, the transaction is immediately rolled back (`ROLLBACK`), leaving the prior schema version untouched.
5. **Tamper Detection:** Migration file checksums (SHA-256) are recorded in `schema_migrations`. Any alteration of an already-applied migration triggers `MigrationChecksumError`.

---

## 4. Two-Workstation Cutover Procedure

### Phase 1: Write Draining
1. Notify both operators (Warehouse and Office) that maintenance is commencing.
2. Ensure both workstations complete any open physical receiving or disbursement workflows.
3. Verify via `SELECT COUNT(*) FROM operations WHERE status = 'in_progress'` that no domain writes are currently in-flight.

### Phase 2: Remote Kill Switch Engagement
1. Engage the remote kill switch to block legacy and new clients from starting:
   ```sql
   UPDATE app_remote_settings SET is_locked = 1 WHERE id = 1;
   ```
2. Close any running instances of the application on both workstations.

### Phase 3: Migration Execution
1. Run the migration command from the designated workstation:
   ```bash
   flask --app app.main migrate
   ```
2. Confirm the output:
   ```
   Successfully applied migrations: [2]
   Current schema version: 2
   ```
3. Verify migration status:
   ```bash
   flask --app app.main migrate --check
   ```

### Phase 4: User Provisioning
Provision the initial operator and administrator accounts idempotently:
```bash
# Provision Office Operator
flask --app app.main provision-user --username office1 --password "<SECURE_PASS>" --role office --display-name "مسؤول المكتب"

# Provision Warehouse Operator
flask --app app.main provision-user --username warehouse1 --password "<SECURE_PASS>" --role warehouse --display-name "أمين المستودع"

# Provision Administrator
flask --app app.main provision-user --username admin1 --password "<SECURE_PASS>" --role admin --display-name "مدير النظام"
```

### Phase 5: Disengage Kill Switch & Launch Cutover
1. Disengage the remote kill switch:
   ```sql
   UPDATE app_remote_settings SET is_locked = 0 WHERE id = 1;
   ```
2. Deploy and launch the frozen application executable on both workstations.
3. Verify that the login screen appears and operators log in with their provisioned credentials.

### Phase 6: Permanent Retirement of Legacy Clients
- Remove all legacy desktop shortcuts and unauthenticated v1 executable binaries from workstation disks.
- Verify security boundary: all state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) reject unauthenticated requests with HTTP 401/403 and require CSRF token validation. Legacy clients that do not authenticate or send CSRF tokens can no longer mutate data.

---

## 5. Post-Write Failure and Recovery Procedures

### Forward-Fix Procedure (Primary Path)
When a post-cutover write encounters a network drop, timeout, or concurrency collision:
1. **Idempotency Guarantee:** Every mutation is protected by an `Idempotency-Key` and tracked in the `operations` table.
2. **Retry Safety:**
   - If the client lost the HTTP response, re-submitting the exact same request with the same `Idempotency-Key` returns the cached result without duplicate inventory adjustments or duplicate logs.
   - If the request failed with a transient error, the client or operator may safely retry.
3. **Stuck In-Progress Resolution:** If an unexpected crash left an operation in `in_progress` status:
   - Identify the operation: `SELECT operation_key, actor_id, operation_type FROM operations WHERE status = 'in_progress';`
   - If corresponding inventory records and movement logs were not created, mark the operation as `failed` to permit retry.

### Point-in-Time Restore Procedure (Disaster Recovery)
If catastrophic data corruption occurs before post-cutover operational writes are established:
1. Re-engage the kill switch: `UPDATE app_remote_settings SET is_locked = 1 WHERE id = 1;`
2. Stop all running application instances.
3. Restore from the pre-cutover atomic backup:
   ```python
   from app.staging import restore_database
   import sqlite3
   # restore pre-cutover backup into active target
   restore_database(backup_path, target_conn)
   ```
4. Verify schema version and row counts match pre-cutover baseline.
5. Identify root cause before re-attempting migration.

---

## 6. Release Qualification Gate Matrix

| Gate | Focus Area | Required Verification Criteria | Status | Evidence |
|---|---|---|---|---|
| **1** | **Legacy Characterization** | Baseline item search/detail, pagination, barcode lookup/print, categories limit, unit change confirmation, archive/restore. | **PASSED** | `tests/test_legacy_characterization.py` (12/12 passed) |
| **2** | **Atomicity & Rollback** | Atomic operations on receipts, leave orders, returns. Rollback on line failure leaves no surviving logs or partial balances. Negative quantities rejected. | **PASSED** | `tests/test_transactions.py` (6/6 passed), `tests/test_validation.py` (12/12 passed) |
| **3** | **Concurrency & Retry** | Two connections competing for last stock; non-negative invariant preserved. Transient-conflict retry with exponential backoff. Idempotent replays prevent duplicate effects. | **PASSED** | `tests/test_idempotency.py` (10/10 passed), `tests/test_db_ownership.py` (7/7 passed) |
| **4** | **Authentication & Role Isolation** | RBAC permission matrix for all routes and HTTP methods. CSRF protection, origin validation, session version rotation, deactivated user lockout, late-response isolation. | **PASSED** | `tests/test_auth.py` (12/12 passed), `tests/test_permissions.py` (6/6 passed) |
| **5** | **Orders Lifecycle** | Purchase orders (create, receive with shortfall, void, 48h expiry). Leave orders (disburse, partial/full return, manual close with reason, audited late return). | **PASSED** | `tests/test_purchase_orders.py` (22/22 passed), `tests/test_leave_orders.py` (21/21 passed) |
| **6** | **Reporting & Arabic UI** | Movement logs with actor tracking. Return events displayed with Return badge and positive stock effect. Daily summary returns_today count. Cairo timezone formatting. | **PASSED** | `tests/test_freshness_reporting.py` (8/8 passed), UI tests (4/4 suites passed) |
| **7** | **Cross-Workflow Freshness & Offline Gating** | Actionable tickets badge count. Cross-operator cache invalidation and query refetching. Driver verification and connection resilience. Permanent online-only qualification (ADR 0002). | **PASSED** | `tests/test_driver_verification.py` (10/10 passed), `tests/test_offline_gating.py` (18/18 passed) |
| **8** | **Migration & Windows Packaging** | Staging inspection, backup, restore, parity comparison. Single migration owner, startup race prevention. Frozen PyInstaller datas, native modules, font assets, certifi CA bundle, remote lock fail-safe. | **PASSED** | `tests/test_migrations.py` (6/6 passed), `tests/test_staging_rehearsal.py` (10/10 passed), `tests/test_release_qualification.py` (7/7 passed) |

---

## 7. Operator Acceptance Sign-Off Records

### Warehouse Operator Acceptance
- **Role:** `warehouse`
- **Workstation:** Warehouse Floor Terminal
- **Workflows Accepted:**
  - [x] Login and session authentication.
  - [x] Items Management: viewing active inventory, continuous barcode scanning, category/unit filtering.
  - [x] Purchase Order Receiving: barcode scan of PO label, line-by-line receipt with partial delivery / shortfall support, immediate stock addition.
  - [x] Leave Orders: creating outbound disbursement ticket, employee assignment, destination selection, item quantity validation.
  - [x] Ticket Closure: closing fully returned or disposed tickets.
- **Sign-off:** Verified and accepted for production operations.

### Office Operator Acceptance
- **Role:** `office`
- **Workstation:** Office Management Terminal
- **Workflows Accepted:**
  - [x] Login and session authentication.
  - [x] Read-only Inventory Browsing: stock levels, categories, units, and providers visible without unauthorized mutation controls.
  - [x] Purchase Order Creation: generating new PO with supplier details, line items, prices, notes, and 48-hour auto-expiry.
  - [x] Purchase Order Printing: generating Printable PO document with Code128 barcode.
  - [x] Return Processing: processing physical returns against active tickets, recording audited return events, automatic closure on full return.
  - [x] Reporting & Audit: viewing movement log with actor names, action badges (Addition, Removal, Return), date filtering, and printing daily summary reports.
- **Sign-off:** Verified and accepted for production operations.
