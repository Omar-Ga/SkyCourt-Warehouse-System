"""
Comprehensive tests for Purchase Orders (Issue #9):
- PO creation with provider snapshot, active items, positive quantities, decimal prices
- Authoritative PO numbering (PO-000001) avoiding item barcode collisions
- Server-side minor-unit money calculation and configured scale (EGP 2 decimals)
- 48-hour UTC authoritative expiration
- Idempotency reservation and replay
- Role-based access control (Office creates/voids, Warehouse denied mutation, both inspect)
- Bounded pagination and status/search filtering
- Effective expiry on read and transactional persistence on mutation
- Conditional void transitions and revision concurrency
- Zero stock side effects on creation, void, expiry, and reprint
- Barcode image endpoint and barcode lookup
- Protection against reserved PO- barcode prefixes on item master
"""
import sqlite3
import pytest
from datetime import datetime, timedelta, timezone

from app.models import item_model, purchase_order_model


def test_po_creation_success(office_client, sample_metadata, temp_db_path):
    """
    Verifies successful creation of a multi-line purchase order:
    - Status 201
    - Collision-free authoritative PO number PO-000001
    - Barcode equals PO number
    - Provider and line item snapshots preserved
    - Minor-unit money calculation and decimal string formatting
    - 48-hour UTC expiration
    - Zero inventory stock changes
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create two active items with known initial quantities
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(
        c, name="Industrial Cable 100m", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=50, provider_id=prov_id, cost=100.0, barcode="CABLE-100M"
    )
    item2_id = item_model.insert_item(
        c, name="Switch Box 4-Port", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=20, provider_id=prov_id, cost=45.5, barcode="SWITCH-4P"
    )
    conn.commit()

    po_payload = {
        "provider_id": prov_id,
        "notes": "Urgent restock for maintenance project",
        "items": [
            {
                "item_id": item1_id,
                "quantity": 10,
                "unit_price": "125.50",
                "line_description": "Standard coil"
            },
            {
                "item_id": item2_id,
                "quantity": 4,
                "unit_price": "50.00",
                "line_description": "Includes mounting brackets"
            }
        ]
    }
    headers = {"Idempotency-Key": "test-po-create-001"}

    res = office_client.post("/api/purchase-orders", json=po_payload, headers=headers)
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.data.decode('utf-8')}"
    order = res.get_json()

    # Verify PO header structure
    assert order["po_number"].startswith("PO-")
    assert order["po_number"] == f"PO-{order['id']:06d}"
    assert order["barcode"] == order["po_number"]
    assert order["provider_id"] == prov_id
    assert order["provider_name"] == "شركة الأهرام"
    assert order["status"] == "open"
    assert order["revision"] == 0
    assert order["currency"] == "EGP"
    assert order["currency_scale"] == 2
    # 10 * 125.50 = 1255.00; 4 * 50.00 = 200.00; Total = 1455.00
    assert order["total_amount"] == "1455.00"
    assert order["total_amount_minor"] == 145500
    assert order["line_count"] == 2
    assert order["total_ordered_quantity"] == 14
    assert order["notes"] == "Urgent restock for maintenance project"
    assert order["company"]["name"] == "شركة سكاي كورت للتجارة والتوزيع"
    assert "void" in order["allowed_actions"]
    assert "print" in order["allowed_actions"]

    # Verify 48-hour expiration calculation
    created_dt = datetime.strptime(order["created_at"], "%Y-%m-%d %H:%M:%S")
    expires_dt = datetime.strptime(order["expires_at"], "%Y-%m-%d %H:%M:%S")
    time_diff = expires_dt - created_dt
    assert abs(time_diff.total_seconds() - 48 * 3600) < 5

    # Verify line items snapshots
    assert len(order["items"]) == 2
    line1 = next(l for l in order["items"] if l["item_id"] == item1_id)
    assert line1["item_name"] == "Industrial Cable 100m"
    assert line1["unit_id"] == unit_id
    assert line1["unit_name"] == "قطعة"
    assert line1["ordered_quantity"] == 10
    assert line1["unit_price"] == "125.50"
    assert line1["unit_price_minor"] == 12550
    assert line1["line_total"] == "1255.00"
    assert line1["line_total_minor"] == 125500
    assert line1["disposition"] == "pending"

    # Verify ZERO stock changes in database
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()[0] == 50
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 20
    conn.close()


def test_po_creation_idempotency_and_replay(client, office_client, sample_metadata):
    """Verifies that repeating a PO creation request with the same Idempotency-Key returns saved body."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Testing Switch",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    payload = {
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "10.00"}]
    }
    headers = {"Idempotency-Key": "idemp-po-key-999"}

    res1 = office_client.post("/api/purchase-orders", json=payload, headers=headers)
    assert res1.status_code == 201
    body1 = res1.get_json()

    # Repeat request with identical payload
    res2 = office_client.post("/api/purchase-orders", json=payload, headers=headers)
    assert res2.status_code == 201
    body2 = res2.get_json()
    assert body1["id"] == body2["id"]
    assert body1["po_number"] == body2["po_number"]

    # Reusing same key with different payload triggers 409 conflict
    payload_conflict = {
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 99, "unit_price": "10.00"}]
    }
    res_conflict = office_client.post("/api/purchase-orders", json=payload_conflict, headers=headers)
    assert res_conflict.status_code == 409
    assert res_conflict.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_po_creation_validations(client, office_client, sample_metadata):
    """Verifies validation rules for PO creation (inactive items, prices, quantities, duplicates)."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Standard Screws",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 100
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    # 1. Missing Idempotency-Key
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 10, "unit_price": "1.50"}]
    })
    assert res.status_code == 400
    assert res.get_json()["code"] == "MISSING_IDEMPOTENCY_KEY"

    # Helper headers
    h = {"Idempotency-Key": "val-test-1"}

    # 2. Empty items
    res = office_client.post("/api/purchase-orders", json={"provider_id": prov_id, "items": []}, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "EMPTY_ITEMS"

    # 3. Duplicate items in lines
    h = {"Idempotency-Key": "val-test-2"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [
            {"item_id": item_id, "quantity": 5, "unit_price": "10.00"},
            {"item_id": item_id, "quantity": 2, "unit_price": "10.00"}
        ]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "DUPLICATE_LINE"


    # 4. Zero or negative quantity
    h = {"Idempotency-Key": "val-test-3"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 0, "unit_price": "10.00"}]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "OUT_OF_RANGE"

    # 5. Negative price
    h = {"Idempotency-Key": "val-test-4"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "-10.00"}]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "OUT_OF_RANGE"

    # 6. Non-finite price
    h = {"Idempotency-Key": "val-test-5"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "NaN"}]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "NON_FINITE_NUMBER"

    # 7. Excess price precision (more than 2 decimals)
    h = {"Idempotency-Key": "val-test-6"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "12.345"}]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "EXCESS_PRECISION"

    # 8. Non-existent provider
    h = {"Idempotency-Key": "val-test-7"}
    res = office_client.post("/api/purchase-orders", json={
        "provider_id": 99999,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "10.00"}]
    }, headers=h)
    assert res.status_code == 400
    assert res.get_json()["code"] == "INVALID_FOREIGN_KEY"


def test_po_role_enforcement(client, office_client, sample_metadata):
    """
    Verifies role-based access:
    - Warehouse client is forbidden from creating or voiding POs (403)
    - Both Warehouse and Office can inspect and list POs
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Access Control Wire",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    # 1. Warehouse cannot create PO
    wh_res = client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "20.00"}]
    }, headers={"Idempotency-Key": "wh-po-create"})
    assert wh_res.status_code == 403

    # 2. Office creates PO
    off_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 5, "unit_price": "20.00"}]
    }, headers={"Idempotency-Key": "off-po-create"})
    assert off_res.status_code == 201
    po_id = off_res.get_json()["id"]

    # 3. Warehouse cannot void PO
    wh_void = client.post(f"/api/purchase-orders/{po_id}/void", json={
        "expected_revision": 0,
        "reason": "Unauthorized void attempt"
    })
    assert wh_void.status_code == 403

    # 4. Both warehouse and office can view PO detail and list
    wh_get = client.get(f"/api/purchase-orders/{po_id}")
    assert wh_get.status_code == 200
    assert wh_get.get_json()["id"] == po_id

    off_get = office_client.get(f"/api/purchase-orders/{po_id}")
    assert off_get.status_code == 200
    assert off_get.get_json()["id"] == po_id


