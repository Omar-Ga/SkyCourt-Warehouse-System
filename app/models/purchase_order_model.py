"""Persistence helpers for draft, dispatched, and atomically received POs."""
import math


def _row_to_dict(cursor, row):
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "keys"):
        return dict(row)
    return dict(zip((col[0] for col in cursor.description), row))


def create_purchase_order(cursor, po_number, provider_id, provider_name, created_by, currency="EGP", currency_scale=2, total_amount=0, notes=None):
    cursor.execute(
        """INSERT INTO purchase_orders
        (po_number, provider_id, provider_name, created_by, currency, currency_scale, total_amount, notes, status, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0)""",
        (po_number, provider_id, provider_name, created_by, currency, currency_scale, total_amount, notes),
    )
    return cursor.lastrowid


def update_po_number(cursor, po_id, po_number):
    cursor.execute("UPDATE purchase_orders SET po_number = ? WHERE id = ?", (po_number, po_id))


def create_po_item(cursor, po_id, item_id, item_name, unit_id, unit_name, requested_quantity, ordered_quantity, unit_price, line_total, line_description=None):
    cursor.execute(
        """INSERT INTO purchase_order_items
        (po_id, item_id, item_name, unit_id, unit_name, line_description,
         requested_quantity, ordered_quantity, unit_price, line_total, received_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
        (po_id, item_id, item_name, unit_id, unit_name, line_description,
         requested_quantity, ordered_quantity, unit_price, line_total),
    )
    return cursor.lastrowid


def get_purchase_order_by_id(cursor_or_db, po_id):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """SELECT po.*, u1.display_name AS creator_name, u2.display_name AS dispatcher_name,
                  u3.display_name AS receiver_name, u4.display_name AS void_actor_name
           FROM purchase_orders po
           LEFT JOIN users u1 ON u1.id = po.created_by
           LEFT JOIN users u2 ON u2.id = po.dispatched_by
           LEFT JOIN users u3 ON u3.id = po.received_by
           LEFT JOIN users u4 ON u4.id = po.voided_by
           WHERE po.id = ?""", (po_id,)
    )
    return _row_to_dict(cursor, cursor.fetchone())


def get_purchase_order_items(cursor_or_db, po_id):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    cursor.execute(
        """SELECT poi.*, i.status AS current_item_status
           FROM purchase_order_items poi LEFT JOIN items i ON i.id = poi.item_id
           WHERE poi.po_id = ? ORDER BY poi.id""", (po_id,)
    )
    return [_row_to_dict(cursor, row) for row in cursor.fetchall()]


def list_purchase_orders(cursor_or_db, page=1, page_size=20, status=None, search=None, now_utc_str=None, role=None):
    cursor = cursor_or_db.cursor() if hasattr(cursor_or_db, "cursor") else cursor_or_db
    clauses, params = [], []
    if role == "warehouse":
        clauses.append("po.status != 'draft'")
    if status and status.lower() not in ("all", ""):
        normalized = status.strip().lower()
        if normalized == "expired":
            clauses.append("po.status = 'expired'")
            if now_utc_str:
                clauses[-1] = "(po.status = 'expired' OR (po.status = 'open' AND po.expires_at <= ?))"
                params.append(now_utc_str)
        elif normalized in ("draft", "open", "closed", "void"):
            clauses.append("po.status = ?")
            params.append(normalized)
        else:
            clauses.append("1 = 0")
    if search and search.strip():
        term = f"%{search.strip()}%"
        clauses.append("(po.po_number LIKE ? OR po.provider_name LIKE ?)")
        params.extend([term, term])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    cursor.execute(f"SELECT COUNT(*) FROM purchase_orders po{where}", params)
    total = cursor.fetchone()[0]
    offset = (page - 1) * page_size
    cursor.execute(
        f"""SELECT po.*, u.display_name AS creator_name,
           (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS line_count,
           (SELECT COALESCE(SUM(ordered_quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS total_ordered_quantity,
           (SELECT COALESCE(SUM(received_quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS total_received_quantity
           FROM purchase_orders po LEFT JOIN users u ON u.id = po.created_by{where}
           ORDER BY po.id DESC LIMIT ? OFFSET ?""", params + [page_size, offset]
    )
    return {
        "purchase_orders": [_row_to_dict(cursor, row) for row in cursor.fetchall()],
        "total_count": total, "page": page, "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if page_size else 0,
    }


def void_purchase_order(cursor, po_id, voided_by, void_reason, now_utc_str, expected_revision):
    cursor.execute("""UPDATE purchase_orders SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ?, revision = revision + 1
        WHERE id = ? AND status IN ('draft', 'open') AND revision = ?""",
        (voided_by, now_utc_str, void_reason, po_id, expected_revision))
    return cursor.rowcount == 1


def expire_purchase_order(cursor, po_id, now_utc_str, expected_revision):
    cursor.execute("""UPDATE purchase_orders SET status = 'expired', void_reason = 'System expiry (30 days elapsed)', voided_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'open' AND revision = ? AND expires_at <= ?""",
        (now_utc_str, po_id, expected_revision, now_utc_str))
    return cursor.rowcount == 1


def replace_draft_items(cursor, po_id, lines):
    cursor.execute("DELETE FROM purchase_order_items WHERE po_id = ?", (po_id,))
    for line in lines:
        create_po_item(cursor, po_id, **line)


def dispatch_purchase_order(cursor, po_id, actor_id, dispatched_at, expires_at, expected_revision):
    cursor.execute("""UPDATE purchase_orders SET status = 'open', dispatched_at = ?, expires_at = ?, dispatched_by = ?, revision = revision + 1
        WHERE id = ? AND status = 'draft' AND revision = ?""",
        (dispatched_at, expires_at, actor_id, po_id, expected_revision))
    return cursor.rowcount == 1


def close_purchase_order_receipt(cursor, po_id, received_by, now_utc_str, expected_revision):
    cursor.execute("""UPDATE purchase_orders SET status = 'closed', received_by = ?, closed_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'open' AND revision = ?""",
        (received_by, now_utc_str, po_id, expected_revision))
    return cursor.rowcount == 1
