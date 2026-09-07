"""
Order route endpoints for SkyCourt Warehouse System.
Provides route endpoints for purchase orders, leave orders, and tickets with full role enforcement
per the authorization matrix.
"""
import logging
from flask import Blueprint, jsonify, request, g

from app.auth import require_role
from app.services import leave_order_service, purchase_order_service
from app.services.idempotency_service import IdempotencyError
from app.validation import (
    ValidationError,
    validate_allowed_fields,
    validate_required_fields
)

logger = logging.getLogger(__name__)

po_bp = Blueprint("purchase_orders_bp", __name__, url_prefix="/api/purchase-orders")
leave_order_bp = Blueprint("leave_orders_bp", __name__, url_prefix="/api/leave-orders")
tickets_bp = Blueprint("tickets_bp", __name__, url_prefix="/api/tickets")


# --- Purchase Orders Matrix ---
@po_bp.route("", methods=["GET"], strict_slashes=False)
@po_bp.route("/", methods=["GET"], strict_slashes=False)
@require_role("office", "warehouse")
def get_purchase_orders():
    """Lists purchase orders with filtering and pagination."""
    raw_page = request.args.get("page", default=1)
    raw_page_size = request.args.get("page_size", default=20)
    try:
        page = int(raw_page)
        page_size = int(raw_page_size)
        if page < 1 or page_size < 1:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "Page and page_size must be positive integers", "code": "INVALID_PAGINATION"}), 400

    status = request.args.get("status", default=None, type=str)
    search = request.args.get("search", default=request.args.get("q", None), type=str)
    role = g.current_user["role"] if getattr(g, "current_user", None) else None

    result = purchase_order_service.list_purchase_orders_service(
        page=page,
        page_size=page_size,
        status=status,
        search=search,
        role=role
    )
    return jsonify(result), 200


@po_bp.route("/<int:po_id>", methods=["GET"])
@require_role("office", "warehouse")
def get_purchase_order_detail(po_id):
    """Retrieves purchase order detail by ID."""
    role = g.current_user["role"] if getattr(g, "current_user", None) else None
    try:
        detail = purchase_order_service.get_purchase_order_detail_service(po_id, role=role)
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    return jsonify(detail), 200


@po_bp.route("/by-barcode/<string:barcode_val>", methods=["GET"])
@require_role("office", "warehouse")
def get_purchase_order_by_barcode(barcode_val):
    """Retrieves purchase order detail by barcode."""
    role = g.current_user["role"] if getattr(g, "current_user", None) else None
    try:
        detail = purchase_order_service.get_purchase_order_by_barcode_service(barcode_val, role=role)
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    return jsonify(detail), 200


@po_bp.route("/<int:po_id>/barcode", methods=["GET"])
@require_role("office", "warehouse")
def get_purchase_order_barcode(po_id):
    """Returns barcode for a purchase order."""
    try:
        result = purchase_order_service.get_purchase_order_barcode_service(po_id)
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    return jsonify(result), 200


@po_bp.route("", methods=["POST"], strict_slashes=False)
@po_bp.route("/", methods=["POST"], strict_slashes=False)
@require_role("office")
def create_purchase_order():
    """Creates a new purchase order (Office only)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key or not str(idempotency_key).strip():
        return jsonify({"error": "Idempotency-Key header is required", "code": "MISSING_IDEMPOTENCY_KEY"}), 400

    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None

    try:
        order = purchase_order_service.create_purchase_order_service(
            provider_id=data.get("provider_id"),
            items=data.get("items"),
            notes=data.get("notes"),
            actor_id=actor_id,
            idempotency_key=idempotency_key
        )
    except ValidationError as e:
        return jsonify(e.to_dict()), 400
    return jsonify(order), 201


@po_bp.route("/<int:po_id>/void", methods=["POST"])
@require_role("office")
def void_purchase_order(po_id):
    """Voids an open purchase order (Office only)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None

    try:
        updated_order = purchase_order_service.void_purchase_order_service(
            po_id=po_id,
            expected_revision=data.get("expected_revision"),
            reason=data.get("reason"),
            actor_id=actor_id,
            idempotency_key=idempotency_key
        )
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    return jsonify(updated_order), 200



