"""
Tests for Idempotency: Atomic Reservation, Safe Replay, Conflict Rejection, and Rollback.
"""
import pytest
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    IdempotencyConflictError,
    IdempotencyInProgressError
)


def test_atomic_reservation_and_completion(migrated_db):
    """Verifies standard idempotency lifecycle: reserve -> in_progress -> complete."""
    op_key = "op-test-key-1"
    op_type = "stock_adjustment"
    payload = {"item_id": 1, "change_amount": 5}
    req_hash = compute_request_hash(payload)

    # 1. Initial reservation
    res = reserve_operation(
        conn=migrated_db,
        operation_key=op_key,
        operation_type=op_type,
        actor_id=None,
        request_hash=req_hash
    )
    assert res["replayed"] is False

    # Check row status is in_progress
    cursor = migrated_db.cursor()
    cursor.execute("SELECT status FROM operations WHERE operation_key = ?", (op_key,))
    assert cursor.fetchone()[0] == "in_progress"

    # 2. Complete operation
    response_body = {"success": True, "balance": 15}
    complete_operation(
        conn=migrated_db,
        operation_key=op_key,
        response_status=200,
        response_body=response_body
    )
    migrated_db.commit()

    # Check row status is completed
    cursor.execute("SELECT status, response_status, response_body FROM operations WHERE operation_key = ?", (op_key,))
    row = cursor.fetchone()
    assert row["status"] == "completed"
    assert row["response_status"] == 200


def test_replay_identical_successful_result(migrated_db):
    """Verifies that submitting with the same key and identical payload replays the saved result."""
    op_key = "op-replay-key"
    op_type = "stock_adjustment"
    payload = {"item_id": 1, "change_amount": 5}
    req_hash = compute_request_hash(payload)

    # Reserve and complete
    reserve_operation(migrated_db, op_key, op_type, None, req_hash)
    complete_operation(migrated_db, op_key, 200, {"resulting_quantity": 15})
    migrated_db.commit()

    # Replay attempt with same key and payload
    res = reserve_operation(migrated_db, op_key, op_type, None, req_hash)
    assert res["replayed"] is True
    assert res["response_status"] == 200
    assert res["response_body"] == {"resulting_quantity": 15}


def test_reject_changed_payload(migrated_db):
    """Verifies that submitting the same key with a different payload raises 409 conflict."""
    op_key = "op-conflict-payload"
    op_type = "stock_adjustment"
    payload1 = {"item_id": 1, "change_amount": 5}
    payload2 = {"item_id": 1, "change_amount": 10}

    reserve_operation(migrated_db, op_key, op_type, None, compute_request_hash(payload1))
    complete_operation(migrated_db, op_key, 200, {"balance": 15})
    migrated_db.commit()

    with pytest.raises(IdempotencyConflictError, match="different request payload"):
        reserve_operation(migrated_db, op_key, op_type, None, compute_request_hash(payload2))


def test_reject_changed_operation_type(migrated_db):
    """Verifies that submitting the same key with a different operation type raises 409 conflict."""
    op_key = "op-conflict-type"
    payload = {"item_id": 1}
    req_hash = compute_request_hash(payload)

    reserve_operation(migrated_db, op_key, "type_A", None, req_hash)
    complete_operation(migrated_db, op_key, 200, {"ok": True})
    migrated_db.commit()

    with pytest.raises(IdempotencyConflictError, match="different operation type"):
        reserve_operation(migrated_db, op_key, "type_B", None, req_hash)


def test_reject_changed_actor(migrated_db):
    """Verifies that submitting the same key with a different actor ID raises 409 conflict."""
    # Seed two users
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('user1', 'h1', 'office', 'User 1')")
    user1_id = cursor.lastrowid
    cursor.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('user2', 'h2', 'warehouse', 'User 2')")
    user2_id = cursor.lastrowid
    migrated_db.commit()

    op_key = "op-conflict-actor"
    payload = {"data": "test"}
    req_hash = compute_request_hash(payload)

    reserve_operation(migrated_db, op_key, "test_op", user1_id, req_hash)
    complete_operation(migrated_db, op_key, 200, {"ok": True})
    migrated_db.commit()

    # User 2 cannot reuse user 1's key
    with pytest.raises(IdempotencyConflictError, match="different actor"):
        reserve_operation(migrated_db, op_key, "test_op", user2_id, req_hash)

    # An unauthenticated caller (None) also cannot snoop or reuse user 1's key
    with pytest.raises(IdempotencyConflictError, match="different actor"):
        reserve_operation(migrated_db, op_key, "test_op", None, req_hash)


