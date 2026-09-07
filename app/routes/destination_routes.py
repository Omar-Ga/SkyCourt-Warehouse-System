from flask import Blueprint, request, jsonify
from app.models import destination_model
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

    new_destination = destination_model.add_destination(name)
    if new_destination:
        return jsonify(new_destination), 201
    else:
        return jsonify({'error': f"Failed to create destination. A destination with name '{name}' might already exist."}), 409

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