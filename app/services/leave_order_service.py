"""Reservation, fulfillment, rejection, and return operations for Leave Orders."""
import math
import uuid
from typing import Any, Dict, List, Optional

from app.models.db_utils import get_db, check_stock_mutation_allowed
from app.models import leave_order_model
from app.models.movement_log_model import add_log_entry
from app.services.item_service import adjust_stock_primitive
from app.services.idempotency_service import compute_request_hash, reserve_operation, complete_operation, StateConflictError
from app.validation import ValidationError, validate_foreign_key, validate_non_negative_integer, validate_positive_integer, validate_string, validate_unique_lines


def _row_value(row, key, index):
    return row[key] if hasattr(row, "__getitem__") and isinstance(key, str) and key in row else row[index]


def _transaction(db):
    conn = db or get_db()
    return conn, db is None


def create_leave_order_service(employee_name: str, destination_id: int, items: List[Dict[str, Any]], notes=None,
                               actor_id=None, actor_name=None, idempotency_key=None, db=None):
    employee_name = validate_string(employee_name, "employee_name", 1, 150)
    validate_positive_integer(destination_id, "destination_id")
    notes = validate_string(notes, "notes", 0, 500, True)
    validate_unique_lines(items, "item_id")
    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    validate_positive_integer(actor_id, "actor_id")
    parsed = []
    for index, line in enumerate(items):
        quantity = line.get("requested_quantity", line.get("quantity"))
        validate_positive_integer(quantity, f"items[{index}].requested_quantity")
        parsed.append({"item_id": line["item_id"], "requested_quantity": quantity})
    conn, owned = _transaction(db)
    key = str(idempotency_key).strip()
    try:
        check_stock_mutation_allowed(conn)
        validate_foreign_key(conn, "destinations", destination_id, "destination_id")
        cursor = conn.cursor(); cursor.execute("SELECT name FROM destinations WHERE id = ?", (destination_id,)); destination_name = cursor.fetchone()[0]
        replay = reserve_operation(conn, key, "leave_order_create", actor_id, compute_request_hash({"employee_name": employee_name, "destination_id": destination_id, "notes": notes, "items": parsed}))
        if replay.get("replayed"): return replay["response_body"]
        validated = []
        for line in parsed:
            cursor.execute("SELECT i.id, i.name, i.unit_id, i.status, i.current_quantity, i.reserved_quantity, u.name AS unit_name FROM items i LEFT JOIN units u ON u.id = i.unit_id WHERE i.id = ?", (line["item_id"],))
            item = cursor.fetchone()
            if not item: raise ValidationError("Item not found", "item_id", "ITEM_NOT_FOUND")
            if item["status"] != "active": raise ValidationError("Item is not active", "status", "ITEM_NOT_ACTIVE")
            qty = line["requested_quantity"]
            cursor.execute("UPDATE items SET reserved_quantity = reserved_quantity + ? WHERE id = ? AND status = 'active' AND current_quantity - reserved_quantity >= ?", (qty, item["id"], qty))
            if cursor.rowcount != 1: raise ValidationError(f"Insufficient available stock for item '{item['name']}'", "requested_quantity", "INSUFFICIENT_STOCK")
            validated.append({"item_id": item["id"], "item_name": item["name"], "unit_id": item["unit_id"], "unit_name": item["unit_name"] or "غير محدد", "requested_quantity": qty})
        placeholder = f"__PENDING_{uuid.uuid4().hex}__"
        order_id = leave_order_model.create_leave_order(cursor, placeholder, employee_name, destination_id, destination_name, notes, actor_id)
        leave_order_model.update_order_number(cursor, order_id, f"LO-{order_id:06d}")
        for line in validated: leave_order_model.create_leave_order_item(cursor, order_id, **line)
        result = leave_order_model.get_leave_order_by_id(conn, order_id); complete_operation(conn, key, 201, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def get_leave_order_detail_service(order_id, db=None):
    validate_positive_integer(order_id, "order_id")
    return leave_order_model.get_leave_order_by_id(db or get_db(), order_id)


def list_leave_orders_service(page=1, page_size=20, status=None, search=None, role=None, db=None):
    page = validate_positive_integer(page, "page"); page_size = min(validate_positive_integer(page_size, "page_size"), 100)
    orders, total = leave_order_model.list_leave_orders(db or get_db(), page, page_size, status, search, role)
    return {"leave_orders": orders, "total_count": total, "page": page, "page_size": page_size, "total_pages": math.ceil(total / page_size) if total else 0}


def get_actionable_tickets_count_service(db=None, role=None):
    return leave_order_model.get_actionable_tickets_count(db or get_db(), role)


def _transition(conn, order_id, expected_revision, actor_id, key, operation_type, payload, action):
    replay = reserve_operation(conn, key, operation_type, actor_id, compute_request_hash(payload))
    if replay.get("replayed"): return replay["response_body"]
    order = leave_order_model.get_leave_order_by_id(conn, order_id)
    if not order: raise ValidationError("Leave order not found", "order_id", "NOT_FOUND")
    if order["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
    action(order)
    result = leave_order_model.get_leave_order_by_id(conn, order_id); complete_operation(conn, key, 200, result); return result


def fulfill_leave_order_service(order_id, expected_revision, actor_id, actor_name=None, idempotency_key=None, db=None):
    validate_positive_integer(order_id, "order_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    key = (idempotency_key or "").strip()
    if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    conn, owned = _transaction(db)
    try:
        check_stock_mutation_allowed(conn)
        def action(order):
            if order["status"] != "open": raise StateConflictError("Only open tickets can be fulfilled", "INVALID_STATUS_TRANSITION")
            for line in order["items"]:
                cursor = conn.cursor(); cursor.execute("UPDATE items SET current_quantity = current_quantity - ?, reserved_quantity = reserved_quantity - ? WHERE id = ? AND status = 'active' AND current_quantity >= ? AND reserved_quantity >= ?", (line["requested_quantity"], line["requested_quantity"], line["item_id"], line["requested_quantity"], line["requested_quantity"]))
                if cursor.rowcount != 1: raise StateConflictError("Reserved stock is no longer available", "STOCK_CONFLICT")
                cursor.execute("UPDATE leave_order_items SET dispensed_quantity = requested_quantity WHERE id = ?", (line["id"],))
                cursor.execute("SELECT current_quantity FROM items WHERE id = ?", (line["item_id"],))
                resulting_quantity = cursor.fetchone()[0]
                add_log_entry(
                    item_id=line["item_id"], item_name=line["item_name"], action_type="Removal",
                    quantity_changed=line["requested_quantity"], resulting_quantity=resulting_quantity,
                    details=f"Leave Order {order['order_number']}", person_name=order["employee_name"],
                    destination_id=order["destination_id"], user_id=actor_id, actor_name=actor_name,
                    operation_key=key, leave_line_id=line["id"], unit_name=line["unit_name"], db=conn,
                )
            if conn.cursor().execute("UPDATE leave_orders SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP, close_reason = 'Fulfilled by warehouse', revision = revision + 1 WHERE id = ? AND revision = ?", (actor_id, order_id, expected_revision)).rowcount != 1:
                raise StateConflictError("Fulfillment conflict", "REVISION_CONFLICT")
        result = _transition(conn, order_id, expected_revision, actor_id, key, "leave_order_fulfill", {"order_id": order_id, "expected_revision": expected_revision}, action)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def reject_leave_order_service(order_id, expected_revision, reason, actor_id, idempotency_key=None, db=None):
    validate_positive_integer(order_id, "order_id"); validate_non_negative_integer(expected_revision, "expected_revision"); reason = validate_string(reason, "reason", 1, 500); validate_positive_integer(actor_id, "actor_id")
    key = (idempotency_key or "").strip()
    if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    conn, owned = _transaction(db)
    try:
        def action(order):
            if order["status"] != "open": raise StateConflictError("Only open tickets can be rejected", "INVALID_STATUS_TRANSITION")
            cursor = conn.cursor()
            for line in order["items"]:
                cursor.execute("UPDATE items SET reserved_quantity = reserved_quantity - ? WHERE id = ? AND reserved_quantity >= ?", (line["requested_quantity"], line["item_id"], line["requested_quantity"]))
                if cursor.rowcount != 1: raise StateConflictError("Reservation conflict", "STOCK_CONFLICT")
            cursor.execute("UPDATE leave_orders SET status = 'rejected', rejection_reason = ?, rejected_by = ?, rejected_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND revision = ?", (reason, actor_id, order_id, expected_revision))
            cursor.execute("INSERT INTO leave_order_rejection_events (leave_order_id, reason, rejected_by, revision) VALUES (?, ?, ?, ?)", (order_id, reason, actor_id, expected_revision + 1))
        result = _transition(conn, order_id, expected_revision, actor_id, key, "leave_order_reject", {"order_id": order_id, "expected_revision": expected_revision, "reason": reason}, action)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def resubmit_leave_order_service(order_id, expected_revision, actor_id, items=None, notes=None, idempotency_key=None, db=None):
    validate_positive_integer(order_id, "order_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    key = (idempotency_key or "").strip()
    if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    conn, owned = _transaction(db)
    try:
        replay = reserve_operation(conn, key, "leave_order_resubmit", actor_id, compute_request_hash({"order_id": order_id, "expected_revision": expected_revision, "items": items, "notes": notes}))
        if replay.get("replayed"):
            return replay["response_body"]
        order = leave_order_model.get_leave_order_by_id(conn, order_id)
        if not order: raise ValidationError("Leave order not found", "order_id", "NOT_FOUND")
        if order["status"] != "rejected": raise StateConflictError("Only rejected tickets can be resubmitted", "INVALID_STATUS_TRANSITION")
        if order["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        if items is None: items = [{"item_id": x["item_id"], "requested_quantity": x["requested_quantity"]} for x in order["items"]]
        validate_unique_lines(items, "item_id")
        cursor = conn.cursor(); parsed = []
        for line in items:
            qty = validate_positive_integer(line.get("requested_quantity", line.get("quantity")), "requested_quantity")
            cursor.execute("SELECT id, name, unit_id, status, reserved_quantity, current_quantity, (current_quantity - reserved_quantity) AS available_quantity, (SELECT name FROM units WHERE id = items.unit_id) AS unit_name FROM items WHERE id = ?", (line["item_id"],)); item = cursor.fetchone()
            if not item or item["status"] != "active": raise ValidationError("Item is not active", "item_id", "ITEM_NOT_ACTIVE")
            cursor.execute("UPDATE items SET reserved_quantity = reserved_quantity + ? WHERE id = ? AND current_quantity - reserved_quantity >= ?", (qty, item["id"], qty))
            if cursor.rowcount != 1: raise ValidationError("Insufficient available stock", "requested_quantity", "INSUFFICIENT_STOCK")
            parsed.append((item, qty))
        cursor.execute("DELETE FROM leave_order_items WHERE leave_order_id = ?", (order_id,))
        notes = validate_string(notes, "notes", 0, 500, True)
        cursor.execute("UPDATE leave_orders SET status = 'open', notes = ?, rejection_reason = NULL, rejected_by = NULL, rejected_at = NULL, revision = revision + 1 WHERE id = ? AND revision = ?", (notes, order_id, expected_revision))
        for item, qty in parsed: leave_order_model.create_leave_order_item(cursor, order_id, item["id"], item["name"], item["unit_id"], item["unit_name"] or "غير محدد", qty)
        result = leave_order_model.get_leave_order_by_id(conn, order_id); complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def cancel_leave_order_service(order_id, expected_revision, actor_id, idempotency_key=None, db=None):
    validate_positive_integer(order_id, "order_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    key = (idempotency_key or "").strip()
    if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    conn, owned = _transaction(db)
    try:
        def cancel(order):
            if order["status"] != "rejected":
                raise StateConflictError("Only rejected tickets can be cancelled", "INVALID_STATUS_TRANSITION")
            if conn.cursor().execute("UPDATE leave_orders SET status = 'cancelled', revision = revision + 1 WHERE id = ? AND revision = ?", (order_id, expected_revision)).rowcount != 1:
                raise StateConflictError("Cancellation conflict", "REVISION_CONFLICT")
        result = _transition(conn, order_id, expected_revision, actor_id, key, "leave_order_cancel", {"order_id": order_id, "expected_revision": expected_revision}, cancel)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def process_ticket_return_service(order_id, expected_revision, items, actor_id, actor_name=None, notes=None, idempotency_key=None, db=None):
    validate_positive_integer(order_id, "order_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    if not idempotency_key or not str(idempotency_key).strip(): raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    validate_unique_lines(items, "line_id"); conn, owned = _transaction(db); key = str(idempotency_key).strip()
    try:
        check_stock_mutation_allowed(conn)
        replay = reserve_operation(conn, key, "leave_order_return", actor_id, compute_request_hash({"order_id": order_id, "expected_revision": expected_revision, "items": items, "notes": notes}))
        if replay.get("replayed"):
            return replay["response_body"]
        order = leave_order_model.get_leave_order_by_id(conn, order_id)
        if not order: raise ValidationError("Leave order not found", "order_id", "NOT_FOUND")
        if order["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        lines = {x["id"]: x for x in order["items"]}; cursor = conn.cursor(); event = leave_order_model.create_return_event(cursor, order_id, key, actor_id, notes)
        for line in items:
            lid = line["line_id"]; qty = validate_positive_integer(line.get("quantity"), "quantity")
            if lid not in lines: raise ValidationError("Invalid leave order line", "line_id", "INVALID_LINE")
            current = lines[lid]; remaining = current["dispensed_quantity"] - current["returned_quantity"]
            if qty > remaining: raise ValidationError("Return exceeds dispensed quantity", "quantity", "EXCEEDS_RETURNABLE_QUANTITY")
            if not leave_order_model.update_leave_order_item_returned(cursor, lid, qty): raise StateConflictError("Return conflict", "STATE_CONFLICT")
            leave_order_model.create_return_event_item(cursor, event, lid, qty)
            adjust_stock_primitive(conn, current["item_id"], qty, "return", actor_id, actor_name, order["employee_name"], destination_id=order["destination_id"], operation_key=key, leave_line_id=lid, return_event_id=event, details=f"Return on {order['order_number']}", unit_name=current["unit_name"])
        cursor.execute("SELECT COALESCE(SUM(dispensed_quantity), 0), COALESCE(SUM(returned_quantity), 0) FROM leave_order_items WHERE leave_order_id = ?", (order_id,)); dispensed, returned = cursor.fetchone()
        status = "closed" if returned >= dispensed else "partially_returned"
        cursor.execute("UPDATE leave_orders SET status = ?, revision = revision + 1 WHERE id = ? AND revision = ?", (status, order_id, expected_revision))
        result = leave_order_model.get_leave_order_by_id(conn, order_id); complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def close_leave_order_service(*args, **kwargs):
    raise StateConflictError("Manual leave-order close is not supported; warehouse must fulfill the ticket", "INVALID_STATUS_TRANSITION")
