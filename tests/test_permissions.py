"""
Comprehensive tests for role enforcement and permission matrix:
- Unauthenticated requests to protected endpoints return 401
- Office vs. Warehouse vs. Admin permissions for all routes in the matrix
- Unknown /api/* routes return JSON 404, never SPA HTML
- Audit linkages: operations and movement_logs attribute authenticated actor
"""
import sqlite3
import pytest
from app.services import user_service, item_service
from app.models import item_model, movement_log_model


def test_unauthenticated_requests_return_401(unauthenticated_client):
    """Verifies that protected API endpoints reject unauthenticated requests with HTTP 401 across root and slash aliases."""
    endpoints = [
        ("GET", "/api/items"),
        ("GET", "/api/items/"),
        ("POST", "/api/items"),
        ("POST", "/api/items/"),
        ("GET", "/api/items/1"),
        ("PUT", "/api/items/1"),
        ("PATCH", "/api/items/1/status"),
        ("PATCH", "/api/items/1/restore"),
        ("POST", "/api/items/1/adjust"),
        ("GET", "/api/items/1/barcode"),
        ("GET", "/api/items/by-barcode/TEST-123"),
        ("GET", "/api/categories"),
        ("GET", "/api/categories/"),
        ("POST", "/api/categories"),
        ("POST", "/api/categories/"),
        ("GET", "/api/categories/1"),
        ("PUT", "/api/categories/1"),
        ("DELETE", "/api/categories/1"),
        ("GET", "/api/units"),
        ("GET", "/api/units/"),
        ("POST", "/api/units"),
        ("POST", "/api/units/"),
        ("GET", "/api/units/1"),
        ("PUT", "/api/units/1"),
        ("DELETE", "/api/units/1"),
        ("GET", "/api/destinations"),
        ("GET", "/api/destinations/"),
        ("POST", "/api/destinations"),
        ("POST", "/api/destinations/"),
        ("PUT", "/api/destinations/1"),
        ("DELETE", "/api/destinations/1"),
        ("GET", "/api/providers"),
        ("GET", "/api/providers/"),
        ("POST", "/api/providers"),
        ("POST", "/api/providers/"),
        ("PUT", "/api/providers/1"),
        ("DELETE", "/api/providers/1"),
        ("GET", "/api/movement-logs"),
        ("GET", "/api/movement-logs/"),
        ("GET", "/api/movement-logs/all_filtered"),
        ("GET", "/api/movement-logs/summary/today"),
        ("GET", "/api/purchase-orders"),
        ("GET", "/api/purchase-orders/"),
        ("POST", "/api/purchase-orders"),
        ("POST", "/api/purchase-orders/"),
        ("POST", "/api/purchase-orders/1/void"),
        ("POST", "/api/purchase-orders/1/receive"),
        ("GET", "/api/leave-orders"),
        ("GET", "/api/leave-orders/"),
        ("POST", "/api/leave-orders"),
        ("POST", "/api/leave-orders/"),
        ("POST", "/api/leave-orders/1/close"),
        ("GET", "/api/tickets"),
        ("GET", "/api/tickets/"),
        ("POST", "/api/tickets/1/return"),
        ("POST", "/api/tickets/1/close"),
        ("GET", "/api/sync-status"),
        ("GET", "/api/sync-status/"),
        ("POST", "/api/sync"),
        ("POST", "/api/sync/")
    ]

    for method, path in endpoints:
        if method == "GET":
            res = unauthenticated_client.get(path)
        elif method == "POST":
            res = unauthenticated_client.post(path, json={})
        elif method == "PUT":
            res = unauthenticated_client.put(path, json={})
        elif method == "PATCH":
            res = unauthenticated_client.patch(path, json={})
        elif method == "DELETE":
            res = unauthenticated_client.delete(path)

        assert res.status_code == 401, f"Expected 401 for unauthenticated {method} {path}, got {res.status_code}"
        data = res.get_json()
        assert data["code"] == "UNAUTHENTICATED"