def test_po_void_success_and_revision_concurrency(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies voiding an open PO:
    - Status transitions to void
    - Void reason and actor recorded
    - Revision incremented
    - Attempting to void again or with wrong revision fails with 409
    - Zero inventory stock changes
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    item_id = item_model.insert_item(
        c, name="Voidable Item", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=35, provider_id=prov_id, cost=50.0, barcode="VOID-ITEM-1"
    )

    conn.commit()

    # Create PO
    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 10, "unit_price": "15.00"}]
    }, headers={"Idempotency-Key": "void-test-create"})
    assert po_res.status_code == 201
    po = po_res.get_json()
    po_id = po["id"]
    assert po["revision"] == 0

    # 1. Void with mismatching expected revision fails with 409
    bad_rev_res = office_client.post(f"/api/purchase-orders/{po_id}/void", json={
        "expected_revision": 5,
        "reason": "Mismatch revision test"
    })
    assert bad_rev_res.status_code == 409
    assert bad_rev_res.get_json()["code"] == "REVISION_CONFLICT"

    # 2. Void with correct revision succeeds
    void_res = office_client.post(f"/api/purchase-orders/{po_id}/void", json={
        "expected_revision": 0,
        "reason": "Supplier unable to fulfill"
    })
    assert void_res.status_code == 200
    voided = void_res.get_json()
    assert voided["status"] == "void"
    assert voided["revision"] == 1
    assert voided["void_reason"] == "Supplier unable to fulfill"
    assert voided["void_actor_name"] == "Office Operator"
    assert voided["voided_at"] is not None
    assert voided["allowed_actions"] == ["print"]

    # 3. Attempting to void an already voided PO fails with 409
    repeat_void = office_client.post(f"/api/purchase-orders/{po_id}/void", json={
        "expected_revision": 1,
        "reason": "Second void attempt"
    })
    assert repeat_void.status_code == 409
    assert repeat_void.get_json()["code"] == "INVALID_STATUS_TRANSITION"

    # 4. Verify item quantity unchanged
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()[0] == 35
    conn.close()


