from .db_utils import get_db
import logging

logger = logging.getLogger(__name__)

def add_destination(name: str) -> dict | None:
    """Adds a new destination to the database."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("INSERT INTO destinations (name) VALUES (?)", (name,))
        db.commit()
        new_id = cursor.lastrowid
        if new_id:
            return {"id": new_id, "name": name}
        return None
    except Exception as e:
        db.rollback()
        logger.error(f"Database error in add_destination: {e}")
        raise e

def get_all_destinations() -> list[dict]:
    """Retrieves all destinations from the database."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM destinations ORDER BY name ASC")
    return [{"id": row["id"], "name": row["name"]} for row in cursor.fetchall()]

def get_destination_by_id(destination_id: int) -> dict | None:
    """Retrieves a single destination by its ID."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM destinations WHERE id = ?", (destination_id,))
    row = cursor.fetchone()
    if row:
        return {"id": row["id"], "name": row["name"]}
    return None

def update_destination(destination_id: int, name: str) -> dict | None:
    """Updates an existing destination's name."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE destinations SET name = ? WHERE id = ?", (name, destination_id))
        db.commit()
        if cursor.rowcount > 0:
            return {"id": destination_id, "name": name}
        return None
    except Exception as e:
        db.rollback()
        logger.error(f"Database error in update_destination: {e}")
        raise e

def is_destination_in_use(destination_id: int) -> bool:
    """Checks if a destination is currently used in any movement logs."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT 1 FROM movement_logs WHERE destination_id = ? LIMIT 1", (destination_id,))
    return bool(cursor.fetchone())

def delete_destination(destination_id: int) -> bool:
    """Deletes a destination by its ID."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM destinations WHERE id = ?", (destination_id,))
        db.commit()
        return cursor.rowcount > 0
    except Exception as e:
        db.rollback()
        logger.error(f"Database error in delete_destination for ID {destination_id}: {e}")
        return False