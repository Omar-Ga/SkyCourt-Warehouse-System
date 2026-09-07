"""
Purchase order data access model for SkyCourt Warehouse System.
Provides queries and persistence for purchase orders and line items.
"""
import math
from typing import Any, Optional, List, Dict


def _row_to_dict(cursor: Any, row: Any) -> Optional[Dict[str, Any]]:
    """Converts a sqlite3.Row, tuple, or dict to a dictionary."""
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "keys"):
        return dict(row)
    if hasattr(cursor, "description") and cursor.description:
        cols = [d[0] for d in cursor.description]
        return dict(zip(cols, row))
    return None


def create_purchase_order(
    cursor: Any,
    po_number: str,
    barcode: str,
    provider_id: int,
    provider_name: str,
    created_by: int,
    expires_at: str,
    currency: str = "EGP",
    currency_scale: int = 2,
    total_amount: int = 0,
    notes: Optional[str] = None
) -> int:
    """Inserts a new purchase order header and returns its integer ID."""
    cursor.execute(
        """
        INSERT INTO purchase_orders (
            po_number, barcode, provider_id, provider_name, created_by,
            expires_at, currency, currency_scale, total_amount, notes,
            status, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)
        """,
        (
            po_number, barcode, provider_id, provider_name, created_by,
            expires_at, currency, currency_scale, total_amount, notes
        )
    )
    return cursor.lastrowid


def update_po_number_and_barcode(
    cursor: Any,
    po_id: int,
    po_number: str,
    barcode: str
) -> None:
    """Updates the final authoritative PO number and barcode."""
    cursor.execute(
        "UPDATE purchase_orders SET po_number = ?, barcode = ? WHERE id = ?",
        (po_number, barcode, po_id)
    )


def create_po_item(
    cursor: Any,
    po_id: int,
    item_id: int,
    item_name: str,
    unit_id: int,
    unit_name: str,
    ordered_quantity: int,
    unit_price: int,
    line_total: int,
    line_description: Optional[str] = None
) -> int:
    """Inserts an immutable line item snapshot for a purchase order."""
    cursor.execute(
        """
        INSERT INTO purchase_order_items (
            po_id, item_id, item_name, unit_id, unit_name,
            line_description, ordered_quantity, unit_price, line_total,
            received_quantity, disposition
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending')
        """,
        (
            po_id, item_id, item_name, unit_id, unit_name,
            line_description, ordered_quantity, unit_price, line_total
        )
    )
    return cursor.lastrowid


