import sqlite3
from datetime import datetime, date
from .db_utils import get_db

def add_log_entry(item_id, item_name, action_type, quantity_changed=None, resulting_quantity=None, provider_id=None, cost_per_item=None, details=None, person_name=None, destination_id=None, db=None):
    """
    Adds an entry to the movement_logs table using a provided DB connection.
    The calling function is responsible for commit/rollback.
    """
    if db is None:
        
        raise ValueError("A database connection must be provided to add_log_entry.")

    cursor = db.cursor()
    # Convert to string for LibSQL compatibility
    local_timestamp = datetime.now().isoformat()
    try:
        cursor.execute("""
            INSERT INTO movement_logs (
                item_id, item_name, action_type,
                quantity_changed, resulting_quantity,
                provider_id, cost_per_item, details,
                person_name, destination_id, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (item_id, item_name, action_type,
              quantity_changed, resulting_quantity,
              provider_id, cost_per_item, details, person_name, destination_id, local_timestamp))
        return True
    except Exception as e:
        print(f"Database error adding log entry for item {item_id}: {e}")
        
        raise e

def get_movement_logs(filters=None, page=1, page_size=50):
    """Retrieves movement logs with filtering and optional pagination."""
    db = get_db()
    cursor = db.cursor()
    logs_list = []
    
    base_query = """
        SELECT 
            ml.id, ml.item_id, ml.item_name, ml.action_type, ml.quantity_changed, 
            ml.resulting_quantity, p.name as provider, ml.cost_per_item, ml.details, 
            ml.person_name, ml.timestamp, d.name as destination_name
        FROM movement_logs ml
        LEFT JOIN destinations d ON ml.destination_id = d.id
        LEFT JOIN providers p ON ml.provider_id = p.id
    """
    count_query = "SELECT COUNT(*) FROM movement_logs ml"
    
    where_clauses = []
    params = []

    if filters:
        if filters.get('item_id'):
            where_clauses.append("ml.item_id = ?")
            params.append(filters['item_id'])
        if filters.get('action_type'):
            action_types = [action.strip() for action in filters['action_type'].split(',') if action.strip()]
            if action_types:
                placeholders = ', '.join('?' * len(action_types))
                where_clauses.append(f"ml.action_type IN ({placeholders})")
                params.extend(action_types)
        if filters.get('provider_id'):
            where_clauses.append("ml.provider_id = ?")
            params.append(filters['provider_id'])
        if filters.get('date_from'):
            try:
                datetime.strptime(filters['date_from'], '%Y-%m-%d')
                where_clauses.append("date(ml.timestamp) >= date(?)")
                params.append(filters['date_from'])
            except ValueError:
                print(f"Invalid date_from format: {filters['date_from']}. Should be YYYY-MM-DD.")
        if filters.get('date_to'):
            try:
                datetime.strptime(filters['date_to'], '%Y-%m-%d')
                where_clauses.append("date(ml.timestamp) <= date(?)")
                params.append(filters['date_to'])
            except ValueError:
                print(f"Invalid date_to format: {filters['date_to']}. Should be YYYY-MM-DD.")
        if filters.get('destination_id'):
            where_clauses.append("ml.destination_id = ?")
            params.append(filters['destination_id'])

    if where_clauses:
        base_query += " WHERE " + " AND ".join(where_clauses)
        count_query += " WHERE " + " AND ".join(where_clauses)

    base_query += " ORDER BY ml.timestamp DESC"
    
    try:
        if page is not None and page_size is not None:
            
            offset = (page - 1) * page_size
            paginated_query = base_query + " LIMIT ? OFFSET ?"
            query_params = params + [page_size, offset]
            
            cursor.execute(count_query, params)
            total_records = cursor.fetchone()[0]
            
            cursor.execute(paginated_query, query_params)
            logs = cursor.fetchall()
            for log_entry in logs:
                logs_list.append(dict(log_entry))
            
            return {
                "logs": logs_list,
                "total_records": total_records,
                "page": page,
                "page_size": page_size,
                "total_pages": (total_records + page_size - 1) // page_size
            }
        else:
            
            cursor.execute(base_query, params)
            logs = cursor.fetchall()
            for log_entry in logs:
                logs_list.append(dict(log_entry))
            
            return {"logs": logs_list}

    except Exception as e:
        print(f"Database error retrieving movement logs: {e}")
        
        return {"logs": [], "error": str(e), "total_records": 0, "page": page, "total_pages": 0}

def get_daily_movement_summary():
    """
    Calculates the total number of additions and withdrawals for the current day.
    """
    db = get_db()
    cursor = db.cursor()
    try:
        today_str = date.today().strftime("%Y-%m-%d")

        # Count additions today
        cursor.execute("""
            SELECT COUNT(*) 
            FROM movement_logs
            WHERE action_type = 'Addition' AND DATE(timestamp) = ?
        """, (today_str,))
        additions_today = cursor.fetchone()[0]

        # Count withdrawals today
        cursor.execute("""
            SELECT COUNT(*)
            FROM movement_logs
            WHERE action_type = 'Removal' AND DATE(timestamp) = ?
        """, (today_str,))
        withdrawals_today = cursor.fetchone()[0]
        
        return {
            "additions_today": additions_today,
            "withdrawals_today": withdrawals_today
        }

    except sqlite3.Error as e:
        print(f"Database error in get_daily_movement_summary: {e}")
        return {"additions_today": 0, "withdrawals_today": 0, "error": str(e)}
    except Exception as e:
        print(f"Unexpected error in get_daily_movement_summary: {e}")
        return {"additions_today": 0, "withdrawals_today": 0, "error": "An unexpected error occurred"} 