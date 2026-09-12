"""Persistence helpers for reservation-based Leave Orders."""
from typing import Any, Dict, List, Optional


def _row_to_dict(cursor: Any, row: Any) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "keys"):
        return dict(row)
    if cursor.description:
        return dict(zip((column[0] for column in cursor.description), row))
    return None


def create_leave_order(cursor, order_number, employee_name, destination_id, destination_name, notes, created_by):
    cursor.execute(
        """INSERT INTO leave_orders
        (order_number, employee_name, destination_id, destination_name, notes, created_by, status, revision)
        VALUES (?, ?, ?, ?, ?, ?, 'open', 0)""",
        (order_number, employee_name, destination_id, destination_name, notes, created_by),
    )
    return cursor.lastrowid


def update_order_number(cursor, order_id, order_number):
    cursor.execute("UPDATE leave_orders SET order_number = ? WHERE id = ?", (order_number, order_id))


def create_leave_order_item(cursor, leave_order_id, item_id, item_name, unit_id, unit_name, requested_quantity):
    cursor.execute(
        """INSERT INTO leave_order_items
        (leave_order_id, item_id, item_name, unit_id, unit_name, requested_quantity)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (leave_order_id, item_id, item_name, unit_id, unit_name, requested_quantity),
    )
    return cursor.lastrowid


def get_leave_order_items(cursor_or_db, order_id) -> List[Dict[str, Any]]:
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """SELECT loi.*, i.status AS current_item_status,
               COALESCE(i.current_quantity, 0) AS current_stock_quantity,
               COALESCE(i.reserved_quantity, 0) AS current_reserved_quantity,
               COALESCE(i.current_quantity - i.reserved_quantity, 0) AS current_available_quantity
        FROM leave_order_items loi LEFT JOIN items i ON i.id = loi.item_id
        WHERE loi.leave_order_id = ? ORDER BY loi.id""",
        (order_id,),
    )
    result = []
    for raw in cursor.fetchall():
        row = _row_to_dict(cursor, raw)
        if row:
            row["quantity"] = row["requested_quantity"]
            row["remaining_quantity"] = row["dispensed_quantity"] - row["returned_quantity"]
            row["net_issued_quantity"] = row["remaining_quantity"]
            result.append(row)
    return result


def get_leave_order_return_events(cursor_or_db, order_id):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """SELECT re.id, re.leave_order_id, re.operation_key, re.created_by,
               u.display_name AS actor_name, re.created_at, re.notes
        FROM return_events re LEFT JOIN users u ON u.id = re.created_by
        WHERE re.leave_order_id = ? ORDER BY re.id""", (order_id,)
    )
    events = []
    for raw in cursor.fetchall():
        event = _row_to_dict(cursor, raw)
        if not event:
            continue
        cursor.execute(
            """SELECT rei.id, rei.return_event_id, rei.leave_order_item_id, rei.quantity,
                      loi.item_id, loi.item_name, loi.unit_name
               FROM return_event_items rei JOIN leave_order_items loi ON loi.id = rei.leave_order_item_id
               WHERE rei.return_event_id = ? ORDER BY rei.id""", (event["id"],)
        )
        event["items"] = [_row_to_dict(cursor, item) for item in cursor.fetchall()]
        events.append(event)
    return events


def get_leave_order_by_id(cursor_or_db, order_id):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """SELECT lo.*, u1.display_name AS creator_name, u2.display_name AS closer_name,
                  u3.display_name AS rejector_name
           FROM leave_orders lo
           LEFT JOIN users u1 ON u1.id = lo.created_by
           LEFT JOIN users u2 ON u2.id = lo.closed_by
           LEFT JOIN users u3 ON u3.id = lo.rejected_by
           WHERE lo.id = ?""", (order_id,)
    )
    row = _row_to_dict(cursor, cursor.fetchone())
    if not row:
        return None
    items = get_leave_order_items(cursor, order_id)
    total_requested = sum(item["requested_quantity"] for item in items)
    total_dispensed = sum(item["dispensed_quantity"] for item in items)
    total_returned = sum(item["returned_quantity"] for item in items)
    row.update({
        "items": items,
        "return_events": get_leave_order_return_events(cursor, order_id),
        "items_count": len(items),
        "total_requested_quantity": total_requested,
        "total_dispensed_quantity": total_dispensed,
        "total_quantity": total_requested,
        "total_returned": total_returned,
        "remaining_quantity": total_dispensed - total_returned,
        "net_issued_quantity": total_dispensed - total_returned,
        "balances": {item["item_id"]: item["current_stock_quantity"] for item in items},
    })
    return row


def list_leave_orders(cursor_or_db, page=1, page_size=20, status=None, search=None, role=None):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    clauses, params = [], []
    if role == "warehouse":
        clauses.append("lo.status = 'open'")
    elif status:
        normalized = status.strip().lower()
        if normalized == "actionable":
            clauses.append("lo.status IN ('open', 'partially_returned')")
        elif normalized in ("open", "rejected", "closed", "partially_returned", "cancelled"):
            clauses.append("lo.status = ?")
            params.append(normalized)
    if search and search.strip():
        term = f"%{search.strip()}%"
        clauses.append("(lo.order_number LIKE ? OR lo.employee_name LIKE ? OR lo.destination_name LIKE ?)")
        params.extend([term, term, term])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    cursor.execute(f"SELECT COUNT(*) FROM leave_orders lo{where}", params)
    total = cursor.fetchone()[0]
    offset = (page - 1) * page_size
    cursor.execute(
        f"""SELECT lo.*, u.display_name AS creator_name,
           (SELECT COUNT(*) FROM leave_order_items WHERE leave_order_id = lo.id) AS items_count,
           (SELECT COALESCE(SUM(requested_quantity), 0) FROM leave_order_items WHERE leave_order_id = lo.id) AS total_requested_quantity,
           (SELECT COALESCE(SUM(dispensed_quantity), 0) FROM leave_order_items WHERE leave_order_id = lo.id) AS total_dispensed_quantity,
           (SELECT COALESCE(SUM(returned_quantity), 0) FROM leave_order_items WHERE leave_order_id = lo.id) AS total_returned
           FROM leave_orders lo LEFT JOIN users u ON u.id = lo.created_by{where}
           ORDER BY lo.id DESC LIMIT ? OFFSET ?""",
        params + [page_size, offset],
    )
    orders = []
    for raw in cursor.fetchall():
        row = _row_to_dict(cursor, raw)
        if row:
            row["total_quantity"] = row["total_requested_quantity"]
            row["remaining_quantity"] = row["total_dispensed_quantity"] - row["total_returned"]
            row["net_issued_quantity"] = row["remaining_quantity"]
            orders.append(row)
    return orders, total


def get_actionable_tickets_count(cursor_or_db, role=None):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    status_clause = "status = 'open'" if role == "warehouse" else "status IN ('open', 'partially_returned')"
    cursor.execute(f"SELECT COUNT(*) FROM leave_orders WHERE {status_clause}")
    return cursor.fetchone()[0]


def update_leave_order_item_returned(cursor, line_id, delta):
    cursor.execute(
        """UPDATE leave_order_items SET returned_quantity = returned_quantity + ?
           WHERE id = ? AND returned_quantity + ? <= dispensed_quantity""", (delta, line_id, delta)
    )
    return cursor.rowcount == 1


def create_return_event(cursor, leave_order_id, operation_key, created_by, notes=None):
    cursor.execute(
        "INSERT INTO return_events (leave_order_id, operation_key, created_by, notes) VALUES (?, ?, ?, ?)",
        (leave_order_id, operation_key, created_by, notes),
    )
    return cursor.lastrowid


def create_return_event_item(cursor, return_event_id, leave_order_item_id, quantity):
    cursor.execute(
        "INSERT INTO return_event_items (return_event_id, leave_order_item_id, quantity) VALUES (?, ?, ?)",
        (return_event_id, leave_order_item_id, quantity),
    )
    return cursor.lastrowid