def test_po_effective_expiry_on_read_and_mutation(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies 48-hour expiration:
    - Open PO whose expires_at is past returns effective status 'expired' on GET
    - Filter status=expired finds it, status=open does not
    - Mutation (void) on expired PO persists system-void transition with 409 ORDER_EXPIRED
    - No stock changes
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    item_id = item_model.insert_item(
        c, name="Expiring Item", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=40, provider_id=prov_id, cost=25.0, barcode="EXP-ITEM-1"
    )

    conn.commit()

    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 10, "unit_price": "25.00"}]
    }, headers={"Idempotency-Key": "expiry-test-create"})
    assert po_res.status_code == 201
    po_id = po_res.get_json()["id"]

    # Manually backdate expires_at in database to simulate 48 hours elapsed
    past_expiry = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
    c.execute("UPDATE purchase_orders SET expires_at = ? WHERE id = ?", (past_expiry, po_id))
    conn.commit()

    # 1. GET detail: should reflect effective status 'expired'
    detail_res = office_client.get(f"/api/purchase-orders/{po_id}")
    assert detail_res.status_code == 200
    detail = detail_res.get_json()
    assert detail["status"] == "expired"
    assert detail["is_expired"] is True
    assert detail["db_status"] == "open"
    assert detail["allowed_actions"] == ["print"]

    # 2. List filtering: status=expired returns it, status=open excludes it
    list_expired = office_client.get("/api/purchase-orders?status=expired")
    assert list_expired.status_code == 200
    assert any(p["id"] == po_id for p in list_expired.get_json()["purchase_orders"])

    list_open = office_client.get("/api/purchase-orders?status=open")
    assert list_open.status_code == 200
    assert not any(p["id"] == po_id for p in list_open.get_json()["purchase_orders"])

    # 3. Mutation on expired PO: discovers expiry, persists system-void transition, returns 409
    void_attempt = office_client.post(f"/api/purchase-orders/{po_id}/void", json={
        "expected_revision": 0,
        "reason": "Office trying to cancel expired PO"
    })
    assert void_attempt.status_code == 409
    assert void_attempt.get_json()["code"] == "ORDER_EXPIRED"

    # 4. In database, PO has now been safely transitioned to system-void
    c.execute("SELECT status, void_reason, voided_by, revision FROM purchase_orders WHERE id = ?", (po_id,))
    row = c.fetchone()
    assert row["status"] == "void"
    assert row["void_reason"] == "System expiry (48 hours elapsed)"
    assert row["voided_by"] is None
    assert row["revision"] == 1

    # 5. Verify stock unchanged
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()[0] == 40
    conn.close()