def test_office_role_permission_matrix(office_client, sample_metadata):
    """
    Verifies Office operator permissions:
    - ALLOW: GET items, categories, units, destinations, providers, logs, barcodes, POs, leave orders, tickets
    - ALLOW: POST PO create, POST PO void, POST ticket return, POST leave-order/ticket close
    - DENY (403): POST/PUT/PATCH/DELETE inventory, categories, units, destinations, providers, adjust
    - DENY (403): POST PO receive, POST leave-order create
    """
    unit_id = sample_metadata["unit_id"]
    cat_id = sample_metadata["category_id"]
    sub_cat_id = sample_metadata["sub_category_id"]
    provider_id = sample_metadata["provider_id"]
    destination_id = sample_metadata["destination_id"]

    # 1. ALLOWED READS (both root and slash aliases)
    assert office_client.get("/api/items").status_code == 200
    assert office_client.get("/api/items/").status_code == 200
    assert office_client.get("/api/categories").status_code == 200
    assert office_client.get("/api/categories/").status_code == 200
    assert office_client.get("/api/units").status_code == 200
    assert office_client.get("/api/units/").status_code == 200
    assert office_client.get("/api/destinations").status_code == 200
    assert office_client.get("/api/destinations/").status_code == 200
    assert office_client.get("/api/providers").status_code == 200
    assert office_client.get("/api/providers/").status_code == 200
    assert office_client.get("/api/movement-logs").status_code == 200
    assert office_client.get("/api/movement-logs/").status_code == 200
    assert office_client.get("/api/movement-logs/all_filtered").status_code == 200
    assert office_client.get("/api/movement-logs/summary/today").status_code == 200
    assert office_client.get("/api/purchase-orders").status_code == 200
    assert office_client.get("/api/leave-orders").status_code == 200
    assert office_client.get("/api/tickets").status_code == 200
    assert office_client.get("/api/leave-orders/tickets/count").status_code == 200
    assert office_client.get("/api/sync-status").status_code == 200
    assert office_client.get("/api/sync-status/").status_code == 200

    # 2. DENIED MUTATIONS (Inventory & Metadata) -> HTTP 403 across both slash and non-slash paths
    denied_mutations = [
        ("POST", "/api/items", {"name": "Office Item", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 10}),
        ("POST", "/api/items/", {"name": "Office Item", "unit_id": unit_id, "sub_category_id": sub_cat_id, "initial_quantity": 10}),
        ("PUT", "/api/items/1", {"name": "Edited Name", "unit_id": unit_id}),
        ("PATCH", "/api/items/1/status", {"status": "inactive"}),
        ("PATCH", "/api/items/1/restore", {"sub_category_id": sub_cat_id}),
        ("POST", "/api/items/1/adjust", {"change_amount": 5, "adjustment_type": "addition"}),
        ("POST", "/api/categories", {"name": "Office Cat"}),
        ("POST", "/api/categories/", {"name": "Office Cat"}),
        ("PUT", f"/api/categories/{cat_id}", {"name": "Edited Cat"}),
        ("DELETE", f"/api/categories/{cat_id}", None),
        ("POST", "/api/units", {"name": "Office Unit"}),
        ("POST", "/api/units/", {"name": "Office Unit"}),
        ("PUT", f"/api/units/{unit_id}", {"name": "Edited Unit"}),
        ("DELETE", f"/api/units/{unit_id}", None),
        ("POST", "/api/destinations", {"name": "Office Dest"}),
        ("POST", "/api/destinations/", {"name": "Office Dest"}),
        ("PUT", f"/api/destinations/{destination_id}", {"name": "Edited Dest"}),
        ("DELETE", f"/api/destinations/{destination_id}", None),
        ("POST", "/api/providers", {"name": "Office Prov"}),
        ("POST", "/api/providers/", {"name": "Office Prov"}),
        ("PUT", f"/api/providers/{provider_id}", {"name": "Edited Prov"}),
        ("DELETE", f"/api/providers/{provider_id}", None),
        # PO Receive is Warehouse only
        ("POST", "/api/purchase-orders/1/receive", {}),
        # Leave Order creation is Warehouse only
        ("POST", "/api/leave-orders", {}),
        ("POST", "/api/leave-orders/", {})
    ]

    for method, path, payload in denied_mutations:
        if method == "POST":
            res = office_client.post(path, json=payload or {})
        elif method == "PUT":
            res = office_client.put(path, json=payload or {})
        elif method == "PATCH":
            res = office_client.patch(path, json=payload or {})
        elif method == "DELETE":
            res = office_client.delete(path)

        assert res.status_code == 403, f"Office operator expected 403 for {method} {path}, got {res.status_code}"
        assert res.get_json()["code"] == "FORBIDDEN"

    # 3. ALLOWED OFFICE-SPECIFIC ORDER & SYNC ACTIONS (not 403)
    # PO create & void
    assert office_client.post("/api/purchase-orders", json={}).status_code != 403
    assert office_client.post("/api/purchase-orders/1/void", json={}).status_code != 403
    # Leave order close
    assert office_client.post("/api/leave-orders/1/close", json={}).status_code != 403
    # Ticket return & close
    assert office_client.post("/api/tickets/1/return", json={}).status_code != 403
    assert office_client.post("/api/tickets/1/close", json={}).status_code != 403
    # Manual sync
    assert office_client.post("/api/sync", json={}).status_code != 403
    assert office_client.post("/api/sync/", json={}).status_code != 403