@po_bp.route("/<int:po_id>/receive", methods=["POST"])
@require_role("warehouse")
def receive_purchase_order(po_id):
    """Receives items for a purchase order (Warehouse only)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    try:
        validate_allowed_fields(data, {"expected_revision", "items"})
        validate_required_fields(data, ["expected_revision", "items"])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key or not str(idempotency_key).strip():
        return jsonify({"error": "Idempotency-Key header is required", "code": "MISSING_IDEMPOTENCY_KEY"}), 400

    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None
    actor_name = actor["display_name"] if actor else None
    if not actor_id:
        return jsonify({"error": "غير مصرح به. يرجى تسجيل الدخول.", "code": "UNAUTHENTICATED"}), 401

    try:
        updated_order = purchase_order_service.receive_purchase_order_service(
            po_id=po_id,
            expected_revision=data.get("expected_revision"),
            items=data.get("items"),
            actor_id=actor_id,
            actor_name=actor_name,
            idempotency_key=idempotency_key
        )
        return jsonify(updated_order), 200
    except ValidationError as e:
        status_code = 404 if e.code in ("NOT_FOUND", "ITEM_NOT_FOUND") else 400
        return jsonify(e.to_dict()), status_code
    except IdempotencyError as e:
        return jsonify(e.to_dict()), e.status_code
    except ValueError as e:
        return jsonify({"error": str(e), "code": "VALIDATION_ERROR"}), 400
    except Exception as e:
        logger.error(f"Error receiving purchase order {po_id}: {e}")
        raise e



# --- Leave Orders Matrix ---

@leave_order_bp.route("", methods=["GET"], strict_slashes=False)
@leave_order_bp.route("/", methods=["GET"], strict_slashes=False)
@require_role("office", "warehouse")
def get_leave_orders():
    """Lists leave orders with filtering and pagination."""
    raw_page = request.args.get("page", default=1)
    raw_page_size = request.args.get("page_size", default=20)
    try:
        page = int(raw_page)
        page_size = int(raw_page_size)
        if page < 1 or page_size < 1:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "Page and page_size must be positive integers", "code": "INVALID_PAGINATION"}), 400

    status = request.args.get("status", default=None, type=str)
    search = request.args.get("search", default=request.args.get("q", None), type=str)

    result = leave_order_service.list_leave_orders_service(
        page=page,
        page_size=page_size,
        status=status,
        search=search
    )
    return jsonify(result), 200


@leave_order_bp.route("/<int:order_id>", methods=["GET"])
@require_role("office", "warehouse")
def get_leave_order_detail(order_id):
    """Retrieves leave order detail by ID."""
    try:
        detail = leave_order_service.get_leave_order_detail_service(order_id)
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    if not detail:
        return jsonify({"error": f"Leave order with ID {order_id} not found", "code": "NOT_FOUND"}), 404
    return jsonify(detail), 200


@leave_order_bp.route("/tickets/count", methods=["GET"])
@require_role("office", "warehouse")
def get_tickets_count():
    """Retrieves count of actionable tickets (open + partially_returned)."""
    count = leave_order_service.get_actionable_tickets_count_service()
    return jsonify({"count": count}), 200


@leave_order_bp.route("", methods=["POST"], strict_slashes=False)
@leave_order_bp.route("/", methods=["POST"], strict_slashes=False)
@require_role("warehouse")
def create_leave_order():
    """Creates a new leave order (Warehouse only)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key or not str(idempotency_key).strip():
        return jsonify({"error": "Idempotency-Key header is required", "code": "MISSING_IDEMPOTENCY_KEY"}), 400

    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None
    actor_name = actor["display_name"] if actor else None

    try:
        order = leave_order_service.create_leave_order_service(
            employee_name=data.get("employee_name"),
            destination_id=data.get("destination_id"),
            items=data.get("items"),
            notes=data.get("notes"),
            actor_id=actor_id,
            actor_name=actor_name,
            idempotency_key=idempotency_key
        )
        return jsonify(order), 201
    except ValidationError as e:
        return jsonify(e.to_dict()), 400
    except IdempotencyError as e:
        return jsonify(e.to_dict()), e.status_code
    except ValueError as e:
        return jsonify({"error": str(e), "code": "VALIDATION_ERROR"}), 400
    except Exception as e:
        logger.error(f"Error creating leave order: {e}")
        raise e


