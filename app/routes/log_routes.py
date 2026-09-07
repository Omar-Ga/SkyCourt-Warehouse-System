from flask import Blueprint, request, jsonify
from app.models import movement_log_model
from app.auth import require_role
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('logs', __name__, url_prefix='/api/movement-logs')

@bp.route('', methods=['GET'], strict_slashes=False)
@bp.route('/', methods=['GET'], strict_slashes=False)
@require_role('office', 'warehouse')
def get_movement_logs_route():

        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)
        
        # Basic validation for page and page_size
        if page < 1: page = 1
        if page_size < 1: page_size = 10
        if page_size > 200: page_size = 200 # Max page size

        filters = {}
        item_id = request.args.get('item_id')
        if item_id:
            filters['item_id'] = int(item_id)
        
        action_type = request.args.get('action_type')
        if action_type: # Model handles comma-separated list
            filters['action_type'] = action_type
        
        provider_id = request.args.get('provider_id')
        if provider_id:
            filters['provider_id'] = int(provider_id)
            
        destination_id = request.args.get('destination_id')
        if destination_id:
            filters['destination_id'] = int(destination_id)
        
        date_from = request.args.get('date_from')
        if date_from:
            try:
                datetime.strptime(date_from, '%Y-%m-%d')
                filters['date_from'] = date_from
            except ValueError:
                return jsonify({"error": "Invalid date_from format. Must be YYYY-MM-DD."}), 400

        date_to = request.args.get('date_to')
        if date_to:
            try:
                datetime.strptime(date_to, '%Y-%m-%d')
                filters['date_to'] = date_to
            except ValueError:
                return jsonify({"error": "Invalid date_to format. Must be YYYY-MM-DD."}), 400

        result = movement_log_model.get_movement_logs(filters=filters, page=page, page_size=page_size)

        if isinstance(result, dict) and "error" in result:
            return jsonify({'error': 'Failed to retrieve movement logs', 'details': result['error']}), 500

        return jsonify(result), 200
            
 

@bp.route('/all_filtered', methods=['GET'])
@require_role('office', 'warehouse')
def get_all_filtered_movement_logs():

        filters = {}
        item_id = request.args.get('item_id')
        if item_id:
            try:
                filters['item_id'] = int(item_id)
            except ValueError:
                return jsonify({"error": "Invalid item_id format. Must be an integer."}), 400
        
        action_type = request.args.get('action_type')
        if action_type:
            filters['action_type'] = action_type
        
        provider_id = request.args.get('provider_id')
        if provider_id:
            try:
                filters['provider_id'] = int(provider_id)
            except ValueError:
                return jsonify({"error": "Invalid provider_id format. Must be an integer."}), 400
            
        destination_id = request.args.get('destination_id')
        if destination_id:
            try:
                filters['destination_id'] = int(destination_id)
            except ValueError:
                return jsonify({"error": "Invalid destination_id format. Must be an integer."}), 400
            
        date_from = request.args.get('date_from')
        if date_from:
            try:
                datetime.strptime(date_from, '%Y-%m-%d')
                filters['date_from'] = date_from
            except ValueError:
                return jsonify({"error": "Invalid date_from format. Must be YYYY-MM-DD."}), 400

        date_to = request.args.get('date_to')
        if date_to:
            try:
                datetime.strptime(date_to, '%Y-%m-%d')
                filters['date_to'] = date_to
            except ValueError:
                return jsonify({"error": "Invalid date_to format. Must be YYYY-MM-DD."}), 400

        all_logs = movement_log_model.get_movement_logs(filters=filters, page=None, page_size=None)

        if isinstance(all_logs, dict) and 'error' in all_logs:
            return jsonify({'error': 'Failed to retrieve movement logs', 'details': all_logs.get('error', '')}), 500

        if isinstance(all_logs, dict) and 'logs' in all_logs:
            return jsonify(all_logs['logs']), 200

        return jsonify({'error': 'Failed to retrieve movement logs'}), 500
            


@bp.route('/summary/today', methods=['GET'])
@require_role('office', 'warehouse')
def get_daily_summary_route():
    """API endpoint to get a summary of today's movements."""
    summary = movement_log_model.get_daily_movement_summary()
    if 'error' in summary:
        return jsonify({"error": "Failed to retrieve daily summary", "details": summary.get("error")}), 500

    return jsonify(summary), 200 