"""
Comprehensive tests for Leave Orders (Issue #7):
- Atomic multi-line creation and conditional stock deduction
- Authoritative order number allocation (LO-000001)
- Snapshot preservation (item name, unit ID, unit name, destination name)
- Audit linkages to movement logs (Removal, user_id, actor_name, destination_id, leave_line_id)
- Rollback on failure leaving no partial state
- Idempotency replay and conflict detection
- Concurrency protection against double stock deduction
- Paginated list, detail, and actionable ticket count endpoints
- Role permissions (Warehouse creates, Office denied, both inspect)
- Metadata deletion protection when leave order references exist
"""
import concurrent.futures
import sqlite3
import pytest

from app.models import item_model, destination_model, unit_model, leave_order_model
from app.services import leave_order_service


def test_leave_order_creation_success(client, sample_metadata, temp_db_path):
    """
    Verifies successful creation of a multi-line leave order:
    - Order number formatted as LO-000001
    - Stock deducted conditionally
    - Immutable line snapshots created
    - Movement logs linked to actor, destination, and leave order line
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create two active items
    res1 = client.post("/api/items/", json={
        "name": "Safety Boots",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 25
    })
    assert res1.status_code == 201
    item1_id = res1.get_json()["id"]

    res2 = client.post("/api/items/", json={
        "name": "Hard Hat",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 15
    })
    assert res2.status_code == 201
    item2_id = res2.get_json()["id"]

    # Create leave order via authenticated warehouse client
    lo_payload = {
        "employee_name": "Tariq Ibrahim",
        "destination_id": dest_id,
        "notes": "Field maintenance equipment",
        "items": [
            {"item_id": item1_id, "quantity": 5},
            {"item_id": item2_id, "quantity": 3}
        ]
    }
    headers = {"Idempotency-Key": "test-lo-create-001"}

    res = client.post("/api/leave-orders", json=lo_payload, headers=headers)
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.data.decode('utf-8')}"
    order = res.get_json()

    # Verify order structure
    assert order["order_number"].startswith("LO-")
    assert order["order_number"] == f"LO-{order['id']:06d}"
    assert order["employee_name"] == "Tariq Ibrahim"
    assert order["destination_id"] == dest_id
    assert order["destination_name"] == "مستودع 1"
    assert order["status"] == "open"
    assert order["revision"] == 0
    assert order["total_quantity"] == 8
    assert order["total_returned"] == 0
    assert order["remaining_quantity"] == 8
    assert len(order["items"]) == 2

    # Verify line snapshots
    line1 = next(l for l in order["items"] if l["item_id"] == item1_id)
    assert line1["item_name"] == "Safety Boots"
    assert line1["unit_id"] == unit_id
    assert line1["unit_name"] == "قطعة"
    assert line1["quantity"] == 5
    assert line1["returned_quantity"] == 0
    assert line1["remaining_quantity"] == 5

    line2 = next(l for l in order["items"] if l["item_id"] == item2_id)
    assert line2["item_name"] == "Hard Hat"
    assert line2["quantity"] == 3

    # Verify stock deduction in database
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()["current_quantity"] == 20  # 25 - 5

    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()["current_quantity"] == 12  # 15 - 3

    # Verify audit movement logs
    c.execute("""
        SELECT action_type, quantity_changed, resulting_quantity, destination_id,
               person_name, actor_name, operation_key, leave_line_id, unit_name
        FROM movement_logs
        WHERE operation_key = 'test-lo-create-001'
        ORDER BY id ASC
    """)
    logs = c.fetchall()
    assert len(logs) == 2

    for log in logs:
        assert log["action_type"] == "Removal"
        assert log["destination_id"] == dest_id
        assert log["person_name"] == "Tariq Ibrahim"
        assert log["actor_name"] == "Warehouse Operator"
        assert log["operation_key"] == "test-lo-create-001"
        assert log["leave_line_id"] is not None
        assert log["unit_name"] == "قطعة"

    conn.close()


def test_leave_order_validation_errors(client, sample_metadata):
    """Verifies strict input validation across all required constraints."""
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Missing Idempotency-Key
    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": dest_id,
        "items": [{"item_id": 1, "quantity": 1}]
    })
    assert res.status_code == 400
    assert res.get_json()["code"] == "MISSING_IDEMPOTENCY_KEY"

    headers = {"Idempotency-Key": "lo-val-key-1"}

    # 2. Blank employee name
    res = client.post("/api/leave-orders", json={
        "employee_name": "   ",
        "destination_id": dest_id,
        "items": [{"item_id": 1, "quantity": 1}]
    }, headers=headers)
    assert res.status_code == 400
    assert res.get_json()["code"] == "EMPTY_STRING"

    # 3. Nonexistent destination
    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": 99999,
        "items": [{"item_id": 1, "quantity": 1}]
    }, headers={"Idempotency-Key": "lo-val-key-2"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "INVALID_FOREIGN_KEY"

    # 4. Empty items list
    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": dest_id,
        "items": []
    }, headers={"Idempotency-Key": "lo-val-key-3"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "EMPTY_LINES"

    # 5. Duplicate items in lines
    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": dest_id,
        "items": [
            {"item_id": 1, "quantity": 2},
            {"item_id": 1, "quantity": 3}
        ]
    }, headers={"Idempotency-Key": "lo-val-key-4"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "DUPLICATE_LINE"

    # 6. Non-positive, zero, or boolean quantities
    for invalid_qty in (0, -3, True, False, 2.5, "five"):
        res = client.post("/api/leave-orders", json={
            "employee_name": "Omar",
            "destination_id": dest_id,
            "items": [{"item_id": 1, "quantity": invalid_qty}]
        }, headers={"Idempotency-Key": f"lo-val-key-{invalid_qty}"})
        assert res.status_code == 400


def test_leave_order_inactive_and_insufficient_stock_rejections(client, sample_metadata):
    """Verifies that inactive/archived items and insufficient stock are strictly rejected."""
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create an item with stock 5
    res = client.post("/api/items/", json={
        "name": "Low Stock Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5
    })
    item_id = res.get_json()["id"]

    # 1. Requesting 10 when stock is 5 -> 400 INSUFFICIENT_STOCK
    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 10}]
    }, headers={"Idempotency-Key": "insufficient-stock-key"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "INSUFFICIENT_STOCK"

    # 2. Deactivate item and attempt leave order -> 400 ITEM_NOT_ACTIVE
    client.patch(f"/api/items/{item_id}/status", json={"status": "inactive"})

    res = client.post("/api/leave-orders", json={
        "employee_name": "Omar",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 2}]
    }, headers={"Idempotency-Key": "inactive-item-key"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "ITEM_NOT_ACTIVE"


def test_multi_line_atomic_rollback_on_failure(client, sample_metadata, temp_db_path):
    """
    Crucial Acceptance Criteria:
    If line 2 fails (insufficient stock), line 1 stock change, header, lines,
    movement logs, and operation reservation must be completely rolled back!
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Item 1 has 20 units
    res1 = client.post("/api/items/", json={
        "name": "Item Alpha",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20
    })
    item1_id = res1.get_json()["id"]

    # Item 2 has 2 units
    res2 = client.post("/api/items/", json={
        "name": "Item Beta",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 2
    })
    item2_id = res2.get_json()["id"]

    # Attempt leave order: Line 1 asks for 5 (valid), Line 2 asks for 10 (exceeds available 2)
    lo_payload = {
        "employee_name": "Hassan",
        "destination_id": dest_id,
        "items": [
            {"item_id": item1_id, "quantity": 5},
            {"item_id": item2_id, "quantity": 10}
        ]
    }
    res = client.post("/api/leave-orders", json=lo_payload, headers={"Idempotency-Key": "atomic-fail-key"})
    assert res.status_code == 400
    assert res.get_json()["code"] == "INSUFFICIENT_STOCK"

    # Verify that Item Alpha was NOT deducted
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()["current_quantity"] == 20

    # Verify no leave order exists
    c.execute("SELECT COUNT(*) FROM leave_orders")
    assert c.fetchone()[0] == 0

    # Verify no leave order items exist
    c.execute("SELECT COUNT(*) FROM leave_order_items")
    assert c.fetchone()[0] == 0

    # Verify no movement logs were committed for this operation
    c.execute("SELECT COUNT(*) FROM movement_logs WHERE operation_key = 'atomic-fail-key'")
    assert c.fetchone()[0] == 0

    # Verify operation was not marked completed
    c.execute("SELECT status FROM operations WHERE operation_key = 'atomic-fail-key'")
    row = c.fetchone()
    # It either rolled back the in_progress row or was not committed
    assert row is None or row["status"] != "completed"

    conn.close()