def test_po_barcode_endpoints(client, office_client, sample_metadata):
    """
    Verifies barcode lookup and barcode base64 image generation endpoints:
    - GET /api/purchase-orders/<id>/barcode returns valid image
    - GET /api/purchase-orders/by-barcode/<barcode> returns PO detail
    - Unknown barcode returns 404
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Barcode Test Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 2, "unit_price": "10.00"}]
    }, headers={"Idempotency-Key": "barcode-test-po"})
    assert po_res.status_code == 201
    po = po_res.get_json()
    po_id = po["id"]
    po_barcode = po["barcode"]

    # 1. Barcode image endpoint
    bc_res = office_client.get(f"/api/purchase-orders/{po_id}/barcode")
    assert bc_res.status_code == 200
    bc_data = bc_res.get_json()
    assert bc_data["barcodeValue"] == po_barcode
    assert bc_data["imageFormat"] == "png"
    assert len(bc_data["imageData"]) > 100

    # 2. Barcode lookup endpoint
    lookup_res = office_client.get(f"/api/purchase-orders/by-barcode/{po_barcode}")
    assert lookup_res.status_code == 200
    assert lookup_res.get_json()["id"] == po_id

    # 3. Unknown barcode lookup returns 404
    unknown_res = office_client.get("/api/purchase-orders/by-barcode/NON_EXISTENT_PO")
    assert unknown_res.status_code == 404
    assert unknown_res.get_json()["code"] == "NOT_FOUND"


def test_reserved_po_barcode_prefix_on_items(client, sample_metadata):
    """Verifies that items cannot be created or updated with barcodes starting with reserved 'PO-'."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create item with PO- barcode rejected
    res = client.post("/api/items/", json={
        "name": "Conflicting Barcode Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5,
        "barcode": "PO-999999"
    })
    assert res.status_code in (400, 409)
    err = res.get_json()["error"]
    assert "reserved 'PO-'" in err

    # Create valid item, then try updating to PO- barcode
    res_valid = client.post("/api/items/", json={
        "name": "Safe Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5,
        "barcode": "SAFE-ITEM-01"
    })
    assert res_valid.status_code == 201
    item_id = res_valid.get_json()["id"]

    upd_res = client.put(f"/api/items/{item_id}", json={
        "name": "Safe Item",
        "unit_id": unit_id,
        "barcode": "PO-000042"
    })
    assert upd_res.status_code in (400, 409)
    assert "reserved 'PO-'" in upd_res.get_json()["error"]



def test_provider_and_unit_deletion_protection_with_po(client, office_client, sample_metadata):
    """Verifies that providers and units referenced by a PO cannot be deleted."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "Protected Rel Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10
    })
    assert res_item.status_code == 201
    item_id = res_item.get_json()["id"]

    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 2, "unit_price": "10.00"}]
    }, headers={"Idempotency-Key": "protect-test-po"})
    assert po_res.status_code == 201

    # Attempt to delete provider
    del_prov = client.delete(f"/api/providers/{prov_id}")
    assert del_prov.status_code in (400, 409)

    # Attempt to delete unit
    del_unit = client.delete(f"/api/units/{unit_id}")
    assert del_unit.status_code in (400, 409)


def test_po_creation_inactive_and_archived_items(client, office_client, sample_metadata, temp_db_path):
    """Verifies that inactive and archived items cannot be added to a purchase order."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    inactive_item_id = item_model.insert_item(
        c, name="Inactive Product", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=10, provider_id=prov_id, cost=20.0, barcode="INACT-001"
    )
    c.execute("UPDATE items SET status = 'inactive' WHERE id = ?", (inactive_item_id,))

    archived_item_id = item_model.insert_item(
        c, name="Archived Product", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=5, provider_id=prov_id, cost=30.0, barcode="ARCH-001"
    )
    c.execute("UPDATE items SET status = 'archived' WHERE id = ?", (archived_item_id,))
    conn.commit()
    conn.close()

    # 1. PO with inactive item is rejected
    res_inact = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": inactive_item_id, "quantity": 5, "unit_price": "20.00"}]
    }, headers={"Idempotency-Key": "po-inact-test"})
    assert res_inact.status_code == 400
    assert res_inact.get_json()["code"] == "ITEM_NOT_ACTIVE"

    # 2. PO with archived item is rejected
    res_arch = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": archived_item_id, "quantity": 5, "unit_price": "30.00"}]
    }, headers={"Idempotency-Key": "po-arch-test"})
    assert res_arch.status_code == 400
    assert res_arch.get_json()["code"] == "ITEM_NOT_ACTIVE"

    # 3. PO with non-existent item is rejected
    res_not_found = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": 99999, "quantity": 5, "unit_price": "10.00"}]
    }, headers={"Idempotency-Key": "po-notfound-test"})
    assert res_not_found.status_code == 400
    assert res_not_found.get_json()["code"] == "ITEM_NOT_FOUND"


