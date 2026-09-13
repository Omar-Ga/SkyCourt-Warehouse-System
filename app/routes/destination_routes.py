from flask import Blueprint, request, jsonify, g
from app.models import destination_model
from app.models.db_utils import get_db
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    IdempotencyError
)
from sqlite3 import IntegrityError
from app.auth import require_role

bp = Blueprint('destination_routes', __name__, url_prefix='/api/destinations')

@bp.route('', methods=['POST'], strict_slashes=False)
@bp.route('/', methods=['POST'], strict_slashes=False)
@require_role('warehouse')
def create_destination():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Destination name is required.'}), 400
    
    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Destination name cannot be empty.'}), 400

    idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
    db = get_db()
    actor_id = g.current_user["id"] if hasattr(g, "current_user") and g.current_user else None

    try:
        if idempotency_key:
            req_hash = compute_request_hash(data)
            res = reserve_operation(
                conn=db,
                operation_key=idempotency_key,
                operation_type="create_destination",
                actor_id=actor_id,
                request_hash=req_hash
            )
            if res.get("replayed"):
                return jsonify(res["response_body"]), res["response_status"]

        new_destination = destination_model.add_destination(name, db=db)
        if new_destination:
            if idempotency_key:
                complete_operation(db, idempotency_key, 201, new_destination)
            db.commit()
            return jsonify(new_destination), 201
        else:
            db.rollback()
            return jsonify({'error': f"Failed to create destination. A destination with name '{name}' might already exist."}), 409
    except IdempotencyError as e:
        db.rollback()
        return jsonify(e.to_dict()), e.status_code
    except IntegrityError as e:
        db.rollback()
        return jsonify({'error': f"Failed to create destination. A destination with name '{name}' might already exist."}), 409
    except Exception as e:
        db.rollback()
        raise e

@bp.route('', methods=['GET'], strict_slashes=False)
@bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_destinations():
    destinations = destination_model.get_all_destinations()
    return jsonify(destinations), 200

@bp.route('/<int:destination_id>', methods=['PUT'])
@require_role('warehouse')
def update_destination_route(destination_id):
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'New destination name is required.'}), 400

    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Destination name cannot be empty.'}), 400

    if not destination_model.get_destination_by_id(destination_id):
        return jsonify({'error': 'Destination not found.'}), 404

    updated_destination = destination_model.update_destination(destination_id, name)
    if updated_destination:
        return jsonify(updated_destination), 200
    else:
        return jsonify({'error': f"Failed to update destination. A destination with name '{name}' might already exist."}), 409

@bp.route('/<int:destination_id>', methods=['DELETE'])
@require_role('warehouse')
def delete_destination_route(destination_id):
    if not destination_model.get_destination_by_id(destination_id):
        return jsonify({'error': 'Destination not found.'}), 404

    if destination_model.is_destination_in_use(destination_id):
        return jsonify({'error': 'Cannot delete destination. It is currently in use by one or more movement logs.'}), 409

    if destination_model.delete_destination(destination_id):
        return jsonify({'message': 'Destination deleted successfully.'}), 200
    else:
        return jsonify({'error': 'Failed to delete destination due to a database error.'}), 500 