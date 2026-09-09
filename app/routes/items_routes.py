from flask import Blueprint, request, jsonify, g
import sqlite3
from sqlite3 import IntegrityError
import logging

from app.auth import require_role
from app.services import item_service
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    IdempotencyError
)
from app.models import item_model
from app.models.db_utils import (
    get_db,
    OfflineMutationGatedError,
    DatabaseUnavailableError
)
from app.validation import (
    ValidationError,
    validate_dict,
    validate_allowed_fields,
    validate_required_fields
)

logger = logging.getLogger(__name__)

items_bp = Blueprint('items_bp', __name__, url_prefix='/api/items')


@items_bp.route('', methods=['GET'], strict_slashes=False)
@items_bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_items_route():
    """
    Unified route for fetching items.
    Supports standard pagination (page, page_size) for tables.
    Supports offset/limit pagination and 'q' for react-select-async-paginate.
    Validates positive pagination parameters.
    """
    is_ranged_request = 'offset' in request.args

    if is_ranged_request:
        raw_offset = request.args.get('offset', type=int)
        raw_limit = request.args.get('limit', type=int)
        if ('offset' in request.args and raw_offset is None) or ('limit' in request.args and raw_limit is None):
            return jsonify({"error": "Offset and limit must be valid integers", "code": "INVALID_PAGINATION"}), 400
        offset = raw_offset if raw_offset is not None else 0
        limit = raw_limit if raw_limit is not None else 10
        if offset < 0 or limit < 1:
            return jsonify({"error": "Offset must be >= 0 and limit must be >= 1", "code": "INVALID_PAGINATION"}), 400
        search_term = request.args.get('q', None)
        page = (offset // limit) + 1
        page_size = limit
    else:
        raw_page = request.args.get('page', type=int)
        raw_page_size = request.args.get('page_size', type=int)
        if ('page' in request.args and raw_page is None) or ('page_size' in request.args and raw_page_size is None):
            return jsonify({"error": "Page and page_size must be valid integers", "code": "INVALID_PAGINATION"}), 400
        page = raw_page if raw_page is not None else 1
        page_size = raw_page_size if raw_page_size is not None else 10
        if page < 1 or page_size < 1:
            return jsonify({"error": "Page and page_size must be positive integers", "code": "INVALID_PAGINATION"}), 400
        search_term = request.args.get('search', None)

    sub_category_id = request.args.get('sub_category_id', None, type=int)

    data = item_model.get_items_paginated(page, page_size, search_term, sub_category_id)

    if is_ranged_request:
        return jsonify({
            "items": data.get("items", []),
            "total_count": data.get("total_count", 0)
        })

    return jsonify(data), 200


@items_bp.route('', methods=['POST'], strict_slashes=False)
@items_bp.route('/', methods=['POST'], strict_slashes=False)
@require_role('warehouse')
def add_item_route():
    """Handles adding a new item, with conflict detection and idempotency support."""
    data = request.get_json()
    try:
        validate_dict(data)
        validate_allowed_fields(data, {
            'name', 'unit_id', 'sub_category_id', 'initial_quantity',
            'provider_id', 'cost', 'person_name'
        })
        validate_required_fields(data, ['name', 'unit_id', 'sub_category_id', 'initial_quantity'])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    db = get_db()
    actor_id = g.current_user["id"] if hasattr(g, "current_user") and g.current_user else None
    actor_name = g.current_user["display_name"] if hasattr(g, "current_user") and g.current_user else None

    try:
        if idempotency_key:
            req_hash = compute_request_hash(data)
            res = reserve_operation(
                conn=db,
                operation_key=idempotency_key,
                operation_type="create_item",
                actor_id=actor_id,
                request_hash=req_hash
            )
            if res.get("replayed"):
                return jsonify(res["response_body"]), res["response_status"]

        name_str = data['name'].strip() if isinstance(data['name'], str) else data['name']
        new_item = item_service.add_item(
            name=name_str,
            unit_id=data['unit_id'],
            sub_category_id=data['sub_category_id'],
            quantity=data['initial_quantity'],
            provider_id=data.get('provider_id'),
            cost=data.get('cost'),
            person_name=data.get('person_name'),
            user_id=actor_id,
            actor_name=actor_name,
            operation_key=idempotency_key,
            db=db
        )

        if idempotency_key:
            complete_operation(db, idempotency_key, 201, new_item)

        db.commit()
        return jsonify(new_item), 201

    except IdempotencyError as e:
        db.rollback()
        return jsonify(e.to_dict()), e.status_code
    except ValidationError as e:
        db.rollback()
        return jsonify(e.to_dict()), 400
    except ValueError as e:
        db.rollback()
        name_val = str(data.get('name', '')).strip()
        item = item_model.get_item_by_name(name_val, db=db)
        if item and item.get('status') in ('inactive', 'archived'):
            return jsonify({"error": str(e), "type": "item_conflict", "item_id": item['id']}), 409
        return jsonify({"error": str(e), "code": "VALIDATION_ERROR"}), 400
    except IntegrityError as e:
        db.rollback()
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        db.rollback()
        raise e


@items_bp.route('/<int:item_id>/restore', methods=['PATCH'])
@require_role('warehouse')
def restore_item_route(item_id):
    """Restores an inactive or archived item."""
    data = request.get_json()
    try:
        validate_dict(data)
        validate_allowed_fields(data, {'sub_category_id', 'person_name'})
        validate_required_fields(data, ['sub_category_id'])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    try:
        actor = getattr(g, "current_user", None)
        actor_id = actor["id"] if actor else None
        actor_name = actor["display_name"] if actor else None
        restored_item = item_service.restore_item(
            item_id=item_id,
            sub_category_id=data['sub_category_id'],
            person_name=data.get('person_name'),
            user_id=actor_id,
            actor_name=actor_name
        )
        if restored_item:
            return jsonify(restored_item), 200
        return jsonify({"error": "Item not found"}), 404
    except ValidationError as e:
        return jsonify(e.to_dict()), 400
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@items_bp.route('/<int:item_id>/status', methods=['PATCH'])
@require_role('warehouse')
def update_item_status_route(item_id):
    """Updates an item's status."""
    data = request.get_json()
    try:
        validate_dict(data)
        validate_allowed_fields(data, {'status', 'person_name'})
        validate_required_fields(data, ['status'])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    try:
        actor = getattr(g, "current_user", None)
        actor_id = actor["id"] if actor else None
        actor_name = actor["display_name"] if actor else None
        updated_item = item_service.update_item_status(
            item_id=item_id,
            new_status=data['status'],
            person_name=data.get('person_name'),
            user_id=actor_id,
            actor_name=actor_name
        )
        if updated_item:
            return jsonify(updated_item), 200
        return jsonify({"error": "Item not found"}), 404
    except ValidationError as e:
        return jsonify(e.to_dict()), 400
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@items_bp.route('/<int:item_id>', methods=['PUT'])
@require_role('warehouse')
def update_item_route(item_id):
    """Updates an item's details."""
    data = request.get_json()
    try:
        validate_dict(data)
        validate_allowed_fields(data, {'name', 'unit_id', 'sub_category_id', 'person_name', 'force_unit_change'})
        validate_required_fields(data, ['name', 'unit_id'])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    try:
        actor = getattr(g, "current_user", None)
        actor_id = actor["id"] if actor else None
        actor_name = actor["display_name"] if actor else None
        updated_item = item_service.update_item(
            item_id=item_id,
            name=data['name'],
            unit_id=data['unit_id'],
            sub_category_id=data.get('sub_category_id'),
            person_name=data.get('person_name'),
            force_unit_change=data.get('force_unit_change', False),
            user_id=actor_id,
            actor_name=actor_name
        )

        if updated_item is None:
            return jsonify({"error": "Item not found"}), 404

        if isinstance(updated_item, dict) and updated_item.get('confirmation_required'):
            return jsonify({
                "error": updated_item['message'],
                "type": "UNIT_CHANGE_CONFIRMATION"
            }), 409

        return jsonify(updated_item), 200
    except ValidationError as e:
        return jsonify(e.to_dict()), 400
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except IntegrityError as e:
        return jsonify({"error": str(e)}), 409


@items_bp.route('/<int:item_id>/adjust', methods=['POST'])
@require_role('warehouse')
def adjust_item_quantity_route(item_id):
    """Adjusts an item's quantity with authoritative conditional updates and idempotency."""
    data = request.get_json()
    try:
        validate_dict(data)
        validate_allowed_fields(data, {'change_amount', 'adjustment_type', 'person_name', 'provider_id', 'cost', 'destination_id'})
        validate_required_fields(data, ['change_amount', 'adjustment_type'])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    idempotency_key = request.headers.get("Idempotency-Key")
    db = get_db()
    actor_id = g.current_user["id"] if hasattr(g, "current_user") and g.current_user else None
    actor_name = g.current_user["display_name"] if hasattr(g, "current_user") and g.current_user else None

    try:
        if idempotency_key:
            req_hash = compute_request_hash({"item_id": item_id, **data})
            res = reserve_operation(
                conn=db,
                operation_key=idempotency_key,
                operation_type="stock_adjustment",
                actor_id=actor_id,
                request_hash=req_hash
            )
            if res.get("replayed"):
                return jsonify(res["response_body"]), res["response_status"]

        result = item_service.record_quantity_adjustment(
            item_id=item_id,
            change_amount=data.get('change_amount'),
            adjustment_type=data.get('adjustment_type', ''),
            person_name=data.get('person_name'),
            provider_id=data.get('provider_id'),
            cost=data.get('cost'),
            destination_id=data.get('destination_id'),
            user_id=actor_id,
            actor_name=actor_name,
            operation_key=idempotency_key,
            db=db
        )

        if idempotency_key:
            complete_operation(db, idempotency_key, 200, result)

        db.commit()
        return jsonify(result), 200

    except (OfflineMutationGatedError, DatabaseUnavailableError) as e:
        db.rollback()
        raise e
    except (IdempotencyError,) as e:
        db.rollback()
        return jsonify(e.to_dict()), e.status_code
    except ValidationError as e:
        db.rollback()
        return jsonify(e.to_dict()), 400
    except (IntegrityError, sqlite3.IntegrityError) as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "STOCK_CONFLICT"}), 409
    except ValueError as e:
        db.rollback()
        err_msg = str(e)
        if "hrana:" in err_msg.lower() and any(term in err_msg.lower() for term in (
            "api error", "host not found", "stream closed", "stream error",
            "connection refused", "connection reset", "status=50", "status=404", "unreachable"
        )):
            raise DatabaseUnavailableError(f"Cloud database connection failure: {err_msg}") from e
        if "does not exist" in err_msg:
            return jsonify({"error": err_msg, "code": "NOT_FOUND"}), 404
        if "Insufficient stock" in err_msg or "cannot adjust quantity" in err_msg or "Cannot deduct stock" in err_msg:
            return jsonify({"error": err_msg, "code": "STOCK_CONFLICT"}), 409
        if "unique constraint" in err_msg.lower() or "check constraint" in err_msg.lower():
            return jsonify({"error": err_msg, "code": "STOCK_CONFLICT"}), 409
        return jsonify({"error": err_msg, "code": "STOCK_ADJUSTMENT_ERROR"}), 400
    except Exception as e:
        db.rollback()
        raise e


@items_bp.route('/<int:item_id>', methods=['GET'])
@require_role('office', 'warehouse')
def get_item_by_id_route(item_id):
    """Gets a single item by its ID."""
    item = item_model.get_item_by_id(item_id)
    if item:
        return jsonify(item), 200
    return jsonify({'error': 'Item not found'}), 404


@items_bp.route('/<int:item_id>/location', methods=['GET'])
@require_role('office', 'warehouse')
def get_item_location_route(item_id):
    """Calculates the page number and position of an item within its sub-category."""
    sub_category_id = request.args.get('sub_category_id', type=int)
    page_size = request.args.get('page_size', 10, type=int)

    if not sub_category_id:
        return jsonify({"error": "sub_category_id is required"}), 400

    position = item_model.get_item_position(item_id, sub_category_id)
    page = (position + page_size - 1) // page_size if page_size > 0 else 1

    return jsonify({
        "item_id": item_id,
        "sub_category_id": sub_category_id,
        "position": position,
        "page": page,
        "page_size": page_size
    }), 200