def test_po_void_idempotency_replay_and_expiry_cleanup(office_client, sample_metadata, temp_db_path):
    """
    Verifies:
    - Retrying a void request with the same Idempotency-Key safely replays the completed result
    - When a void request discovers expiry, the operation table does not trap the key in 'in_progress'
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    item_id = item_model.insert_item(
        c, name="Void Idemp Item", unit_id=unit_id, sub_category_id=sub_cat_id,
        quantity=15, provider_id=prov_id, cost=10.0, barcode="VOID-IDEMP-1"
    )
    conn.commit()

    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 3, "unit_price": "10.00"}]
    }, headers={"Idempotency-Key": "void-replay-create"})
    assert po_res.status_code == 201
    po_id = po_res.get_json()["id"]

    # Void with idempotency key
    void_headers = {"Idempotency-Key": "void-op-key-101"}
    void_payload = {"expected_revision": 0, "reason": "Testing void replay"}
    res1 = office_client.post(f"/api/purchase-orders/{po_id}/void", json=void_payload, headers=void_headers)
    assert res1.status_code == 200
    body1 = res1.get_json()
    assert body1["status"] == "void"
    assert body1["revision"] == 1

    # Retry with identical key and payload: safely replayed
    res2 = office_client.post(f"/api/purchase-orders/{po_id}/void", json=void_payload, headers=void_headers)
    assert res2.status_code == 200
    body2 = res2.get_json()
    assert body1["id"] == body2["id"]
    assert body1["revision"] == body2["revision"]
    assert body1["status"] == body2["status"]

    # Test discovered expiry does not leave stuck in_progress
    po_res_exp = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": item_id, "quantity": 2, "unit_price": "10.00"}]
    }, headers={"Idempotency-Key": "exp-test-create-2"})
    assert po_res_exp.status_code == 201
    po_exp_id = po_res_exp.get_json()["id"]

    past_expiry = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    c.execute("UPDATE purchase_orders SET expires_at = ? WHERE id = ?", (past_expiry, po_exp_id))
    conn.commit()

    exp_key = "exp-void-op-key-202"
    exp_void = office_client.post(f"/api/purchase-orders/{po_exp_id}/void", json={
        "expected_revision": 0,
        "reason": "Voiding expired"
    }, headers={"Idempotency-Key": exp_key})
    assert exp_void.status_code == 409
    assert exp_void.get_json()["code"] == "ORDER_EXPIRED"

    # Confirm operation record was not left in 'in_progress'
    c.execute("SELECT status FROM operations WHERE operation_key = ?", (exp_key,))
    op_row = c.fetchone()
    assert op_row is None or op_row["status"] != "in_progress"
    conn.close()


def test_po_status_filter_edge_cases(office_client, sample_metadata):
    """Verifies filtering by case-insensitive status and rejection of invalid status strings."""
    # Invalid status returns empty list
    res = office_client.get("/api/purchase-orders?status=invalid_status_xyz")
    assert res.status_code == 200
    assert res.get_json()["total_count"] == 0
    assert len(res.get_json()["purchase_orders"]) == 0

    # Case-insensitive status works
    res_open = office_client.get("/api/purchase-orders?status=OPEN")
    assert res_open.status_code == 200

    res_all = office_client.get("/api/purchase-orders?status=ALL")
    assert res_all.status_code == 200


def test_po_number_collision_fallback(office_client, sample_metadata, temp_db_path):
    """
    Verifies that if a candidate PO number PO-00000X collides with an existing item barcode,
    the allocation system falls back to a non-colliding PO-ORD-00000X format.
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Pre-create an item whose barcode matches the next expected PO number
    c.execute("SELECT seq FROM sqlite_sequence WHERE name = 'purchase_orders'")
    seq_row = c.fetchone()
    next_id = (seq_row[0] + 1) if seq_row else 1
    colliding_barcode = f"PO-{next_id:06d}"

    # Insert item directly into DB with the colliding barcode (simulating legacy data)
    c.execute(
        """
        INSERT INTO items (name, unit_id, sub_category_id, current_quantity, cost, status, barcode)
        VALUES ('Legacy Item', ?, ?, 10, 50.0, 'active', ?)
        """,
        (unit_id, sub_cat_id, colliding_barcode)
    )
    conn.commit()
    conn.close()

    # Create PO: it must detect the collision and use PO-ORD- prefix
    po_res = office_client.post("/api/purchase-orders", json={
        "provider_id": prov_id,
        "items": [{"item_id": 1, "quantity": 1, "unit_price": "25.00"}]
    }, headers={"Idempotency-Key": "collision-fallback-test"})
    assert po_res.status_code == 201
    po = po_res.get_json()
    assert po["po_number"].startswith("PO-ORD-")
    assert po["barcode"] == po["po_number"]


# ============================================================================
# Issue #10: PO Receipt Tests
# ============================================================================

