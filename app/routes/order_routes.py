"""HTTP endpoints for the two-operator purchase and disbursement workflows."""
from flask import Blueprint, g, jsonify, request

from app.auth import require_role
from app.services import leave_order_service, purchase_order_service
from app.services.idempotency_service import IdempotencyError
from app.validation import ValidationError, validate_allowed_fields, validate_required_fields

po_bp = Blueprint("purchase_orders_bp", __name__, url_prefix="/api/purchase-orders")
leave_order_bp = Blueprint("leave_orders_bp", __name__, url_prefix="/api/leave-orders")
tickets_bp = Blueprint("tickets_bp", __name__, url_prefix="/api/tickets")


def _body():
    data = request.get_json()
    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400)
    return data, None


def _key_required():
    key = request.headers.get("Idempotency-Key")
    if not key or not key.strip():
        return None, (jsonify({"error": "Idempotency-Key header is required", "code": "MISSING_IDEMPOTENCY_KEY"}), 400)
    return key.strip(), None


def _error(error):
    if isinstance(error, (IdempotencyError, ValidationError)):
        status = error.status_code if isinstance(error, IdempotencyError) else (404 if error.code == "NOT_FOUND" else 400)
        return jsonify(error.to_dict()), status
    if isinstance(error, ValueError):
        return jsonify({"error": str(error), "code": "VALIDATION_ERROR"}), 400
    raise error


@po_bp.get("", strict_slashes=False)
@po_bp.get("/", strict_slashes=False)
@require_role("office", "warehouse")
def get_purchase_orders():
    try:
        page = int(request.args.get("page", 1)); page_size = int(request.args.get("page_size", 20))
        if page < 1 or page_size < 1: raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Page and page_size must be positive integers", "code": "INVALID_PAGINATION"}), 400
    try:
        result = purchase_order_service.list_purchase_orders_service(
            page, page_size, request.args.get("status"), request.args.get("search", request.args.get("q")),
            g.current_user["role"]
        )
        return jsonify(result)
    except Exception as error:
        return _error(error)


@po_bp.get("/<int:po_id>")
@require_role("office", "warehouse")
def get_purchase_order_detail(po_id):
    try:
        return jsonify(purchase_order_service.get_purchase_order_detail_service(po_id, g.current_user["role"]))
    except Exception as error:
        return _error(error)


@po_bp.post("", strict_slashes=False)
@po_bp.post("/", strict_slashes=False)
@require_role("office")
def create_purchase_order():
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"provider_id", "items", "notes"})
        validate_required_fields(data, ("provider_id", "items"))
        result = purchase_order_service.create_purchase_order_service(data["provider_id"], data["items"], data.get("notes"), g.current_user["id"], key)
        return jsonify(result), 201
    except Exception as exc:
        return _error(exc)


@po_bp.put("/<int:po_id>")
@require_role("office")
def edit_purchase_order(po_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"provider_id", "items", "notes", "expected_revision"})
        validate_required_fields(data, ("provider_id", "items", "expected_revision"))
        result = purchase_order_service.edit_purchase_order_service(po_id, data["provider_id"], data["items"], data.get("notes"), data["expected_revision"], g.current_user["id"], key)
        return jsonify(result)
    except Exception as exc:
        return _error(exc)


