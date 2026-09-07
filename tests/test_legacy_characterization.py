"""
Legacy inventory characterization tests covering:
- Item add/search/detail and both pagination styles
- Duplicate/restore 409 conflict workflows
- Barcode lookup, PNG, and base64 generation
- Unit-change confirmation and unresolved order guards
- Category hierarchy, 25-main-category limit, and archive-on-delete
- Metadata deletion guards (units, providers, destinations)
- Manual adjustments and movement log filters
"""
import io
import json
import pytest
from app.models import category_model, unit_model, provider_model, destination_model, item_model


def test_item_creation_search_and_detail(client, sample_metadata):
    """Tests item creation, active-only search, and detail retrieval."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Create item
    res = client.post("/api/items/", json={
        "name": "مفتاح ربط 10 ملم",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 25,
        "cost": 15.5,
        "barcode": "WRENCH-10"
    })
    assert res.status_code == 201
    created = res.get_json()
    item_id = created["id"]
    assert created["name"] == "مفتاح ربط 10 ملم"
    assert created["current_quantity"] == 25
    assert created["status"] == "active"

    # 2. Search item by name
    res_search = client.get("/api/items/?search=مفتاح")
    assert res_search.status_code == 200
    search_data = res_search.get_json()
    assert search_data["total_count"] == 1
    assert search_data["items"][0]["id"] == item_id

    # 3. Retrieve by ID
    res_get = client.get(f"/api/items/{item_id}")
    assert res_get.status_code == 200
    assert res_get.get_json()["name"] == "مفتاح ربط 10 ملم"

    # 4. Retrieve by barcode
    res_bc = client.get("/api/items/by-barcode/WRENCH-10")
    assert res_bc.status_code == 200
    assert res_bc.get_json()["id"] == item_id


def test_both_pagination_styles(client, sample_metadata):
    """Tests standard table pagination and react-select offset/limit pagination."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Seed 15 items
    for i in range(1, 16):
        client.post("/api/items/", json={
            "name": f"Item Page Test {i:02d}",
            "unit_id": unit_id,
            "sub_category_id": sub_cat_id,
            "initial_quantity": i,
            "barcode": f"BC-PAGE-{i:02d}"
        })

    # Standard pagination: page=1, page_size=10
    res1 = client.get("/api/items/?page=1&page_size=10")
    assert res1.status_code == 200
    data1 = res1.get_json()
    assert len(data1["items"]) == 10
    assert data1["total_count"] == 15

    # Standard pagination: page=2, page_size=10
    res2 = client.get("/api/items/?page=2&page_size=10")
    assert res2.status_code == 200
    data2 = res2.get_json()
    assert len(data2["items"]) == 5

    # Ranged pagination (react-select): offset=10, limit=5
    res_ranged = client.get("/api/items/?offset=10&limit=5")
    assert res_ranged.status_code == 200
    ranged_data = res_ranged.get_json()
    assert len(ranged_data["items"]) == 5
    assert ranged_data["total_count"] == 15

    # Invalid pagination rejection
    res_bad = client.get("/api/items/?page=0&page_size=-1")
    assert res_bad.status_code == 400
    assert res_bad.get_json()["code"] == "INVALID_PAGINATION"


