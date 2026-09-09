# Offline Synchronization Qualification and Authoritative Online-Only Architecture

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** SkyCourt Engineering Team
- **Consulted:** Issue #13, Issue #2, ADR 0001, Ponytail Architecture Guidelines

## Context

GitHub Issue #13 ("Qualify and Implement Offline Synchronization if Required") tasked engineering with evaluating whether offline stock mutations can be safely supported across two workstations (Warehouse and Office) without compromising inventory consistency.

The acceptance criteria specified:
> "If any invariant remains unproven, the corresponding operation stays online-only and the product limitation is documented."

Our specification analysis and empirical reproduction test suite (`tests/test_offline_gating.py`) proved five fatal failure modes inherent to disconnected local execution and naive sync / Last-Push-Wins (LPW):
1. **Breach of Non-Negative Stock Invariant:** Disconnected nodes independently dispensing items from the same remaining stock cause over-allocation upon reconciliation, creating impossible negative physical balances (`test_naive_offline_sync_negative_stock_violation`).
2. **Silent Lost Updates:** Absolute stock writes under Last-Push-Wins overwrite concurrent inbound returns with earlier deductions (or vice versa), permanently losing units from the ledger (`test_naive_offline_sync_lost_update_reproduction`).
3. **Primary & Foreign Key Collisions:** Local integer `AUTOINCREMENT` allocations on disconnected workstations allocate identical primary keys, corrupting order lines and immutable audit trails upon sync (`test_naive_offline_sync_autoincrement_id_collision`).
4. **Lifecycle Order State Races:** Office voiding an expired Purchase Order while Warehouse receives against it creates an unresolvable logical contradiction under replay (`test_naive_offline_sync_po_receive_vs_void_race`).
5. **Irreconcilable Return Races:** Warehouse recording physical item returns while Office manually closes a Leave Order ticket creates ledger divergence (`test_naive_offline_sync_leave_order_return_vs_close_race`).

Alternative distributed offline reconciliation architectures (e.g. CRDT delta counters, distributed lock leases, partitioned escrows, local operation queues) were evaluated under the Ponytail / YAGNI engineering principle:
- **Partitioned Escrows / Quantity Reservations:** Carving stock quotas across two workstations in the same warehouse building adds massive operational friction (e.g. stock cannot be disbursed because the "other" node holds quota) and fails when physical inventory must be instantly authoritative.
- **CRDTs / Operation Replay:** Event sourcing with vector clocks does not solve physical constraint violations: if two operators hand out physical items while offline, no mathematical merge algorithm can manifest physical inventory that does not exist.
- **Complexity vs. Value:** For a two-workstation warehouse with stable broadband/LAN, building and maintaining distributed multi-master consensus is extreme over-engineering that introduces endless edge-case failure modes and 3am operational debt.

## Decision

1. **Ditch Offline Synchronization and Embedded Replicas Completely:**
   Offline synchronization, embedded local replicas, and background replication loops are permanently discarded. The system operates strictly in single-writer authoritative cloud mode.
2. **100% Authoritative Online-Only Stock Mutations:**
   All operations that modify inventory balance or order lifecycles (item adjustments, Purchase Order receiving, Leave Order disbursements, and Leave Order returns) remain strictly online-only.
3. **Fail-Fast Offline Gating:**
   When disconnected from the authoritative LibSQL/Turso cloud database (or when operating under network partition), the application strictly halts mutation attempts:
   - Returns HTTP 503 `OFFLINE_MUTATION_GATED` ("عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت").
   - Returns HTTP 503 `DATABASE_UNAVAILABLE` when the database endpoint is unreachable.
   - Never queues mutations locally or gives operators a false impression that offline writes were committed.
4. **Documented Product Limitation:**
   In the event of an internet outage, operators can continue viewing cached/local read data where available, but cannot execute stock mutations or order lifecycle transitions until connectivity is restored.

## Consequences

- **Positive (Data Integrity):** Guarantees zero negative inventory, zero lost updates, zero ID collisions, and 100% atomic audit log fidelity. All business invariants are preserved.
- **Positive (Simplicity):** Eliminates complex conflict-resolution engines, background synchronization daemons, distributed locks, and replica state rot. Codebase remains lean and maintainable.
- **Positive (Security):** Database credentials and user password hashes are not persisted in local sync replica files on workstation disks.
- **Documented Limitation:** Inventory adjustments, PO receipts, and ticket disbursements require active internet connectivity to the authoritative database.
