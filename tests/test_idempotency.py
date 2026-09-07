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