def _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-create-test"):
    po_payload = {
        "provider_id": prov_id,
        "notes": "Testing PO Receipt",
        "items": [
            {"item_id": item1_id, "quantity": 10, "unit_price": "25.50", "line_description": "Item 1 desc"},
            {"item_id": item2_id, "quantity": 5, "unit_price": "10.00", "line_description": "Item 2 desc"}
        ]
    }
    res = office_client.post("/api/purchase-orders", json=po_payload, headers={"Idempotency-Key": key})
    assert res.status_code == 201
    return res.get_json()


def test_po_full_receipt_success(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies full receipt of an open PO:
    - Status 200, PO status -> 'closed', revision increments (0 -> 1)
    - Lines updated with received_quantity and disposition='received'
    - Item balances incremented atomically
    - Addition movement logs created with provider, cost_per_item, actor_name, and po_line_id
    - Affected balances returned
    - receiver_name and closed_at recorded
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Alpha", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=20, provider_id=prov_id, cost=20.0, barcode="ALPHA-1")
    item2_id = item_model.insert_item(c, name="Item Beta", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=15, provider_id=prov_id, cost=10.0, barcode="BETA-1")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    receipt_payload = {
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }
    headers = {"Idempotency-Key": "po-receive-key-001"}

    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers=headers)
    assert res.status_code == 200, f"Error: {res.data.decode('utf-8')}"
    data = res.get_json()

    assert data["status"] == "closed"
    assert data["revision"] == 1
    assert data["total_received_quantity"] == 15
    assert data["receiver_name"] == "Warehouse Operator"
    assert data["closed_at"] is not None
    assert "affected_balances" in data
    assert len(data["affected_balances"]) == 2

    # Check stock balances in database
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()[0] == 30  # 20 + 10
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 20  # 15 + 5

    # Check movement logs
    c.execute("SELECT * FROM movement_logs WHERE po_line_id = ? ORDER BY id DESC", (line1["id"],))
    log1 = c.fetchone()
    assert log1 is not None
    assert log1["action_type"] == "Addition"
    assert log1["quantity_changed"] == 10
    assert log1["resulting_quantity"] == 30
    assert log1["provider_id"] == prov_id
    assert abs(log1["cost_per_item"] - 25.50) < 0.001
    assert log1["actor_name"] == "Warehouse Operator"
    assert log1["unit_name"] == "قطعة"

    c.execute("SELECT * FROM movement_logs WHERE po_line_id = ? ORDER BY id DESC", (line2["id"],))
    log2 = c.fetchone()
    assert log2 is not None
    assert log2["action_type"] == "Addition"
    assert log2["quantity_changed"] == 5
    assert log2["resulting_quantity"] == 20

    conn.close()


def test_po_short_receipt_and_struck_off(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies short receipt where one line is partially received and another is struck off:
    - Struck off line has received_quantity = 0 and creates NO stock increase and NO log entry
    - Partial received line increments stock by received_quantity
    - PO closes as final receipt (unfulfilled quantities are not a backorder)
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Gamma", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=50, provider_id=prov_id, cost=5.0, barcode="GAMMA-1")
    item2_id = item_model.insert_item(c, name="Item Delta", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=8.0, barcode="DELTA-1")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-002")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    receipt_payload = {
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 6, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 0, "disposition": "struck_off"}
        ]
    }
    headers = {"Idempotency-Key": "po-receive-key-002"}

    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers=headers)
    assert res.status_code == 200
    data = res.get_json()

    assert data["status"] == "closed"
    assert data["total_received_quantity"] == 6
    assert len(data["affected_balances"]) == 1
    assert data["affected_balances"][0]["item_id"] == item1_id
    assert data["affected_balances"][0]["resulting_quantity"] == 56

    # Verify item1 incremented, item2 untouched
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()[0] == 56
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 10

    # Verify no movement log for struck-off line
    c.execute("SELECT * FROM movement_logs WHERE po_line_id = ?", (line2["id"],))
    assert c.fetchone() is None

    # Verify line outcomes in items
    res_detail = client.get(f"/api/purchase-orders/{po['id']}")
    detail = res_detail.get_json()
    dl1 = next(l for l in detail["items"] if l["id"] == line1["id"])
    dl2 = next(l for l in detail["items"] if l["id"] == line2["id"])
    assert dl1["received_quantity"] == 6
    assert dl1["disposition"] == "received"
    assert dl2["received_quantity"] == 0
    assert dl2["disposition"] == "struck_off"

    conn.close()


