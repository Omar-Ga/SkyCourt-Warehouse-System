"""Tests for the reservation-based two-operator Leave Order workflow."""
import sqlite3

from app.models import item_model


def _seed_item(temp_db_path, sample_metadata, quantity=10):
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    item_id = item_model.insert_item(
        conn.cursor(), "Test Item", sample_metadata["unit_id"],
        sample_metadata["sub_category_id"], quantity,
        sample_metadata["provider_id"], 2.0,
    )
    conn.commit()
    conn.close()
    return item_id


def _item_balance(temp_db_path, item_id):
    conn = sqlite3.connect(temp_db_path)
    row = conn.execute("SELECT current_quantity, reserved_quantity FROM items WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return row


def test_office_creation_reserves_without_deducting(office_client, client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata)
    response = office_client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 4}]},
        headers={"Idempotency-Key": "leave-create-1"},
    )
    assert response.status_code == 201
    body = response.get_json()
    assert body["status"] == "open"
    assert body["items"][0]["dispensed_quantity"] == 0
    assert body["items"][0]["current_available_quantity"] == 6
    assert _item_balance(temp_db_path, item_id) == (10, 4)
    assert client.get("/api/tickets").get_json()["total_count"] == 1


def test_warehouse_cannot_create_leave_order(client, sample_metadata):
    response = client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": []},
        headers={"Idempotency-Key": "warehouse-create"},
    )
    assert response.status_code == 403


def test_reservation_prevents_overallocation(office_client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata, 5)
    payload = {"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 4}]}
    assert office_client.post("/api/leave-orders", json=payload, headers={"Idempotency-Key": "reserve-a"}).status_code == 201
    payload["employee_name"] = "Employee 2"
    failed = office_client.post("/api/leave-orders", json=payload, headers={"Idempotency-Key": "reserve-b"})
    assert failed.status_code == 400
    assert failed.get_json()["code"] == "INSUFFICIENT_STOCK"
    assert _item_balance(temp_db_path, item_id) == (5, 4)


def test_fulfill_deducts_and_logs_once(client, office_client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata)
    created = office_client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 4}]},
        headers={"Idempotency-Key": "leave-create-2"},
    ).get_json()
    fulfilled = client.post(
        f"/api/tickets/{created['id']}/fulfill",
        json={"expected_revision": created["revision"]},
        headers={"Idempotency-Key": "leave-fulfill-1"},
    )
    assert fulfilled.status_code == 200
    assert fulfilled.get_json()["status"] == "closed"
    assert _item_balance(temp_db_path, item_id) == (6, 0)
    conn = sqlite3.connect(temp_db_path)
    assert conn.execute("SELECT COUNT(*) FROM movement_logs WHERE action_type = 'Removal'").fetchone()[0] == 1
    replay = client.post(
        f"/api/tickets/{created['id']}/fulfill",
        json={"expected_revision": created["revision"]},
        headers={"Idempotency-Key": "leave-fulfill-1"},
    )
    assert replay.status_code == 200
    assert conn.execute("SELECT COUNT(*) FROM movement_logs WHERE action_type = 'Removal'").fetchone()[0] == 1
    conn.close()


def test_reject_releases_reservation_and_requires_reason(client, office_client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata)
    created = office_client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 4}]},
        headers={"Idempotency-Key": "leave-create-3"},
    ).get_json()
    blank = client.post(f"/api/tickets/{created['id']}/reject", json={"expected_revision": 0, "reason": "   "}, headers={"Idempotency-Key": "reject-blank"})
    assert blank.status_code == 400
    rejected = client.post(f"/api/tickets/{created['id']}/reject", json={"expected_revision": 0, "reason": "Item unavailable"}, headers={"Idempotency-Key": "reject-1"})
    assert rejected.status_code == 200
    assert rejected.get_json()["status"] == "rejected"
    assert rejected.get_json()["rejection_reason"] == "Item unavailable"
    assert _item_balance(temp_db_path, item_id) == (10, 0)


def test_rejected_order_can_resubmit_or_cancel(office_client, client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata)
    created = office_client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 2}]},
        headers={"Idempotency-Key": "leave-create-4"},
    ).get_json()
    assert client.post(f"/api/tickets/{created['id']}/reject", json={"expected_revision": 0, "reason": "Review"}, headers={"Idempotency-Key": "reject-2"}).status_code == 200
    resubmitted = office_client.post(f"/api/leave-orders/{created['id']}/resubmit", json={"expected_revision": 1}, headers={"Idempotency-Key": "resubmit-1"})
    assert resubmitted.status_code == 200
    assert resubmitted.get_json()["status"] == "open"
    assert _item_balance(temp_db_path, item_id) == (10, 2)
    assert client.post(f"/api/tickets/{created['id']}/reject", json={"expected_revision": 2, "reason": "Cancel"}, headers={"Idempotency-Key": "reject-3"}).status_code == 200
    cancelled = office_client.post(f"/api/leave-orders/{created['id']}/cancel", json={"expected_revision": 3}, headers={"Idempotency-Key": "cancel-1"})
    assert cancelled.status_code == 200
    assert cancelled.get_json()["status"] == "cancelled"
    assert _item_balance(temp_db_path, item_id) == (10, 0)


def test_returns_are_limited_to_dispensed_stock(office_client, client, sample_metadata, temp_db_path):
    item_id = _seed_item(temp_db_path, sample_metadata)
    created = office_client.post(
        "/api/leave-orders",
        json={"employee_name": "Employee", "destination_id": sample_metadata["destination_id"], "items": [{"item_id": item_id, "requested_quantity": 4}]},
        headers={"Idempotency-Key": "leave-create-5"},
    ).get_json()
    assert office_client.post(f"/api/leave-orders/{created['id']}/return", json={"expected_revision": 0, "items": [{"line_id": 1, "quantity": 1}]}, headers={"Idempotency-Key": "return-before"}).status_code == 400
    closed = client.post(f"/api/tickets/{created['id']}/fulfill", json={"expected_revision": 0}, headers={"Idempotency-Key": "fulfill-5"}).get_json()
    returned = office_client.post(f"/api/leave-orders/{created['id']}/return", json={"expected_revision": closed["revision"], "items": [{"line_id": 1, "quantity": 2}]}, headers={"Idempotency-Key": "return-1"})
    assert returned.status_code == 200
    assert returned.get_json()["status"] == "partially_returned"
    assert _item_balance(temp_db_path, item_id) == (8, 0)
