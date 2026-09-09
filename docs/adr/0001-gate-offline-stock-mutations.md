# Gate Offline Stock Mutations and Establish Authoritative Cloud Writer

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** SkyCourt Engineering Team
- **Consulted:** Spec Review (Commit `b4241a8`), Issue #2

## Context

The SkyCourt Warehouse System is expanding from a single-workstation desktop utility to a two-operator deployment (Office and Warehouse workstations). The original TASK-8 proposal suggested deploying Turso's embedded SQLite replicas on both desktop workstations with a 5-second periodic background synchronization loop (`pyturso` sync).

However, rigorous specification analysis (Findings R01, R04, R05, and R06) demonstrated that direct replica replacement and unconditional offline synchronization break essential business invariants:
1. **Lost Updates via Last-Push-Wins:** Turso replica synchronization uses last-push-wins conflict resolution and local change replay. In this application, stock adjustments are computed against locally perceived balances or updated via absolute replacement. If Warehouse reads 10 and removes 3 (writing 7), while Office reads 10 and returns 2 (writing 12), whichever replica pushes last overwrites the other, resulting in a corrupted balance (7 or 12 instead of 9).
2. **Breach of Non-Negative Stock Invariant:** When two disconnected workstations independently deduct stock from the same item (e.g. both dispensing the last 2 remaining units), both local transactions succeed because each locally observes sufficient stock. When reconnected, 4 units have been removed when only 2 existed, resulting in an impossible physical inventory state.
3. **Primary Key Collisions & Broken Foreign Keys:** Tables rely on independent local integer `AUTOINCREMENT` sequences (`movement_logs`, `purchase_orders`, `leave_orders`, `items`). When both machines insert rows offline, they generate identical local IDs. Replaying these inserts against the remote primary causes unique constraint failures or corrupts foreign key links across parent orders and child line items.
4. **Irreconcilable Lifecycle Races:** Disconnected workstations can make conflicting lifecycle transitions on shared records: Office voids an expired Purchase Order while Warehouse receives stock against it; or Office closes a Leave Order while Warehouse records a physical return. Last-push-wins cannot resolve whether stock was physically accepted or voided.
5. **Driver Incompatibilities:** The pinned driver (`libsql==0.1.11`) does not support native `row_factory` assignment, uses keyword argument `_check_same_thread` instead of `check_same_thread`, accepts `database` rather than `path`, and raises standard `ValueError` rather than `sqlite3.IntegrityError` for constraint violations.
6. **Security & Credential Boundaries:** Replicating database credentials, tokens, or user password hashes to untrusted workstation disks circumvents role-based access control.

## Decision

1. **Online-Only Stock Mutations:** For the two-operator release, all stock-affecting operations (stock adjustments, Purchase Order receipts, Leave Order disbursements, and returns) are **strictly online-only**.
2. **Single Authoritative Writer:** The cloud-hosted LibSQL/Turso database is designated as the sole authoritative writer. Transactions execute directly and atomically against the remote engine.
3. **Offline Gating:** Direct replica replacement and unconditional offline synchronization loops are strictly disabled. Any stock mutation attempted while disconnected from the authoritative database fails immediately.
4. **Standardized User-Visible Behavior:**
   - **Pending:** Not supported. Mutations are never queued locally or left in an ambiguous pending-sync state.
   - **Rejected:** Malformed requests, negative balances, invalid units, or non-existent references return HTTP 400 or 422 with explicit bilingual error descriptions.
   - **Conflicted:** Stale-read or concurrent transaction conflicts (when bounded retries are exhausted) return HTTP 409 Conflict with code `CONCURRENCY_CONFLICT`.
   - **Unavailable:** When the cloud database is disconnected or unreachable, operations fail fast and return HTTP 503 Service Unavailable with code `DATABASE_UNAVAILABLE` and message: "الخدمة غير متصلة: قاعدة البيانات غير متاحة حالياً. عمليات تعديل المخزون تتطلب اتصالاً بالإنترنت." ("Service unavailable: database is unreachable. Stock mutations require an active connection.").
5. **Adapter Preservation:** Keep and test `LibSQLConnectionWrapper`, `LibSQLCursorWrapper`, and `LibSQLRow` to provide complete duck-typing with `sqlite3` interfaces while preserving connection scoping in Flask request contexts (`g.db`).
6. **Offline Qualification Outcome (Issue #13 / ADR 0002):** Formal qualification proved that offline stock mutations violate fundamental business invariants (negative stock under partitions, lost updates, ID collisions). In accordance with Issue #13 acceptance criteria and ADR 0002, offline synchronization and embedded replicas are permanently abandoned in favor of the 100% authoritative online-only architecture.

## Consequences

- **Positive:** Eliminates lost inventory updates, negative stock states, primary key collisions, and silent audit log corruption.
- **Positive:** Protects business data integrity by ensuring every stock change is serialized, committed, and logged within a single transaction boundary on the authoritative database.
- **Positive:** Greatly simplifies desktop deployment and removes failure-prone background sync threads, local SQLite locking bugs, and database file corruption risks.
- **Negative:** Operators cannot adjust or receive stock during an internet outage. In such scenarios, the user interface clearly surfaces a 503 unavailable error rather than giving a false illusion of completed work.
