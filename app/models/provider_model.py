from typing import Any
from sqlite3 import IntegrityError
from .db_utils import get_db

def get_all_providers():
    """Retrieves all providers from the database."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM providers ORDER BY name")
    providers = [dict(row) for row in cursor.fetchall()]
    return providers

def add_provider(name: str, db: Any = None):
    """Adds a new provider to the database."""
    conn = db if db is not None else get_db()
    caller_owned = db is not None
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO providers (name) VALUES (?)", (name,))
        if not caller_owned:
            conn.commit()
        return {"id": cursor.lastrowid, "name": name}
    except IntegrityError:
        if not caller_owned:
            conn.rollback()
        raise ValueError(f"Provider '{name}' already exists.")
    except Exception as e:
        if not caller_owned:
            conn.rollback()
        raise e

def update_provider(provider_id: int, name: str):
    """Updates an existing provider's name."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE providers SET name = ? WHERE id = ?", (name, provider_id))
        if cursor.rowcount == 0:
            return None
        db.commit()
        return {"id": provider_id, "name": name}
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Provider name '{name}' is already in use by another provider.")
    except Exception as e:
        db.rollback()
        raise e

def is_provider_in_use(provider_id: int):
    """Checks if a provider is currently associated with any items, logs, or purchase orders."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT 1 FROM items WHERE provider_id = ? LIMIT 1", (provider_id,))
    if cursor.fetchone() is not None:
        return True

    cursor.execute("SELECT 1 FROM movement_logs WHERE provider_id = ? LIMIT 1", (provider_id,))
    if cursor.fetchone() is not None:
        return True

    cursor.execute("SELECT 1 FROM purchase_orders WHERE provider_id = ? LIMIT 1", (provider_id,))
    if cursor.fetchone() is not None:
        return True

    return False

def delete_provider(provider_id: int):
    """Deletes a provider from the database."""
    if is_provider_in_use(provider_id):
        raise ValueError("Cannot delete a provider that is currently in use by one or more items.")
    
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        if cursor.rowcount == 0:
            return False
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        raise e