def test_idempotency_replay_and_conflict(client, sample_metadata):
    """
    Verifies:
    1. Identical resubmission replays saved response without re-deducting stock.
    2. Changed payload with same key returns 409 conflict.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Cable Roll",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 50
    })
    item_id = res_item.get_json()["id"]

    payload = {
        "employee_name": "Adel Emam",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 10}]
    }
    headers = {"Idempotency-Key": "idemp-leave-key-100"}

    # 1. First submission
    res1 = client.post("/api/leave-orders", json=payload, headers=headers)
    assert res1.status_code == 201
    order1 = res1.get_json()

    # Item balance is now 50 - 10 = 40
    item_check = client.get(f"/api/items/{item_id}").get_json()
    assert item_check["current_quantity"] == 40

    # 2. Resubmission with same key and payload -> Replays exact result
    res2 = client.post("/api/leave-orders", json=payload, headers=headers)
    assert res2.status_code == 201
    order2 = res2.get_json()
    assert order1["id"] == order2["id"]
    assert order1["order_number"] == order2["order_number"]

    # Stock must NOT have been deducted again (still 40)
    item_check = client.get(f"/api/items/{item_id}").get_json()
    assert item_check["current_quantity"] == 40

    # 3. Resubmission with same key but DIFFERENT payload -> 409 Conflict
    diff_payload = {
        "employee_name": "Different Employee",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 10}]
    }
    res3 = client.post("/api/leave-orders", json=diff_payload, headers=headers)
    assert res3.status_code == 409
    assert res3.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_concurrent_leave_order_stock_protection(temp_db_path, sample_metadata):
    """
    Simulates concurrent requests competing for limited stock:
    Item has 10 units. Two threads attempt to issue 7 units each.
    Exactly one must succeed, one must fail; stock must never become negative.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]

    conn = sqlite3.connect(temp_db_path)
    c = conn.cursor()
    c.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Limited Cables', ?, 10, 'active')", (unit_id,))
    item_id = c.lastrowid
    c.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('wh_worker', 'h', 'warehouse', 'WH Worker')")
    user_id = c.lastrowid
    conn.commit()
    conn.close()

    def submit_leave_order(key):
        thread_conn = sqlite3.connect(temp_db_path, check_same_thread=False)
        thread_conn.row_factory = sqlite3.Row
        thread_conn.execute("PRAGMA foreign_keys = ON;")
        thread_conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            leave_order_service.create_leave_order_service(
                employee_name="Worker A",
                destination_id=dest_id,
                items=[{"item_id": item_id, "quantity": 7}],
                actor_id=user_id,
                actor_name="WH Worker",
                idempotency_key=key,
                db=thread_conn
            )
            thread_conn.commit()
            return True
        except Exception:
            thread_conn.rollback()
            return False
        finally:
            thread_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(submit_leave_order, "concurrent-lo-1")
        f2 = executor.submit(submit_leave_order, "concurrent-lo-2")
        results = [f1.result(), f2.result()]

    assert sum(1 for r in results if r is True) == 1
    assert sum(1 for r in results if r is False) == 1

    # Check final quantity in DB
    verify_conn = sqlite3.connect(temp_db_path)
    c = verify_conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()[0] == 3  # 10 - 7
    verify_conn.close()


