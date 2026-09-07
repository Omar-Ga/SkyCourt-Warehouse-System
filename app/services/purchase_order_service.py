"""
Purchase order service for SkyCourt Warehouse System.
Orchestrates purchase order creation, line snapshots, authoritative numbering,
expiry evaluation, void transitions, barcode generation, and role checks.
"""
import uuid
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional, Dict, List
from urllib.parse import unquote

from app.config import (
    COMPANY_NAME,
    COMPANY_ADDRESS,
    COMPANY_PHONE,
    COMPANY_EMAIL,
    COMPANY_LOGO_URL,
    DEFAULT_CURRENCY,
    DEFAULT_CURRENCY_SCALE
)
from app.models.db_utils import get_db, check_stock_mutation_allowed
from app.models import purchase_order_model
from app.services.barcode_service import generate_barcode_base64
from app.services.item_service import adjust_stock_primitive
from app.services.idempotency_service import (
    compute_request_hash,
    reserve_operation,
    complete_operation,
    StateConflictError
)
from app.validation import (
    ValidationError,
    validate_string,
    validate_integer,
    validate_positive_integer,
    validate_non_negative_integer,
    validate_foreign_key,
    validate_unique_lines,
    validate_decimal_money,
    validate_enum,
    validate_allowed_fields
)


logger = logging.getLogger(__name__)


def _get_utc_now() -> datetime:
    """Returns current authoritative UTC instant."""
    return datetime.now(timezone.utc)


def _format_utc_str(dt: datetime) -> str:
    """Formats datetime as SQLite-compatible UTC string."""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _format_money_str(minor_units: int, scale: int = DEFAULT_CURRENCY_SCALE) -> str:
    """Formats minor units integer to authoritative decimal string."""
    divisor = Decimal(10 ** scale)
    return f"{Decimal(minor_units) / divisor:.{scale}f}"


