from .db_utils import get_db
from sqlite3 import IntegrityError, Error
import logging

logger = logging.getLogger(__name__)

def add_unit(name: str) -> dict | None:
    """Adds a new unit to the database.
    Returns the newly added unit as a dictionary (id, name) or None if error."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("INSERT INTO units (name) VALUES (?)", (name,))
        db.commit()
        new_unit_id = cursor.lastrowid
        if new_unit_id:
            return {"id": new_unit_id, "name": name}
        return None
    except IntegrityError:
        db.rollback()
        raise ValueError(f"A unit with the name '{name}' already exists.")
    except Error as e:
        db.rollback()
        logger.error(f"Database error in add_unit: {e}")
        raise e

def get_all_units() -> list[dict]:
    """Retrieves all units from the database."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM units ORDER BY name ASC")
    units = [{"id": row["id"], "name": row["name"]} for row in cursor.fetchall()]
    return units

def get_unit_by_id(unit_id: int) -> dict | None:
    """Retrieves a single unit by its ID."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM units WHERE id = ?", (unit_id,))
    row = cursor.fetchone()
    if row:
        return {"id": row["id"], "name": row["name"]}
    return None

def update_unit(unit_id: int, name: str) -> dict | None:
    """Updates an existing unit's name.
    Returns the updated unit as a dictionary or None if not found or error."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE units SET name = ? WHERE id = ?", (name, unit_id))
        db.commit()
        if cursor.rowcount > 0:
            return {"id": unit_id, "name": name}
        return None
    except IntegrityError:
        logger.error(f"Error: Cannot update unit ID {unit_id}, name '{name}' already exists.")
        return None
    except Error as e:
        db.rollback()
        logger.error(f"Database error in update_unit: {e}")
        raise e

def is_unit_in_use(unit_id: int) -> bool:
    """Checks if a unit is currently assigned to any item or order line."""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("SELECT 1 FROM items WHERE unit_id = ? LIMIT 1", (unit_id,))
    if cursor.fetchone():
        return True

    cursor.execute("SELECT 1 FROM purchase_order_items WHERE unit_id = ? LIMIT 1", (unit_id,))
    if cursor.fetchone():
        return True

    cursor.execute("SELECT 1 FROM leave_order_items WHERE unit_id = ? LIMIT 1", (unit_id,))
    if cursor.fetchone():
        return True

    return False

def delete_unit(unit_id: int) -> bool:
    """Deletes a unit by its ID.
    Returns True if deletion was successful, False otherwise (e.g., not found or DB error).
    Does not delete if the unit is in use (caller should check is_unit_in_use first)."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM units WHERE id = ?", (unit_id,))
        db.commit()
        return cursor.rowcount > 0
    except Error as e:
        db.rollback()
        logger.error(f"Database error in delete_unit for ID {unit_id}: {e}")
        return False