@po_bp.post("/<int:po_id>/dispatch")
@require_role("office")
def dispatch_purchase_order(po_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision"}); validate_required_fields(data, ("expected_revision",))
        return jsonify(purchase_order_service.dispatch_purchase_order_service(po_id, data["expected_revision"], g.current_user["id"], key))
    except Exception as exc:
        return _error(exc)


@po_bp.post("/<int:po_id>/void")
@require_role("office")
def void_purchase_order(po_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision", "reason"}); validate_required_fields(data, ("expected_revision", "reason"))
        return jsonify(purchase_order_service.void_purchase_order_service(po_id, data["expected_revision"], data["reason"], g.current_user["id"], key))
    except Exception as exc:
        return _error(exc)


@po_bp.post("/<int:po_id>/receive")
@require_role("warehouse")
def receive_purchase_order(po_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision"}); validate_required_fields(data, ("expected_revision",))
        return jsonify(purchase_order_service.receive_purchase_order_service(po_id, data["expected_revision"], actor_id=g.current_user["id"], actor_name=g.current_user["display_name"], idempotency_key=key))
    except Exception as exc:
        return _error(exc)


@leave_order_bp.get("", strict_slashes=False)
@leave_order_bp.get("/", strict_slashes=False)
@require_role("office", "warehouse")
def get_leave_orders():
    try:
        result = leave_order_service.list_leave_orders_service(
            int(request.args.get("page", 1)), int(request.args.get("page_size", 20)),
            request.args.get("status"), request.args.get("search", request.args.get("q")), g.current_user["role"]
        )
        return jsonify(result)
    except Exception as error:
        return _error(error)


@leave_order_bp.get("/<int:order_id>")
@require_role("office", "warehouse")
def get_leave_order_detail(order_id):
    try:
        detail = leave_order_service.get_leave_order_detail_service(order_id)
        return jsonify(detail) if detail else (jsonify({"error": "Leave order not found", "code": "NOT_FOUND"}), 404)
    except Exception as error:
        return _error(error)


@leave_order_bp.get("/tickets/count")
@require_role("office", "warehouse")
def get_tickets_count():
    return jsonify({"count": leave_order_service.get_actionable_tickets_count_service(role=g.current_user["role"])})


@leave_order_bp.post("", strict_slashes=False)
@leave_order_bp.post("/", strict_slashes=False)
@require_role("office")
def create_leave_order():
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"employee_name", "destination_id", "items", "notes"})
        validate_required_fields(data, ("employee_name", "destination_id", "items"))
        result = leave_order_service.create_leave_order_service(data["employee_name"], data["destination_id"], data["items"], data.get("notes"), g.current_user["id"], g.current_user["display_name"], key)
        return jsonify(result), 201
    except Exception as exc:
        return _error(exc)


@tickets_bp.get("", strict_slashes=False)
@tickets_bp.get("/", strict_slashes=False)
@require_role("warehouse")
def get_tickets():
    try:
        result = leave_order_service.list_leave_orders_service(int(request.args.get("page", 1)), int(request.args.get("page_size", 20)), "open", request.args.get("search", request.args.get("q")), "warehouse")
        return jsonify({"tickets": result["leave_orders"], **{key: result[key] for key in ("total_count", "page", "page_size", "total_pages")}})
    except Exception as error:
        return _error(error)


@tickets_bp.get("/<int:ticket_id>")
@require_role("warehouse")
def get_ticket_detail(ticket_id):
    try:
        detail = leave_order_service.get_leave_order_detail_service(ticket_id)
        if not detail or detail["status"] != "open": return jsonify({"error": "Ticket not found", "code": "NOT_FOUND"}), 404
        return jsonify(detail)
    except Exception as error:
        return _error(error)


@tickets_bp.get("/count")
@require_role("warehouse")
def get_tickets_count_alias():
    return get_tickets_count()


@tickets_bp.post("/<int:ticket_id>/fulfill")
@require_role("warehouse")
def fulfill_ticket(ticket_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision"}); validate_required_fields(data, ("expected_revision",))
        return jsonify(leave_order_service.fulfill_leave_order_service(ticket_id, data["expected_revision"], g.current_user["id"], g.current_user["display_name"], key))
    except Exception as exc:
        return _error(exc)


@tickets_bp.post("/<int:ticket_id>/reject")
@require_role("warehouse")
def reject_ticket(ticket_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision", "reason"}); validate_required_fields(data, ("expected_revision", "reason"))
        return jsonify(leave_order_service.reject_leave_order_service(ticket_id, data["expected_revision"], data["reason"], g.current_user["id"], key))
    except Exception as exc:
        return _error(exc)


@leave_order_bp.post("/<int:order_id>/resubmit")
@require_role("office")
def resubmit_leave_order(order_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision", "items", "notes"}); validate_required_fields(data, ("expected_revision",))
        return jsonify(leave_order_service.resubmit_leave_order_service(order_id, data["expected_revision"], g.current_user["id"], data.get("items"), data.get("notes"), key))
    except Exception as exc:
        return _error(exc)


@leave_order_bp.post("/<int:order_id>/cancel")
@require_role("office")
def cancel_leave_order(order_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision"}); validate_required_fields(data, ("expected_revision",))
        return jsonify(leave_order_service.cancel_leave_order_service(order_id, data["expected_revision"], g.current_user["id"], key))
    except Exception as exc:
        return _error(exc)


@leave_order_bp.post("/<int:order_id>/return")
@require_role("office")
def return_leave_order(order_id):
    data, error = _body()
    if error: return error
    key, error = _key_required()
    if error: return error
    try:
        validate_allowed_fields(data, {"expected_revision", "items", "notes"}); validate_required_fields(data, ("expected_revision", "items"))
        return jsonify(leave_order_service.process_ticket_return_service(order_id, data["expected_revision"], data["items"], g.current_user["id"], g.current_user["display_name"], data.get("notes"), key))
    except Exception as exc:
        return _error(exc)


@tickets_bp.post("/<int:ticket_id>/return")
@require_role("office")
def return_ticket_items(ticket_id):
    return return_leave_order(ticket_id)