def format_po_response(
    po_dict: Dict[str, Any],
    items: Optional[List[Dict[str, Any]]] = None,
    role: Optional[str] = None,
    now_utc_str: Optional[str] = None
) -> Dict[str, Any]:
    """
    Formats a raw purchase order dictionary into the authoritative API contract:
    - Computes effective expiry classification.
    - Formats minor unit amounts as authoritative decimal strings.
    - Attaches configured company identity snapshot.
    - Computes allowed actions based on effective status and user role.
    - Formats line items with decimal prices and totals.
    """
    if not now_utc_str:
        now_utc_str = _format_utc_str(_get_utc_now())

    scale = po_dict.get("currency_scale", DEFAULT_CURRENCY_SCALE)
    stored_status = po_dict.get("status", "open")

    # Effective expiry: open orders past expires_at are effectively expired
    expires_at = str(po_dict.get("expires_at", ""))
    is_expired = False
    if stored_status == "open" and expires_at and now_utc_str >= expires_at:
        effective_status = "expired"
        is_expired = True
    else:
        effective_status = stored_status

    # Compute allowed actions
    norm_role = role.lower() if role else None
    allowed_actions = []
    if effective_status == "open":
        if norm_role in ("office", "admin", None):
            allowed_actions.append("void")
        if norm_role in ("warehouse", "admin", None):
            allowed_actions.append("receive")
        allowed_actions.append("print")
    else:
        # Terminal documents (closed, void, expired) remain viewable and printable
        allowed_actions.append("print")

    total_amount_minor = po_dict.get("total_amount", 0)
    total_amount_str = _format_money_str(total_amount_minor, scale)

    # Formatted lines
    formatted_items = []
    line_count = 0
    total_ordered_qty = 0
    total_received_qty = 0

    if items is not None:
        line_count = len(items)
        for line in items:
            unit_price_minor = line.get("unit_price", 0)
            line_total_minor = line.get("line_total", 0)
            ord_qty = line.get("ordered_quantity", 0)
            rec_qty = line.get("received_quantity")

            total_ordered_qty += ord_qty
            if rec_qty is not None:
                total_received_qty += rec_qty

            formatted_items.append({
                "id": line.get("id"),
                "po_id": line.get("po_id"),
                "item_id": line.get("item_id"),
                "item_name": line.get("item_name"),
                "unit_id": line.get("unit_id"),
                "unit_name": line.get("unit_name"),
                "line_description": line.get("line_description") or "",
                "ordered_quantity": ord_qty,
                "received_quantity": rec_qty,
                "disposition": line.get("disposition", "pending"),
                "unit_price": _format_money_str(unit_price_minor, scale),
                "unit_price_minor": unit_price_minor,
                "line_total": _format_money_str(line_total_minor, scale),
                "line_total_minor": line_total_minor,
                "current_item_status": line.get("current_item_status")
            })
    else:
        line_count = po_dict.get("line_count", 0)
        total_ordered_qty = po_dict.get("total_ordered_quantity", 0)
        total_received_qty = po_dict.get("total_received_quantity", 0)

    return {
        "id": po_dict["id"],
        "po_number": po_dict["po_number"],
        "barcode": po_dict["barcode"],
        "provider_id": po_dict["provider_id"],
        "provider_name": po_dict["provider_name"],
        "status": effective_status,
        "db_status": stored_status,
        "is_expired": is_expired,
        "notes": po_dict.get("notes") or "",
        "created_by": po_dict["created_by"],
        "creator_name": po_dict.get("creator_name") or "",
        "created_at": po_dict.get("created_at"),
        "expires_at": po_dict.get("expires_at"),
        "revision": po_dict.get("revision", 0),
        "received_by": po_dict.get("received_by"),
        "receiver_name": po_dict.get("receiver_name"),
        "closed_at": po_dict.get("closed_at"),
        "voided_by": po_dict.get("voided_by"),
        "void_actor_name": po_dict.get("void_actor_name"),
        "voided_at": po_dict.get("voided_at"),
        "void_reason": po_dict.get("void_reason"),
        "currency": po_dict.get("currency", DEFAULT_CURRENCY),
        "currency_scale": scale,
        "total_amount": total_amount_str,
        "total_amount_minor": total_amount_minor,
        "line_count": line_count,
        "total_ordered_quantity": total_ordered_qty,
        "total_received_quantity": total_received_qty if effective_status == "closed" else None,
        "company": {
            "name": COMPANY_NAME,
            "address": COMPANY_ADDRESS,
            "phone": COMPANY_PHONE,
            "email": COMPANY_EMAIL,
            "logo_url": COMPANY_LOGO_URL
        },
        "allowed_actions": allowed_actions,
        "items": formatted_items
    }