def test_leave_order_list_detail_and_tickets_count(client, sample_metadata):
    """
    Verifies:
    - GET /api/leave-orders with pagination, status filters, and search
    - GET /api/leave-orders/<id> detail format
    - GET /api/leave-orders/tickets/count
    - GET /api/tickets actionable list
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Measuring Tape",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 100
    })
    item_id = res_item.get_json()["id"]

    # Create 3 leave orders
    for i in range(1, 4):
        client.post("/api/leave-orders", json={
            "employee_name": f"Employee {i}",
            "destination_id": dest_id,
            "items": [{"item_id": item_id, "quantity": 2 * i}]
        }, headers={"Idempotency-Key": f"list-test-lo-{i}"})

    # 1. Count endpoint: 3 open orders -> count = 3
    count_res = client.get("/api/leave-orders/tickets/count")
    assert count_res.status_code == 200
    assert count_res.get_json()["count"] == 3

    # 2. Paginated list: page=1, page_size=2
    list_res = client.get("/api/leave-orders?page=1&page_size=2")
    assert list_res.status_code == 200
    list_data = list_res.get_json()
    assert list_data["total_count"] == 3
    assert list_data["page"] == 1
    assert list_data["page_size"] == 2
    assert list_data["total_pages"] == 2
    assert len(list_data["leave_orders"]) == 2

    # 3. Status filter
    open_res = client.get("/api/leave-orders?status=open")
    assert open_res.status_code == 200
    assert open_res.get_json()["total_count"] == 3

    closed_res = client.get("/api/leave-orders?status=closed")
    assert closed_res.status_code == 200
    assert closed_res.get_json()["total_count"] == 0

    # 4. Search filter
    search_res = client.get("/api/leave-orders?search=Employee 2")
    assert search_res.status_code == 200
    assert search_res.get_json()["total_count"] == 1
    assert search_res.get_json()["leave_orders"][0]["employee_name"] == "Employee 2"

    # 5. Detail endpoint
    first_id = list_data["leave_orders"][0]["id"]
    detail_res = client.get(f"/api/leave-orders/{first_id}")
    assert detail_res.status_code == 200
    detail = detail_res.get_json()
    assert detail["id"] == first_id
    assert "items" in detail
    assert "return_events" in detail
    assert detail["items"][0]["item_name"] == "Measuring Tape"

    # 6. Tickets list endpoint (defaults to actionable status)
    ticket_res = client.get("/api/tickets")
    assert ticket_res.status_code == 200
    ticket_data = ticket_res.get_json()
    assert "tickets" in ticket_data
    assert ticket_data["total_count"] == 3


def test_leave_order_manual_closure(client, office_client, sample_metadata):
    """
    Verifies manual closure with disposition reason:
    - Office or Warehouse can close
    - Requires nonblank reason and expected_revision
    - Decrements actionable ticket count
    - Closes without adjusting inventory
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Drill Bit",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20
    })
    item_id = res_item.get_json()["id"]

    create_res = client.post("/api/leave-orders", json={
        "employee_name": "Mustafa",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 4}]
    }, headers={"Idempotency-Key": "close-test-lo-1"})
    order = create_res.get_json()
    order_id = order["id"]

    # Actionable count is 1
    assert client.get("/api/leave-orders/tickets/count").get_json()["count"] == 1

    # Close order via Office client
    close_res = office_client.post(f"/api/leave-orders/{order_id}/close", json={
        "reason": "Project completed, consumed in field",
        "expected_revision": 0
    })
    assert close_res.status_code == 200
    closed_order = close_res.get_json()
    assert closed_order["status"] == "closed"
    assert closed_order["close_reason"] == "Project completed, consumed in field"
    assert closed_order["revision"] == 1

    # Stock is unchanged (still 20 - 4 = 16)
    item_row = client.get(f"/api/items/{item_id}").get_json()
    assert item_row["current_quantity"] == 16

    # Actionable count drops to 0
    assert client.get("/api/leave-orders/tickets/count").get_json()["count"] == 0

    # Attempting to close an already closed order -> 409 Conflict
    reclose = office_client.post(f"/api/leave-orders/{order_id}/close", json={
        "reason": "Again",
        "expected_revision": 1
    })
    assert reclose.status_code == 409


def test_role_permissions_for_leave_orders(client, office_client, sample_metadata):
    """
    Verifies permission matrix:
    - Warehouse: can create (POST /api/leave-orders)
    - Office: DENIED create (403 Forbidden)
    - Both: can read (GET list, detail, count)
    """
    dest_id = sample_metadata["destination_id"]

    # Office trying to create leave order -> 403 Forbidden
    res = office_client.post("/api/leave-orders", json={
        "employee_name": "Office Employee",
        "destination_id": dest_id,
        "items": [{"item_id": 1, "quantity": 1}]
    }, headers={"Idempotency-Key": "office-lo-create"})
    assert res.status_code == 403
    assert res.get_json()["code"] == "FORBIDDEN"

    # Office can read list and count
    assert office_client.get("/api/leave-orders").status_code == 200
    assert office_client.get("/api/leave-orders/tickets/count").status_code == 200


