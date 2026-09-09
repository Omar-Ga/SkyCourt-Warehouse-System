"""Tests for draft, dispatch, and atomic receive purchase orders."""
import sqlite3

from app.models import item_model


def _item(temp_db_path, sample_metadata, quantity=0):
    conn = sqlite3.connect(temp_db_path)
    item_id = item_model.insert_item(conn.cursor(), "PO Item", sample_metadata["unit_id"], sample_metadata["sub_category_id"], quantity, sample_metadata["provider_id"], 3.0)
    conn.commit(); conn.close()
    return item_id


def _qty(temp_db_path, item_id):
    conn = sqlite3.connect(temp_db_path); value = conn.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,)).fetchone()[0]; conn.close(); return value


def _draft(office_client, provider_id, item_id, key="po-create"):
    response = office_client.post("/api/purchase-orders", json={"provider_id": provider_id, "items": [{"item_id": item_id, "requested_quantity": 5, "ordered_quantity": 5, "unit_price": "2.00"}]}, headers={"Idempotency-Key": key})
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_creation_is_office_only_draft_and_does_not_change_stock(office_client, client, sample_metadata, temp_db_path):
    item_id = _item(temp_db_path, sample_metadata, 10)
    draft = _draft(office_client, sample_metadata["provider_id"], item_id)
    assert draft["status"] == "draft"
    assert draft["expires_at"] is None
    assert draft["dispatched_at"] is None
    assert _qty(temp_db_path, item_id) == 10
    assert client.get("/api/purchase-orders").get_json()["total_count"] == 0
    assert client.get(f"/api/purchase-orders/{draft['id']}").status_code == 404


def test_draft_edit_preserves_requested_quantity_and_dispatches(office_client, sample_metadata, temp_db_path):
    item_id = _item(temp_db_path, sample_metadata)
    draft = _draft(office_client, sample_metadata["provider_id"], item_id, "po-edit-create")
    edited = office_client.put(f"/api/purchase-orders/{draft['id']}", json={"provider_id": sample_metadata["provider_id"], "expected_revision": 0, "items": [{"item_id": item_id, "requested_quantity": 5, "ordered_quantity": 0, "unit_price": "2.00"}]}, headers={"Idempotency-Key": "po-edit"})
    assert edited.status_code == 200
    assert edited.get_json()["items"][0]["requested_quantity"] == 5
    assert edited.get_json()["items"][0]["ordered_quantity"] == 0
    assert office_client.post(f"/api/purchase-orders/{draft['id']}/dispatch", json={"expected_revision": 1}, headers={"Idempotency-Key": "po-dispatch-empty"}).status_code == 400
    edited = office_client.put(f"/api/purchase-orders/{draft['id']}", json={"provider_id": sample_metadata["provider_id"], "expected_revision": 1, "items": [{"item_id": item_id, "requested_quantity": 5, "ordered_quantity": 3, "unit_price": "2.00"}]}, headers={"Idempotency-Key": "po-edit-2"}).get_json()
    dispatched = office_client.post(f"/api/purchase-orders/{draft['id']}/dispatch", json={"expected_revision": 2}, headers={"Idempotency-Key": "po-dispatch"})
    assert dispatched.status_code == 200
    body = dispatched.get_json()
    assert body["status"] == "open"
    assert body["expires_at"] is not None
    assert body["dispatched_at"] is not None


def test_warehouse_receive_is_atomic_and_not_partial(client, office_client, sample_metadata, temp_db_path):
    item_id = _item(temp_db_path, sample_metadata)
    draft = _draft(office_client, sample_metadata["provider_id"], item_id, "po-receive-create")
    open_po = office_client.post(f"/api/purchase-orders/{draft['id']}/dispatch", json={"expected_revision": 0}, headers={"Idempotency-Key": "po-receive-dispatch"}).get_json()
    partial = client.post(f"/api/purchase-orders/{draft['id']}/receive", json={"expected_revision": open_po["revision"], "items": []}, headers={"Idempotency-Key": "po-partial"})
    assert partial.status_code == 400
    received = client.post(f"/api/purchase-orders/{draft['id']}/receive", json={"expected_revision": open_po["revision"]}, headers={"Idempotency-Key": "po-receive"})
    assert received.status_code == 200
    assert received.get_json()["status"] == "closed"
    assert received.get_json()["items"][0]["received_quantity"] == 5
    assert _qty(temp_db_path, item_id) == 5
    replay = client.post(f"/api/purchase-orders/{draft['id']}/receive", json={"expected_revision": open_po["revision"]}, headers={"Idempotency-Key": "po-receive"})
    assert replay.status_code == 200
    conn = sqlite3.connect(temp_db_path)
    assert conn.execute("SELECT COUNT(*) FROM movement_logs WHERE action_type = 'Addition'").fetchone()[0] == 1
    conn.close()


def test_removed_identifier_routes_are_unavailable(office_client):
    assert office_client.get("/api/purchase-orders/by-barcode/PO-1").status_code == 404
    assert office_client.get("/api/purchase-orders/1/barcode").status_code == 404
