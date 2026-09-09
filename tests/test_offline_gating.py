"""
Tests for Offline Stock Mutation Gating and Invariant Failure Mode Verification.
Covers:
1. Gating contract enforcement:
   - /api/sync-status endpoint contract (mode: cloud, offline_mutations_allowed: False).
   - adjust_stock_primitive offline gate check raising OfflineMutationGatedError.
   - Flask error handler returning HTTP 503 for OfflineMutationGatedError.
   - Flask error handler returning HTTP 503 for DatabaseUnavailableError.
   - Flask error handler returning HTTP 409 for ConcurrencyConflictError.
2. Invariant verification & reproduction tests proving why naive offline sync is fatal:
   - Breach of non-negative stock invariant under partition (double-withdrawal).
   - Lost update under last-push-wins (removal vs return overwrite).
   - Autoincrement primary key and foreign key collisions from concurrent offline inserts.
   - Irreconcilable lifecycle race: PO receipt vs PO void/expiry.
   - Irreconcilable lifecycle race: Leave Order return vs manual close.
"""
import sqlite3
import pytest
from flask import g

from app.models.db_utils import (
    get_db,
    get_sync_status,
    is_offline_mutation_allowed,
    check_stock_mutation_allowed,
    OfflineMutationGatedError,
    DatabaseUnavailableError,
    ConcurrencyConflictError
)
from app.services.item_service import adjust_stock_primitive


# =========================================================================
# 1. GATING CONTRACT TESTS
# =========================================================================

def test_sync_status_endpoint_contract(client):
    """
    Verifies that /api/sync-status explicitly indicates cloud mode and that
    offline stock mutations are strictly disabled.
    """
    response = client.get("/api/sync-status")
    assert response.status_code == 200
    data = response.get_json()

    assert data["mode"] == "cloud"
    assert data["authoritative_writer"] == "remote_libsql"
    assert data["offline_mutations_allowed"] is False
    assert "connected" in data
    assert "engine" in data
    assert "version" in data
    assert isinstance(data["version"], str) and len(data["version"]) > 0


def test_offline_mutation_gate_blocks_stock_adjustment(app, sample_metadata):
    """
    Verifies that when offline mode is flagged, adjust_stock_primitive raises
    OfflineMutationGatedError, preventing un-synchronized local stock changes.
    """
    with app.test_request_context():
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Gate Item', ?, 10, 'active')",
            (sample_metadata["unit_id"],)
        )
        item_id = cursor.lastrowid
        conn.commit()

        # Simulate offline state
        g.offline_mode = True

        with pytest.raises(OfflineMutationGatedError, match="Offline stock mutations are disabled"):
            check_stock_mutation_allowed()

        with pytest.raises(OfflineMutationGatedError):
            adjust_stock_primitive(
                conn=conn,
                item_id=item_id,
                change_amount=5,
                action_type="addition"
            )


def test_offline_mutation_gated_error_handler_503(client):
    """
    Verifies that an OfflineMutationGatedError raised in a route produces
    HTTP 503 Service Unavailable with user-visible bilingual error explanation.
    """
    app = client.application

    @app.route("/api/test-offline-gate-trigger")
    def trigger_offline_gated():
        raise OfflineMutationGatedError("Offline mutations are disallowed.")

    response = client.get("/api/test-offline-gate-trigger")
    assert response.status_code == 503
    data = response.get_json()
    assert data["code"] == "OFFLINE_MUTATION_GATED"
    assert "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت" in data["error"]


def test_database_unavailable_error_handler_503(client):
    """
    Verifies that when the database is unreachable, the application returns
    HTTP 503 Service Unavailable with code DATABASE_UNAVAILABLE.
    """
    app = client.application

    @app.route("/api/test-db-unavailable-trigger")
    def trigger_db_unavailable():
        raise DatabaseUnavailableError("Cloud database host unreachable.")

    response = client.get("/api/test-db-unavailable-trigger")
    assert response.status_code == 503
    data = response.get_json()
    assert data["code"] == "DATABASE_UNAVAILABLE"
    assert "قاعدة البيانات غير متاحة حالياً" in data["error"]