@leave_order_bp.route("/<int:order_id>/close", methods=["POST"])
@require_role("office", "warehouse")
def close_leave_order(order_id):
    """Manually closes a leave order with disposition reason (Office or Warehouse)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None
    if not actor_id:
        return jsonify({"error": "غير مصرح به. يرجى تسجيل الدخول.", "code": "UNAUTHENTICATED"}), 401

    try:
        updated = leave_order_service.close_leave_order_service(
            order_id=order_id,
            closed_by=actor_id,
            reason=data.get("reason"),
            expected_revision=data.get("expected_revision"),
            idempotency_key=idempotency_key
        )
        return jsonify(updated), 200
    except ValidationError as e:
        status_code = 404 if e.code == "NOT_FOUND" else 400
        return jsonify(e.to_dict()), status_code
    except IdempotencyError as e:
        return jsonify(e.to_dict()), e.status_code
    except ValueError as e:
        return jsonify({"error": str(e), "code": "VALIDATION_ERROR"}), 400
    except Exception as e:
        logger.error(f"Error closing leave order: {e}")
        raise e


# --- Tickets Matrix ---

@tickets_bp.route("", methods=["GET"], strict_slashes=False)
@tickets_bp.route("/", methods=["GET"], strict_slashes=False)
@require_role("office", "warehouse")
def get_tickets():
    """Lists actionable tickets with pagination."""
    raw_page = request.args.get("page", default=1)
    raw_page_size = request.args.get("page_size", default=20)
    try:
        page = int(raw_page)
        page_size = int(raw_page_size)
        if page < 1 or page_size < 1:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "Page and page_size must be positive integers", "code": "INVALID_PAGINATION"}), 400

    status = request.args.get("status", default="actionable", type=str)
    search = request.args.get("search", default=request.args.get("q", None), type=str)

    result = leave_order_service.list_leave_orders_service(
        page=page,
        page_size=page_size,
        status=status,
        search=search
    )
    return jsonify({
        "tickets": result["leave_orders"],
        "total_count": result["total_count"],
        "page": result["page"],
        "page_size": result["page_size"],
        "total_pages": result["total_pages"]
    }), 200


@tickets_bp.route("/<int:ticket_id>", methods=["GET"])
@require_role("office", "warehouse")
def get_ticket_detail(ticket_id):
    """Retrieves ticket detail by leave order ID."""
    try:
        detail = leave_order_service.get_leave_order_detail_service(ticket_id)
    except ValidationError as e:
        return jsonify(e.to_dict()), 404 if e.code == "NOT_FOUND" else 400
    if not detail:
        return jsonify({"error": f"Ticket with ID {ticket_id} not found", "code": "NOT_FOUND"}), 404
    return jsonify(detail), 200


@tickets_bp.route("/count", methods=["GET"])
@require_role("office", "warehouse")
def get_tickets_count_alias():
    """Retrieves count of actionable tickets (open + partially_returned)."""
    return get_tickets_count()


@tickets_bp.route("/<int:ticket_id>/return", methods=["POST"])
@require_role("office")
def return_ticket_items(ticket_id):
    """Processes returns on a ticket (Office only)."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object", "code": "INVALID_OBJECT_SHAPE"}), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key or not str(idempotency_key).strip():
        return jsonify({"error": "Idempotency-Key header is required", "code": "MISSING_IDEMPOTENCY_KEY"}), 400

    actor = getattr(g, "current_user", None)
    actor_id = actor["id"] if actor else None
    actor_name = actor["display_name"] if actor else None
    if not actor_id:
        return jsonify({"error": "غير مصرح به. يرجى تسجيل الدخول.", "code": "UNAUTHENTICATED"}), 401

    try:
        updated = leave_order_service.process_ticket_return_service(
            order_id=ticket_id,
            expected_revision=data.get("expected_revision"),
            items=data.get("items"),
            actor_id=actor_id,
            actor_name=actor_name,
            notes=data.get("notes"),
            idempotency_key=idempotency_key
        )
        return jsonify(updated), 200
    except ValidationError as e:
        status_code = 404 if e.code == "NOT_FOUND" else 400
        return jsonify(e.to_dict()), status_code
    except IdempotencyError as e:
        return jsonify(e.to_dict()), e.status_code
    except ValueError as e:
        return jsonify({"error": str(e), "code": "VALIDATION_ERROR"}), 400
    except Exception as e:
        logger.error(f"Error returning ticket items: {e}")
        raise e


@tickets_bp.route("/<int:ticket_id>/close", methods=["POST"])
@require_role("office", "warehouse")
def close_ticket(ticket_id):
    """Closes a ticket with disposition reason (Office or Warehouse)."""
    return close_leave_order(ticket_id)


@leave_order_bp.route("/<int:order_id>/return", methods=["POST"])
@require_role("office")
def return_leave_order(order_id):
    """Alias for ticket return on leave-orders prefix (Office only)."""
    return return_ticket_items(order_id)

