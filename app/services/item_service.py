from sqlite3 import IntegrityError
from app.models.db_utils import get_db
from app.models import item_model
from app.models.movement_log_model import add_log_entry
from app.models.sync_worker import run_background_sync
from app.models.category_model import get_category_by_id












def add_item(name: str, unit_id: int, sub_category_id: int, quantity: int, provider_id: int | None, cost: float | None, person_name: str | None, barcode: str | None):
    """Orchestrates adding a new item."""
    db = get_db(type='write')
    
    try:
        # Business Logic: Check duplicates
        existing_item = item_model.get_item_by_name(name, db=db)
        if existing_item:
            if existing_item['status'] in ('inactive', 'archived'):
                raise ValueError(f"Item '{name}' exists but is {existing_item['status']}. Restore it instead.")
            else:
                # Check subcategory conflict logic
                existing_sub_id = existing_item.get('sub_category_id')
                if existing_sub_id:
                    category = get_category_by_id(existing_sub_id)
                    if category:
                        category_name = category.get('name', 'غير محددة')
                        raise IntegrityError(f"الصنف '{name}' موجود بالفعل في الفئة الفرعية '{category_name}'.")
                
                raise IntegrityError(f"An active item named '{name}' already exists.")

        # DAO: Insert Item
        cursor = db.cursor()
        item_id = item_model.insert_item(cursor, name, unit_id, sub_category_id, quantity, provider_id, cost, barcode)
        
        # Logging
        add_log_entry(
            item_id=item_id, 
            item_name=name, 
            action_type='Creation', 
            quantity_changed=quantity, 
            resulting_quantity=quantity, 
            details="Item created.", 
            person_name=person_name, 
            provider_id=provider_id, 
            db=db
        )
        
        db.commit()
        run_background_sync()
        return item_model.get_item_by_id(item_id, db=db)
        
    except Exception as e:
        db.rollback()
        raise e

def restore_item(item_id: int, sub_category_id: int, person_name: str | None):
    """Orchestrates restoring an item."""
    db = get_db(type='write')
    try:
        item = item_model.get_item_by_id(item_id, db=db)
        if not item: return None

        cursor = db.cursor()
        item_model.update_status_and_category(cursor, item_id, 'active', sub_category_id)
        
        add_log_entry(
            item_id=item_id, 
            item_name=item['name'], 
            action_type='Restored',
            details=f"Item restored to category ID {sub_category_id}.", 
            person_name=person_name, 
            db=db
        )
        
        db.commit()
        run_background_sync()
        return item_model.get_item_by_id(item_id, db=db)
    except Exception as e:
        db.rollback()
        raise e

def update_item_status(item_id: int, new_status: str, person_name: str | None):
    """Orchestrates updating item status."""
    db = get_db(type='write')
    try:
        if new_status not in ('active', 'inactive'):
            raise ValueError("Invalid status provided.")
        
        item = item_model.get_item_by_id(item_id, db=db)
        if not item or item['status'] == new_status: return item

        cursor = db.cursor()
        item_model.update_status(cursor, item_id, new_status)
        
        add_log_entry(
            item_id=item_id, 
            item_name=item['name'], 
            action_type='Status Change',
            details=f"Status changed from '{item['status']}' to '{new_status}'.", 
            person_name=person_name, 
            db=db
        )
        
        db.commit()
        run_background_sync()
        return item_model.get_item_by_id(item_id, db=db)
    except Exception as e:
        db.rollback()
        raise e

def update_item(item_id: int, name: str, unit_id: int, sub_category_id: int | None, barcode: str | None, person_name: str | None = None, force_unit_change: bool = False):
    """Orchestrates updating item details."""
    db = get_db(type='write')
    cursor = db.cursor()
    try:
        current_item = item_model.get_item_by_id(item_id, db=db)
        if not current_item: return None

        # Business Logic: Barcode uniqueness
        if barcode and barcode != current_item.get('barcode'):
            if item_model.check_barcode_exists(cursor, barcode, exclude_item_id=item_id):
                 raise IntegrityError(f"Barcode '{barcode}' is already in use by another item.")

        # Business Logic: Unit change check
        if unit_id != current_item['unit_id'] and not force_unit_change:
            if item_model.has_movement_logs(cursor, item_id):
                return {"confirmation_required": True, "message": "Changing unit might affect logs."}

        # DAO: Update
        item_model.update_item_details(cursor, item_id, name, unit_id, sub_category_id, barcode)
        
        add_log_entry(
            item_id=item_id, 
            item_name=name, 
            action_type='Update', 
            details="Item details updated.", 
            person_name=person_name, 
            db=db
        )

        db.commit()
        run_background_sync()
        return item_model.get_item_by_id(item_id, db=db)
    except Exception as e:
        db.rollback()
        raise e

def record_quantity_adjustment(item_id, change_amount, adjustment_type, person_name, provider_id=None, cost=None, destination_id=None):
    """Orchestrates quantity adjustment."""
    db = get_db(type='write')
    cursor = db.cursor()
    try:
        # We need to lock or at least fetch fresh data
        # In SQLite default transaction mode, a write transaction starts lazily or we can force it.
        # get_db(type='write') usually implies we want to write.
        
        item = item_model.get_item_by_id(item_id, db=db)
        if not item: raise ValueError("Item not found.")

        current_quantity = item['current_quantity']
        new_quantity = current_quantity + change_amount if adjustment_type == 'addition' else current_quantity - change_amount
        
        if new_quantity < 0: raise ValueError("Resulting quantity cannot be negative.")

        item_model.update_quantity(cursor, item_id, new_quantity)

        add_log_entry(
            item_id=item_id, 
            item_name=item['name'], 
            action_type=adjustment_type.capitalize(),
            quantity_changed=change_amount, 
            resulting_quantity=new_quantity, 
            provider_id=provider_id,
            cost_per_item=cost, 
            destination_id=destination_id, 
            person_name=person_name, 
            db=db
        )
        
        db.commit()
        run_background_sync()
        return item_model.get_item_by_id(item_id, db=db)
    except Exception as e:
        db.rollback()
        raise e