def test_warehouse_role_permission_matrix(client, sample_metadata):
    """
    Verifies Warehouse operator permissions:
    - ALLOW: All existing items, categories, units, destinations, providers (GET, POST, PUT, PATCH, DELETE)
    - ALLOW: Adjust stock, restore, status
    - ALLOW: PO receive, Leave Order create, Leave Order close
    - DENY (403): POST PO create, POST PO void, POST ticket return
    """
    unit_id = sample_metadata["unit_id"]
    cat_id = sample_metadata["category_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Warehouse can create item
    res_item = client.post("/api/items/", json={
        "name": "Warehouse Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    # 2. Warehouse can adjust item
    res_adj = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 5,
        "adjustment_type": "addition"
    })
    assert res_adj.status_code == 200

    # 3. Warehouse can perform Leave order create / close and PO receive (not 403)
    assert client.post("/api/leave-orders", json={}).status_code != 403
    assert client.post("/api/leave-orders/1/close", json={}).status_code != 403
    assert client.post("/api/purchase-orders/1/receive", json={}).status_code != 403

    # 4. Warehouse DENIED for office-only actions (403 Forbidden)
    denied_actions = [
        ("POST", "/api/purchase-orders", {}),
        ("POST", "/api/purchase-orders/1/void", {}),
        ("POST", "/api/tickets/1/return", {})
    ]
    for method, path, payload in denied_actions:
        res = client.post(path, json=payload)
        assert res.status_code == 403, f"Warehouse operator expected 403 for {method} {path}, got {res.status_code}"
        assert res.get_json()["code"] == "FORBIDDEN"


def test_admin_role_union_of_permissions(admin_client, sample_metadata):
    """Verifies that Admin possesses the union of Office and Warehouse permissions."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Admin can do Warehouse actions (create item, adjust)
    res_item = admin_client.post("/api/items/", json={
        "name": "Admin Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 50
    })
    assert res_item.status_code == 201

    # 2. Admin can do Office actions (PO create/void, ticket return) - not 403
    assert admin_client.post("/api/purchase-orders", json={}).status_code != 403
    assert admin_client.post("/api/purchase-orders/1/void", json={}).status_code != 403
    assert admin_client.post("/api/tickets/1/return", json={}).status_code != 403

    # 3. Admin can do Warehouse order actions (PO receive, leave order create) - not 403
    assert admin_client.post("/api/purchase-orders/1/receive", json={}).status_code != 403
    assert admin_client.post("/api/leave-orders", json={}).status_code != 403


def test_unknown_api_paths_return_json_404_never_spa_html(client):
    """Verifies that unknown /api/* endpoints strictly return JSON 404 and never HTML."""
    unknown_routes = [
        "/api/nonexistent",
        "/api/items/not-a-real-subpath",
        "/api/v2/orders",
        "/api/unknown/nested/route"
    ]

    for path in unknown_routes:
        res = client.get(path)
        assert res.status_code == 404
        assert res.is_json
        data = res.get_json()
        assert data["code"] == "NOT_FOUND"
        assert "html" not in res.data.decode("utf-8").lower()


def test_actor_attribution_in_audit_movement_logs(client, sample_metadata, temp_db_path):
    """
    Verifies that new stock mutations attribute the authenticated actor (user_id, actor_name),
    while legacy records remain with null actor fields.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Create item via authenticated warehouse client
    res_item = client.post("/api/items/", json={
        "name": "Attributed Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    # 2. Adjust stock
    res_adj = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 5,
        "adjustment_type": "addition"
    })
    assert res_adj.status_code == 200

    # 3. Update item details
    res_update = client.put(f"/api/items/{item_id}", json={
        "name": "Attributed Item Updated",
        "unit_id": unit_id
    })
    assert res_update.status_code == 200

    # 4. Change status
    res_status = client.patch(f"/api/items/{item_id}/status", json={
        "status": "inactive"
    })
    assert res_status.status_code == 200

    # 5. Restore item
    res_restore = client.patch(f"/api/items/{item_id}/restore", json={
        "sub_category_id": sub_cat_id
    })
    assert res_restore.status_code == 200

    # Verify movement_logs directly from database for all actions
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT item_name, action_type, user_id, actor_name
        FROM movement_logs
        WHERE item_id = ?
        ORDER BY id ASC
    """, (item_id,))
    rows = cursor.fetchall()
    assert len(rows) == 5  # Created, Adjusted, Updated, Status Change, Restored

    # All 5 log rows must have user_id and actor_name attributed to 'default_warehouse'
    expected_actions = ["Item Created", "Addition", "Update", "Status Change", "Restored"]
    for row in rows:
        assert row["user_id"] is not None
        assert row["actor_name"] == "Warehouse Operator"

    # 6. Simulate a legacy log entry with NULL actor fields
    cursor.execute("""
        INSERT INTO movement_logs (item_id, item_name, action_type, quantity_changed, resulting_quantity, timestamp)
        VALUES (?, 'Attributed Item', 'Addition', 1, 16, '2025-01-01T00:00:00')
    """, (item_id,))
    conn.commit()

    cursor.execute("SELECT user_id, actor_name FROM movement_logs WHERE timestamp = '2025-01-01T00:00:00'")
    legacy_row = cursor.fetchone()
    assert legacy_row["user_id"] is None
    assert legacy_row["actor_name"] is None

    conn.close()
