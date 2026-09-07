"""
Leave order data access model for SkyCourt Warehouse System.
Provides queries and persistence for leave orders, line items, and return events.
"""
from typing import Any, Optional, Tuple, List, Dict
import math


def _row_to_dict(cursor: Any, row: Any) -> Optional[Dict[str, Any]]:
    """Converts a sqlite3.Row, tuple, or dict to a dictionary."""
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    if hasattr(row, "keys"):
        return dict(row)
    if hasattr(cursor, "description") and cursor.description:
        cols = [d[0] for d in cursor.description]
        return dict(zip(cols, row))
    return None



def create_leave_order(
    cursor: Any,
    order_number: str,
    employee_name: str,
    destination_id: int,
    destination_name: str,
    notes: Optional[str],
    created_by: int
) -> int:
    """Inserts a new leave order header and returns its integer ID."""
    cursor.execute(
        """
        INSERT INTO leave_orders (
            order_number, employee_name, destination_id, destination_name,
            notes, created_by, status, revision
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', 0)
        """,
        (order_number, employee_name, destination_id, destination_name, notes, created_by)
    )
    return cursor.lastrowid


def update_order_number(cursor: Any, order_id: int, order_number: str) -> None:
    """Updates the final authoritative order number for a leave order."""
    cursor.execute(
        "UPDATE leave_orders SET order_number = ? WHERE id = ?",
        (order_number, order_id)
    )


def create_leave_order_item(
    cursor: Any,
    leave_order_id: int,
    item_id: int,
    item_name: str,
    unit_id: int,
    unit_name: str,
    quantity: int
) -> int:
    """Inserts an immutable line item snapshot for a leave order."""
    cursor.execute(
        """
        INSERT INTO leave_order_items (
            leave_order_id, item_id, item_name, unit_id, unit_name, quantity, returned_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, 0)
        """,
        (leave_order_id, item_id, item_name, unit_id, unit_name, quantity)
    )
    return cursor.lastrowid


def get_leave_order_items(cursor_or_db: Any, order_id: int) -> List[Dict[str, Any]]:
    """Retrieves line items with remaining quantity and current item lifecycle status."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT loi.id, loi.leave_order_id, loi.item_id, loi.item_name, loi.unit_id, loi.unit_name,
               loi.quantity, loi.returned_quantity,
               (loi.quantity - loi.returned_quantity) AS remaining_quantity,
               i.status AS current_item_status,
               COALESCE(i.current_quantity, 0) AS current_stock_quantity
        FROM leave_order_items loi
        LEFT JOIN items i ON loi.item_id = i.id
        WHERE loi.leave_order_id = ?
        ORDER BY loi.id ASC
        """,
        (order_id,)
    )
    rows = cursor.fetchall()
    items = []
    for raw_r in rows:
        r = _row_to_dict(cursor, raw_r)
        if not r:
            continue
        items.append({
            "id": r["id"],
            "leave_order_id": r["leave_order_id"],
            "item_id": r["item_id"],
            "item_name": r["item_name"],
            "unit_id": r["unit_id"],
            "unit_name": r["unit_name"],
            "quantity": r["quantity"],
            "returned_quantity": r["returned_quantity"],
            "remaining_quantity": r["remaining_quantity"],
            "net_issued_quantity": r["remaining_quantity"],
            "current_item_status": r["current_item_status"],
            "current_stock_quantity": r["current_stock_quantity"]
        })
    return items


def get_leave_order_return_events(cursor_or_db: Any, order_id: int) -> List[Dict[str, Any]]:
    """Retrieves all return events and their line item details for a leave order."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT re.id, re.leave_order_id, re.operation_key, re.created_by,
               u.display_name AS actor_name, re.created_at, re.notes
        FROM return_events re
        LEFT JOIN users u ON re.created_by = u.id
        WHERE re.leave_order_id = ?
        ORDER BY re.id ASC
        """,
        (order_id,)
    )
    event_rows = cursor.fetchall()
    events = []
    for raw_er in event_rows:
        er = _row_to_dict(cursor, raw_er)
        if not er:
            continue
        event_id = er["id"]
        cursor.execute(
            """
            SELECT rei.id, rei.return_event_id, rei.leave_order_item_id, rei.quantity,
                   loi.item_id, loi.item_name, loi.unit_name
            FROM return_event_items rei
            JOIN leave_order_items loi ON rei.leave_order_item_id = loi.id
            WHERE rei.return_event_id = ?
            ORDER BY rei.id ASC
            """,
            (event_id,)
        )
        item_rows = cursor.fetchall()
        event_items = []
        for raw_ir in item_rows:
            ir = _row_to_dict(cursor, raw_ir)
            if not ir:
                continue
            event_items.append({
                "id": ir["id"],
                "return_event_id": ir["return_event_id"],
                "leave_order_item_id": ir["leave_order_item_id"],
                "quantity": ir["quantity"],
                "item_id": ir["item_id"],
                "item_name": ir["item_name"],
                "unit_name": ir["unit_name"]
            })
        events.append({
            "id": er["id"],
            "leave_order_id": er["leave_order_id"],
            "operation_key": er["operation_key"],
            "created_by": er["created_by"],
            "actor_name": er["actor_name"],
            "created_at": er["created_at"],
            "notes": er["notes"],
            "items": event_items
        })
    return events