def get_purchase_order_by_id(cursor_or_db: Any, po_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves a purchase order by ID with creator, receiver, and voider names."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT po.id, po.po_number, po.barcode, po.provider_id, po.provider_name,
               po.status, po.notes, po.created_by, po.created_at, po.expires_at,
               po.revision, po.received_by, po.closed_at, po.voided_by, po.voided_at,
               po.void_reason, po.currency, po.currency_scale, po.total_amount,
               u_creator.display_name AS creator_name,
               u_receiver.display_name AS receiver_name,
               u_voider.display_name AS void_actor_name
        FROM purchase_orders po
        LEFT JOIN users u_creator ON po.created_by = u_creator.id
        LEFT JOIN users u_receiver ON po.received_by = u_receiver.id
        LEFT JOIN users u_voider ON po.voided_by = u_voider.id
        WHERE po.id = ?
        """,
        (po_id,)
    )
    row = cursor.fetchone()
    return _row_to_dict(cursor, row)


def get_purchase_order_by_barcode(cursor_or_db: Any, barcode: str) -> Optional[Dict[str, Any]]:
    """Retrieves a purchase order by barcode with creator, receiver, and voider names."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT po.id, po.po_number, po.barcode, po.provider_id, po.provider_name,
               po.status, po.notes, po.created_by, po.created_at, po.expires_at,
               po.revision, po.received_by, po.closed_at, po.voided_by, po.voided_at,
               po.void_reason, po.currency, po.currency_scale, po.total_amount,
               u_creator.display_name AS creator_name,
               u_receiver.display_name AS receiver_name,
               u_voider.display_name AS void_actor_name
        FROM purchase_orders po
        LEFT JOIN users u_creator ON po.created_by = u_creator.id
        LEFT JOIN users u_receiver ON po.received_by = u_receiver.id
        LEFT JOIN users u_voider ON po.voided_by = u_voider.id
        WHERE po.barcode = ?
        """,
        (barcode,)
    )
    row = cursor.fetchone()
    return _row_to_dict(cursor, row)


def get_purchase_order_items(cursor_or_db: Any, po_id: int) -> List[Dict[str, Any]]:
    """Retrieves all line items for a given purchase order."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """
        SELECT poi.id, poi.po_id, poi.item_id, poi.item_name, poi.unit_id, poi.unit_name,
               poi.line_description, poi.ordered_quantity, poi.unit_price, poi.line_total,
               poi.received_quantity, poi.disposition, i.status AS current_item_status
        FROM purchase_order_items poi
        LEFT JOIN items i ON poi.item_id = i.id
        WHERE poi.po_id = ?
        ORDER BY poi.id ASC
        """,
        (po_id,)
    )
    rows = cursor.fetchall()
    items = []
    for r in rows:
        d = _row_to_dict(cursor, r)
        if d:
            items.append(d)
    return items


def list_purchase_orders(
    cursor_or_db: Any,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None,
    now_utc_str: Optional[str] = None
) -> Dict[str, Any]:
    """
    Lists purchase orders with status filtering, search, and bounded pagination.
    Accounts for effective expiry when filtering status.
    """
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db

    where_clauses: List[str] = []
    params: List[Any] = []

    # Status filter logic
    if status and status.lower() not in ("all", ""):
        st = status.strip().lower()
        if st == "open":
            if now_utc_str:
                where_clauses.append("po.status = 'open' AND po.expires_at > ?")
                params.append(now_utc_str)
            else:
                where_clauses.append("po.status = 'open'")
        elif st == "expired":
            if now_utc_str:
                where_clauses.append("po.status = 'open' AND po.expires_at <= ?")
                params.append(now_utc_str)
            else:
                # Without now_utc, open orders cannot be verified as expired
                where_clauses.append("1 = 0")
        elif st in ("closed", "void"):
            where_clauses.append("po.status = ?")
            params.append(st)
        else:
            where_clauses.append("1 = 0")

    # Search filter
    if search and search.strip():
        term = f"%{search.strip()}%"
        where_clauses.append("(po.po_number LIKE ? OR po.provider_name LIKE ?)")
        params.extend([term, term])

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Count query
    count_sql = f"SELECT COUNT(*) AS total FROM purchase_orders po {where_sql}"
    cursor.execute(count_sql, tuple(params))
    count_row = cursor.fetchone()
    total_count = count_row["total"] if hasattr(count_row, "__getitem__") and "total" in count_row else count_row[0]

    total_pages = math.ceil(total_count / page_size) if page_size > 0 else 1

    # Data query
    offset = (page - 1) * page_size
    data_sql = f"""
        SELECT po.id, po.po_number, po.barcode, po.provider_id, po.provider_name,
               po.status, po.notes, po.created_by, po.created_at, po.expires_at,
               po.revision, po.received_by, po.closed_at, po.voided_by, po.voided_at,
               po.void_reason, po.currency, po.currency_scale, po.total_amount,
               u_creator.display_name AS creator_name,
               u_receiver.display_name AS receiver_name,
               u_voider.display_name AS void_actor_name,
               (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS line_count,
               (SELECT COALESCE(SUM(ordered_quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS total_ordered_quantity,
               (SELECT COALESCE(SUM(received_quantity), 0) FROM purchase_order_items WHERE po_id = po.id AND received_quantity IS NOT NULL) AS total_received_quantity
        FROM purchase_orders po
        LEFT JOIN users u_creator ON po.created_by = u_creator.id
        LEFT JOIN users u_receiver ON po.received_by = u_receiver.id
        LEFT JOIN users u_voider ON po.voided_by = u_voider.id
        {where_sql}
        ORDER BY po.id DESC
        LIMIT ? OFFSET ?
    """
    cursor.execute(data_sql, tuple(params + [page_size, offset]))
    rows = cursor.fetchall()
    orders = []
    for r in rows:
        d = _row_to_dict(cursor, r)
        if d:
            orders.append(d)

    return {
        "purchase_orders": orders,
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }


def void_purchase_order(
    cursor: Any,
    po_id: int,
    voided_by: int,
    void_reason: str,
    now_utc_str: str,
    expected_revision: int
) -> bool:
    """Conditionally transitions an open PO to void status, incrementing revision."""
    cursor.execute(
        """
        UPDATE purchase_orders
        SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ?, revision = revision + 1
        WHERE id = ? AND status = 'open' AND revision = ?
        """,
        (voided_by, now_utc_str, void_reason, po_id, expected_revision)
    )
    return cursor.rowcount > 0


def expire_purchase_order(
    cursor: Any,
    po_id: int,
    now_utc_str: str,
    expected_revision: int
) -> bool:
    """Conditionally transitions an expired open PO to void status via system expiry."""
    cursor.execute(
        """
        UPDATE purchase_orders
        SET status = 'void', voided_by = NULL, voided_at = ?,
            void_reason = 'System expiry (48 hours elapsed)', revision = revision + 1
        WHERE id = ? AND status = 'open' AND revision = ?
        """,
        (now_utc_str, po_id, expected_revision)
    )
    return cursor.rowcount > 0


def check_item_barcode_collision(cursor_or_db: Any, barcode: str) -> bool:
    """Checks if any item barcode collides with the given barcode."""
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute("SELECT 1 FROM items WHERE barcode = ? LIMIT 1", (barcode,))
    return cursor.fetchone() is not None


def update_po_item_receipt(
    cursor: Any,
    line_id: int,
    received_quantity: int,
    disposition: str
) -> bool:
    """Updates received quantity and disposition for a PO line item."""
    cursor.execute(
        """
        UPDATE purchase_order_items
        SET received_quantity = ?, disposition = ?
        WHERE id = ?
        """,
        (received_quantity, disposition, line_id)
    )
    return cursor.rowcount > 0


def close_purchase_order_receipt(
    cursor: Any,
    po_id: int,
    received_by: int,
    now_utc_str: str,
    expected_revision: int
) -> bool:
    """Conditionally transitions an open PO to closed status upon receipt, incrementing revision."""
    cursor.execute(
        """
        UPDATE purchase_orders
        SET status = 'closed', received_by = ?, closed_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'open' AND revision = ?
        """,
        (received_by, now_utc_str, po_id, expected_revision)
    )
    return cursor.rowcount > 0