def create_purchase_order_service(
    provider_id: int,
    items: List[Dict[str, Any]],
    notes: Optional[str] = None,
    actor_id: Optional[int] = None,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Creates a new purchase order within a single atomic transaction:
    1. Validates provider, active items, positive quantities, finite nonnegative prices.
    2. Enforces idempotency via operations reservation.
    3. Authoritatively allocates PO number (PO-000001) avoiding item barcode collisions.
    4. Computes minor-unit line totals and header total using configured scale.
    5. Calculates expires_at at 48 authoritative UTC hours.
    6. Stores line snapshots and completes the operation.
    """
    # 1. Input Validation
    validate_positive_integer(provider_id, "provider_id")
    cleaned_notes = validate_string(notes, "notes", min_len=0, max_len=500, allow_none=True)

    if not items or not isinstance(items, list):
        raise ValidationError("Purchase order must contain at least one item line", field="items", code="EMPTY_ITEMS")

    validate_unique_lines(items, id_field="item_id")

    # Validate each line item
    parsed_lines = []
    for idx, line in enumerate(items):
        if not isinstance(line, dict):
            raise ValidationError(f"Item line {idx} must be a JSON object", field=f"items[{idx}]", code="INVALID_OBJECT_SHAPE")

        item_id = line.get("item_id")
        validate_positive_integer(item_id, f"items[{idx}].item_id")

        qty = line.get("quantity")
        validate_positive_integer(qty, f"items[{idx}].quantity")

        raw_price = line.get("unit_price")
        price_dec, unit_price_minor = validate_decimal_money(raw_price, f"items[{idx}].unit_price", scale=DEFAULT_CURRENCY_SCALE)

        desc = line.get("line_description")
        cleaned_desc = validate_string(desc, f"items[{idx}].line_description", min_len=0, max_len=500, allow_none=True)

        line_total_minor = qty * unit_price_minor

        parsed_lines.append({
            "item_id": item_id,
            "quantity": qty,
            "price_dec": price_dec,
            "unit_price_minor": unit_price_minor,
            "line_total_minor": line_total_minor,
            "line_description": cleaned_desc
        })

    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", field="Idempotency-Key", code="MISSING_IDEMPOTENCY_KEY")
    idempotency_key = str(idempotency_key).strip()

    if not actor_id:
        raise ValidationError("Authenticated user (actor_id) is required to create a purchase order", field="actor_id", code="MISSING_REQUIRED_FIELD")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        check_stock_mutation_allowed(conn)

        # 2. Idempotency reservation
        canonical_items = [
            {
                "item_id": line["item_id"],
                "quantity": line["quantity"],
                "unit_price": str(line["price_dec"])
            }
            for line in sorted(parsed_lines, key=lambda x: x["item_id"])
        ]
        canonical_payload = {
            "provider_id": provider_id,
            "notes": cleaned_notes,
            "items": canonical_items
        }
        request_hash = compute_request_hash(canonical_payload)

        reservation = reserve_operation(
            conn=conn,
            operation_key=idempotency_key,
            operation_type="purchase_order_create",
            actor_id=actor_id,
            request_hash=request_hash
        )

        if reservation.get("replayed"):
            return reservation["response_body"]

        # 3. Validate Provider exists
        validate_foreign_key(conn, "providers", provider_id, "provider_id")
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM providers WHERE id = ?", (provider_id,))
        prov_row = cursor.fetchone()
        provider_name = prov_row["name"] if hasattr(prov_row, "__getitem__") and "name" in prov_row else prov_row[0]

        # 4. Check all items: exist and status == 'active'
        validated_items = []
        for line in parsed_lines:
            item_id = line["item_id"]
            cursor.execute(
                """
                SELECT i.id, i.name, i.unit_id, u.name AS unit_name, i.status
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

            if status != "active":
                raise ValidationError(
                    f"Cannot order item '{item_name}' (ID {item_id}): status is '{status}'. Only active items can be ordered.",
                    field="status",
                    code="ITEM_NOT_ACTIVE"
                )

            validated_items.append({
                **line,
                "item_name": item_name,
                "unit_id": unit_id,
                "unit_name": unit_name or "غير محدد"
            })

        # 5. Calculate header totals and timestamps
        total_amount_minor = sum(line["line_total_minor"] for line in validated_items)
        now_utc = _get_utc_now()
        now_utc_str = _format_utc_str(now_utc)
        expires_at_dt = now_utc + timedelta(hours=48)
        expires_at_str = _format_utc_str(expires_at_dt)

        # 6. Authoritative Order Number Allocation:
        temp_placeholder = f"__PENDING_PO_{uuid.uuid4().hex}__"
        po_id = purchase_order_model.create_purchase_order(
            cursor=cursor,
            po_number=temp_placeholder,
            barcode=temp_placeholder,
            provider_id=provider_id,
            provider_name=provider_name,
            created_by=actor_id,
            expires_at=expires_at_str,
            currency=DEFAULT_CURRENCY,
            currency_scale=DEFAULT_CURRENCY_SCALE,
            total_amount=total_amount_minor,
            notes=cleaned_notes
        )

        candidate_number = f"PO-{po_id:06d}"
        collision_idx = 1
        while purchase_order_model.check_item_barcode_collision(cursor, candidate_number):
            candidate_number = f"PO-ORD-{po_id:06d}-{collision_idx}"
            collision_idx += 1

        po_number = candidate_number
        barcode_val = candidate_number

        purchase_order_model.update_po_number_and_barcode(
            cursor=cursor,
            po_id=po_id,
            po_number=po_number,
            barcode=barcode_val
        )

        # 7. Insert line item snapshots
        saved_lines = []
        for line in validated_items:
            line_id = purchase_order_model.create_po_item(
                cursor=cursor,
                po_id=po_id,
                item_id=line["item_id"],
                item_name=line["item_name"],
                unit_id=line["unit_id"],
                unit_name=line["unit_name"],
                ordered_quantity=line["quantity"],
                unit_price=line["unit_price_minor"],
                line_total=line["line_total_minor"],
                line_description=line["line_description"]
            )
            saved_lines.append({
                "id": line_id,
                "po_id": po_id,
                "item_id": line["item_id"],
                "item_name": line["item_name"],
                "unit_id": line["unit_id"],
                "unit_name": line["unit_name"],
                "ordered_quantity": line["quantity"],
                "received_quantity": None,
                "disposition": "pending",
                "unit_price": line["unit_price_minor"],
                "line_total": line["line_total_minor"],
                "line_description": line["line_description"]
            })

        # Fetch creator user display name
        cursor.execute("SELECT display_name FROM users WHERE id = ?", (actor_id,))
        user_row = cursor.fetchone()
        creator_name = user_row["display_name"] if hasattr(user_row, "__getitem__") and "display_name" in user_row else user_row[0]

        po_raw = {
            "id": po_id,
            "po_number": po_number,
            "barcode": barcode_val,
            "provider_id": provider_id,
            "provider_name": provider_name,
            "status": "open",
            "notes": cleaned_notes,
            "created_by": actor_id,
            "creator_name": creator_name,
            "created_at": now_utc_str,
            "expires_at": expires_at_str,
            "revision": 0,
            "received_by": None,
            "receiver_name": None,
            "closed_at": None,
            "voided_by": None,
            "void_actor_name": None,
            "voided_at": None,
            "void_reason": None,
            "currency": DEFAULT_CURRENCY,
            "currency_scale": DEFAULT_CURRENCY_SCALE,
            "total_amount": total_amount_minor,
            "line_count": len(saved_lines),
            "total_ordered_quantity": sum(l["ordered_quantity"] for l in saved_lines),
            "total_received_quantity": 0
        }

        response_body = format_po_response(po_raw, saved_lines, role="office", now_utc_str=now_utc_str)

        # 8. Complete operation idempotency
        complete_operation(
            conn=conn,
            operation_key=idempotency_key,
            response_status=201,
            response_body=response_body
        )

        if not caller_owned:
            conn.commit()

        logger.info(f"Purchase order {po_number} (ID {po_id}) successfully created by user {actor_id}")
        return response_body

    except Exception as e:
        if not caller_owned and conn:
            conn.rollback()
        logger.error(f"Failed to create purchase order: {e}", exc_info=True)
        raise e


def get_purchase_order_detail_service(
    po_id: int,
    role: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Retrieves full purchase order details with line items and allowed actions."""
    validate_positive_integer(po_id, "po_id")
    conn = db if db is not None else get_db()

    po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
    if not po:
        raise ValidationError(f"Purchase order with ID {po_id} not found", field="po_id", code="NOT_FOUND")

    items = purchase_order_model.get_purchase_order_items(conn, po_id)
    return format_po_response(po, items, role=role)


def get_purchase_order_by_barcode_service(
    barcode_val: str,
    role: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Retrieves purchase order details by barcode value (URL-decoded)."""
    cleaned_barcode = unquote(barcode_val).strip()
    if not cleaned_barcode:
        raise ValidationError("Barcode cannot be empty", field="barcode", code="EMPTY_STRING")

    conn = db if db is not None else get_db()
    po = purchase_order_model.get_purchase_order_by_barcode(conn, cleaned_barcode)
    if not po:
        raise ValidationError(f"Purchase order with barcode '{cleaned_barcode}' not found", field="barcode", code="NOT_FOUND")

    items = purchase_order_model.get_purchase_order_items(conn, po["id"])
    return format_po_response(po, items, role=role)


def get_purchase_order_barcode_service(
    po_id: int,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Generates base64 PNG barcode image aligned with the existing barcode service contract."""
    validate_positive_integer(po_id, "po_id")
    conn = db if db is not None else get_db()

    po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
    if not po:
        raise ValidationError(f"Purchase order with ID {po_id} not found", field="po_id", code="NOT_FOUND")

    return generate_barcode_base64(po["barcode"])


def list_purchase_orders_service(
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None,
    role: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Lists purchase orders with bounded pagination and status/search filters."""
    page = validate_positive_integer(page, "page")
    page_size = validate_integer(page_size, "page_size", min_val=1, max_val=100)

    conn = db if db is not None else get_db()
    now_utc_str = _format_utc_str(_get_utc_now())

    raw_result = purchase_order_model.list_purchase_orders(
        cursor_or_db=conn,
        page=page,
        page_size=page_size,
        status=status,
        search=search,
        now_utc_str=now_utc_str
    )

    formatted_orders = [
        format_po_response(order, items=None, role=role, now_utc_str=now_utc_str)
        for order in raw_result["purchase_orders"]
    ]

    return {
        "purchase_orders": formatted_orders,
        "total_count": raw_result["total_count"],
        "page": raw_result["page"],
        "page_size": raw_result["page_size"],
        "total_pages": raw_result["total_pages"]
    }


def void_purchase_order_service(
    po_id: int,
    expected_revision: int,
    reason: str,
    actor_id: int,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Voids an open purchase order conditionally:
    1. Validates reason and expected revision.
    2. Enforces idempotency if operation key provided.
    3. Detects expired status transactionally and persists system expiry.
    4. Transitions status from open to void without stock side effects.
    """
    validate_positive_integer(po_id, "po_id")
    validate_non_negative_integer(expected_revision, "expected_revision")
    cleaned_reason = validate_string(reason, "reason", min_len=1, max_len=255)

    if not actor_id:
        raise ValidationError("Authenticated user (actor_id) is required to void a purchase order", field="actor_id", code="MISSING_REQUIRED_FIELD")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        check_stock_mutation_allowed(conn)

        if idempotency_key:
            canonical_payload = {
                "po_id": po_id,
                "expected_revision": expected_revision,
                "reason": cleaned_reason
            }
            request_hash = compute_request_hash(canonical_payload)
            reservation = reserve_operation(
                conn=conn,
                operation_key=idempotency_key,
                operation_type="purchase_order_void",
                actor_id=actor_id,
                request_hash=request_hash
            )
            if reservation.get("replayed"):
                return reservation["response_body"]

        cursor = conn.cursor()
        po = purchase_order_model.get_purchase_order_by_id(cursor, po_id)
        if not po:
            raise ValidationError(f"Purchase order with ID {po_id} not found", field="po_id", code="NOT_FOUND")

        # Check revision match
        if po["revision"] != expected_revision:
            raise StateConflictError(
                f"Revision conflict on PO {po['po_number']}: expected {expected_revision}, but current revision is {po['revision']}",
                code="REVISION_CONFLICT"
            )

        # Check if already terminal
        if po["status"] in ("closed", "void"):
            raise StateConflictError(
                f"Cannot void purchase order in '{po['status']}' state",
                code="INVALID_STATUS_TRANSITION"
            )

        # Check expiry
        now_utc = _get_utc_now()
        now_utc_str = _format_utc_str(now_utc)
        if po["expires_at"] and now_utc_str >= po["expires_at"]:
            # Discovered expiry on mutation: persist authorized system expiry event
            if idempotency_key:
                cursor.execute("DELETE FROM operations WHERE operation_key = ?", (idempotency_key,))
            purchase_order_model.expire_purchase_order(cursor, po_id, now_utc_str, expected_revision)
            if not caller_owned:
                conn.commit()
            raise StateConflictError(
                f"Purchase order {po['po_number']} has expired and cannot be voided",
                code="ORDER_EXPIRED"
            )

        # Execute void transition
        success = purchase_order_model.void_purchase_order(
            cursor=cursor,
            po_id=po_id,
            voided_by=actor_id,
            void_reason=cleaned_reason,
            now_utc_str=now_utc_str,
            expected_revision=expected_revision
        )

        if not success:
            raise StateConflictError(
                f"Failed to void purchase order {po['po_number']}: concurrent state or revision update",
                code="REVISION_CONFLICT"
            )

        updated_po = purchase_order_model.get_purchase_order_by_id(cursor, po_id)
        items = purchase_order_model.get_purchase_order_items(cursor, po_id)
        response_body = format_po_response(updated_po, items, role="office", now_utc_str=now_utc_str)

        if idempotency_key:
            complete_operation(
                conn=conn,
                operation_key=idempotency_key,
                response_status=200,
                response_body=response_body
            )

        if not caller_owned:
            conn.commit()

        logger.info(f"Purchase order {po['po_number']} successfully voided by user {actor_id}")
        return response_body

    except Exception as e:
        if not caller_owned and conn:
            conn.rollback()
        logger.error(f"Failed to void purchase order {po_id}: {e}", exc_info=True)
        raise e


def receive_purchase_order_service(
    po_id: int,
    expected_revision: int,
    items: List[Dict[str, Any]],
    actor_id: int,
    actor_name: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Receives an open purchase order conditionally in a single atomic transaction:
    1. Validates inputs, expected revision, idempotency key, unique line references, valid dispositions.
    2. Enforces every line is accounted for, at least one positive receipt, no over-receipt.
    3. Verifies open status, 48h UTC unexpired boundary, revision match, and active matching-unit item references.
    4. Claims state, updates line outcomes, atomically increments stock balances, logs Additions for received lines.
    5. Closes PO header, records receiver and time, increments revision, completes idempotency record.
    6. Returns updated detail and affected item balances.
    """
    validate_positive_integer(po_id, "po_id")
    validate_non_negative_integer(expected_revision, "expected_revision")

    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", field="Idempotency-Key", code="MISSING_IDEMPOTENCY_KEY")
    idempotency_key = str(idempotency_key).strip()

    if not actor_id:
        raise ValidationError("Authenticated user (actor_id) is required to receive a purchase order", field="actor_id", code="MISSING_REQUIRED_FIELD")

    if not items or not isinstance(items, list):
        raise ValidationError("Purchase order receipt must contain at least one item line", field="items", code="EMPTY_ITEMS")

    validate_unique_lines(items, id_field="line_id")

    cleaned_items = []
    positive_receipts = 0
    for idx, line in enumerate(items):
        if not isinstance(line, dict):
            raise ValidationError(f"Item line {idx} must be a JSON object", field=f"items[{idx}]", code="INVALID_OBJECT_SHAPE")

        validate_allowed_fields(line, {"line_id", "received_quantity", "disposition"})

        line_id = line.get("line_id")
        validate_positive_integer(line_id, f"items[{idx}].line_id")

        disposition = line.get("disposition")
        if disposition not in ("received", "struck_off"):
            raise ValidationError(
                f"Invalid disposition '{disposition}' on line {line_id}. Must be 'received' or 'struck_off'.",
                field=f"items[{idx}].disposition",
                code="INVALID_DISPOSITION"
            )

        rec_qty = line.get("received_quantity")
        if disposition == "struck_off":
            validate_integer(rec_qty, f"items[{idx}].received_quantity", min_val=0, max_val=0)
            rec_qty = 0
        else:
            validate_positive_integer(rec_qty, f"items[{idx}].received_quantity")
            positive_receipts += 1

        cleaned_items.append({
            "line_id": line_id,
            "disposition": disposition,
            "received_quantity": rec_qty
        })

    if positive_receipts == 0:
        raise ValidationError(
            "Purchase order receipt must include at least one positive received quantity. If nothing arrived, leave the order open or void it.",
            field="items",
            code="NO_POSITIVE_RECEIPT"
        )

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        check_stock_mutation_allowed(conn)

        # Idempotency reservation
        canonical_items = [
            {
                "disposition": line["disposition"],
                "line_id": line["line_id"],
                "received_quantity": line["received_quantity"]
            }
            for line in sorted(cleaned_items, key=lambda x: x["line_id"])
        ]
        canonical_payload = {
            "po_id": po_id,
            "expected_revision": expected_revision,
            "items": canonical_items
        }
        request_hash = compute_request_hash(canonical_payload)
        reservation = reserve_operation(
            conn=conn,
            operation_key=idempotency_key,
            operation_type="purchase_order_receive",
            actor_id=actor_id,
            request_hash=request_hash
        )
        if reservation.get("replayed"):
            return reservation["response_body"]

        cursor = conn.cursor()
        po = purchase_order_model.get_purchase_order_by_id(cursor, po_id)
        if not po:
            raise ValidationError(f"Purchase order with ID {po_id} not found", field="po_id", code="NOT_FOUND")

        # Revision check
        if po["revision"] != expected_revision:
            raise StateConflictError(
                f"Revision conflict on PO {po['po_number']}: expected {expected_revision}, but current revision is {po['revision']}",
                code="REVISION_CONFLICT"
            )

        # Terminal status check
        if po["status"] in ("closed", "void"):
            raise StateConflictError(
                f"Cannot receive purchase order in '{po['status']}' state",
                code="INVALID_STATUS_TRANSITION"
            )

        # Expiry check (exact boundary is inclusive: receipt at or after expires_at is rejected)
        now_utc = _get_utc_now()
        now_utc_str = _format_utc_str(now_utc)
        if po["expires_at"] and now_utc_str >= po["expires_at"]:
            cursor.execute("DELETE FROM operations WHERE operation_key = ?", (idempotency_key,))
            purchase_order_model.expire_purchase_order(cursor, po_id, now_utc_str, expected_revision)
            if not caller_owned:
                conn.commit()
            raise StateConflictError(
                f"Purchase order {po['po_number']} has expired and cannot be received",
                code="ORDER_EXPIRED"
            )

        # Fetch DB PO items and match
        db_items = purchase_order_model.get_purchase_order_items(cursor, po_id)
        db_items_by_id = {item["id"]: item for item in db_items}
        req_line_ids = {item["line_id"] for item in cleaned_items}
        db_line_ids = set(db_items_by_id.keys())

        if req_line_ids != db_line_ids:
            raise ValidationError(
                "Receipt must specify every line item of the purchase order exactly once without omission or foreign lines.",
                field="items",
                code="LINE_MISMATCH"
            )

        # Validate line constraints (over-receipt, item existence, active status, unit match)
        for line in cleaned_items:
            lid = line["line_id"]
            poi = db_items_by_id[lid]
            rec_qty = line["received_quantity"]
            ord_qty = poi["ordered_quantity"]

            if rec_qty > ord_qty:
                raise ValidationError(
                    f"Received quantity {rec_qty} exceeds ordered quantity {ord_qty} for item '{poi['item_name']}'",
                    field="received_quantity",
                    code="OVER_RECEIPT"
                )

            if line["disposition"] == "received" and rec_qty > 0:
                cursor.execute(
                    "SELECT id, name, unit_id, status FROM items WHERE id = ?",
                    (poi["item_id"],)
                )
                item_row = cursor.fetchone()
                if not item_row:
                    raise ValidationError(
                        f"Item '{poi['item_name']}' (ID {poi['item_id']}) does not exist in master items",
                        field="item_id",
                        code="ITEM_NOT_FOUND"
                    )
                item_status = item_row["status"] if hasattr(item_row, "__getitem__") and "status" in item_row else item_row[3]
                item_unit_id = item_row["unit_id"] if hasattr(item_row, "__getitem__") and "unit_id" in item_row else item_row[2]

                if item_status != "active":
                    raise ValidationError(
                        f"Cannot receive item '{poi['item_name']}' (ID {poi['item_id']}): status is '{item_status}'. Pending PO receipts against inactive/archived items require warehouse restoration before receipt.",
                        field="status",
                        code="ITEM_NOT_ACTIVE"
                    )

                if item_unit_id != poi["unit_id"]:
                    raise ValidationError(
                        f"Item '{poi['item_name']}' unit mismatch: current unit (ID {item_unit_id}) does not match order snapshot unit '{poi['unit_name']}' (ID {poi['unit_id']}). Reconcile item unit before receiving.",
                        field="unit_id",
                        code="UNIT_MISMATCH"
                    )

        # Execute line updates and stock increments
        scale = po.get("currency_scale", DEFAULT_CURRENCY_SCALE)
        affected_balances = []

        # Query actor display name if not provided
        if not actor_name:
            cursor.execute("SELECT display_name FROM users WHERE id = ?", (actor_id,))
            u_row = cursor.fetchone()
            if u_row:
                actor_name = u_row["display_name"] if hasattr(u_row, "__getitem__") and "display_name" in u_row else u_row[0]

        for line in cleaned_items:
            lid = line["line_id"]
            poi = db_items_by_id[lid]
            rec_qty = line["received_quantity"]
            disp = line["disposition"]

            # 1. Update purchase_order_items line
            updated_line = purchase_order_model.update_po_item_receipt(
                cursor=cursor,
                line_id=lid,
                received_quantity=rec_qty,
                disposition=disp
            )
            if not updated_line:
                raise StateConflictError(
                    f"Failed to update purchase order line {lid}: concurrent update",
                    code="STATE_CONFLICT"
                )

            # 2. Stock increment & Addition log (received lines only)
            if disp == "received" and rec_qty > 0:
                unit_price_minor = poi.get("unit_price", 0)
                cost_float = float(Decimal(unit_price_minor) / Decimal(10 ** scale))

                balance = adjust_stock_primitive(
                    conn=conn,
                    item_id=poi["item_id"],
                    change_amount=rec_qty,
                    action_type="addition",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    provider_id=po["provider_id"],
                    cost=cost_float,
                    operation_key=idempotency_key,
                    po_line_id=lid,
                    details=f"PO Receipt {po['po_number']}",
                    unit_name=poi["unit_name"]
                )
                affected_balances.append(balance)

        # 3. Close PO header
        closed = purchase_order_model.close_purchase_order_receipt(
            cursor=cursor,
            po_id=po_id,
            received_by=actor_id,
            now_utc_str=now_utc_str,
            expected_revision=expected_revision
        )
        if not closed:
            raise StateConflictError(
                f"Failed to close purchase order {po['po_number']}: concurrent revision or state change",
                code="STATE_CONFLICT"
            )

        # 4. Fetch updated PO and lines
        updated_po = purchase_order_model.get_purchase_order_by_id(cursor, po_id)
        updated_lines = purchase_order_model.get_purchase_order_items(cursor, po_id)
        po_response = format_po_response(updated_po, updated_lines, role="warehouse", now_utc_str=now_utc_str)

        response_body = {
            **po_response,
            "affected_balances": affected_balances
        }

        # 5. Complete idempotency record
        complete_operation(
            conn=conn,
            operation_key=idempotency_key,
            response_status=200,
            response_body=response_body
        )

        if not caller_owned:
            conn.commit()

        logger.info(f"Purchase order {po['po_number']} successfully received and closed by user {actor_id}")
        return response_body

    except Exception as e:
        if not caller_owned and conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.error(f"Failed to receive purchase order {po_id}: {e}", exc_info=True)
        raise e

