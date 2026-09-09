"""Business operations for draft, dispatched, and received purchase orders."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.config import (
    COMPANY_ADDRESS, COMPANY_EMAIL, COMPANY_LOGO_URL, COMPANY_NAME, COMPANY_PHONE,
    DEFAULT_CURRENCY, DEFAULT_CURRENCY_SCALE,
)
from app.models.db_utils import get_db, check_stock_mutation_allowed
from app.models import purchase_order_model
from app.services.item_service import adjust_stock_primitive
from app.services.idempotency_service import compute_request_hash, reserve_operation, complete_operation, StateConflictError
from app.validation import (
    ValidationError, validate_decimal_money, validate_foreign_key, validate_integer,
    validate_non_negative_integer, validate_positive_integer, validate_string,
    validate_unique_lines,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _money(value: int, scale: int = DEFAULT_CURRENCY_SCALE) -> str:
    return f"{Decimal(value) / Decimal(10 ** scale):.{scale}f}"


def format_po_response(po: Dict[str, Any], items: Optional[List[Dict[str, Any]]] = None,
                       role: Optional[str] = None, now_utc_str: Optional[str] = None) -> Dict[str, Any]:
    now_utc_str = now_utc_str or _utc(_now())
    stored_status = po.get("status", "draft")
    expires_at = po.get("expires_at")
    expired = stored_status == "open" and expires_at and now_utc_str >= str(expires_at)
    status = "expired" if expired else stored_status
    norm_role = role.lower() if role else None
    actions = ["print"]
    if status == "draft" and norm_role in ("office", "admin", None):
        actions += ["edit", "dispatch", "void"]
    elif status == "open":
        if norm_role in ("office", "admin", None):
            actions.append("void")
        if norm_role in ("warehouse", "admin", None):
            actions.append("receive")

    scale = po.get("currency_scale", DEFAULT_CURRENCY_SCALE)
    lines = []
    if items is not None:
        for line in items:
            requested = line.get("requested_quantity", 0)
            ordered = line.get("ordered_quantity", line.get("quantity", requested))
            lines.append({
                "id": line.get("id"), "po_id": line.get("po_id"), "item_id": line.get("item_id"),
                "item_name": line.get("item_name"), "unit_id": line.get("unit_id"), "unit_name": line.get("unit_name"),
                "line_description": line.get("line_description") or "", "requested_quantity": requested,
                "ordered_quantity": ordered, "received_quantity": line.get("received_quantity", 0),
                "unit_price": _money(line.get("unit_price", 0), scale), "unit_price_minor": line.get("unit_price", 0),
                "line_total": _money(line.get("line_total", 0), scale), "line_total_minor": line.get("line_total", 0),
                "disposition": line.get("disposition", "pending"), "current_item_status": line.get("current_item_status"),
            })
    else:
        lines = []
    return {
        "id": po["id"], "po_number": po["po_number"], "provider_id": po["provider_id"],
        "provider_name": po["provider_name"], "status": status, "db_status": stored_status,
        "is_expired": bool(expired), "notes": po.get("notes") or "", "created_by": po["created_by"],
        "creator_name": po.get("creator_name") or "", "created_at": po.get("created_at"),
        "dispatched_at": po.get("dispatched_at"), "dispatched_by": po.get("dispatched_by"),
        "dispatcher_name": po.get("dispatcher_name"), "expires_at": expires_at,
        "revision": po.get("revision", 0), "received_by": po.get("received_by"),
        "receiver_name": po.get("receiver_name"), "closed_at": po.get("closed_at"),
        "voided_by": po.get("voided_by"), "void_actor_name": po.get("void_actor_name"),
        "voided_at": po.get("voided_at"), "void_reason": po.get("void_reason"),
        "currency": po.get("currency", DEFAULT_CURRENCY), "currency_scale": scale,
        "total_amount": _money(po.get("total_amount", 0), scale), "total_amount_minor": po.get("total_amount", 0),
        "line_count": len(lines) if items is not None else po.get("line_count", 0),
        "total_ordered_quantity": sum(x["ordered_quantity"] for x in lines) if items is not None else po.get("total_ordered_quantity", 0),
        "total_received_quantity": sum(x["received_quantity"] for x in lines) if items is not None and status == "closed" else None,
        "company": {"name": COMPANY_NAME, "address": COMPANY_ADDRESS, "phone": COMPANY_PHONE, "email": COMPANY_EMAIL, "logo_url": COMPANY_LOGO_URL},
        "allowed_actions": actions, "items": lines,
    }


def _parse_lines(conn: Any, items: List[Dict[str, Any]], existing: Optional[Dict[int, int]] = None) -> List[Dict[str, Any]]:
    validate_unique_lines(items, id_field="item_id")
    parsed = []
    for index, line in enumerate(items):
        item_id = validate_positive_integer(line.get("item_id"), f"items[{index}].item_id")
        requested = line.get("requested_quantity", line.get("quantity", 0))
        ordered = line.get("ordered_quantity", line.get("quantity", 0))
        validate_non_negative_integer(requested, f"items[{index}].requested_quantity")
        validate_non_negative_integer(ordered, f"items[{index}].ordered_quantity")
        if existing and item_id in existing:
            requested = existing[item_id]
        _, price_minor = validate_decimal_money(line.get("unit_price", "0"), f"items[{index}].unit_price", DEFAULT_CURRENCY_SCALE)
        description = validate_string(line.get("line_description"), f"items[{index}].line_description", 0, 500, True)
        cursor = conn.cursor()
        cursor.execute("SELECT i.id, i.name, i.unit_id, i.status, u.name AS unit_name FROM items i LEFT JOIN units u ON u.id = i.unit_id WHERE i.id = ?", (item_id,))
        row = cursor.fetchone()
        if not row:
            raise ValidationError(f"Item with ID {item_id} does not exist", "item_id", "ITEM_NOT_FOUND")
        if row["status"] != "active":
            raise ValidationError(f"Item '{row['name']}' is not active", "status", "ITEM_NOT_ACTIVE")
        parsed.append({
            "item_id": item_id, "item_name": row["name"], "unit_id": row["unit_id"], "unit_name": row["unit_name"] or "غير محدد",
            "requested_quantity": requested, "ordered_quantity": ordered, "unit_price": price_minor,
            "line_total": ordered * price_minor, "line_description": description,
        })
    return parsed


def _response(conn, po_id: int, role: str = "office") -> Dict[str, Any]:
    po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
    return format_po_response(po, purchase_order_model.get_purchase_order_items(conn, po_id), role=role)


def create_purchase_order_service(provider_id: int, items: List[Dict[str, Any]], notes: Optional[str] = None,
                                  actor_id: Optional[int] = None, idempotency_key: Optional[str] = None,
                                  db: Optional[Any] = None) -> Dict[str, Any]:
    validate_positive_integer(provider_id, "provider_id")
    notes = validate_string(notes, "notes", 0, 500, True)
    if not idempotency_key or not str(idempotency_key).strip():
        raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    validate_positive_integer(actor_id, "actor_id")
    conn = db or get_db()
    owned = db is None
    try:
        validate_foreign_key(conn, "providers", provider_id, "provider_id")
        parsed = _parse_lines(conn, items)
        key = str(idempotency_key).strip()
        payload = {"provider_id": provider_id, "notes": notes, "items": parsed}
        replay = reserve_operation(conn, key, "purchase_order_create_draft", actor_id, compute_request_hash(payload))
        if replay.get("replayed"):
            return replay["response_body"]
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM providers WHERE id = ?", (provider_id,))
        provider_name = cursor.fetchone()[0]
        placeholder = f"__PENDING_PO_{uuid.uuid4().hex}__"
        po_id = purchase_order_model.create_purchase_order(cursor, placeholder, provider_id, provider_name, actor_id,
                                                            DEFAULT_CURRENCY, DEFAULT_CURRENCY_SCALE,
                                                            sum(x["line_total"] for x in parsed), notes)
        purchase_order_model.update_po_number(cursor, po_id, f"PO-{po_id:06d}")
        for line in parsed:
            purchase_order_model.create_po_item(cursor, po_id, **line)
        result = _response(conn, po_id, "office")
        complete_operation(conn, key, 201, result)
        if owned:
            conn.commit()
        return result
    except Exception:
        if owned:
            conn.rollback()
        raise


def get_purchase_order_detail_service(po_id: int, role: Optional[str] = None, db: Optional[Any] = None) -> Dict[str, Any]:
    validate_positive_integer(po_id, "po_id")
    conn = db or get_db()
    po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
    if not po or (role == "warehouse" and po["status"] == "draft"):
        raise ValidationError(f"Purchase order with ID {po_id} not found", "po_id", "NOT_FOUND")
    return format_po_response(po, purchase_order_model.get_purchase_order_items(conn, po_id), role=role)


def list_purchase_orders_service(page=1, page_size=20, status=None, search=None, role=None, db=None):
    page = validate_positive_integer(page, "page")
    page_size = validate_integer(page_size, "page_size", 1, 100)
    conn = db or get_db()
    now = _utc(_now())
    result = purchase_order_model.list_purchase_orders(conn, page, page_size, status, search, now, role)
    return {**result, "purchase_orders": [format_po_response(x, role=role, now_utc_str=now) for x in result["purchase_orders"]]}


def edit_purchase_order_service(po_id: int, provider_id: int, items: List[Dict[str, Any]], notes: Optional[str],
                                expected_revision: int, actor_id: int, idempotency_key: str, db=None):
    validate_positive_integer(po_id, "po_id"); validate_positive_integer(provider_id, "provider_id")
    validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    if not idempotency_key or not idempotency_key.strip():
        raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    conn = db or get_db(); owned = db is None
    try:
        po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
        if not po: raise ValidationError("Purchase order not found", "po_id", "NOT_FOUND")
        if po["status"] != "draft": raise StateConflictError("Only draft purchase orders can be edited", "INVALID_STATUS_TRANSITION")
        if po["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        existing = {x["item_id"]: x["requested_quantity"] for x in purchase_order_model.get_purchase_order_items(conn, po_id)}
        parsed = _parse_lines(conn, items, existing)
        notes = validate_string(notes, "notes", 0, 500, True)
        key = idempotency_key.strip()
        replay = reserve_operation(conn, key, "purchase_order_edit_draft", actor_id, compute_request_hash({"po_id": po_id, "provider_id": provider_id, "items": parsed, "notes": notes, "expected_revision": expected_revision}))
        if replay.get("replayed"): return replay["response_body"]
        validate_foreign_key(conn, "providers", provider_id, "provider_id")
        cursor = conn.cursor(); cursor.execute("SELECT name FROM providers WHERE id = ?", (provider_id,)); provider_name = cursor.fetchone()[0]
        purchase_order_model.replace_draft_items(cursor, po_id, parsed)
        cursor.execute("UPDATE purchase_orders SET provider_id = ?, provider_name = ?, notes = ?, total_amount = ?, revision = revision + 1 WHERE id = ? AND status = 'draft' AND revision = ?", (provider_id, provider_name, notes, sum(x["line_total"] for x in parsed), po_id, expected_revision))
        result = _response(conn, po_id, "office"); complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def dispatch_purchase_order_service(po_id: int, expected_revision: int, actor_id: int, idempotency_key: str, db=None):
    validate_positive_integer(po_id, "po_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    conn = db or get_db(); owned = db is None
    try:
        po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
        if not po: raise ValidationError("Purchase order not found", "po_id", "NOT_FOUND")
        if po["status"] != "draft": raise StateConflictError("Only drafts can be dispatched", "INVALID_STATUS_TRANSITION")
        if po["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        lines = purchase_order_model.get_purchase_order_items(conn, po_id)
        if not any(x["ordered_quantity"] > 0 for x in lines): raise ValidationError("At least one ordered quantity must be positive", "items", "EMPTY_ORDER")
        key = idempotency_key.strip() if idempotency_key else ""
        if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
        replay = reserve_operation(conn, key, "purchase_order_dispatch", actor_id, compute_request_hash({"po_id": po_id, "expected_revision": expected_revision}))
        if replay.get("replayed"): return replay["response_body"]
        dispatched = _now(); expires = dispatched + timedelta(days=30)
        if not purchase_order_model.dispatch_purchase_order(conn.cursor(), po_id, actor_id, _utc(dispatched), _utc(expires), expected_revision): raise StateConflictError("Dispatch conflict", "REVISION_CONFLICT")
        result = _response(conn, po_id, "office"); complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def void_purchase_order_service(po_id, expected_revision, reason, actor_id, idempotency_key=None, db=None):
    validate_positive_integer(po_id, "po_id"); validate_non_negative_integer(expected_revision, "expected_revision")
    reason = validate_string(reason, "reason", 1, 255); validate_positive_integer(actor_id, "actor_id")
    conn = db or get_db(); owned = db is None
    try:
        key = (idempotency_key or "").strip()
        if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
        replay = reserve_operation(conn, key, "purchase_order_void", actor_id, compute_request_hash({"po_id": po_id, "expected_revision": expected_revision, "reason": reason}))
        if replay.get("replayed"): return replay["response_body"]
        po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
        if not po: raise ValidationError("Purchase order not found", "po_id", "NOT_FOUND")
        if po["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        now = _utc(_now())
        if po["status"] == "open" and po.get("expires_at") and now >= po["expires_at"]:
            purchase_order_model.expire_purchase_order(conn.cursor(), po_id, now, expected_revision)
            conn.cursor().execute("DELETE FROM operations WHERE operation_key = ?", (key,))
            if owned: conn.commit()
            raise StateConflictError("Purchase order has expired", "ORDER_EXPIRED")
        if not purchase_order_model.void_purchase_order(conn.cursor(), po_id, actor_id, reason, _utc(_now()), expected_revision): raise StateConflictError("Invalid purchase order state", "INVALID_STATUS_TRANSITION")
        result = _response(conn, po_id, "office"); complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise


def receive_purchase_order_service(po_id: int, expected_revision: int, items=None, actor_id: int = None,
                                   actor_name: Optional[str] = None, idempotency_key: Optional[str] = None, db=None):
    validate_positive_integer(po_id, "po_id"); validate_non_negative_integer(expected_revision, "expected_revision"); validate_positive_integer(actor_id, "actor_id")
    key = (idempotency_key or "").strip()
    if not key: raise ValidationError("Idempotency-Key header is required", "Idempotency-Key", "MISSING_IDEMPOTENCY_KEY")
    if items is not None: raise ValidationError("Client receipt quantities are not accepted", "items", "PARTIAL_RECEIPT_NOT_ALLOWED")
    conn = db or get_db(); owned = db is None
    try:
        check_stock_mutation_allowed(conn)
        replay = reserve_operation(conn, key, "purchase_order_receive", actor_id, compute_request_hash({"po_id": po_id, "expected_revision": expected_revision}))
        if replay.get("replayed"): return replay["response_body"]
        po = purchase_order_model.get_purchase_order_by_id(conn, po_id)
        if not po: raise ValidationError("Purchase order not found", "po_id", "NOT_FOUND")
        if po["revision"] != expected_revision: raise StateConflictError("Revision conflict", "REVISION_CONFLICT")
        if po["status"] != "open": raise StateConflictError("Only open purchase orders can be received", "INVALID_STATUS_TRANSITION")
        now = _utc(_now())
        if po.get("expires_at") and now >= po["expires_at"]:
            purchase_order_model.expire_purchase_order(conn.cursor(), po_id, now, expected_revision)
            # Expiry is a persisted state transition, but the rejected receipt
            # must not leave its idempotency operation stuck in progress.
            conn.cursor().execute("DELETE FROM operations WHERE operation_key = ?", (key,))
            conn.commit()
            raise StateConflictError("Purchase order has expired", "ORDER_EXPIRED")
        cursor = conn.cursor(); lines = purchase_order_model.get_purchase_order_items(conn, po_id); balances = []
        for line in lines:
            quantity = line["ordered_quantity"]
            if quantity <= 0: continue
            cursor.execute("SELECT status, unit_id FROM items WHERE id = ?", (line["item_id"],)); item = cursor.fetchone()
            if not item: raise ValidationError("PO item no longer exists", "item_id", "ITEM_NOT_FOUND")
            if item["status"] != "active": raise ValidationError("PO item is not active", "status", "ITEM_NOT_ACTIVE")
            if item["unit_id"] != line["unit_id"]: raise ValidationError("PO item unit changed", "unit_id", "UNIT_MISMATCH")
            cursor.execute("UPDATE purchase_order_items SET received_quantity = ? WHERE id = ?", (quantity, line["id"]))
            balances.append(adjust_stock_primitive(conn, line["item_id"], quantity, "addition", actor_id, actor_name, provider_id=po["provider_id"], cost=float(Decimal(line["unit_price"]) / Decimal(10 ** po["currency_scale"])), operation_key=key, po_line_id=line["id"], details=f"PO Receipt {po['po_number']}", unit_name=line["unit_name"]))
        if not purchase_order_model.close_purchase_order_receipt(cursor, po_id, actor_id, now, expected_revision): raise StateConflictError("Receipt conflict", "REVISION_CONFLICT")
        result = {**_response(conn, po_id, "warehouse"), "affected_balances": balances}; complete_operation(conn, key, 200, result)
        if owned: conn.commit()
        return result
    except Exception:
        if owned: conn.rollback()
        raise