def test_concurrent_unique_constraint_collision_handled(temp_db_path):
    """
    Verifies that if two concurrent requests attempt to reserve the same key simultaneously
    and trigger a database unique constraint, reserve_operation catches it and raises IdempotencyInProgressError safely.
    """
    import sqlite3
    from app.migrations import run_migrations
    init_conn = sqlite3.connect(temp_db_path)
    run_migrations(init_conn)
    init_conn.close()

    conn1 = sqlite3.connect(temp_db_path)
    conn2 = sqlite3.connect(temp_db_path)

    op_key = "op-concurrent-race"
    req_hash = compute_request_hash({"item": 1})

    # conn1 reserves key
    res1 = reserve_operation(conn1, op_key, "order", None, req_hash)
    assert res1["replayed"] is False
    conn1.commit()

    # conn2 attempts to reserve same key concurrently
    with pytest.raises(IdempotencyInProgressError):
        reserve_operation(conn2, op_key, "order", None, req_hash)

    conn1.close()
    conn2.close()


def test_complete_nonexistent_operation_raises_error(migrated_db):
    """Verifies that complete_operation on a non-existent key raises IdempotencyError with status 404."""
    from app.services.idempotency_service import IdempotencyError
    with pytest.raises(IdempotencyError) as exc:
        complete_operation(migrated_db, "nonexistent-key", 200, {"ok": True})
    assert exc.value.status_code == 404


def test_reject_concurrent_in_progress_operation(migrated_db):
    """Verifies that a duplicate request while an operation is still in-progress raises conflict."""
    op_key = "op-in-progress"
    payload = {"foo": "bar"}
    req_hash = compute_request_hash(payload)

    reserve_operation(migrated_db, op_key, "test_op", None, req_hash)
    # Note: NOT completed, still in_progress!

    with pytest.raises(IdempotencyInProgressError, match="currently in progress"):
        reserve_operation(migrated_db, op_key, "test_op", None, req_hash)


def test_rollback_on_failure_allows_clean_retry(migrated_db):
    """
    Verifies that if a business operation fails and rolls back,
    the in-progress operation reservation is rolled back too, permitting clean retry.
    """
    op_key = "op-retry-after-failure"
    payload = {"amount": 5}
    req_hash = compute_request_hash(payload)

    # First attempt: reserve then fail and rollback
    try:
        reserve_operation(migrated_db, op_key, "payment", None, req_hash)
        raise RuntimeError("Business logic failed")
    except RuntimeError:
        migrated_db.rollback()

    # The reservation should not exist
    cursor = migrated_db.cursor()
    cursor.execute("SELECT * FROM operations WHERE operation_key = ?", (op_key,))
    assert cursor.fetchone() is None

    # Clean retry succeeds
    res = reserve_operation(migrated_db, op_key, "payment", None, req_hash)
    assert res["replayed"] is False
    complete_operation(migrated_db, op_key, 200, {"status": "paid"})
    migrated_db.commit()


def test_api_route_idempotency_replay(client, sample_metadata):
    """Integration test: API POST /api/items/<id>/adjust with Idempotency-Key header."""
    unit_id = sample_metadata["unit_id"]

    # Create item
    res_create = client.post("/api/items/", json={
        "name": "Idempotent Stock Item",
        "unit_id": unit_id,
        "sub_category_id": sample_metadata["sub_category_id"],
        "initial_quantity": 10
    })
    assert res_create.status_code == 201
    item_id = res_create.get_json()["id"]

    idem_key = "adjust-key-12345"
    adjust_payload = {
        "change_amount": 3,
        "adjustment_type": "addition",
        "person_name": "Tester"
    }

    # First request
    res1 = client.post(
        f"/api/items/{item_id}/adjust",
        json=adjust_payload,
        headers={"Idempotency-Key": idem_key}
    )
    assert res1.status_code == 200
    assert res1.get_json()["current_quantity"] == 13

    # Duplicate request with same key and payload -> must replay 200 without adding stock again!
    res2 = client.post(
        f"/api/items/{item_id}/adjust",
        json=adjust_payload,
        headers={"Idempotency-Key": idem_key}
    )
    assert res2.status_code == 200
    assert res2.get_json()["current_quantity"] == 13  # Not 16!

    # Reusing same key with different payload -> must return 409
    res3 = client.post(
        f"/api/items/{item_id}/adjust",
        json={**adjust_payload, "change_amount": 10},
        headers={"Idempotency-Key": idem_key}
    )
    assert res3.status_code == 409
    assert res3.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"

    # Reusing same key for a DIFFERENT item -> must return 409 conflict
    res_item2 = client.post("/api/items/", json={
        "name": "Second Item for Idempotency Conflict",
        "unit_id": unit_id,
        "sub_category_id": sample_metadata["sub_category_id"],
        "initial_quantity": 20
    })
    assert res_item2.status_code == 201
    item2_id = res_item2.get_json()["id"]

    res_cross = client.post(
        f"/api/items/{item2_id}/adjust",
        json=adjust_payload,
        headers={"Idempotency-Key": idem_key}
    )
    assert res_cross.status_code == 409
    assert res_cross.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_stock_mutations_require_idempotency_key(client, sample_metadata):
    """Missing operation keys are rejected before item or stock mutation."""
    payload = {
        "name": "Missing Key Item",
        "unit_id": sample_metadata["unit_id"],
        "sub_category_id": sample_metadata["sub_category_id"],
        "initial_quantity": 10,
    }
    response = client.post("/api/items", json=payload, headers={"Idempotency-Key": ""})
    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Missing required Idempotency-Key header",
        "code": "MISSING_IDEMPOTENCY_KEY",
    }

    created = client.post(
        "/api/items",
        json=payload,
        headers={"Idempotency-Key": "missing-key-follow-up"},
    )
    assert created.status_code == 201
    item_id = created.get_json()["id"]

    adjustment = client.post(
        f"/api/items/{item_id}/adjust",
        json={"change_amount": 1, "adjustment_type": "addition"},
        headers={"X-Idempotency-Key": ""},
    )
    assert adjustment.status_code == 400
    assert adjustment.get_json() == {
        "error": "Missing required Idempotency-Key header",
        "code": "MISSING_IDEMPOTENCY_KEY",
    }