def test_duplicate_name_and_restore_conflict_workflow(client, sample_metadata):
    """
    Tests:
    1. Adding an active item with an existing name raises 409 conflict.
    2. Deactivating an item, then attempting to add it again raises 409 with type: item_conflict and item_id.
    3. Restoring the inactive item via /restore endpoint reactivates it into a category.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create active item
    res1 = client.post("/api/items/", json={
        "name": "كابل شاحن",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10
    })
    assert res1.status_code == 201
    item_id = res1.get_json()["id"]

    # 1. Duplicate active item -> 409 IntegrityError
    res_dup = client.post("/api/items/", json={
        "name": "كابل شاحن",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5
    })
    assert res_dup.status_code == 409

    # 2. Deactivate item
    res_deact = client.patch(f"/api/items/{item_id}/status", json={"status": "inactive"})
    assert res_deact.status_code == 200
    assert res_deact.get_json()["status"] == "inactive"

    # Attempt to re-create inactive item -> 409 item_conflict with item_id
    res_recreate = client.post("/api/items/", json={
        "name": "كابل شاحن",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5
    })
    assert res_recreate.status_code == 409
    body = res_recreate.get_json()
    assert body.get("type") == "item_conflict"
    assert body.get("item_id") == item_id

    # 3. Restore item
    res_restore = client.patch(f"/api/items/{item_id}/restore", json={"sub_category_id": sub_cat_id})
    assert res_restore.status_code == 200
    restored = res_restore.get_json()
    assert restored["status"] == "active"
    assert restored["sub_category_id"] == sub_cat_id


def test_unit_change_confirmation_flow(client, sample_metadata):
    """
    Tests:
    1. Changing unit without logs succeeds immediately.
    2. Changing unit on item with logs requires confirmation (409 UNIT_CHANGE_CONFIRMATION).
    3. Retrying with force_unit_change=True succeeds.
    """
    unit1_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create Unit 2
    res_u2 = client.post("/api/units/", json={"name": "علبة"})
    assert res_u2.status_code == 201
    unit2_id = res_u2.get_json()["id"]

    # Create item
    res_item = client.post("/api/items/", json={
        "name": "براغي تثبيت",
        "unit_id": unit1_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 100
    })
    item_id = res_item.get_json()["id"]

    # Item has a 'Creation' log entry. Changing unit should trigger confirmation
    res_change_unit = client.put(f"/api/items/{item_id}", json={
        "name": "براغي تثبيت",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id
    })
    assert res_change_unit.status_code == 409
    assert res_change_unit.get_json().get("type") == "UNIT_CHANGE_CONFIRMATION"

    # Retry with force_unit_change=True
    res_force = client.put(f"/api/items/{item_id}", json={
        "name": "براغي تثبيت",
        "unit_id": unit2_id,
        "sub_category_id": sub_cat_id,
        "force_unit_change": True
    })
    assert res_force.status_code == 200
    assert res_force.get_json()["unit_id"] == unit2_id


def test_barcode_png_and_base64_routes(client, sample_metadata):
    """Tests barcode image generation endpoints."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "شريط قياس",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10,
        "barcode": "TAPE-1234"
    })
    item_id = res_item.get_json()["id"]

    # 1. Barcode PNG endpoint
    res_png = client.get(f"/api/items/{item_id}/barcode")
    assert res_png.status_code == 200
    assert res_png.content_type == "image/png"
    assert len(res_png.data) > 0

    # 2. Barcode Base64 endpoint
    res_b64 = client.get("/api/items/generate-barcode/TAPE-1234")
    assert res_b64.status_code == 200
    b64_json = res_b64.get_json()
    assert b64_json["barcodeValue"] == "TAPE-1234"
    assert b64_json["imageFormat"] == "png"
    assert len(b64_json["imageData"]) > 0


def test_category_hierarchy_and_archive_on_delete(client, sample_metadata):
    """
    Tests:
    1. 25-main-category limit is enforced.
    2. Cannot delete category with active items or sub-categories.
    3. Deleting category archives inactive items.
    """
    cat_id = sample_metadata["category_id"]
    sub_cat_id = sample_metadata["sub_category_id"]
    unit_id = sample_metadata["unit_id"]

    # Add active item to sub_cat_id
    res_item = client.post("/api/items/", json={
        "name": "هاتف ذكي",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5
    })
    item_id = res_item.get_json()["id"]

    # Deleting sub_category should fail because it has an active item
    res_del_sub = client.delete(f"/api/categories/{sub_cat_id}")
    assert res_del_sub.status_code == 409

    # Deactivate the item
    client.patch(f"/api/items/{item_id}/status", json={"status": "inactive"})

    # Now deleting sub_category should succeed and archive the inactive item
    res_del_sub_ok = client.delete(f"/api/categories/{sub_cat_id}")
    assert res_del_sub_ok.status_code == 200

    # Verify item status changed to 'archived'
    res_archived = client.get(f"/api/items/{item_id}")
    assert res_archived.get_json()["status"] == "archived"