def test_concurrency_conflict_error_handler_409(client):
    """
    Verifies that unresolvable concurrent conflicts return HTTP 409 Conflict.
    """
    app = client.application

    @app.route("/api/test-conflict-trigger")
    def trigger_conflict():
        raise ConcurrencyConflictError("Stale version conflict during stock deduction.")

    response = client.get("/api/test-conflict-trigger")
    assert response.status_code == 409
    data = response.get_json()
    assert data["code"] == "CONCURRENCY_CONFLICT"
    assert "تعارض في التحديث المتزامن" in data["error"]


# =========================================================================
# 2. INVARIANT FAILURE MODE REPRODUCTION (WHY NAIVE SYNC IS FATAL)
# =========================================================================

def test_naive_offline_sync_negative_stock_violation():
    """
    Proves that partitioned offline writes violate the non-negative stock invariant.
    Scenario:
    - Item has quantity = 2.
    - Node A (disconnected) removes 2 units (2 - 2 = 0). Local transaction succeeds.
    - Node B (disconnected) removes 2 units (2 - 2 = 0). Local transaction succeeds.
    - Both nodes believe they dispensed available stock.
    - Total physical stock dispensed = 4 units, but only 2 units existed.
    """
    initial_stock = 2

    # Node A local database
    conn_a = sqlite3.connect(":memory:")
    conn_a.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, stock INTEGER CHECK(stock >= 0));")
    conn_a.execute("INSERT INTO items VALUES (1, ?);", (initial_stock,))
    conn_a.commit()

    # Node B local database (replicated from initial)
    conn_b = sqlite3.connect(":memory:")
    conn_b.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, stock INTEGER CHECK(stock >= 0));")
    conn_b.execute("INSERT INTO items VALUES (1, ?);", (initial_stock,))
    conn_b.commit()

    # Both nodes dispense 2 units offline
    # Node A
    conn_a.execute("UPDATE items SET stock = stock - 2 WHERE id = 1 AND stock >= 2;")
    conn_a.commit()
    cur_a = conn_a.execute("SELECT stock FROM items WHERE id = 1;")
    assert cur_a.fetchone()[0] == 0

    # Node B
    conn_b.execute("UPDATE items SET stock = stock - 2 WHERE id = 1 AND stock >= 2;")
    conn_b.commit()
    cur_b = conn_b.execute("SELECT stock FROM items WHERE id = 1;")
    assert cur_b.fetchone()[0] == 0

    # Reconciling these two independent withdrawals against the primary:
    # 2 units withdrawn on Node A + 2 units withdrawn on Node B = 4 units withdrawn.
    # True stock: 2 - 4 = -2, which violates physical and database invariants!
    total_withdrawn = 2 + 2
    resulting_balance = initial_stock - total_withdrawn
    assert resulting_balance < 0, "Invariant breached: stock became negative under partition!"