def test_metadata_and_lifecycle_safety_with_leave_orders(client, sample_metadata):
    """
    Verifies that:
    1. Destination in use by leave order cannot be deleted (409 Conflict).
    2. Unit in use by leave order line cannot be deleted (409 Conflict).
    3. Item with outstanding unreturned stock in leave order blocks unit modification.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Safety Goggles",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 30
    })
    item_id = res_item.get_json()["id"]

    # Create leave order
    client.post("/api/leave-orders", json={
        "employee_name": "Mahmoud",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 5}]
    }, headers={"Idempotency-Key": "metadata-safety-key"})

    # 1. Attempt to delete destination -> 409 Conflict
    del_dest = client.delete(f"/api/destinations/{dest_id}")
    assert del_dest.status_code == 409

    # 2. Attempt to delete unit -> 409 Conflict
    del_unit = client.delete(f"/api/units/{unit_id}")
    assert del_unit.status_code == 409

    # 3. Create a second unit
    res_u2 = client.post("/api/units", json={"name": "علبة"})
    unit2_id = res_u2.get_json()["id"]

    # Attempt to change item's unit while leave order has outstanding unreturned units -> Rejected
    put_res = client.put(f"/api/items/{item_id}", json={
        "name": "Safety Goggles",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id
    })
    assert put_res.status_code == 400
    assert "pending purchase orders or outstanding leave orders" in put_res.get_json()["error"]


def test_zero_id_boundary_validation(client):
    """
    Verifies that requesting ID 0 for leave orders or tickets returns 400 Validation Error,
    never crashing the server with a 500 error.
    """
    res1 = client.get("/api/leave-orders/0")
    assert res1.status_code == 400
    assert res1.get_json()["code"] == "OUT_OF_RANGE"

    res2 = client.get("/api/tickets/0")
    assert res2.status_code == 400
    assert res2.get_json()["code"] == "OUT_OF_RANGE"


def test_leave_order_closure_idempotency_and_ticket_alias(client, office_client, sample_metadata):
    """
    Verifies:
    1. Closing via canonical /api/tickets/<id>/close route.
    2. Replaying closure with the same Idempotency-Key returns saved 200 result.
    3. Closing with mismatched revision returns 409 REVISION_CONFLICT.
    4. Closing an already closed order with a different request returns 409 STATE_CONFLICT.
    5. Unit modification remains blocked even after manual closure when unreturned quantities exist.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Hardened Chisel",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 25
    })
    item_id = res_item.get_json()["id"]

    create_res = client.post("/api/leave-orders", json={
        "employee_name": "Salim",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 8}]
    }, headers={"Idempotency-Key": "close-alias-lo-1"})
    order_id = create_res.get_json()["id"]

    # 1. Revision mismatch returns 409 REVISION_CONFLICT
    res_rev = office_client.post(f"/api/leave-orders/{order_id}/close", json={
        "reason": "Wrong rev",
        "expected_revision": 99
    })
    assert res_rev.status_code == 409
    assert res_rev.get_json()["code"] == "REVISION_CONFLICT"

    # 2. Close via canonical /api/tickets/<id>/close with Idempotency-Key
    close_headers = {"Idempotency-Key": "close-idemp-key-100"}
    close_payload = {
        "reason": "Work completed on site",
        "expected_revision": 0
    }
    res_close = office_client.post(f"/api/tickets/{order_id}/close", json=close_payload, headers=close_headers)
    assert res_close.status_code == 200
    closed_data = res_close.get_json()
    assert closed_data["status"] == "closed"
    assert closed_data["revision"] == 1
    assert closed_data["close_reason"] == "Work completed on site"

    # 3. Exact replay of same close request returns saved success (200)
    res_replay = office_client.post(f"/api/tickets/{order_id}/close", json=close_payload, headers=close_headers)
    assert res_replay.status_code == 200
    assert res_replay.get_json()["id"] == order_id
    assert res_replay.get_json()["status"] == "closed"

    # 4. Different close request against already-closed order returns 409 STATE_CONFLICT
    diff_close = office_client.post(f"/api/tickets/{order_id}/close", json={
        "reason": "Different reason",
        "expected_revision": 1
    }, headers={"Idempotency-Key": "different-close-key-200"})
    assert diff_close.status_code == 409
    assert diff_close.get_json()["code"] == "STATE_CONFLICT"

    # 5. Unit change remains blocked after manual closure because outstanding quantity still exists
    res_u2 = client.post("/api/units", json={"name": "كرتونة"})
    unit2_id = res_u2.get_json()["id"]

    put_res = client.put(f"/api/items/{item_id}", json={
        "name": "Hardened Chisel",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id
    })
    assert put_res.status_code == 400
    assert "pending purchase orders or outstanding leave orders" in put_res.get_json()["error"]


def test_office_can_return_warehouse_and_unauth_denied(client, office_client, unauthenticated_client, sample_metadata):
    """Verifies role permissions for ticket returns: Office allowed, Warehouse denied, Unauthenticated rejected."""
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Safety Gloves V2",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Ahmad Mansour",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 10}]
    }, headers={"Idempotency-Key": "perm-test-lo-100"})
    assert res_lo.status_code == 201
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    return_payload = {
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 3}],
        "notes": "Office return authorization"
    }

    # 1. Unauthenticated request -> 401
    res_unauth = unauthenticated_client.post(f"/api/tickets/{order_id}/return", json=return_payload)
    assert res_unauth.status_code == 401
    assert res_unauth.get_json()["code"] == "UNAUTHENTICATED"

    # 2. Warehouse request -> 403
    res_wh = client.post(f"/api/tickets/{order_id}/return", json=return_payload, headers={"Idempotency-Key": "wh-return-attempt-1"})
    assert res_wh.status_code == 403
    assert res_wh.get_json()["code"] == "FORBIDDEN"

    # 3. Office request -> 200
    res_office = office_client.post(f"/api/tickets/{order_id}/return", json=return_payload, headers={"Idempotency-Key": "office-return-success-1"})
    assert res_office.status_code == 200
    updated = res_office.get_json()
    assert updated["status"] == "partially_returned"
    assert updated["total_returned"] == 3
    assert updated["remaining_quantity"] == 7
    assert updated["net_issued_quantity"] == 7
    assert updated["revision"] == 1


