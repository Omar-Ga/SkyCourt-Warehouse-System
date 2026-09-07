import logging
from sqlite3 import IntegrityError
from typing import Optional, Any
from app.models.db_utils import get_db, check_stock_mutation_allowed
from app.models import item_model
from app.models.movement_log_model import add_log_entry
from app.models.category_model import get_category_by_id
from app.validation import (
    ValidationError,
    validate_positive_integer,
    validate_non_negative_integer,
    validate_string,
    validate_number,
    validate_enum,
    validate_foreign_key
)

logger = logging.getLogger(__name__)


def adjust_stock_primitive(
    conn: Any,
    item_id: int,
    change_amount: int,
    action_type: str,
    actor_id: Optional[int] = None,
    actor_name: Optional[str] = None,
    person_name: Optional[str] = None,
    provider_id: Optional[int] = None,
    cost: Optional[float] = None,
    destination_id: Optional[int] = None,
    operation_key: Optional[str] = None,
    po_line_id: Optional[int] = None,
    leave_line_id: Optional[int] = None,
    return_event_id: Optional[int] = None,
    details: Optional[str] = None,
    unit_name: Optional[str] = None
) -> dict:
    """
    Atomic primitive for stock adjustments.
    Executes authoritative conditional stock update, fetches resulting balance,
    and records movement log entry within the caller's transaction.
    DOES NOT commit or rollback.
    """
    check_stock_mutation_allowed(conn)

    validate_positive_integer(item_id, "item_id")
    validate_positive_integer(change_amount, "change_amount")

    normalized_action = action_type.lower()
    validate_enum(normalized_action, "action_type", ("addition", "removal", "return"))

    cursor = conn.cursor()

    if normalized_action == "addition":
        new_quantity = item_model.add_item_quantity_conditional(cursor, item_id, change_amount, active_only=True)
        log_action = "Addition"
    elif normalized_action == "removal":
        new_quantity = item_model.subtract_item_quantity_conditional(cursor, item_id, change_amount)
        log_action = "Removal"
    elif normalized_action == "return":
        # Returns can be made to active, inactive, or archived items
        new_quantity = item_model.add_item_quantity_conditional(cursor, item_id, change_amount, active_only=False)
        log_action = "Return"

    # Query item name and unit for immutable log snapshot
    cursor.execute("""
        SELECT i.name, u.name as unit_name
        FROM items i
        LEFT JOIN units u ON i.unit_id = u.id
        WHERE i.id = ?
    """, (item_id,))
    item_row = cursor.fetchone()
    item_name = item_row["name"] if item_row and hasattr(item_row, "__getitem__") and "name" in item_row else (item_row[0] if item_row else "")
    resolved_unit_name = unit_name or (item_row["unit_name"] if item_row and hasattr(item_row, "__getitem__") and "unit_name" in item_row else (item_row[1] if item_row else None))

    # Add audit log entry inside caller's transaction
    add_log_entry(
        item_id=item_id,
        item_name=item_name,
        action_type=log_action,
        quantity_changed=change_amount,
        resulting_quantity=new_quantity,
        provider_id=provider_id,
        cost_per_item=cost,
        details=details or f"Stock {log_action.lower()}",
        person_name=person_name,
        destination_id=destination_id,
        user_id=actor_id,
        actor_name=actor_name,
        operation_key=operation_key,
        po_line_id=po_line_id,
        leave_line_id=leave_line_id,
        return_event_id=return_event_id,
        unit_name=resolved_unit_name,
        db=conn
    )

    return {
        "item_id": item_id,
        "name": item_name,
        "quantity_changed": change_amount,
        "resulting_quantity": new_quantity,
        "action_type": log_action
    }


