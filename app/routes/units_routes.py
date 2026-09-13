from flask import Blueprint, request, jsonify, g
from app.models import unit_model
from app.models.db_utils import get_db
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    IdempotencyError
)
from sqlite3 import IntegrityError
from app.auth import require_role
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('units_routes', __name__, url_prefix='/api/units')

@bp.route('', methods=['POST'], strict_slashes=False)
@bp.route('/', methods=['POST'], strict_slashes=False)
@require_role('warehouse')
def create_unit():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Unit name is required.'}), 400
    
    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Unit name cannot be empty.'}), 400

    idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
    db = get_db()
    actor_id = g.current_user["id"] if hasattr(g, "current_user") and g.current_user else None

    try:
        if idempotency_key:
            req_hash = compute_request_hash(data)
            res = reserve_operation(
                conn=db,
                operation_key=idempotency_key,
                operation_type="create_unit",
                actor_id=actor_id,
                request_hash=req_hash
            )
            if res.get("replayed"):
                return jsonify(res["response_body"]), res["response_status"]

        new_unit = unit_model.add_unit(name, db=db)
        if new_unit:
            if idempotency_key:
                complete_operation(db, idempotency_key, 201, new_unit)
            db.commit()
            return jsonify(new_unit), 201
        else:
            db.rollback()
            return jsonify({'error': 'Failed to create unit.'}), 500
    except IdempotencyError as e:
        db.rollback()
        return jsonify(e.to_dict()), e.status_code
    except ValueError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    except IntegrityError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 409
    except Exception as e:
        db.rollback()
        raise e

@bp.route('', methods=['GET'], strict_slashes=False)
@bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_units():
    logger.debug("GET /api/units/ received")
    units = unit_model.get_all_units()
    logger.debug(f"Returning {len(units)} units")
    return jsonify(units), 200

@bp.route('/<int:unit_id>', methods=['GET'])
@require_role('office', 'warehouse')
def get_unit(unit_id):
    unit = unit_model.get_unit_by_id(unit_id)
    if unit:
        return jsonify(unit), 200
    else:
        return jsonify({'error': 'Unit not found.'}), 404

@bp.route('/<int:unit_id>', methods=['PUT'])
@require_role('warehouse')
def update_unit_route(unit_id):
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'New unit name is required.'}), 400

    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Unit name cannot be empty.'}), 400

    # Check if unit exists before attempting update
    if not unit_model.get_unit_by_id(unit_id):
        return jsonify({'error': 'Unit not found.'}), 404

    updated_unit = unit_model.update_unit(unit_id, name)
    if updated_unit:
        return jsonify(updated_unit), 200
    else:
        # This could be due to a duplicate name (IntegrityError) or other DB issue
        return jsonify({'error': f"Failed to update unit. A unit with name '{name}' might already exist or a database error occurred."}), 409 # 409 Conflict

@bp.route('/<int:unit_id>', methods=['DELETE'])
@require_role('warehouse')
def delete_unit_route(unit_id):
    # Check if unit exists
    unit = unit_model.get_unit_by_id(unit_id)
    if not unit:
        return jsonify({'error': 'Unit not found.'}), 404

    # Check if unit is in use (PRD FR6.5)
    if unit_model.is_unit_in_use(unit_id):
        return jsonify({'error': 'Cannot delete unit. It is currently in use by one or more items.'}), 409 # Conflict

    if unit_model.delete_unit(unit_id):
        return jsonify({'message': 'Unit deleted successfully.'}), 200
    else:
        return jsonify({'error': 'Failed to delete unit due to a database error.'}), 500 