from flask import Blueprint, request, jsonify, g
from app.models import category_model
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

bp = Blueprint('category_routes', __name__, url_prefix='/api/categories')

@bp.route('', methods=['POST'], strict_slashes=False)
@bp.route('/', methods=['POST'], strict_slashes=False)
@require_role('warehouse')
def create_category():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Category name is required.'}), 400
    
    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Category name cannot be empty.'}), 400

    parent_id = data.get('parent_id')

    if parent_id is not None and parent_id != '':
        parent_id = int(parent_id)
    else:
        parent_id = None

    idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
    db = get_db()
    actor_id = g.current_user["id"] if hasattr(g, "current_user") and g.current_user else None

    try:
        if idempotency_key:
            req_hash = compute_request_hash(data)
            res = reserve_operation(
                conn=db,
                operation_key=idempotency_key,
                operation_type="create_category",
                actor_id=actor_id,
                request_hash=req_hash
            )
            if res.get("replayed"):
                return jsonify(res["response_body"]), res["response_status"]

        new_category = category_model.add_category(name, parent_id, db=db)
        if new_category:
            if idempotency_key:
                complete_operation(db, idempotency_key, 201, new_category)
            db.commit()
            return jsonify(new_category), 201
        else:
            db.rollback()
            return jsonify({'error': 'Failed to create category.'}), 500
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

@bp.route('/<int:category_id>', methods=['GET'])
@require_role('office', 'warehouse')
def get_category(category_id):
    category = category_model.get_category_by_id(category_id)
    if category:
        return jsonify(category), 200
    return jsonify({'error': 'Category not found'}), 404

@bp.route('', methods=['GET'], strict_slashes=False)
@bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_categories_route():
    parent_id_str = request.args.get('parent_id')
    level = request.args.get('level')
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 10, type=int)

    parent_id = None
    main_categories_only = False

    if level == 'main':
        main_categories_only = True
    elif parent_id_str:
        parent_id = int(parent_id_str)
    

    result = category_model.get_categories(
        parent_id=parent_id, 
        main_categories_only=main_categories_only,
        page=page,
        page_size=page_size
    )
    
    if main_categories_only:
        return jsonify(result.get('categories', [])), 200
    else:
        return jsonify(result), 200



@bp.route('/<int:category_id>', methods=['PUT'])
@require_role('warehouse')
def update_category_route(category_id):
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'New category name is required.'}), 400

    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Category name cannot be empty.'}), 400

    if not category_model.get_category_by_id(category_id):
        return jsonify({'error': 'Category not found.'}), 404

    updated_category = category_model.update_category(category_id, name)
    
    if updated_category:
        
        full_category = category_model.get_category_by_id(category_id)
        return jsonify(full_category), 200
    else:
        return jsonify({'error': 'Failed to update category due to a database error.'}), 500

@bp.route('/<int:category_id>', methods=['DELETE'])
@require_role('warehouse')
def delete_category_route(category_id):
    if not category_model.get_category_by_id(category_id):
        return jsonify({'error': 'Category not found.'}), 404

    if category_model.is_category_in_use(category_id):
        return jsonify({'error': 'Cannot delete category. It is in use by items or has sub-categories.'}), 409

    if category_model.delete_category(category_id):
        return jsonify({'message': 'Category deleted successfully.'}), 200
    else:
        return jsonify({'error': 'Failed to delete category due to a database error.'}), 500 