def test_naive_offline_sync_lost_update_reproduction():
    """
    Proves that last-push-wins replica synchronization produces lost updates.
    Scenario:
    - Item has initial balance = 10.
    - Warehouse removes 3 units (10 - 3 = 7).
    - Office records a return of 2 units (10 + 2 = 12).
    - Under Turso's last-push-wins model, the second push completely overwrites the first.
    - If Office pushes second, balance is 12 (the removal of 3 units is lost).
    - If Warehouse pushes second, balance is 7 (the return of 2 units is lost).
    - Neither outcome yields the correct reconciled balance of 9 (10 - 3 + 2).
    """
    initial_stock = 10
    removal = 3
    inbound_return = 2
    correct_reconciled = initial_stock - removal + inbound_return  # 9

    # Simulated Primary Database
    primary = sqlite3.connect(":memory:")
    primary.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, current_quantity INTEGER);")
    primary.execute("INSERT INTO items VALUES (1, ?);", (initial_stock,))
    primary.commit()

    # Node A writes absolute balance 7
    node_a_balance = initial_stock - removal  # 7
    # Node B writes absolute balance 12
    node_b_balance = initial_stock + inbound_return  # 12

    # Case 1: Node A pushes first, Node B pushes second (last-push-wins)
    primary.execute("UPDATE items SET current_quantity = ? WHERE id = 1;", (node_a_balance,))
    primary.commit()
    primary.execute("UPDATE items SET current_quantity = ? WHERE id = 1;", (node_b_balance,))
    primary.commit()

    final_balance_b_last = primary.execute("SELECT current_quantity FROM items WHERE id = 1;").fetchone()[0]
    assert final_balance_b_last == 12
    assert final_balance_b_last != correct_reconciled  # 12 != 9 (Removal lost!)

    # Case 2: Node B pushes first, Node A pushes second (last-push-wins)
    primary.execute("UPDATE items SET current_quantity = ? WHERE id = 1;", (node_a_balance,))
    primary.commit()

    final_balance_a_last = primary.execute("SELECT current_quantity FROM items WHERE id = 1;").fetchone()[0]
    assert final_balance_a_last == 7
    assert final_balance_a_last != correct_reconciled  # 7 != 9 (Return lost!)


def test_naive_offline_sync_autoincrement_id_collision():
    """
    Proves that concurrent offline inserts using local AUTOINCREMENT sequences
    generate identical primary keys, corrupting foreign key links upon synchronization.
    """
    # Node A inserting offline
    conn_a = sqlite3.connect(":memory:")
    conn_a.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, action TEXT);")
    conn_a.execute("INSERT INTO logs (item_id, action) VALUES (10, 'Addition');")
    conn_a.commit()
    id_a = conn_a.execute("SELECT id FROM logs;").fetchone()[0]

    # Node B inserting offline
    conn_b = sqlite3.connect(":memory:")
    conn_b.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, action TEXT);")
    conn_b.execute("INSERT INTO logs (item_id, action) VALUES (20, 'Removal');")
    conn_b.commit()
    id_b = conn_b.execute("SELECT id FROM logs;").fetchone()[0]

    # Both nodes allocated ID 1 locally
    assert id_a == 1
    assert id_b == 1
    assert id_a == id_b, "Fatal ID collision: both replicas independently allocated id = 1!"


def test_naive_offline_sync_po_receive_vs_void_race():
    """
    Proves that a concurrent PO receive on one replica and void on another
    creates an irreconcilable conflict under naive synchronization.
    Scenario:
    - Primary has purchase_orders (id=1, status='open') and items (id=1, current_quantity=100).
    - Node A (Warehouse offline replica) receives the PO:
      marks status='closed' and adds 50 units (current_quantity = 150).
    - Node B (Office offline replica) voids the expired PO:
      marks status='void' with no stock change (current_quantity = 100).
    - Under Last-Push-Wins (LPW) row or table replay against Primary:
      If Office pushes second, PO status becomes 'void' while Warehouse already disbursed/shelved physical stock,
      and stock is overwritten back to 100, losing the 50 physically received units.
      If Warehouse pushes second, void is overwritten and an expired/cancelled PO is illegally marked closed.
    """
    primary = sqlite3.connect(":memory:")
    primary.execute("CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, status TEXT);")
    primary.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, current_quantity INTEGER);")
    primary.execute("INSERT INTO purchase_orders VALUES (1, 'open');")
    primary.execute("INSERT INTO items VALUES (1, 100);")
    primary.commit()

    # Node A local commit: received 50 units, PO closed
    node_a_po_status = "closed"
    node_a_stock = 150

    # Node B local commit: voided expired PO, stock unchanged
    node_b_po_status = "void"
    node_b_stock = 100

    # Case 1: Node A pushes first, Node B pushes second (LPW)
    primary.execute("UPDATE purchase_orders SET status = ? WHERE id = 1;", (node_a_po_status,))
    primary.execute("UPDATE items SET current_quantity = ? WHERE id = 1;", (node_a_stock,))
    primary.commit()

    # Node B overwrites under naive sync
    primary.execute("UPDATE purchase_orders SET status = ? WHERE id = 1;", (node_b_po_status,))
    primary.execute("UPDATE items SET current_quantity = ? WHERE id = 1;", (node_b_stock,))
    primary.commit()

    final_po = primary.execute("SELECT status FROM purchase_orders WHERE id = 1;").fetchone()[0]
    final_stock = primary.execute("SELECT current_quantity FROM items WHERE id = 1;").fetchone()[0]

    assert final_po == "void"
    assert final_stock == 100  # The 50 received physical units are silently lost!
    assert final_stock != 150