def get_leave_order_by_id(cursor_or_db: Any, order_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves a single leave order by ID with line items, aggregates, and return events."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT lo.id, lo.order_number, lo.employee_name, lo.destination_id, lo.destination_name,
               lo.status, lo.notes, lo.created_by, lo.created_at, lo.revision,
               lo.closed_by, lo.closed_at, lo.close_reason,
               u1.display_name AS creator_name,
               u2.display_name AS closer_name
        FROM leave_orders lo
        LEFT JOIN users u1 ON lo.created_by = u1.id
        LEFT JOIN users u2 ON lo.closed_by = u2.id
        WHERE lo.id = ?
        """,
        (order_id,)
    )
    raw_row = cursor.fetchone()
    if not raw_row:
        return None
    row = _row_to_dict(cursor, raw_row)
    if not row:
        return None

    items = get_leave_order_items(cursor, order_id)
    return_events = get_leave_order_return_events(cursor, order_id)

    total_quantity = sum(item["quantity"] for item in items)
    total_returned = sum(item["returned_quantity"] for item in items)
    remaining_quantity = total_quantity - total_returned

    return {
        "id": row["id"],
        "order_number": row["order_number"],
        "employee_name": row["employee_name"],
        "destination_id": row["destination_id"],
        "destination_name": row["destination_name"],
        "status": row["status"],
        "notes": row["notes"],
        "created_by": row["created_by"],
        "creator_name": row["creator_name"],
        "created_at": row["created_at"],
        "revision": row["revision"],
        "closed_by": row["closed_by"],
        "closer_name": row["closer_name"],
        "closed_at": row["closed_at"],
        "close_reason": row["close_reason"],
        "items": items,
        "items_count": len(items),
        "return_events": return_events,
        "total_quantity": total_quantity,
        "total_returned": total_returned,
        "remaining_quantity": remaining_quantity,
        "net_issued_quantity": remaining_quantity,
        "balances": {item["item_id"]: item.get("current_stock_quantity", 0) for item in items}
    }


def list_leave_orders(
    cursor_or_db: Any,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Lists paginated leave orders with optional status and search filters.
    Returns (leave_orders, total_count).
    """
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db

    where_clauses = []
    params: List[Any] = []

    if status:
        norm_status = status.lower().strip()
        if norm_status == "actionable":
            where_clauses.append("lo.status IN ('open', 'partially_returned')")
        elif norm_status in ("open", "partially_returned", "closed"):
            where_clauses.append("lo.status = ?")
            params.append(norm_status)

    if search:
        search_pattern = f"%{search.strip()}%"
        where_clauses.append("(lo.order_number LIKE ? OR lo.employee_name LIKE ? OR lo.destination_name LIKE ?)")
        params.extend([search_pattern, search_pattern, search_pattern])

    where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    # Total count query
    count_query = f"SELECT COUNT(*) FROM leave_orders lo{where_sql}"
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()[0]

    offset = (page - 1) * page_size
    query = f"""
        SELECT lo.id, lo.order_number, lo.employee_name, lo.destination_id, lo.destination_name,
               lo.status, lo.notes, lo.created_by, lo.created_at, lo.revision,
               lo.closed_by, lo.closed_at, lo.close_reason,
               u1.display_name AS creator_name,
               u2.display_name AS closer_name,
               COALESCE(agg.items_count, 0) AS items_count,
               COALESCE(agg.total_quantity, 0) AS total_quantity,
               COALESCE(agg.total_returned, 0) AS total_returned,
               (COALESCE(agg.total_quantity, 0) - COALESCE(agg.total_returned, 0)) AS remaining_quantity
        FROM leave_orders lo
        LEFT JOIN users u1 ON lo.created_by = u1.id
        LEFT JOIN users u2 ON lo.closed_by = u2.id
        LEFT JOIN (
            SELECT leave_order_id,
                   COUNT(*) AS items_count,
                   SUM(quantity) AS total_quantity,
                   SUM(returned_quantity) AS total_returned
            FROM leave_order_items
            GROUP BY leave_order_id
        ) agg ON lo.id = agg.leave_order_id
        {where_sql}
        ORDER BY lo.id DESC
        LIMIT ? OFFSET ?
    """
    paged_params = list(params) + [page_size, offset]
    cursor.execute(query, paged_params)
    rows = cursor.fetchall()

    orders = []
    for raw_r in rows:
        r = _row_to_dict(cursor, raw_r)
        if not r:
            continue
        orders.append({
            "id": r["id"],
            "order_number": r["order_number"],
            "employee_name": r["employee_name"],
            "destination_id": r["destination_id"],
            "destination_name": r["destination_name"],
            "status": r["status"],
            "notes": r["notes"],
            "created_by": r["created_by"],
            "creator_name": r["creator_name"],
            "created_at": r["created_at"],
            "revision": r["revision"],
            "closed_by": r["closed_by"],
            "closer_name": r["closer_name"],
            "closed_at": r["closed_at"],
            "close_reason": r["close_reason"],
            "items_count": r["items_count"],
            "total_quantity": r["total_quantity"],
            "total_returned": r["total_returned"],
            "remaining_quantity": r["remaining_quantity"],
            "net_issued_quantity": r["remaining_quantity"]
        })

    return orders, total_count


def get_actionable_tickets_count(cursor_or_db: Any) -> int:
    """Returns the count of orders in open or partially_returned status."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute("SELECT COUNT(*) FROM leave_orders WHERE status IN ('open', 'partially_returned')")
    return cursor.fetchone()[0]


def close_leave_order_conditional(
    cursor: Any,
    order_id: int,
    closed_by: int,
    reason: str,
    expected_revision: int
) -> bool:
    """
    Atomically closes an open or partially_returned leave order conditioned on expected revision.
    Returns True if updated, False if conflict / condition not met.
    """
    cursor.execute(
        """
        UPDATE leave_orders
        SET status = 'closed',
            closed_by = ?,
            closed_at = CURRENT_TIMESTAMP,
            close_reason = ?,
            revision = revision + 1
        WHERE id = ? AND revision = ? AND status IN ('open', 'partially_returned')
        """,
        (closed_by, reason, order_id, expected_revision)
    )
    return cursor.rowcount == 1


def create_return_event(
    cursor: Any,
    leave_order_id: int,
    operation_key: Optional[str],
    created_by: int,
    notes: Optional[str] = None
) -> int:
    """Inserts an immutable return event header and returns its integer ID."""
    cursor.execute(
        """
        INSERT INTO return_events (leave_order_id, operation_key, created_by, notes)
        VALUES (?, ?, ?, ?)
        """,
        (leave_order_id, operation_key, created_by, notes)
    )
    return cursor.lastrowid


def create_return_event_item(
    cursor: Any,
    return_event_id: int,
    leave_order_item_id: int,
    quantity: int
) -> int:
    """Inserts a return event line item snapshot."""
    cursor.execute(
        """
        INSERT INTO return_event_items (return_event_id, leave_order_item_id, quantity)
        VALUES (?, ?, ?)
        """,
        (return_event_id, leave_order_item_id, quantity)
    )
    return cursor.lastrowid


def update_leave_order_item_returned(
    cursor: Any,
    line_id: int,
    delta: int
) -> bool:
    """
    Conditionally increments returned_quantity on a leave order item.
    Ensures returned_quantity does not exceed ordered quantity.
    """
    cursor.execute(
        """
        UPDATE leave_order_items
        SET returned_quantity = returned_quantity + ?
        WHERE id = ? AND (returned_quantity + ?) <= quantity
        """,
        (delta, line_id, delta)
    )
    return cursor.rowcount == 1


def update_leave_order_on_return(
    cursor: Any,
    order_id: int,
    expected_revision: int,
    new_status: str,
    closed_by: Optional[int] = None,
    close_reason: Optional[str] = None
) -> bool:
    """
    Atomically updates leave order header on return event:
    - If status was already closed (late return), preserves closed_by, closed_at, close_reason
    - If full return (new_status='closed'), sets closed_by, closed_at, close_reason
    - If partial return, sets status='partially_returned'
    Increments revision.
    """
    if new_status == "closed" and closed_by is not None:
        cursor.execute(
            """
            UPDATE leave_orders
            SET status = 'closed',
                closed_by = ?,
                closed_at = CURRENT_TIMESTAMP,
                close_reason = ?,
                revision = revision + 1
            WHERE id = ? AND revision = ?
            """,
            (closed_by, close_reason, order_id, expected_revision)
        )
    elif new_status == "closed":
        # Order was already closed (permitted late return) - preserve original closure fields
        cursor.execute(
            """
            UPDATE leave_orders
            SET revision = revision + 1
            WHERE id = ? AND revision = ? AND status = 'closed'
            """,
            (order_id, expected_revision)
        )
    else:
        cursor.execute(
            """
            UPDATE leave_orders
            SET status = 'partially_returned',
                revision = revision + 1
            WHERE id = ? AND revision = ?
            """,
            (order_id, expected_revision)
        )
    return cursor.rowcount == 1