def test_metadata_deletion_guards(client, sample_metadata):
    """Tests that units, providers, and destinations in use cannot be deleted."""
    unit_id = sample_metadata["unit_id"]
    provider_id = sample_metadata["provider_id"]
    destination_id = sample_metadata["destination_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # Create item referencing unit and provider
    res_create = client.post("/api/items/", json={
        "name": "محول كهرباء",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "provider_id": provider_id,
        "initial_quantity": 10
    })
    item_id = res_create.get_json()["id"]

    # Unit in use cannot be deleted
    res_del_unit = client.delete(f"/api/units/{unit_id}")
    assert res_del_unit.status_code == 409

    # Provider in use cannot be deleted
    res_del_prov = client.delete(f"/api/providers/{provider_id}")
    assert res_del_prov.status_code == 409

    # Adjust stock with destination to create log referencing destination
    client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 2,
        "adjustment_type": "removal",
        "destination_id": destination_id
    })

    # Destination in use cannot be deleted
    res_del_dest = client.delete(f"/api/destinations/{destination_id}")
    assert res_del_dest.status_code == 409


def test_movement_log_filtering_and_daily_summary(client, sample_metadata):
    """Tests movement logs filtering and daily movement summary counts."""
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    res_item = client.post("/api/items/", json={
        "name": "حبل نايلون",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 50
    })
    item_id = res_item.get_json()["id"]

    # 1. Manual addition
    client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 10,
        "adjustment_type": "addition",
        "person_name": "Ali"
    })

    # 2. Manual removal
    client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 5,
        "adjustment_type": "removal",
        "person_name": "Omar"
    })

    # Filter logs by action_type='Addition'
    res_logs_add = client.get(f"/api/movement-logs/?action_type=Addition&item_id={item_id}")
    assert res_logs_add.status_code == 200
    logs_data = res_logs_add.get_json()
    assert all(log["action_type"] == "Addition" for log in logs_data["logs"])
    assert len(logs_data["logs"]) >= 1

    # Daily summary check
    res_sum = client.get("/api/movement-logs/summary/today")
    assert res_sum.status_code == 200
    sum_data = res_sum.get_json()
    assert "additions_today" in sum_data
    assert "withdrawals_today" in sum_data
    assert "returns_today" in sum_data
    assert sum_data["additions_today"] >= 1
    assert sum_data["withdrawals_today"] >= 1