def test_po_receipt_idempotency_and_replay(client, office_client, sample_metadata, temp_db_path):
    """Verifies that replaying a receipt request with the same idempotency key returns saved response without duplicating stock."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Epsilon", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="EPSILON-1")
    item2_id = item_model.insert_item(c, name="Item Zeta", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="ZETA-1")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-003")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    receipt_payload = {
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 4, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 2, "disposition": "received"}
        ]
    }
    headers = {"Idempotency-Key": "po-receive-idemp-key-777"}

    # First attempt
    res1 = client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers=headers)
    assert res1.status_code == 200
    body1 = res1.get_json()

    # Second attempt (replay)
    res2 = client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers=headers)
    assert res2.status_code == 200
    body2 = res2.get_json()
    assert body1["id"] == body2["id"]
    assert body1["revision"] == body2["revision"]

    # Check stock was only incremented ONCE
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()[0] == 14  # 10 + 4
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 12  # 10 + 2

    # Check logs were only created ONCE
    c.execute("SELECT COUNT(*) FROM movement_logs WHERE po_line_id = ?", (line1["id"],))
    assert c.fetchone()[0] == 1

    # Conflicting replay: same key, different payload -> 409
    diff_payload = {
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 1, "disposition": "received"}
        ]
    }
    res_conflict = client.post(f"/api/purchase-orders/{po['id']}/receive", json=diff_payload, headers=headers)
    assert res_conflict.status_code == 409

    conn.close()


def test_po_receipt_validation_rejections(client, office_client, sample_metadata, temp_db_path):
    """
    Verifies all validation rejection rules:
    - Missing Idempotency-Key -> 400
    - Missing lines -> 400
    - All struck off (empty receipt) -> 400
    - Over-receipt (received_quantity > ordered_quantity) -> 400
    - Struck off with non-zero quantity -> 400
    - Duplicate line in request -> 400
    """
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Val1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="VAL-1")
    item2_id = item_model.insert_item(c, name="Item Val2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="VAL-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-val-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    # 1. Missing Idempotency-Key
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    })
    assert res.status_code == 400
    assert "MISSING_IDEMPOTENCY_KEY" in res.data.decode("utf-8")

    # 2. Omitted line
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-2"})
    assert res.status_code == 400
    assert "LINE_MISMATCH" in res.data.decode("utf-8")

    # 3. All struck-off (empty receipt)
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 0, "disposition": "struck_off"},
            {"line_id": line2["id"], "received_quantity": 0, "disposition": "struck_off"}
        ]
    }, headers={"Idempotency-Key": "key-val-3"})
    assert res.status_code == 400
    assert "NO_POSITIVE_RECEIPT" in res.data.decode("utf-8")

    # 4. Over-receipt (ordered 10, received 11)
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 11, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-4"})
    assert res.status_code == 400
    assert "OVER_RECEIPT" in res.data.decode("utf-8")

    # 5. Struck-off with non-zero quantity
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 2, "disposition": "struck_off"}
        ]
    }, headers={"Idempotency-Key": "key-val-5"})
    assert res.status_code == 400

    # 6. Duplicate line_id
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received"},
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-6"})
    assert res.status_code == 400

    # 7. Unknown root field rejected
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ],
        "unexpected_field": "disallowed"
    }, headers={"Idempotency-Key": "key-val-7"})
    assert res.status_code == 400
    assert "UNKNOWN_FIELD" in res.data.decode("utf-8")

    # 8. Unknown line field rejected
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received", "rogue": 123},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-8"})
    assert res.status_code == 400
    assert "UNKNOWN_FIELD" in res.data.decode("utf-8")

    # 9. Missing expected_revision rejected
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-9"})
    assert res.status_code == 400
    assert "MISSING_REQUIRED_FIELD" in res.data.decode("utf-8")

    # 10. Negative received_quantity rejected
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": -5, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-10"})
    assert res.status_code == 400

    # 11. Invalid disposition string rejected
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 5, "disposition": "rejected_custom"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-val-11"})
    assert res.status_code == 400
    assert "INVALID_DISPOSITION" in res.data.decode("utf-8")

    conn.close()


def test_po_receipt_revision_conflict_and_terminal_rejection(client, office_client, sample_metadata, temp_db_path):
    """Verifies that revision mismatch or attempting to receive an already closed PO returns 409 conflict."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Conf1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="CONF-1")
    item2_id = item_model.insert_item(c, name="Item Conf2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="CONF-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-conf-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    # Revision conflict: expected 1 when actual is 0
    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 1,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-rev-1"})
    assert res.status_code == 409
    assert "REVISION_CONFLICT" in res.data.decode("utf-8")

    # Successful receipt closes the order
    res_ok = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-rev-ok"})
    assert res_ok.status_code == 200

    # Now attempt a new receipt on closed order with new key -> 409
    res_closed = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 1,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-rev-after-close"})
    assert res_closed.status_code == 409
    assert "INVALID_STATUS_TRANSITION" in res_closed.data.decode("utf-8")

    conn.close()


def test_po_receipt_expiry_boundary(client, office_client, sample_metadata, temp_db_path):
    """Verifies that receipt at or after expires_at is rejected with 409 and persists system expiry."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Exp1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="EXP-1")
    item2_id = item_model.insert_item(c, name="Item Exp2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="EXP-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-exp-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    # Manually backdate expires_at to 1 hour in the past
    past_utc = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    c.execute("UPDATE purchase_orders SET expires_at = ? WHERE id = ?", (past_utc, po["id"]))
    conn.commit()

    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-exp-1"})
    assert res.status_code == 409
    assert "ORDER_EXPIRED" in res.data.decode("utf-8")

    # Verify zero stock changes
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert c.fetchone()[0] == 10

    # Verify order was transitioned to void with system expiry reason
    c.execute("SELECT status, void_reason FROM purchase_orders WHERE id = ?", (po["id"],))
    row = c.fetchone()
    assert row["status"] == "void"
    assert "System expiry" in row["void_reason"]

    conn.close()


def test_po_receipt_inactive_item_rejection(client, office_client, sample_metadata, temp_db_path):
    """Verifies that if an item was inactivated/archived after PO creation, receipt is rejected and stock remains unchanged."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Inact1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="INACT-1")
    item2_id = item_model.insert_item(c, name="Item Inact2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="INACT-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-inact-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    # Inactivate item1
    c.execute("UPDATE items SET status = 'inactive' WHERE id = ?", (item1_id,))
    conn.commit()

    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-inact-1"})
    assert res.status_code == 400
    assert "ITEM_NOT_ACTIVE" in res.data.decode("utf-8")

    # Check zero stock changes and PO remains open
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 10
    c.execute("SELECT status FROM purchase_orders WHERE id = ?", (po["id"],))
    assert c.fetchone()[0] == "open"

    conn.close()


def test_po_receipt_unit_mismatch_rejection(client, office_client, sample_metadata, temp_db_path):
    """Verifies that if an item's unit was modified away from the snapshot unit, receipt is rejected with actionable message."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Create a second unit
    c.execute("INSERT INTO units (name) VALUES ('متر')")
    unit2_id = c.lastrowid

    item1_id = item_model.insert_item(c, name="Item Unit1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="UNIT-1")
    item2_id = item_model.insert_item(c, name="Item Unit2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="UNIT-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-unit-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    # Force unit mismatch on item1 in database
    c.execute("UPDATE items SET unit_id = ? WHERE id = ?", (unit2_id, item1_id))
    conn.commit()

    res = client.post(f"/api/purchase-orders/{po['id']}/receive", json={
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }, headers={"Idempotency-Key": "key-unit-1"})
    assert res.status_code == 400
    assert "UNIT_MISMATCH" in res.data.decode("utf-8")

    # Verify no stock was added to item2 either (atomicity)
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item2_id,))
    assert c.fetchone()[0] == 10
    c.execute("SELECT status FROM purchase_orders WHERE id = ?", (po["id"],))
    assert c.fetchone()[0] == "open"

    conn.close()


def test_po_receipt_permissions(client, office_client, admin_client, sample_metadata, temp_db_path):
    """Verifies that Office is forbidden (403) from receiving a PO, while Warehouse and Admin are authorized."""
    unit_id = sample_metadata["unit_id"]
    prov_id = sample_metadata["provider_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    item1_id = item_model.insert_item(c, name="Item Perm1", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="PERM-1")
    item2_id = item_model.insert_item(c, name="Item Perm2", unit_id=unit_id, sub_category_id=sub_cat_id,
                                      quantity=10, provider_id=prov_id, cost=10.0, barcode="PERM-2")
    conn.commit()

    po = _create_receipt_sample_po(office_client, prov_id, item1_id, item2_id, key="po-receipt-perm-001")
    line1 = next(l for l in po["items"] if l["item_id"] == item1_id)
    line2 = next(l for l in po["items"] if l["item_id"] == item2_id)

    receipt_payload = {
        "expected_revision": 0,
        "items": [
            {"line_id": line1["id"], "received_quantity": 10, "disposition": "received"},
            {"line_id": line2["id"], "received_quantity": 5, "disposition": "received"}
        ]
    }

    # Office attempt -> 403 Forbidden
    res_office = office_client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers={"Idempotency-Key": "key-perm-off"})
    assert res_office.status_code == 403

    # Admin attempt -> 200 OK
    res_admin = admin_client.post(f"/api/purchase-orders/{po['id']}/receive", json=receipt_payload, headers={"Idempotency-Key": "key-perm-adm"})
    assert res_admin.status_code == 200

    conn.close()


