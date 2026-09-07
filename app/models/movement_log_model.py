import logging
import sqlite3
import zoneinfo
from datetime import datetime, date, timezone, time, timedelta
from typing import Optional, Any
from .db_utils import get_db

logger = logging.getLogger(__name__)
CAIRO_TZ = zoneinfo.ZoneInfo("Africa/Cairo")


def add_log_entry(
    item_id: int,
    item_name: str,
    action_type: str,
    quantity_changed: Optional[int] = None,
    resulting_quantity: Optional[int] = None,
    provider_id: Optional[int] = None,
    cost_per_item: Optional[float] = None,
    details: Optional[str] = None,
    person_name: Optional[str] = None,
    destination_id: Optional[int] = None,
    db: Optional[Any] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None,
    operation_key: Optional[str] = None,
    po_line_id: Optional[int] = None,
    leave_line_id: Optional[int] = None,
    return_event_id: Optional[int] = None,
    unit_name: Optional[str] = None
) -> bool:
    """
    Adds an entry to the movement_logs table using a caller-provided DB connection.
    The caller is strictly responsible for commit/rollback.
    """
    if db is None:
        raise ValueError("A database connection must be provided to add_log_entry.")

    cursor = db.cursor()
    utc_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")

    try:
        cursor.execute("""
            INSERT INTO movement_logs (
                item_id, item_name, action_type,
                quantity_changed, resulting_quantity,
                provider_id, cost_per_item, details,
                person_name, destination_id, timestamp,
                user_id, actor_name, operation_key,
                po_line_id, leave_line_id, return_event_id, unit_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            item_id, item_name, action_type,
            quantity_changed, resulting_quantity,
            provider_id, cost_per_item, details,
            person_name, destination_id, utc_timestamp,
            user_id, actor_name, operation_key,
            po_line_id, leave_line_id, return_event_id, unit_name
        ))
        return True
    except Exception as e:
        logger.error(f"Database error adding log entry for item {item_id}: {e}")
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
            ml.person_name, ml.timestamp, d.name as destination_name,
            ml.user_id, ml.actor_name, ml.operation_key, ml.unit_name,
            ml.po_line_id, ml.leave_line_id, ml.return_event_id
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
        date_from_val = filters.get('date_from')
        date_to_val = filters.get('date_to')
        if date_from_val and date_to_val:
            try:
                date_from_dt = datetime.strptime(date_from_val, '%Y-%m-%d').date()
                date_to_dt = datetime.strptime(date_to_val, '%Y-%m-%d').date()
                start_cairo = datetime.combine(date_from_dt, time.min, tzinfo=CAIRO_TZ)
                next_day_cairo = datetime.combine(date_to_dt + timedelta(days=1), time.min, tzinfo=CAIRO_TZ)
                start_utc_str = start_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                next_day_utc_str = next_day_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                where_clauses.append("""(
                    ((ml.user_id IS NULL AND ml.actor_name IS NULL AND ml.timestamp NOT LIKE '%Z' AND ml.timestamp NOT LIKE '%+00%')
                     AND SUBSTR(REPLACE(ml.timestamp, 'T', ' '), 1, 10) >= ?
                     AND SUBSTR(REPLACE(ml.timestamp, 'T', ' '), 1, 10) <= ?)
                    OR
                    ((ml.user_id IS NOT NULL OR ml.actor_name IS NOT NULL OR ml.timestamp LIKE '%Z' OR ml.timestamp LIKE '%+00%')
                     AND REPLACE(REPLACE(ml.timestamp, 'T', ' '), 'Z', '') >= ?
                     AND REPLACE(REPLACE(ml.timestamp, 'T', ' '), 'Z', '') < ?)
                )""")
                params.extend([date_from_val, date_to_val, start_utc_str, next_day_utc_str])
            except ValueError:
                logger.warning(f"Invalid date format in filters: {date_from_val} to {date_to_val}")
        elif date_from_val:
            try:
                date_from_dt = datetime.strptime(date_from_val, '%Y-%m-%d').date()
                start_cairo = datetime.combine(date_from_dt, time.min, tzinfo=CAIRO_TZ)
                start_utc_str = start_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                where_clauses.append("""(
                    ((ml.user_id IS NULL AND ml.actor_name IS NULL AND ml.timestamp NOT LIKE '%Z' AND ml.timestamp NOT LIKE '%+00%')
                     AND SUBSTR(REPLACE(ml.timestamp, 'T', ' '), 1, 10) >= ?)
                    OR
                    ((ml.user_id IS NOT NULL OR ml.actor_name IS NOT NULL OR ml.timestamp LIKE '%Z' OR ml.timestamp LIKE '%+00%')
                     AND REPLACE(REPLACE(ml.timestamp, 'T', ' '), 'Z', '') >= ?)
                )""")
                params.extend([date_from_val, start_utc_str])
            except ValueError:
                logger.warning(f"Invalid date_from format: {date_from_val}")
        elif date_to_val:
            try:
                date_to_dt = datetime.strptime(date_to_val, '%Y-%m-%d').date()
                next_day_cairo = datetime.combine(date_to_dt + timedelta(days=1), time.min, tzinfo=CAIRO_TZ)
                next_day_utc_str = next_day_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                where_clauses.append("""(
                    ((ml.user_id IS NULL AND ml.actor_name IS NULL AND ml.timestamp NOT LIKE '%Z' AND ml.timestamp NOT LIKE '%+00%')
                     AND SUBSTR(REPLACE(ml.timestamp, 'T', ' '), 1, 10) <= ?)
                    OR
                    ((ml.user_id IS NOT NULL OR ml.actor_name IS NOT NULL OR ml.timestamp LIKE '%Z' OR ml.timestamp LIKE '%+00%')
                     AND REPLACE(REPLACE(ml.timestamp, 'T', ' '), 'Z', '') < ?)
                )""")
                params.extend([date_to_val, next_day_utc_str])
            except ValueError:
                logger.warning(f"Invalid date_to format: {date_to_val}")
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
            total_count = cursor.fetchone()[0]
            
            cursor.execute(paginated_query, query_params)
            logs = cursor.fetchall()
            for log_entry in logs:
                logs_list.append(dict(log_entry))
            
            return {
                "logs": logs_list,
                "total_count": total_count,
                "page": page,
                "page_size": page_size,
                "total_pages": (total_count + page_size - 1) // page_size if page_size > 0 else 0
            }
        else:
            cursor.execute(base_query, params)
            logs = cursor.fetchall()
            for log_entry in logs:
                logs_list.append(dict(log_entry))
            
            return {"logs": logs_list}

    except Exception as e:
        logger.error(f"Database error retrieving movement logs: {e}")
        return {"logs": [], "error": str(e), "total_count": 0, "page": page, "total_pages": 0}


def get_daily_movement_summary():
    """
    Calculates the total number of additions, withdrawals, and returns for the current day in Africa/Cairo.
    Preserves Addition and Removal event-count semantics, keeps Creation separate, and counts Return events.
    """
    db = get_db()
    cursor = db.cursor()
    try:
        now_cairo = datetime.now(CAIRO_TZ)
        today_cairo_str = now_cairo.strftime("%Y-%m-%d")

        start_cairo = datetime.combine(now_cairo.date(), time.min, tzinfo=CAIRO_TZ)
        next_day_cairo = datetime.combine(now_cairo.date() + timedelta(days=1), time.min, tzinfo=CAIRO_TZ)

        start_utc_str = start_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        next_day_utc_str = next_day_cairo.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        query = """
            SELECT action_type, COUNT(*)
            FROM movement_logs
            WHERE (
                (
                    (user_id IS NULL AND actor_name IS NULL AND timestamp NOT LIKE '%Z' AND timestamp NOT LIKE '%+00%')
                    AND SUBSTR(REPLACE(timestamp, 'T', ' '), 1, 10) = ?
                )
                OR
                (
                    (user_id IS NOT NULL OR actor_name IS NOT NULL OR timestamp LIKE '%Z' OR timestamp LIKE '%+00%')
                    AND REPLACE(REPLACE(timestamp, 'T', ' '), 'Z', '') >= ?
                    AND REPLACE(REPLACE(timestamp, 'T', ' '), 'Z', '') < ?
                )
            )
            GROUP BY action_type
        """
        cursor.execute(query, (today_cairo_str, start_utc_str, next_day_utc_str))
        rows = cursor.fetchall()

        counts = {
            "Addition": 0,
            "Removal": 0,
            "Return": 0
        }
        for row in rows:
            action = row[0] if isinstance(row, (tuple, list)) else row["action_type"]
            count = row[1] if isinstance(row, (tuple, list)) else row["COUNT(*)"]
            if action in counts:
                counts[action] = count

        return {
            "additions_today": counts["Addition"],
            "withdrawals_today": counts["Removal"],
            "returns_today": counts["Return"]
        }

    except (sqlite3.Error, Exception) as e:
        logger.error(f"Database error in get_daily_movement_summary: {e}")
        return {
            "additions_today": 0,
            "withdrawals_today": 0,
            "returns_today": 0,
            "error": str(e)
        }