def test_item_routes_unknown_fields_and_conflict_status_codes(client, sample_metadata):
    """
    Verifies that:
    1. Items routes reject unknown payload fields with 400 UNKNOWN_FIELD.
    2. Adjusting stock beyond available balance returns 409 STOCK_CONFLICT.
    3. Adjusting non-existent item returns 404 NOT_FOUND.
    4. Non-integer pagination returns 400 INVALID_PAGINATION.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    # 1. Unknown field in create item -> 400
    res_bad_create = client.post("/api/items/", json={
        "name": "Invalid Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 10,
        "hacked_field": "exploit"
    })
    assert res_bad_create.status_code == 400
    assert res_bad_create.get_json()["code"] == "UNKNOWN_FIELD"

    # Create valid item with initial_quantity 5
    res_ok = client.post("/api/items/", json={
        "name": "Strict Item",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 5
    })
    assert res_ok.status_code == 201
    item_id = res_ok.get_json()["id"]

    # 2. Unknown field in adjust item -> 400
    res_bad_adj = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 1,
        "adjustment_type": "addition",
        "unknown_flag": True
    })
    assert res_bad_adj.status_code == 400
    assert res_bad_adj.get_json()["code"] == "UNKNOWN_FIELD"

    # 3. Insufficient stock (deduct 10 from balance 5) -> 409 STOCK_CONFLICT
    res_over = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 10,
        "adjustment_type": "removal"
    })
    assert res_over.status_code == 409
    assert res_over.get_json()["code"] == "STOCK_CONFLICT"

    # 4. Adjust non-existent item -> 404
    res_notfound = client.post("/api/items/99999/adjust", json={
        "change_amount": 1,
        "adjustment_type": "removal"
    })
    assert res_notfound.status_code == 404

    # 5. Non-integer pagination parameter -> 400
    res_malformed_page = client.get("/api/items/?page=abc")
    assert res_malformed_page.status_code == 400
    assert res_malformed_page.get_json()["code"] == "INVALID_PAGINATION"


def test_manual_adjustment_preserves_attributes_and_does_not_create_leave_orders(client, sample_metadata, migrated_db):
    """
    Verifies that:
    1. Manual additions and removals preserve provider, cost, person, destination, and positive integers.
    2. Manual removals do NOT create leave orders in the leave_orders table.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]
    prov_id = sample_metadata["provider_id"]
    dest_id = sample_metadata["destination_id"]

    # Check leave_orders table count before
    cursor = migrated_db.cursor()
    cursor.execute("SELECT COUNT(*) FROM leave_orders")
    initial_lo_count = cursor.fetchone()[0]

    # 1. Create item
    res_create = client.post("/api/items/", json={
        "name": "صندوق أدوات",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 20,
        "cost": 100.0,
        "provider_id": prov_id
    })
    assert res_create.status_code == 201
    item_id = res_create.get_json()["id"]

    # 2. Manual addition preserving provider, cost, person
    res_add = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 10,
        "adjustment_type": "addition",
        "provider_id": prov_id,
        "cost": 105.5,
        "person_name": "أحمد المستودع"
    })
    assert res_add.status_code == 200
    assert res_add.get_json()["current_quantity"] == 30

    # 3. Manual removal preserving destination and person
    res_rem = client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 8,
        "adjustment_type": "removal",
        "destination_id": dest_id,
        "person_name": "سعيد السائق"
    })
    assert res_rem.status_code == 200
    assert res_rem.get_json()["current_quantity"] == 22

    # 4. Verify leave_orders table count is completely unchanged
    cursor.execute("SELECT COUNT(*) FROM leave_orders")
    after_lo_count = cursor.fetchone()[0]
    assert after_lo_count == initial_lo_count, "Manual removals must never create leave orders"

    # 5. Verify movement log records have preserved attributes
    res_logs = client.get(f"/api/movement-logs/?item_id={item_id}")
    assert res_logs.status_code == 200
    logs = res_logs.get_json()["logs"]
    
    # Find removal log
    rem_log = next(l for l in logs if l["action_type"] == "Removal")
    assert rem_log["quantity_changed"] == 8
    assert rem_log["person_name"] == "سعيد السائق"
    assert rem_log["destination_name"] == "مستودع 1"

    # Find addition log
    add_log = next(l for l in logs if l["action_type"] == "Addition")
    assert add_log["quantity_changed"] == 10
    assert add_log["person_name"] == "أحمد المستودع"
    assert add_log["provider"] == "شركة الأهرام"
    assert add_log["cost_per_item"] == 105.5