def test_positive_delta_validation_and_atomicity(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies input validation constraints and transactional rollback:
    - Delta must be a positive integer
    - Cannot exceed remaining returnable quantity
    - Duplicate line_ids rejected
    - If any line fails, all line changes roll back completely
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res1 = client.post("/api/items/", json={"name": "Cable 10m", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 50})
    res2 = client.post("/api/items/", json={"name": "Switch Box", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 30})
    item1_id = res1.get_json()["id"]
    item2_id = res2.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Sami Nabil",
        "destination_id": dest_id,
        "items": [
            {"item_id": item1_id, "quantity": 10},
            {"item_id": item2_id, "quantity": 5}
        ]
    }, headers={"Idempotency-Key": "val-test-lo-100"})
    order = res_lo.get_json()
    order_id = order["id"]
    line1 = next(l for l in order["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in order["items"] if l["item_id"] == item2_id)

    # 1. Missing Idempotency-Key
    res_no_key = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line1["id"], "quantity": 2}]
    })
    assert res_no_key.status_code == 400
    assert res_no_key.get_json()["code"] == "MISSING_IDEMPOTENCY_KEY"

    # 2. Delta is zero or negative
    for bad_qty in [0, -2]:
        res_bad_qty = office_client.post(f"/api/tickets/{order_id}/return", json={
            "expected_revision": 0,
            "items": [{"line_id": line1["id"], "quantity": bad_qty}]
        }, headers={"Idempotency-Key": f"bad-qty-{bad_qty}"})
        assert res_bad_qty.status_code == 400

    # 3. Delta exceeds returnable quantity
    res_exceed = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line1["id"], "quantity": 11}]  # Ordered 10
    }, headers={"Idempotency-Key": "exceed-qty-1"})
    assert res_exceed.status_code == 400
    assert res_exceed.get_json()["code"] == "EXCEEDS_RETURNABLE_QUANTITY"

    # 4. Duplicate line_id
    res_dup = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "quantity": 1},
            {"line_id": line1["id"], "quantity": 2}
        ]
    }, headers={"Idempotency-Key": "dup-lines-1"})
    assert res_dup.status_code == 400
    assert res_dup.get_json()["code"] == "DUPLICATE_LINE"

    # 5. Non-existent line ID
    res_bad_line = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": 999999, "quantity": 1}]
    }, headers={"Idempotency-Key": "bad-line-1"})
    assert res_bad_line.status_code == 400
    assert res_bad_line.get_json()["code"] == "INVALID_LINE"

    # 6. Multi-line transactional atomicity:
    # Line 1 is valid (qty 2 <= 10), but Line 2 exceeds remaining (qty 10 > 5)
    res_atomic = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "quantity": 2},
            {"line_id": line2["id"], "quantity": 10}
        ]
    }, headers={"Idempotency-Key": "atomic-fail-1"})
    assert res_atomic.status_code == 400
    assert res_atomic.get_json()["code"] == "EXCEEDS_RETURNABLE_QUANTITY"

    # Verify database: stock for item1 must still be 40 (50 - 10), item2 still 25 (30 - 5)
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()["current_quantity"] == 40
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()["current_quantity"] == 25

    # Verify no return events or return logs were created
    c.execute("SELECT COUNT(*) FROM return_events WHERE leave_order_id = ?", (order_id,))
    assert c.fetchone()[0] == 0
    c.execute("SELECT COUNT(*) FROM movement_logs WHERE action_type = 'Return'")
    assert c.fetchone()[0] == 0
    conn.close()


