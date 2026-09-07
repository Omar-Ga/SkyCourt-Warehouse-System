from flask import Blueprint, request, jsonify
from app.models import provider_model
from app.auth import require_role

bp = Blueprint('providers', __name__, url_prefix='/api/providers')

@bp.route('', methods=['GET'], strict_slashes=False)
@bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_providers():
    """Returns a list of all providers."""
    providers = provider_model.get_all_providers()
    return jsonify(providers), 200

@bp.route('', methods=['POST'], strict_slashes=False)
@bp.route('/', methods=['POST'], strict_slashes=False)
@require_role('warehouse')
def add_provider():
    """Adds a new provider."""
    data = request.get_json()
    if not data or 'name' not in data or not data['name'].strip():
        return jsonify({'error': 'Provider name is required.'}), 400
    
    name = data['name'].strip()
    new_provider = provider_model.add_provider(name)
    return jsonify(new_provider), 201

@bp.route('/<int:provider_id>', methods=['PUT'])
@require_role('warehouse')
def update_provider(provider_id):
    """Updates an existing provider's name."""
    data = request.get_json()
    if not data or 'name' not in data or not data['name'].strip():
        return jsonify({'error': 'Provider name is required.'}), 400
        
    name = data['name'].strip()
    updated_provider = provider_model.update_provider(provider_id, name)
    if updated_provider is None:
        return jsonify({'error': 'Provider not found.'}), 404
    return jsonify(updated_provider), 200

@bp.route('/<int:provider_id>', methods=['DELETE'])
@require_role('warehouse')
def delete_provider(provider_id):
    """Deletes a provider."""
    if provider_model.is_provider_in_use(provider_id):
        return jsonify({'error': 'Cannot delete provider. It is currently in use.'}), 409

    if provider_model.delete_provider(provider_id):
        return jsonify({'message': 'Provider deleted successfully.'}), 200
    else:
        return jsonify({'error': 'Provider not found.'}), 404 