def test_movement_log_advanced_filtering_and_exports(client, sample_metadata):
    """
    Verifies that:
    1. Movement logs support comma-separated action_type filtering (e.g. 'Addition,Removal').
    2. Logs support destination_id and provider_id filters.
    3. Standard endpoint returns paginated metadata {logs, total_count, page, page_size, total_pages}.
    4. /all_filtered returns an array of matching logs for exports/reports.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]
    prov_id = sample_metadata["provider_id"]
    dest_id = sample_metadata["destination_id"]

    res_item = client.post("/api/items/", json={
        "name": "معدات تصدير اللوج",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 50
    })
    item_id = res_item.get_json()["id"]

    # Create multiple log entries
    client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 5,
        "adjustment_type": "addition",
        "provider_id": prov_id
    })
    client.post(f"/api/items/{item_id}/adjust", json={
        "change_amount": 3,
        "adjustment_type": "removal",
        "destination_id": dest_id
    })

    # 1. Comma-separated action_type filtering
    res_multi_action = client.get(f"/api/movement-logs/?action_type=Addition,Removal&item_id={item_id}")
    assert res_multi_action.status_code == 200
    multi_data = res_multi_action.get_json()
    assert multi_data["total_count"] == 2
    assert {l["action_type"] for l in multi_data["logs"]} == {"Addition", "Removal"}

    # 2. Destination filter
    res_dest = client.get(f"/api/movement-logs/?destination_id={dest_id}&item_id={item_id}")
    assert res_dest.status_code == 200
    dest_data = res_dest.get_json()
    assert dest_data["total_count"] == 1
    assert dest_data["logs"][0]["action_type"] == "Removal"

    # 3. Provider filter
    res_prov = client.get(f"/api/movement-logs/?provider_id={prov_id}&item_id={item_id}")
    assert res_prov.status_code == 200
    prov_data = res_prov.get_json()
    assert prov_data["total_count"] == 1
    assert prov_data["logs"][0]["action_type"] == "Addition"

    # 4. Pagination contract
    assert "page" in multi_data
    assert "page_size" in multi_data
    assert "total_pages" in multi_data
    assert "total_count" in multi_data

    # 5. Export array endpoint (/all_filtered)
    res_all_filtered = client.get(f"/api/movement-logs/all_filtered?item_id={item_id}")
    assert res_all_filtered.status_code == 200
    assert isinstance(res_all_filtered.get_json(), list)
    assert len(res_all_filtered.get_json()) >= 3  # Creation + Addition + Removal


def test_item_creation_idempotency_via_api(client, sample_metadata):
    """
    Verifies that first-party item creation requests carrying an Idempotency-Key header:
    1. First submission succeeds (201 Created).
    2. Replay with identical key & payload returns cached 201 response without duplicating item.
    3. Resubmitting same key with different payload returns 409 IDEMPOTENCY_KEY_CONFLICT.
    """
    unit_id = sample_metadata["unit_id"]
    sub_cat_id = sample_metadata["sub_category_id"]

    idem_key = "idem-create-item-001"
    create_payload = {
        "name": "صنف للتكرار الآمن",
        "unit_id": unit_id,
        "sub_category_id": sub_cat_id,
        "initial_quantity": 15,
        "barcode": "SAFE-REPLAY-1"
    }

    # 1. Initial creation
    res1 = client.post("/api/items/", json=create_payload, headers={"Idempotency-Key": idem_key})
    assert res1.status_code == 201
    item1 = res1.get_json()
    assert item1["name"] == "صنف للتكرار الآمن"
    assert item1["current_quantity"] == 15

    # 2. Replay identical request
    res2 = client.post("/api/items/", json=create_payload, headers={"Idempotency-Key": idem_key})
    assert res2.status_code == 201
    item2 = res2.get_json()
    assert item2["id"] == item1["id"]
    assert item2["name"] == item1["name"]

    # Verify no duplicate item exists in search
    res_search = client.get("/api/items/?search=صنف للتكرار الآمن")
    assert res_search.status_code == 200
    assert res_search.get_json()["total_count"] == 1

    # 3. Conflict: same key with different payload
    res3 = client.post("/api/items/", json={
        **create_payload,
        "initial_quantity": 99
    }, headers={"Idempotency-Key": idem_key})
    assert res3.status_code == 409
    assert res3.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"