def test_naive_offline_sync_leave_order_return_vs_close_race():
    """
    Proves that a concurrent Leave Order return on one replica and manual closure on another
    creates inconsistent inventory ledger state under naive synchronization.
    Scenario:
    - Primary has leave_orders (id=1, status='open'), leave_order_items (id=1, returned_qty=0, outstanding=5),
      and items (id=1, current_quantity=20).
    - Node A (Warehouse offline): operator accepts return of 5 units.
      returned_qty becomes 5, outstanding becomes 0, item stock becomes 25, LO status becomes 'closed_returned'.
    - Node B (Office offline): operator marks order as closed/unreturned (disposition='lost').
      item stock remains 20, LO status becomes 'closed_lost'.
    - Under LPW replay against Primary:
      If Office pushes second, stock returns to 20, wiping out the 5 physically returned units.
      If Warehouse pushes second, Office's loss disposition is silently undone.
    """
    primary = sqlite3.connect(":memory:")
    primary.execute("CREATE TABLE leave_orders (id INTEGER PRIMARY KEY, status TEXT);")
    primary.execute("CREATE TABLE leave_order_items (id INTEGER PRIMARY KEY, returned_qty INTEGER, outstanding INTEGER);")
    primary.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, current_quantity INTEGER);")
    primary.execute("INSERT INTO leave_orders VALUES (1, 'open');")
    primary.execute("INSERT INTO leave_order_items VALUES (1, 0, 5);")
    primary.execute("INSERT INTO items VALUES (1, 20);")
    primary.commit()

    # Node A updates (Warehouse returns items)
    primary.execute("UPDATE leave_orders SET status = 'closed_returned' WHERE id = 1;")
    primary.execute("UPDATE leave_order_items SET returned_qty = 5, outstanding = 0 WHERE id = 1;")
    primary.execute("UPDATE items SET current_quantity = 25 WHERE id = 1;")
    primary.commit()

    # Node B pushes second (Office closes as lost)
    primary.execute("UPDATE leave_orders SET status = 'closed_lost' WHERE id = 1;")
    primary.execute("UPDATE items SET current_quantity = 20 WHERE id = 1;")
    primary.commit()

    final_status = primary.execute("SELECT status FROM leave_orders WHERE id = 1;").fetchone()[0]
    final_stock = primary.execute("SELECT current_quantity FROM items WHERE id = 1;").fetchone()[0]

    assert final_status == "closed_lost"
    assert final_stock == 20  # Physical inventory restored to shelves is lost in ledger!
    assert final_stock != 25


# =========================================================================
# 3. ROUTE LEVEL OFFLINE GATING & NETWORK PARTITION TESTS
# =========================================================================

def test_offline_mode_app_config_blocks_stock_adjustment_route(client, sample_metadata):
    """
    Verifies that when OFFLINE_MODE is configured at application level,
    POST /api/items/<id>/adjust is strictly blocked with HTTP 503 OFFLINE_MUTATION_GATED.
    """
    res_item = client.post(
        "/api/items/",
        json={
            "name": "Offline Gated Item",
            "unit_id": sample_metadata["unit_id"],
            "sub_category_id": sample_metadata["sub_category_id"],
            "initial_quantity": 10
        }
    )
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    client.application.config["OFFLINE_MODE"] = True
    try:
        response = client.post(
            f"/api/items/{item_id}/adjust",
            json={"change_amount": 5, "adjustment_type": "addition"}
        )
        assert response.status_code == 503
        data = response.get_json()
        assert data["code"] == "OFFLINE_MUTATION_GATED"
        assert "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت" in data["error"]
    finally:
        client.application.config["OFFLINE_MODE"] = False