def record_quantity_adjustment(
    item_id: int,
    change_amount: int,
    adjustment_type: str,
    person_name: Optional[str] = None,
    provider_id: Optional[int] = None,
    cost: Optional[float] = None,
    destination_id: Optional[int] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None,
    operation_key: Optional[str] = None,
    db: Optional[Any] = None
) -> dict:
    """
    Public service for manual quantity adjustments.
    Only 'addition' and 'removal' are permitted.
    If db connection is provided, operates within caller's transaction.
    Otherwise manages its own commit and rollback.
    """
    validate_positive_integer(item_id, "item_id")
    validate_positive_integer(change_amount, "change_amount")
    norm_type = adjustment_type.lower()
    validate_enum(norm_type, "adjustment_type", ("addition", "removal"))

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        if destination_id is not None:
            validate_foreign_key(conn, "destinations", destination_id, "destination_id", allow_none=True)
        if provider_id is not None:
            validate_foreign_key(conn, "providers", provider_id, "provider_id", allow_none=True)
        if cost is not None:
            validate_number(cost, "cost", min_val=0.0, allow_none=True)

        adjust_stock_primitive(
            conn=conn,
            item_id=item_id,
            change_amount=change_amount,
            action_type=norm_type,
            actor_id=user_id,
            actor_name=actor_name,
            person_name=person_name,
            provider_id=provider_id,
            cost=cost,
            destination_id=destination_id,
            operation_key=operation_key
        )

        if not caller_owned:
            conn.commit()

        return item_model.get_item_by_id(item_id, db=conn)

    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def add_item(
    name: str,
    unit_id: int,
    sub_category_id: int,
    quantity: int,
    provider_id: Optional[int] = None,
    cost: Optional[float] = None,
    person_name: Optional[str] = None,
    barcode: Optional[str] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None,
    operation_key: Optional[str] = None,
    db: Optional[Any] = None
) -> dict:
    """Orchestrates adding a new item with validation and audit logging."""
    cleaned_name = validate_string(name, "name", min_len=1, max_len=150)
    validate_positive_integer(unit_id, "unit_id")
    validate_positive_integer(sub_category_id, "sub_category_id")
    validate_non_negative_integer(quantity, "quantity")
    
    if cost is not None:
        validate_number(cost, "cost", min_val=0.0, allow_none=True)
    if provider_id is not None:
        validate_positive_integer(provider_id, "provider_id")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        # Validate foreign keys exist
        validate_foreign_key(conn, "units", unit_id, "unit_id")
        validate_foreign_key(conn, "categories", sub_category_id, "sub_category_id")
        if provider_id:
            validate_foreign_key(conn, "providers", provider_id, "provider_id")

        # Duplicate check
        existing_item = item_model.get_item_by_name(cleaned_name, db=conn)
        if existing_item:
            if existing_item['status'] in ('inactive', 'archived'):
                raise ValueError(f"Item '{cleaned_name}' exists but is {existing_item['status']}. Restore it instead.")
            else:
                existing_sub_id = existing_item.get('sub_category_id')
                if existing_sub_id:
                    category = get_category_by_id(existing_sub_id)
                    if category:
                        category_name = category.get('name', 'غير محددة')
                        raise IntegrityError(f"الصنف '{cleaned_name}' موجود بالفعل في الفئة الفرعية '{category_name}'.")
                raise IntegrityError(f"An active item named '{cleaned_name}' already exists.")

        # Check barcode uniqueness if provided
        cursor = conn.cursor()
        if barcode:
            cleaned_barcode = barcode.strip()
            if cleaned_barcode.upper().startswith("PO-"):
                raise IntegrityError("Barcode cannot use reserved 'PO-' purchase order prefix.")
            if item_model.check_barcode_exists(cursor, cleaned_barcode, exclude_item_id=-1):
                raise IntegrityError(f"Barcode '{cleaned_barcode}' is already in use by another item.")
        else:
            cleaned_barcode = None


        # Insert item
        item_id = item_model.insert_item(
            cursor, cleaned_name, unit_id, sub_category_id, quantity, provider_id, cost, cleaned_barcode
        )

        # Audit log entry
        add_log_entry(
            item_id=item_id,
            item_name=cleaned_name,
            action_type='Creation',
            quantity_changed=quantity,
            resulting_quantity=quantity,
            details="Item created.",
            person_name=person_name,
            provider_id=provider_id,
            cost_per_item=cost,
            user_id=user_id,
            actor_name=actor_name,
            operation_key=operation_key,
            db=conn
        )

        if not caller_owned:
            conn.commit()

        return item_model.get_item_by_id(item_id, db=conn)

    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def restore_item(
    item_id: int,
    sub_category_id: int,
    person_name: Optional[str] = None,
    db: Optional[Any] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None
) -> Optional[dict]:
    """Orchestrates restoring an inactive or archived item."""
    validate_positive_integer(item_id, "item_id")
    validate_positive_integer(sub_category_id, "sub_category_id")

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        validate_foreign_key(conn, "categories", sub_category_id, "sub_category_id")

        item = item_model.get_item_by_id(item_id, db=conn)
        if not item:
            return None

        cursor = conn.cursor()
        item_model.update_status_and_category(cursor, item_id, 'active', sub_category_id)

        add_log_entry(
            item_id=item_id,
            item_name=item['name'],
            action_type='Restored',
            details=f"Item restored to category ID {sub_category_id}.",
            person_name=person_name,
            user_id=user_id,
            actor_name=actor_name,
            db=conn
        )

        if not caller_owned:
            conn.commit()

        return item_model.get_item_by_id(item_id, db=conn)
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def update_item_status(
    item_id: int,
    new_status: str,
    person_name: Optional[str] = None,
    db: Optional[Any] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None
) -> Optional[dict]:
    """Orchestrates updating item status."""
    validate_positive_integer(item_id, "item_id")
    validate_enum(new_status, "status", ("active", "inactive", "archived"))

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        item = item_model.get_item_by_id(item_id, db=conn)
        if not item or item['status'] == new_status:
            return item

        cursor = conn.cursor()
        item_model.update_status(cursor, item_id, new_status)

        add_log_entry(
            item_id=item_id,
            item_name=item['name'],
            action_type='Status Change',
            details=f"Status changed from '{item['status']}' to '{new_status}'.",
            person_name=person_name,
            user_id=user_id,
            actor_name=actor_name,
            db=conn
        )

        if not caller_owned:
            conn.commit()

        return item_model.get_item_by_id(item_id, db=conn)
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def update_item(
    item_id: int,
    name: str,
    unit_id: int,
    sub_category_id: Optional[int] = None,
    barcode: Optional[str] = None,
    person_name: Optional[str] = None,
    force_unit_change: bool = False,
    db: Optional[Any] = None,
    user_id: Optional[int] = None,
    actor_name: Optional[str] = None
) -> Optional[dict]:
    """Orchestrates updating item details with order checks and barcode uniqueness."""
    validate_positive_integer(item_id, "item_id")
    cleaned_name = validate_string(name, "name", min_len=1, max_len=150)
    validate_positive_integer(unit_id, "unit_id")
    if sub_category_id is not None:
        validate_positive_integer(sub_category_id, "sub_category_id")

    conn = db if db is not None else get_db()
    caller_owned = db is not None
    cursor = conn.cursor()

    try:
        current_item = item_model.get_item_by_id(item_id, db=conn)
        if not current_item:
            return None

        # Barcode uniqueness
        if barcode and barcode != current_item.get('barcode'):
            cleaned_barcode = barcode.strip()
            if cleaned_barcode.upper().startswith("PO-"):
                raise IntegrityError("Barcode cannot use reserved 'PO-' purchase order prefix.")
            if item_model.check_barcode_exists(cursor, cleaned_barcode, exclude_item_id=item_id):
                raise IntegrityError(f"Barcode '{cleaned_barcode}' is already in use by another item.")


        # Unit change checks
        if unit_id != current_item['unit_id']:
            # Block unit change if item is referenced by pending PO or outstanding leave orders
            if item_model.has_unresolved_orders(cursor, item_id):
                raise ValueError("Cannot change unit: item has pending purchase orders or outstanding leave orders.")

            if not force_unit_change and item_model.has_movement_logs(cursor, item_id):
                return {"confirmation_required": True, "message": "Changing unit might affect logs."}

        item_model.update_item_details(cursor, item_id, cleaned_name, unit_id, sub_category_id, barcode)

        add_log_entry(
            item_id=item_id,
            item_name=cleaned_name,
            action_type='Update',
            details="Item details updated.",
            person_name=person_name,
            user_id=user_id,
            actor_name=actor_name,
            db=conn
        )

        if not caller_owned:
            conn.commit()

        return item_model.get_item_by_id(item_id, db=conn)
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e
