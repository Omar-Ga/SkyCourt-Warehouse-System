"""
Leave order service for SkyCourt Warehouse System.
Orchestrates atomic leave order creation, stock deduction, audit logging,
idempotency, and conditional closure.
"""
import uuid
import logging
from typing import Any, Optional, Dict, List

from app.models.db_utils import get_db, check_stock_mutation_allowed
from app.models import leave_order_model
from app.services.item_service import adjust_stock_primitive
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    IdempotencyConflictError,
    StateConflictError
)
from app.validation import (
    ValidationError,
    validate_string,
    validate_positive_integer,
    validate_non_negative_integer,
    validate_foreign_key,
    validate_unique_lines
)

logger = logging.getLogger(__name__)


def create_leave_order_service(
    employee_name: str,
    destination_id: int,
    items: List[Dict[str, Any]],
    notes: Optional[str] = None,
    actor_id: Optional[int] = None,
    actor_name: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Creates a new leave order within a single atomic database transaction:
    1. Validates inputs, nonblank employee, destination, active items, and stock sufficiency.
    2. Enforces idempotency via operations reservation.
    3. Authoritatively allocates order number derived from primary autoincrement ID (LO-000001).
    4. Creates immutable line snapshots.
    5. Atomically deducts stock and records linked removal logs.
    6. Completes the operation reservation and commits.
    """
    # 1. Input Validation
    cleaned_employee = validate_string(employee_name, "employee_name", min_len=1, max_len=150)
    validate_positive_integer(destination_id, "destination_id")
    cleaned_notes = validate_string(notes, "notes", min_len=0, max_len=500, allow_none=True)
    validate_unique_lines(items, id_field="item_id")

    for idx, line in enumerate(items):
        qty = line.get("quantity")
        validate_positive_integer(qty, f"items[{idx}].quantity")

    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", field="Idempotency-Key", code="MISSING_IDEMPOTENCY_KEY")
    idempotency_key = str(idempotency_key).strip()

    if not actor_id:
        raise ValidationError("Authenticated user (actor_id) is required to create a leave order", field="actor_id", code="MISSING_REQUIRED_FIELD")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        check_stock_mutation_allowed(conn)

        # 2. Idempotency reservation
        canonical_items = [
            {"item_id": line["item_id"], "quantity": line["quantity"]}
            for line in sorted(items, key=lambda x: x["item_id"])
        ]
        canonical_payload = {
            "employee_name": cleaned_employee,
            "destination_id": destination_id,
            "notes": cleaned_notes,
            "items": canonical_items
        }
        request_hash = compute_request_hash(canonical_payload)

        reservation = reserve_operation(
            conn=conn,
            operation_key=idempotency_key,
            operation_type="leave_order_create",
            actor_id=actor_id,
            request_hash=request_hash
        )

        if reservation.get("replayed"):
            return reservation["response_body"]

        # 3. Validate Destination exists
        validate_foreign_key(conn, "destinations", destination_id, "destination_id")
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM destinations WHERE id = ?", (destination_id,))
        dest_row = cursor.fetchone()
        destination_name = dest_row["name"] if hasattr(dest_row, "__getitem__") and "name" in dest_row else dest_row[0]

        # 4. Check all items: exist, status == 'active', current_quantity >= quantity
        validated_items = []
        for line in items:
            item_id = line["item_id"]
            qty = line["quantity"]

            cursor.execute(
                """
                SELECT i.id, i.name, i.unit_id, u.name AS unit_name, i.status, i.current_quantity
                FROM items i
                LEFT JOIN units u ON i.unit_id = u.id
                WHERE i.id = ?
                """,
                (item_id,)
            )
            item_row = cursor.fetchone()
            if not item_row:
                raise ValidationError(
                    f"Item with ID {item_id} does not exist",
                    field="item_id",
                    code="ITEM_NOT_FOUND"
                )

            item_name = item_row["name"] if hasattr(item_row, "__getitem__") and "name" in item_row else item_row[1]
            unit_id = item_row["unit_id"] if hasattr(item_row, "__getitem__") and "unit_id" in item_row else item_row[2]
            unit_name = item_row["unit_name"] if hasattr(item_row, "__getitem__") and "unit_name" in item_row else item_row[3]
            status = item_row["status"] if hasattr(item_row, "__getitem__") and "status" in item_row else item_row[4]
            current_qty = item_row["current_quantity"] if hasattr(item_row, "__getitem__") and "current_quantity" in item_row else item_row[5]

            if status != "active":
                raise ValidationError(
                    f"Cannot disburse item '{item_name}' (ID {item_id}): status is '{status}'. Only active items can be disbursed.",
                    field="status",
                    code="ITEM_NOT_ACTIVE"
                )

            if current_qty < qty:
                raise ValidationError(
                    f"Insufficient stock for item '{item_name}': available {current_qty}, requested {qty}.",
                    field="quantity",
                    code="INSUFFICIENT_STOCK"
                )

            validated_items.append({
                "item_id": item_id,
                "item_name": item_name,
                "unit_id": unit_id,
                "unit_name": unit_name or "غير محدد",
                "quantity": qty
            })

        # 5. Authoritative Order Number Allocation:
        # Insert with temporary unique placeholder to obtain primary key ID
        temp_placeholder = f"__PENDING_{uuid.uuid4().hex}__"
        order_id = leave_order_model.create_leave_order(
            cursor=cursor,
            order_number=temp_placeholder,
            employee_name=cleaned_employee,
            destination_id=destination_id,
            destination_name=destination_name,
            notes=cleaned_notes,
            created_by=actor_id
        )

        order_number = f"LO-{order_id:06d}"
        leave_order_model.update_order_number(cursor, order_id, order_number)

        # 6. Insert lines and deduct stock via adjust_stock_primitive
        for item_data in validated_items:
            line_id = leave_order_model.create_leave_order_item(
                cursor=cursor,
                leave_order_id=order_id,
                item_id=item_data["item_id"],
                item_name=item_data["item_name"],
                unit_id=item_data["unit_id"],
                unit_name=item_data["unit_name"],
                quantity=item_data["quantity"]
            )

            # Atomic conditional deduction & movement log
            try:
                adjust_stock_primitive(
                    conn=conn,
                    item_id=item_data["item_id"],
                    change_amount=item_data["quantity"],
                    action_type="removal",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    person_name=cleaned_employee,
                    destination_id=destination_id,
                    operation_key=idempotency_key,
                    leave_line_id=line_id,
                    details=f"Leave Order {order_number}",
                    unit_name=item_data["unit_name"]
                )
            except ValueError as ve:
                err_str = str(ve)
                if "insufficient stock" in err_str.lower():
                    raise ValidationError(err_str, field="quantity", code="INSUFFICIENT_STOCK")
                if "cannot deduct stock" in err_str.lower() or "inactive" in err_str.lower() or "archived" in err_str.lower():
                    raise ValidationError(err_str, field="status", code="ITEM_NOT_ACTIVE")
                raise ve

        # 7. Build full response representation
        order_detail = leave_order_model.get_leave_order_by_id(conn, order_id)

        # 8. Complete idempotency operation record
        complete_operation(conn, idempotency_key, 201, order_detail)

        if not caller_owned:
            conn.commit()

        return order_detail

    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def get_leave_order_detail_service(order_id: int, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """Fetches full leave order detail by ID."""
    validate_positive_integer(order_id, "order_id")
    conn = db if db is not None else get_db()
    return leave_order_model.get_leave_order_by_id(conn, order_id)


def list_leave_orders_service(
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Lists paginated leave orders."""
    valid_page = validate_positive_integer(page, "page") or 1
    valid_page_size = validate_positive_integer(page_size, "page_size") or 20
    if valid_page_size > 100:
        valid_page_size = 100

    conn = db if db is not None else get_db()
    orders, total_count = leave_order_model.list_leave_orders(
        cursor_or_db=conn,
        page=valid_page,
        page_size=valid_page_size,
        status=status,
        search=search
    )

    import math
    total_pages = math.ceil(total_count / valid_page_size) if total_count > 0 else 0

    return {
        "leave_orders": orders,
        "total_count": total_count,
        "page": valid_page,
        "page_size": valid_page_size,
        "total_pages": total_pages
    }


def get_actionable_tickets_count_service(db: Optional[Any] = None) -> int:
    """Returns the count of open and partially_returned leave orders."""
    conn = db if db is not None else get_db()
    return leave_order_model.get_actionable_tickets_count(conn)


def close_leave_order_service(
    order_id: int,
    closed_by: int,
    reason: str,
    expected_revision: int,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Manually closes an open or partially returned leave order with a disposition reason.
    Conditional on expected revision.
    """
    validate_positive_integer(order_id, "order_id")
    cleaned_reason = validate_string(reason, "reason", min_len=1, max_len=500)
    validate_non_negative_integer(expected_revision, "expected_revision")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        if idempotency_key:
            payload = {
                "order_id": order_id,
                "reason": cleaned_reason,
                "expected_revision": expected_revision
            }
            req_hash = compute_request_hash(payload)
            res = reserve_operation(conn, idempotency_key, "leave_order_close", closed_by, req_hash)
            if res.get("replayed"):
                return res["response_body"]

        cursor = conn.cursor()
        order = leave_order_model.get_leave_order_by_id(conn, order_id)
        if not order:
            raise ValidationError(f"Leave order with ID {order_id} not found", field="order_id", code="NOT_FOUND")

        if order["status"] == "closed":
            raise StateConflictError(f"Leave order {order['order_number']} is already closed", code="STATE_CONFLICT")

        if order["revision"] != expected_revision:
            raise StateConflictError(
                f"Revision conflict: current revision is {order['revision']}, expected {expected_revision}",
                code="REVISION_CONFLICT"
            )

        updated = leave_order_model.close_leave_order_conditional(
            cursor=cursor,
            order_id=order_id,
            closed_by=closed_by,
            reason=cleaned_reason,
            expected_revision=expected_revision
        )

        if not updated:
            raise StateConflictError(
                f"Failed to close leave order {order['order_number']}: state or revision changed concurrently",
                code="STATE_CONFLICT"
            )

        updated_detail = leave_order_model.get_leave_order_by_id(conn, order_id)

        if idempotency_key:
            complete_operation(conn, idempotency_key, 200, updated_detail)

        if not caller_owned:
            conn.commit()

        return updated_detail

    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def process_ticket_return_service(
    order_id: int,
    expected_revision: int,
    items: List[Dict[str, Any]],
    actor_id: int,
    actor_name: Optional[str] = None,
    notes: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Processes returns against a leave order within a single atomic database transaction:
    1. Validates input shapes, positive integer deltas, and unique line references.
    2. Enforces idempotency via operations reservation.
    3. Verifies expected revision and non-exceeded returnable quantities.
    4. Enforces unit match against current item snapshot.
    5. Restores stock conditionally via adjust_stock_primitive (active, inactive, or archived).
    6. Writes immutable return event, return event lines, and Return audit logs.
    7. Updates leave order status (partially_returned, closed, or permitted late return).
    8. Completes operation reservation and commits.
    """
    validate_positive_integer(order_id, "order_id")
    validate_non_negative_integer(expected_revision, "expected_revision")
    cleaned_notes = validate_string(notes, "notes", min_len=0, max_len=500, allow_none=True)

    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", field="Idempotency-Key", code="MISSING_IDEMPOTENCY_KEY")
    idempotency_key = str(idempotency_key).strip()

    if not actor_id:
        raise ValidationError("Authenticated user (actor_id) is required to process returns", field="actor_id", code="MISSING_REQUIRED_FIELD")

    if not isinstance(items, list) or len(items) == 0:
        raise ValidationError("items must be a non-empty list", field="items", code="EMPTY_ITEMS")

    cleaned_items = []
    seen_line_ids = set()
    for idx, line in enumerate(items):
        if not isinstance(line, dict):
            raise ValidationError(f"Item at index {idx} must be an object", field=f"items[{idx}]", code="INVALID_OBJECT_SHAPE")
        lid = line.get("line_id") if "line_id" in line else line.get("leave_order_item_id")
        validate_positive_integer(lid, f"items[{idx}].line_id")
        qty = line.get("quantity")
        validate_positive_integer(qty, f"items[{idx}].quantity")
        if lid in seen_line_ids:
            raise ValidationError(f"Duplicate line ID {lid} in return items", field="items", code="DUPLICATE_LINE")
        seen_line_ids.add(lid)
        cleaned_items.append({"line_id": lid, "quantity": qty})

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        check_stock_mutation_allowed(conn)

        # Idempotency reservation
        canonical_items = [
            {"line_id": line["line_id"], "quantity": line["quantity"]}
            for line in sorted(cleaned_items, key=lambda x: x["line_id"])
        ]
        canonical_payload = {
            "order_id": order_id,
            "expected_revision": expected_revision,
            "notes": cleaned_notes,
            "items": canonical_items
        }
        req_hash = compute_request_hash(canonical_payload)
        reservation = reserve_operation(
            conn=conn,
            operation_key=idempotency_key,
            operation_type="ticket_return",
            actor_id=actor_id,
            request_hash=req_hash
        )
        if reservation.get("replayed"):
            return reservation["response_body"]

        cursor = conn.cursor()
        order = leave_order_model.get_leave_order_by_id(conn, order_id)
        if not order:
            raise ValidationError(f"Leave order with ID {order_id} not found", field="order_id", code="NOT_FOUND")

        if order["revision"] != expected_revision:
            raise StateConflictError(
                f"Revision conflict: current revision is {order['revision']}, expected {expected_revision}",
                code="REVISION_CONFLICT"
            )

        cursor.execute(
            """
            SELECT loi.id, loi.item_id, loi.item_name, loi.unit_id, loi.unit_name, loi.quantity, loi.returned_quantity,
                   i.unit_id AS current_unit_id, i.name AS current_item_name, i.status AS current_item_status
            FROM leave_order_items loi
            LEFT JOIN items i ON loi.item_id = i.id
            WHERE loi.leave_order_id = ?
            """,
            (order_id,)
        )
        raw_lines = cursor.fetchall()
        order_lines = {}
        for raw_r in raw_lines:
            r = leave_order_model._row_to_dict(cursor, raw_r)
            if r:
                order_lines[r["id"]] = r

        for line in cleaned_items:
            lid = line["line_id"]
            delta = line["quantity"]
            if lid not in order_lines:
                raise ValidationError(f"Line ID {lid} does not belong to leave order {order_id}", field="items", code="INVALID_LINE")
            db_line = order_lines[lid]
            if db_line["current_item_name"] is None:
                raise ValidationError(f"Item with ID {db_line['item_id']} no longer exists", field="item_id", code="ITEM_NOT_FOUND")
            if db_line["current_unit_id"] != db_line["unit_id"]:
                raise ValidationError(
                    f"Item '{db_line['item_name']}' unit has changed since leave order was issued. Snapshot unit '{db_line['unit_name']}' differs from current item unit. Reconciliation required.",
                    field="unit_id",
                    code="UNIT_MISMATCH"
                )
            remaining = db_line["quantity"] - db_line["returned_quantity"]
            if remaining <= 0:
                raise ValidationError(
                    f"Line {lid} for item '{db_line['item_name']}' has already been fully returned",
                    field="quantity",
                    code="EXCEEDS_RETURNABLE_QUANTITY"
                )
            if delta > remaining:
                raise ValidationError(
                    f"Return quantity {delta} exceeds remaining quantity {remaining} for item '{db_line['item_name']}'",
                    field="quantity",
                    code="EXCEEDS_RETURNABLE_QUANTITY"
                )

        return_event_id = leave_order_model.create_return_event(
            cursor=cursor,
            leave_order_id=order_id,
            operation_key=idempotency_key,
            created_by=actor_id,
            notes=cleaned_notes
        )

        for line in cleaned_items:
            lid = line["line_id"]
            delta = line["quantity"]
            db_line = order_lines[lid]

            updated_line = leave_order_model.update_leave_order_item_returned(cursor, lid, delta)
            if not updated_line:
                raise StateConflictError(
                    f"Concurrent conflict updating returned quantity on line {lid}",
                    code="STATE_CONFLICT"
                )

            leave_order_model.create_return_event_item(cursor, return_event_id, lid, delta)

            adjust_stock_primitive(
                conn=conn,
                item_id=db_line["item_id"],
                change_amount=delta,
                action_type="return",
                actor_id=actor_id,
                actor_name=actor_name,
                person_name=order["employee_name"],
                destination_id=order["destination_id"],
                operation_key=idempotency_key,
                leave_line_id=lid,
                return_event_id=return_event_id,
                details=f"Return on {order['order_number']}",
                unit_name=db_line["unit_name"]
            )

        cursor.execute(
            """
            SELECT SUM(quantity) AS total_qty, SUM(returned_quantity) AS total_ret
            FROM leave_order_items
            WHERE leave_order_id = ?
            """,
            (order_id,)
        )
        raw_agg = cursor.fetchone()
        agg = leave_order_model._row_to_dict(cursor, raw_agg) if raw_agg else None
        total_qty = agg["total_qty"] if agg and agg.get("total_qty") is not None else 0
        total_ret = agg["total_ret"] if agg and agg.get("total_ret") is not None else 0

        if order["status"] == "closed":
            # Permitted late return: remains closed, preserves original closure details
            updated = leave_order_model.update_leave_order_on_return(
                cursor=cursor,
                order_id=order_id,
                expected_revision=expected_revision,
                new_status="closed"
            )
        elif total_ret >= total_qty:
            # Full return: automatically closed with reason
            updated = leave_order_model.update_leave_order_on_return(
                cursor=cursor,
                order_id=order_id,
                expected_revision=expected_revision,
                new_status="closed",
                closed_by=actor_id,
                close_reason="All items returned"
            )
        else:
            # Partial return
            updated = leave_order_model.update_leave_order_on_return(
                cursor=cursor,
                order_id=order_id,
                expected_revision=expected_revision,
                new_status="partially_returned"
            )

        if not updated:
            raise StateConflictError(
                f"Failed to update leave order {order['order_number']}: state or revision changed concurrently",
                code="STATE_CONFLICT"
            )

        updated_detail = leave_order_model.get_leave_order_by_id(conn, order_id)
        complete_operation(conn, idempotency_key, 200, updated_detail)

        if not caller_owned:
            conn.commit()

        return updated_detail

    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e