def test_partial_and_full_return_lifecycle(client, office_client, sample_metadata, temp_db_path):
    """
    Tests complete return lifecycle:
    - Order starts 'open', count badge reflects it
    - Partial return transitions to 'partially_returned', badge reflects it
    - Full return transitions automatically to 'closed' with reason 'All items returned', leaves badge
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={"name": "Drill Bit", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 20})
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Karim Zaki",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 8}]
    }, headers={"Idempotency-Key": "lifecycle-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # Initial count check
    cnt_res = office_client.get("/api/leave-orders/tickets/count")
    initial_count = cnt_res.get_json()["count"]
    assert initial_count >= 1

    # Check /api/tickets list returns actionable tickets
    tickets_res = office_client.get("/api/tickets?status=actionable")
    assert tickets_res.status_code == 200
    ticket_ids = [t["id"] for t in tickets_res.get_json()["tickets"]]
    assert order_id in ticket_ids

    # 1. Partial Return: return 3 out of 8
    res_partial = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 3}],
        "notes": "First partial batch return"
    }, headers={"Idempotency-Key": "lifecycle-ret-1"})
    assert res_partial.status_code == 200
    p_data = res_partial.get_json()
    assert p_data["status"] == "partially_returned"
    assert p_data["revision"] == 1
    assert p_data["total_returned"] == 3
    assert p_data["remaining_quantity"] == 5
    assert p_data["net_issued_quantity"] == 5
    assert len(p_data["return_events"]) == 1

    # Verify inventory credited: 12 + 3 = 15
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()["current_quantity"] == 15

    # Verify Return audit log
    c.execute("""
        SELECT action_type, quantity_changed, resulting_quantity, user_id, actor_name,
               operation_key, leave_line_id, return_event_id, unit_name, person_name, destination_id
        FROM movement_logs
        WHERE operation_key = 'lifecycle-ret-1'
    """)
    log = c.fetchone()
    assert log["action_type"] == "Return"
    assert log["quantity_changed"] == 3
    assert log["resulting_quantity"] == 15
    assert log["actor_name"] == "Office Operator"
    assert log["person_name"] == "Karim Zaki"
    assert log["destination_id"] == dest_id
    assert log["leave_line_id"] == line_id
    assert log["return_event_id"] is not None
    assert log["unit_name"] == "قطعة"
    conn.close()

    # Ticket is still actionable
    cnt_res = office_client.get("/api/leave-orders/tickets/count")
    assert cnt_res.get_json()["count"] == initial_count

    # 2. Full Return: return remaining 5
    res_full = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 1,
        "items": [{"line_id": line_id, "quantity": 5}],
        "notes": "Final return batch"
    }, headers={"Idempotency-Key": "lifecycle-ret-2"})
    assert res_full.status_code == 200
    f_data = res_full.get_json()
    assert f_data["status"] == "closed"
    assert f_data["revision"] == 2
    assert f_data["total_returned"] == 8
    assert f_data["remaining_quantity"] == 0
    assert f_data["net_issued_quantity"] == 0
    assert f_data["close_reason"] == "All items returned"
    assert f_data["closed_by"] is not None
    assert f_data["closer_name"] == "Office Operator"
    assert f_data["closed_at"] is not None
    assert len(f_data["return_events"]) == 2

    # Inventory fully restored: 15 + 5 = 20
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()["current_quantity"] == 20
    conn.close()

    # Ticket is NO LONGER actionable
    cnt_res = office_client.get("/api/leave-orders/tickets/count")
    assert cnt_res.get_json()["count"] == initial_count - 1

    # /api/tickets list without closed filter does NOT show closed ticket
    tickets_res = office_client.get("/api/tickets?status=actionable")
    active_ids = [t["id"] for t in tickets_res.get_json()["tickets"]]
    assert order_id not in active_ids


def test_idempotency_replay_and_conflict(client, office_client, sample_metadata):
    """Verifies that replaying return requests returns saved response and changed payload returns 409."""
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={"name": "Safety Vest", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 10})
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Mustafa Ali",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 6}]
    }, headers={"Idempotency-Key": "idemp-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    idemp_headers = {"Idempotency-Key": "idemp-ret-exact-key-1"}
    payload = {
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 2}],
        "notes": "Partial return"
    }

    # 1. First execution
    res1 = office_client.post(f"/api/tickets/{order_id}/return", json=payload, headers=idemp_headers)
    assert res1.status_code == 200
    data1 = res1.get_json()
    assert data1["total_returned"] == 2
    assert data1["revision"] == 1

    # 2. Exact replay with same idempotency key
    res2 = office_client.post(f"/api/tickets/{order_id}/return", json=payload, headers=idemp_headers)
    assert res2.status_code == 200
    data2 = res2.get_json()
    assert data2["id"] == data1["id"]
    assert data2["total_returned"] == 2
    assert data2["revision"] == 1

    # 3. Same key with altered payload -> 409 conflict
    diff_payload = {
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 3}],
        "notes": "Modified delta"
    }
    res_conflict = office_client.post(f"/api/tickets/{order_id}/return", json=diff_payload, headers=idemp_headers)
    assert res_conflict.status_code == 409


def test_revision_conflict_and_competing_returns(client, office_client, sample_metadata):
    """Verifies that stale expected_revision returns 409 REVISION_CONFLICT."""
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={"name": "Welding Mask", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 10})
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Rami Fouad",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 4}]
    }, headers={"Idempotency-Key": "rev-comp-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # First return bumps revision from 0 to 1
    res1 = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 1}]
    }, headers={"Idempotency-Key": "rev-bump-1"})
    assert res1.status_code == 200

    # Second return sends stale revision 0 -> 409 REVISION_CONFLICT
    res_stale = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 1}]
    }, headers={"Idempotency-Key": "rev-stale-2"})
    assert res_stale.status_code == 409
    assert res_stale.get_json()["code"] == "REVISION_CONFLICT"


def test_manual_closure_and_permitted_late_returns(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies that:
    1. Manual closure with outstanding units requires a nonblank reason and never modifies stock.
    2. A manually closed order can accept permitted late returns for still-outstanding quantities.
    3. Late returns keep the order closed and preserve the original closure details (closer, time, reason).
    4. Late returns cannot exceed still-outstanding units.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={"name": "Copper Pipe", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 30})
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Bassam Hasan",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 10}]
    }, headers={"Idempotency-Key": "manual-close-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # Partial return of 2 items
    res_ret1 = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 2}]
    }, headers={"Idempotency-Key": "ret-before-close"})
    assert res_ret1.status_code == 200
    rev1 = res_ret1.get_json()["revision"]  # 1

    # Manual close requires nonblank reason
    res_blank = office_client.post(f"/api/tickets/{order_id}/close", json={
        "expected_revision": rev1,
        "reason": "   "
    }, headers={"Idempotency-Key": "close-blank-reason"})
    assert res_blank.status_code == 400

    # Manual close with valid reason
    res_close = office_client.post(f"/api/tickets/{order_id}/close", json={
        "expected_revision": rev1,
        "reason": "Used up on site during emergency repair"
    }, headers={"Idempotency-Key": "manual-close-valid"})
    assert res_close.status_code == 200
    closed_order = res_close.get_json()
    assert closed_order["status"] == "closed"
    assert closed_order["close_reason"] == "Used up on site during emergency repair"
    assert closed_order["closed_by"] is not None
    original_closer_name = closed_order["closer_name"]
    original_closed_at = closed_order["closed_at"]
    rev2 = closed_order["revision"]  # 2

    # Verify manual close did NOT adjust stock: current stock should be 30 - 10 + 2 = 22
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()["current_quantity"] == 22
    conn.close()

    # Permitted Late Return: 3 units are found in the truck and returned
    res_late = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": rev2,
        "items": [{"line_id": line_id, "quantity": 3}],
        "notes": "Late return found in maintenance vehicle"
    }, headers={"Idempotency-Key": "permitted-late-ret-1"})
    assert res_late.status_code == 200
    late_order = res_late.get_json()

    # The ticket REMAINS closed
    assert late_order["status"] == "closed"
    # Original closure details are PRESERVED
    assert late_order["close_reason"] == "Used up on site during emergency repair"
    assert late_order["closer_name"] == original_closer_name
    assert late_order["closed_at"] == original_closed_at
    # Aggregates updated
    assert late_order["total_returned"] == 5  # 2 + 3
    assert late_order["remaining_quantity"] == 5  # 10 - 5
    assert late_order["revision"] == rev2 + 1  # 3

    # Stock was credited +3: 22 + 3 = 25
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()["current_quantity"] == 25
    conn.close()

    # Attempting late return exceeding remaining (6 > 5) is rejected
    res_late_exceed = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": rev2 + 1,
        "items": [{"line_id": line_id, "quantity": 6}]
    }, headers={"Idempotency-Key": "late-exceed-ret"})
    assert res_late_exceed.status_code == 400
    assert res_late_exceed.get_json()["code"] == "EXCEEDS_RETURNABLE_QUANTITY"


def test_inactive_and_archived_items_returns(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies that inactive or archived items can receive returns without being silently reactivated.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={"name": "Obsolete Sensor", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 10})
    item_id = res_item.get_json()["id"]

    # Warehouse creates leave order for 4 units
    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Adel Salem",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 4}]
    }, headers={"Idempotency-Key": "inactive-item-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # Now archive the item
    res_status = client.patch(f"/api/items/{item_id}/status", json={"status": "archived"})
    assert res_status.status_code == 200
    assert res_status.get_json()["status"] == "archived"

    # Office returns 2 units against the archived item
    res_ret = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 2}],
        "notes": "Returning decommissioned sensor"
    }, headers={"Idempotency-Key": "ret-archived-item-1"})
    assert res_ret.status_code == 200

    # Verify item status remains 'archived' and current_quantity is 6 + 2 = 8
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT status, current_quantity FROM items WHERE id = ?", (item_id,))
    row = c.fetchone()
    assert row["status"] == "archived", "Item was silently reactivated!"
    assert row["current_quantity"] == 8
    conn.close()


def test_unit_change_blocked_and_unit_mismatch_on_return(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies that:
    1. Unit changes on an item are blocked as long as returnable quantities remain.
    2. Once all returnable quantities are returned, unit change is unblocked.
    3. If an item's unit in DB differs from snapshot unit, return is rejected with UNIT_MISMATCH.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create a second unit
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("INSERT INTO units (name) VALUES ('متر')")
    unit2_id = c.lastrowid
    conn.commit()
    conn.close()

    res_item = client.post("/api/items/", json={"name": "Hydraulic Hose", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 15})
    item_id = res_item.get_json()["id"]

    res_lo = client.post("/api/leave-orders", json={
        "employee_name": "Waleed Taha",
        "destination_id": dest_id,
        "items": [{"item_id": item_id, "quantity": 5}]
    }, headers={"Idempotency-Key": "unit-block-lo-1"})
    order = res_lo.get_json()
    order_id = order["id"]
    line_id = order["items"][0]["id"]

    # 1. Attempt unit change while returnable quantity remains -> blocked
    res_unit_change = client.put(f"/api/items/{item_id}", json={
        "name": "Hydraulic Hose",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id
    })
    assert res_unit_change.status_code == 400
    assert "cannot change unit" in res_unit_change.get_json()["error"].lower()

    # 2. Simulate unit mismatch by directly updating item unit in DB
    conn = sqlite3.connect(temp_db_path)
    conn.execute("UPDATE items SET unit_id = ? WHERE id = ?", (unit2_id, item_id))
    conn.commit()
    conn.close()

    # Return should fail with UNIT_MISMATCH
    res_mismatch = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 2}]
    }, headers={"Idempotency-Key": "unit-mismatch-key"})
    assert res_mismatch.status_code == 400
    assert res_mismatch.get_json()["code"] == "UNIT_MISMATCH"

    # Restore original unit
    conn = sqlite3.connect(temp_db_path)
    conn.execute("UPDATE items SET unit_id = ? WHERE id = ?", (unit_id, item_id))
    conn.commit()
    conn.close()

    # Full return to clear outstanding units
    res_full_ret = office_client.post(f"/api/tickets/{order_id}/return", json={
        "expected_revision": 0,
        "items": [{"line_id": line_id, "quantity": 5}]
    }, headers={"Idempotency-Key": "clear-outstanding-key"})
    assert res_full_ret.status_code == 200

    # 3. Now unit change is unblocked!
    res_unblocked = client.put(f"/api/items/{item_id}", json={
        "name": "Hydraulic Hose",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id,
        "force_unit_change": True
    })
    assert res_unblocked.status_code == 200
    assert res_unblocked.get_json()["unit_id"] == unit2_id


def test_concurrent_competing_returns(sample_metadata, temp_db_path):
    """
    Two concurrent threads compete to process returns against the same ticket at revision 0.
    Order has 10 units issued. Thread 1 returns 4 units, Thread 2 returns 4 units.
    Both submit expected_revision=0.
    Exactly one must succeed (committing return event, bumping revision to 1, restoring 4 units of stock).
    The other must fail with revision/state conflict and roll back cleanly.
    Final DB state: total_returned = 4, remaining_quantity = 6, stock credited = 4, revision = 1.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]

    conn = sqlite3.connect(temp_db_path)
    c = conn.cursor()
    c.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Concurrent Wire', ?, 20, 'active')", (unit_id,))
    item_id = c.lastrowid
    c.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('office_user_conc', 'h', 'office', 'Office User')")
    user_id = c.lastrowid
    conn.commit()

    order = leave_order_service.create_leave_order_service(
        employee_name="Worker Conc",
        destination_id=dest_id,
        items=[{"item_id": item_id, "quantity": 10}],
        actor_id=user_id,
        actor_name="Office User",
        idempotency_key="setup-conc-lo-1",
        db=conn
    )
    conn.commit()
    order_id = order["id"]
    line_id = order["items"][0]["id"]
    conn.close()

    def submit_return(key):
        thread_conn = sqlite3.connect(temp_db_path, check_same_thread=False, timeout=10)
        thread_conn.row_factory = sqlite3.Row
        thread_conn.execute("PRAGMA foreign_keys = ON;")
        thread_conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            leave_order_service.process_ticket_return_service(
                order_id=order_id,
                expected_revision=0,
                items=[{"line_id": line_id, "quantity": 4}],
                actor_id=user_id,
                actor_name="Office User",
                idempotency_key=key,
                db=thread_conn
            )
            thread_conn.commit()
            return True, None
        except Exception as e:
            thread_conn.rollback()
            return False, type(e).__name__
        finally:
            thread_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(submit_return, "conc-ret-key-1")
        f2 = executor.submit(submit_return, "conc-ret-key-2")
        results = [f1.result(), f2.result()]

    successes = [r for r in results if r[0] is True]
    failures = [r for r in results if r[0] is False]

    assert len(successes) == 1, f"Expected exactly 1 success, got: {results}"
    assert len(failures) == 1, f"Expected exactly 1 failure, got: {results}"
    assert failures[0][1] in ("StateConflictError", "OperationalError")

    verify_conn = sqlite3.connect(temp_db_path)
    verify_conn.row_factory = sqlite3.Row
    c = verify_conn.cursor()

    # Stock was credited exactly 4: (20 - 10) + 4 = 14
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()["current_quantity"] == 14

    lo = leave_order_model.get_leave_order_by_id(verify_conn, order_id)
    assert lo["revision"] == 1
    assert lo["total_returned"] == 4
    assert lo["remaining_quantity"] == 6
    assert lo["status"] == "partially_returned"
    assert len(lo["return_events"]) == 1

    c.execute("SELECT COUNT(*) FROM movement_logs WHERE action_type = 'Return'")
    assert c.fetchone()[0] == 1
    verify_conn.close()