def test_category_creation_idempotency(client, migrated_db):
    """Verifies that category creation requests carrying an Idempotency-Key are idempotent."""
    idem_key = "cat-create-key-001"
    payload = {"name": "فئة تجريبية فريدة"}

    # 1. Initial creation
    res1 = client.post("/api/categories", json=payload, headers={"Idempotency-Key": idem_key})
    assert res1.status_code == 201
    created_cat = res1.get_json()
    assert created_cat["name"] == payload["name"]
    cat_id = created_cat["id"]

    # 2. Duplicate submission with same key & payload -> replays exact 201 response
    res2 = client.post("/api/categories", json=payload, headers={"Idempotency-Key": idem_key})
    assert res2.status_code == 201
    assert res2.get_json()["id"] == cat_id
    assert res2.get_json()["name"] == payload["name"]

    # Verify only ONE category exists in DB with this name
    cursor = migrated_db.cursor()
    cursor.execute("SELECT COUNT(*) FROM categories WHERE name = ?", (payload["name"],))
    assert cursor.fetchone()[0] == 1

    # 3. Conflict: same key with different payload -> 409
    res3 = client.post("/api/categories", json={"name": "فئة تجريبية مختلفة"}, headers={"Idempotency-Key": idem_key})
    assert res3.status_code == 409
    assert res3.get_json()["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_provider_destination_unit_creation_idempotency(client, migrated_db):
    """Verifies that provider, destination, and unit creations support Idempotency-Key replay."""
    # Provider
    prov_key = "prov-create-key-001"
    p_res1 = client.post("/api/providers", json={"name": "مورد اختباري"}, headers={"Idempotency-Key": prov_key})
    assert p_res1.status_code == 201
    p_id = p_res1.get_json()["id"]

    p_res2 = client.post("/api/providers", json={"name": "مورد اختباري"}, headers={"Idempotency-Key": prov_key})
    assert p_res2.status_code == 201
    assert p_res2.get_json()["id"] == p_id

    # Destination
    dest_key = "dest-create-key-001"
    d_res1 = client.post("/api/destinations", json={"name": "وجهة اختبارية"}, headers={"Idempotency-Key": dest_key})
    assert d_res1.status_code == 201
    d_id = d_res1.get_json()["id"]

    d_res2 = client.post("/api/destinations", json={"name": "وجهة اختبارية"}, headers={"Idempotency-Key": dest_key})
    assert d_res2.status_code == 201
    assert d_res2.get_json()["id"] == d_id

    # Unit
    unit_key = "unit-create-key-001"
    u_res1 = client.post("/api/units", json={"name": "وحدة اختبارية"}, headers={"Idempotency-Key": unit_key})
    assert u_res1.status_code == 201
    u_id = u_res1.get_json()["id"]

    u_res2 = client.post("/api/units", json={"name": "وحدة اختبارية"}, headers={"Idempotency-Key": unit_key})
    assert u_res2.status_code == 201
    assert u_res2.get_json()["id"] == u_id


def test_category_creation_with_x_idempotency_key_and_subcategories(client, migrated_db):
    """Verifies X-Idempotency-Key header support and subcategory idempotency."""
    # 1. Main category with X-Idempotency-Key
    main_key = "cat-main-xkey-001"
    main_res = client.post("/api/categories", json={"name": "فئة رئيسية X"}, headers={"X-Idempotency-Key": main_key})
    assert main_res.status_code == 201
    parent_id = main_res.get_json()["id"]

    # Replay main category
    main_replay = client.post("/api/categories", json={"name": "فئة رئيسية X"}, headers={"X-Idempotency-Key": main_key})
    assert main_replay.status_code == 201
    assert main_replay.get_json()["id"] == parent_id

    # 2. Subcategory with Idempotency-Key and parent_id
    sub_key = "cat-sub-key-002"
    sub_payload = {"name": "فئة فرعية تابعة", "parent_id": parent_id}
    sub_res = client.post("/api/categories", json=sub_payload, headers={"Idempotency-Key": sub_key})
    assert sub_res.status_code == 201
    sub_id = sub_res.get_json()["id"]
    assert sub_res.get_json()["parent_id"] == parent_id

    # Replay subcategory
    sub_replay = client.post("/api/categories", json=sub_payload, headers={"Idempotency-Key": sub_key})
    assert sub_replay.status_code == 201
    assert sub_replay.get_json()["id"] == sub_id
    assert sub_replay.get_json()["parent_id"] == parent_id


def test_category_creation_in_progress_returns_409(client, migrated_db):
    """Verifies that attempting an operation while it is still in_progress returns 409 IDEMPOTENCY_IN_PROGRESS."""
    in_prog_key = "cat-in-prog-001"
    cursor = migrated_db.cursor()
    cursor.execute("SELECT id FROM users WHERE username = 'default_warehouse'")
    actor_id = cursor.fetchone()[0]

    cursor.execute(
        """
        INSERT INTO operations (operation_key, actor_id, operation_type, request_hash, status)
        VALUES (?, ?, 'create_category', ?, 'in_progress')
        """,
        (in_prog_key, actor_id, compute_request_hash({"name": "فئة قيد التنفيذ"}))
    )
    migrated_db.commit()

    res = client.post("/api/categories", json={"name": "فئة قيد التنفيذ"}, headers={"Idempotency-Key": in_prog_key})
    assert res.status_code == 409
    assert res.get_json()["code"] == "IDEMPOTENCY_IN_PROGRESS"


def test_put_and_delete_with_idempotency_headers(client):
    """
    Verifies that PUT and DELETE routes for categories, providers, destinations, and units
    handle requests carrying Idempotency-Key or X-Idempotency-Key without errors.
    """
    # 1. Category
    c_res = client.post("/api/categories", json={"name": "فئة للتعديل والحذف"}, headers={"Idempotency-Key": "c-init"})
    assert c_res.status_code == 201
    cat_id = c_res.get_json()["id"]

    put_cat = client.put(f"/api/categories/{cat_id}", json={"name": "فئة بعد التعديل"}, headers={"Idempotency-Key": "c-put"})
    assert put_cat.status_code == 200
    assert put_cat.get_json()["name"] == "فئة بعد التعديل"

    del_cat = client.delete(f"/api/categories/{cat_id}", headers={"Idempotency-Key": "c-del"})
    assert del_cat.status_code == 200

    # 2. Provider
    p_res = client.post("/api/providers", json={"name": "مورد للتعديل"}, headers={"Idempotency-Key": "p-init"})
    assert p_res.status_code == 201
    p_id = p_res.get_json()["id"]

    put_p = client.put(f"/api/providers/{p_id}", json={"name": "مورد معدل"}, headers={"X-Idempotency-Key": "p-put"})
    assert put_p.status_code == 200
    assert put_p.get_json()["name"] == "مورد معدل"

    del_p = client.delete(f"/api/providers/{p_id}", headers={"Idempotency-Key": "p-del"})
    assert del_p.status_code == 200

    # 3. Destination
    d_res = client.post("/api/destinations", json={"name": "وجهة للتعديل"}, headers={"Idempotency-Key": "d-init"})
    assert d_res.status_code == 201
    d_id = d_res.get_json()["id"]

    put_d = client.put(f"/api/destinations/{d_id}", json={"name": "وجهة معدلة"}, headers={"Idempotency-Key": "d-put"})
    assert put_d.status_code == 200
    assert put_d.get_json()["name"] == "وجهة معدلة"

    del_d = client.delete(f"/api/destinations/{d_id}", headers={"X-Idempotency-Key": "d-del"})
    assert del_d.status_code == 200

    # 4. Unit
    u_res = client.post("/api/units", json={"name": "وحدة للتعديل"}, headers={"Idempotency-Key": "u-init"})
    assert u_res.status_code == 201
    u_id = u_res.get_json()["id"]

    put_u = client.put(f"/api/units/{u_id}", json={"name": "وحدة معدلة"}, headers={"Idempotency-Key": "u-put"})
    assert put_u.status_code == 200
    assert put_u.get_json()["name"] == "وحدة معدلة"

    del_u = client.delete(f"/api/units/{u_id}", headers={"Idempotency-Key": "u-del"})
    assert del_u.status_code == 200