def test_offline_mode_sync_status_reporting(client):
    """
    Verifies that when OFFLINE_MODE is configured, /api/sync-status accurately
    reports connected: False and mode: offline.
    """
    client.application.config["OFFLINE_MODE"] = True
    try:
        response = client.get("/api/sync-status")
        assert response.status_code == 200
        data = response.get_json()
        assert data["connected"] is False
        assert data["mode"] == "offline"
        assert data["offline_mutations_allowed"] is False
    finally:
        client.application.config["OFFLINE_MODE"] = False


def test_network_partition_hrana_error_returns_503_database_unavailable(client, sample_metadata, monkeypatch):
    """
    Simulates a sudden network partition where LibSQL/Hrana raises a network error
    during an active stock adjustment request.
    Verifies that the application returns HTTP 503 DATABASE_UNAVAILABLE (not 400 VALUE_ERROR).
    """
    res_item = client.post(
        "/api/items/",
        json={
            "name": "Partition Test Item",
            "unit_id": sample_metadata["unit_id"],
            "sub_category_id": sample_metadata["sub_category_id"],
            "initial_quantity": 10
        }
    )
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    from unittest.mock import MagicMock
    import app.routes.items_routes

    mock_conn = MagicMock()
    # Execute raises Hrana network/connection error
    mock_conn.cursor.return_value.execute.side_effect = ValueError(
        "Hrana: `api error: `status=503 Service Unavailable, body=Turso host unreachable``"
    )
    monkeypatch.setattr(app.routes.items_routes, "get_db", lambda: mock_conn)

    response = client.post(
        f"/api/items/{item_id}/adjust",
        json={"change_amount": 3, "adjustment_type": "addition"}
    )
    assert response.status_code == 503
    data = response.get_json()
    assert data["code"] == "DATABASE_UNAVAILABLE"
    assert "قاعدة البيانات غير متاحة حالياً" in data["error"]


def test_offline_flagged_connection_blocks_primitive(migrated_db, sample_metadata):
    """
    Verifies that passing a connection explicitly flagged with is_offline = True
    causes adjust_stock_primitive to raise OfflineMutationGatedError.
    """
    class OfflineConnectionWrapper:
        def __init__(self, raw):
            self._raw = raw
            self.is_offline = True
        def cursor(self):
            return self._raw.cursor()

    cur = migrated_db.cursor()
    cur.execute(
        "INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Flagged Item', ?, 10, 'active')",
        (sample_metadata["unit_id"],)
    )
    item_id = cur.lastrowid
    migrated_db.commit()

    conn = OfflineConnectionWrapper(migrated_db)

    with pytest.raises(OfflineMutationGatedError, match="Offline stock mutations are disabled"):
        adjust_stock_primitive(
            conn=conn,
            item_id=item_id,
            change_amount=1,
            action_type="addition"
        )


def test_offline_mode_blocks_purchase_order_receipt(office_client, client, sample_metadata):
    """
    Verifies that when OFFLINE_MODE is configured, receiving a Purchase Order
    (which would mutate inventory stock) is strictly blocked with HTTP 503 OFFLINE_MUTATION_GATED.
    """
    # 1. Create active item
    res_item = client.post(
        "/api/items/",
        json={
            "name": "PO Gating Item",
            "unit_id": sample_metadata["unit_id"],
            "sub_category_id": sample_metadata["sub_category_id"],
            "initial_quantity": 10
        }
    )
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    # 2. Office creates a PO
    res_po = office_client.post(
        "/api/purchase-orders",
        json={
            "provider_id": sample_metadata["provider_id"],
            "notes": "Testing offline gate",
                "items": [{"item_id": item_id, "requested_quantity": 15, "ordered_quantity": 15, "unit_price": "50.00"}]
        },
        headers={"Idempotency-Key": "test-po-offline-gate-001"}
    )
    assert res_po.status_code == 201
    po = res_po.get_json()
    line_id = po["items"][0]["id"]

    # 3. Simulate offline mode on application
    client.application.config["OFFLINE_MODE"] = True
    try:
        res_receive = client.post(
            f"/api/purchase-orders/{po['id']}/receive",
            json={
                    "expected_revision": 1
            },
            headers={"Idempotency-Key": "test-po-receive-offline-001"}
        )
        assert res_receive.status_code == 503
        data = res_receive.get_json()
        assert data["code"] == "OFFLINE_MUTATION_GATED"
        assert "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت" in data["error"]
    finally:
        client.application.config["OFFLINE_MODE"] = False