def test_concurrent_return_and_manual_close(sample_metadata, temp_db_path):
    """
    Two concurrent threads: Thread 1 attempts return (4 units), Thread 2 attempts manual close.
    Both submit expected_revision=0.
    Exactly one must win, and the other must fail with conflict. State remains completely sound.
    """
    unit_id = sample_metadata["unit_id"]
    dest_id = sample_metadata["destination_id"]

    conn = sqlite3.connect(temp_db_path)
    c = conn.cursor()
    c.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Race Pipe', ?, 30, 'active')", (unit_id,))
    item_id = c.lastrowid
    c.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('race_user', 'h', 'office', 'Race User')")
    user_id = c.lastrowid
    conn.commit()

    order = leave_order_service.create_leave_order_service(
        employee_name="Race Worker",
        destination_id=dest_id,
        items=[{"item_id": item_id, "quantity": 8}],
        actor_id=user_id,
        actor_name="Race User",
        idempotency_key="setup-race-lo-1",
        db=conn
    )
    conn.commit()
    order_id = order["id"]
    line_id = order["items"][0]["id"]
    conn.close()

    def do_return(key):
        thread_conn = sqlite3.connect(temp_db_path, check_same_thread=False, timeout=10)
        thread_conn.row_factory = sqlite3.Row
        thread_conn.execute("PRAGMA foreign_keys = ON;")
        thread_conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            leave_order_service.process_ticket_return_service(
                order_id=order_id,
                expected_revision=0,
                items=[{"line_id": line_id, "quantity": 4}],
                actor_id=user_id,
                actor_name="Race User",
                idempotency_key=key,
                db=thread_conn
            )
            thread_conn.commit()
            return True, "return"
        except Exception:
            thread_conn.rollback()
            return False, "return"
        finally:
            thread_conn.close()

    def do_close(key):
        thread_conn = sqlite3.connect(temp_db_path, check_same_thread=False, timeout=10)
        thread_conn.row_factory = sqlite3.Row
        thread_conn.execute("PRAGMA foreign_keys = ON;")
        thread_conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            leave_order_service.close_leave_order_service(
                order_id=order_id,
                closed_by=user_id,
                reason="Race closure",
                expected_revision=0,
                idempotency_key=key,
                db=thread_conn
            )
            thread_conn.commit()
            return True, "close"
        except Exception:
            thread_conn.rollback()
            return False, "close"
        finally:
            thread_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_return, "race-ret-1")
        f2 = executor.submit(do_close, "race-close-1")
        results = [f1.result(), f2.result()]

    successes = [r for r in results if r[0] is True]
    failures = [r for r in results if r[0] is False]
    assert len(successes) == 1
    assert len(failures) == 1

    verify_conn = sqlite3.connect(temp_db_path)
    verify_conn.row_factory = sqlite3.Row
    lo = leave_order_model.get_leave_order_by_id(verify_conn, order_id)
    assert lo["revision"] == 1
    if successes[0][1] == "return":
        assert lo["status"] == "partially_returned"
        assert lo["total_returned"] == 4
    else:
        assert lo["status"] == "closed"
        assert lo["total_returned"] == 0
        assert lo["close_reason"] == "Race closure"
    verify_conn.close()



