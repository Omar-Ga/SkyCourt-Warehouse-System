"""API boundary tests for the two-operator role matrix."""


def test_unauthenticated_requests_are_rejected(unauthenticated_client):
    for method, path in (
        ("get", "/api/items"), ("get", "/api/purchase-orders"),
        ("post", "/api/leave-orders"), ("post", "/api/tickets/1/fulfill"),
        ("post", "/api/purchase-orders/1/receive"),
    ):
        response = getattr(unauthenticated_client, method)(path, json={})
        assert response.status_code == 401, (method, path, response.status_code)


def test_role_workflow_boundaries(client, office_client, sample_metadata):
    assert client.post("/api/leave-orders", json={}, headers={"Idempotency-Key": "x"}).status_code == 403
    assert office_client.post("/api/tickets/1/fulfill", json={}, headers={"Idempotency-Key": "x"}).status_code == 403
    assert office_client.post("/api/purchase-orders/1/receive", json={}, headers={"Idempotency-Key": "x"}).status_code == 403
    assert client.post("/api/purchase-orders", json={}, headers={"Idempotency-Key": "x"}).status_code == 403


def test_removed_routes_return_not_found(office_client):
    for path in ("/api/items/by-barcode/X", "/api/items/1/barcode", "/api/items/generate-barcode/X", "/api/purchase-orders/by-barcode/X", "/api/purchase-orders/1/barcode"):
        assert office_client.get(path).status_code == 404