def test_offline_mode_blocks_leave_order_disbursement(client, office_client, sample_metadata):
    """
    Verifies that when OFFLINE_MODE is configured, creating a Leave Order
    (which deducts stock) is strictly blocked with HTTP 503 OFFLINE_MUTATION_GATED.
    """
    res_item = client.post(
        "/api/items/",
        json={
            "name": "LO Gating Item",
            "unit_id": sample_metadata["unit_id"],
            "sub_category_id": sample_metadata["sub_category_id"],
            "initial_quantity": 25
        }
    )
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    client.application.config["OFFLINE_MODE"] = True
    try:
        res = office_client.post(
            "/api/leave-orders",
            json={
                "employee_name": "Sami Youssef",
                "destination_id": sample_metadata["destination_id"],
                "notes": "Offline gate test",
                "items": [{"item_id": item_id, "quantity": 5}]
            },
            headers={"Idempotency-Key": "test-lo-offline-gate-001"}
        )
        assert res.status_code == 503
        data = res.get_json()
        assert data["code"] == "OFFLINE_MUTATION_GATED"
        assert "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت" in data["error"]
    finally:
        client.application.config["OFFLINE_MODE"] = False


def test_offline_mode_blocks_leave_order_return(client, office_client, sample_metadata):
    """
    Verifies that when OFFLINE_MODE is configured, processing a return on a Leave Order
    (which increases stock) is strictly blocked with HTTP 503 OFFLINE_MUTATION_GATED.
    """
    # 1. Create item and leave order while online
    res_item = client.post(
        "/api/items/",
        json={
            "name": "Return Gating Item",
            "unit_id": sample_metadata["unit_id"],
            "sub_category_id": sample_metadata["sub_category_id"],
            "initial_quantity": 20
        }
    )
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    res_lo = office_client.post(
        "/api/leave-orders",
        json={
            "employee_name": "Khaled Amer",
            "destination_id": sample_metadata["destination_id"],
            "notes": "Return gate test",
            "items": [{"item_id": item_id, "quantity": 8}]
        },
        headers={"Idempotency-Key": "test-lo-return-gate-create"}
    )
    assert res_lo.status_code == 201
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # 2. Simulate offline mode and attempt return
    office_client.application.config["OFFLINE_MODE"] = True
    try:
        res_ret = office_client.post(
            f"/api/tickets/{order_id}/return",
            json={
                "expected_revision": 0,
                "notes": "Attempt return offline",
                "items": [{"line_id": line_id, "quantity": 4}]
            },
            headers={"Idempotency-Key": "test-return-offline-gate-001"}
        )
        assert res_ret.status_code == 503
        data = res_ret.get_json()
        assert data["code"] == "OFFLINE_MUTATION_GATED"
        assert "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت" in data["error"]
    finally:
        office_client.application.config["OFFLINE_MODE"] = False


def test_offline_qualification_decision_invariants():
    """
    Verifies the architectural qualification decision (ADR 0001 / ADR 0002 / Issue #13):
    - Offline stock mutations are disabled by default and permanently gated.
    - is_offline_mutation_allowed() returns False.
    - Sync status reports offline_mutations_allowed = False.
    """
    assert is_offline_mutation_allowed() is False
    status = get_sync_status()
    assert status["offline_mutations_allowed"] is False
    assert status["authoritative_writer"] == "remote_libsql"
