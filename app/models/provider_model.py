import sqlite3
from .db_utils import get_db
from .sync_worker import run_background_sync

def get_all_providers():
    """Retrieves all providers from the database."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM providers ORDER BY name")
    providers = [dict(row) for row in cursor.fetchall()]
    return providers

def add_provider(name: str):
    """Adds a new provider to the database."""
    db = get_db(type='write')
    cursor = db.cursor()
    try:
        cursor.execute("INSERT INTO providers (name) VALUES (?)", (name,))
        db.commit()
        run_background_sync()
        return {"id": cursor.lastrowid, "name": name}
    except sqlite3.IntegrityError:
        db.rollback()
        raise ValueError(f"Provider '{name}' already exists.")
    except Exception as e:
        db.rollback()
        raise e

def update_provider(provider_id: int, name: str):
    """Updates an existing provider's name."""
    db = get_db(type='write')
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE providers SET name = ? WHERE id = ?", (name, provider_id))
        if cursor.rowcount == 0:
            return None
        db.commit()
        run_background_sync()
        return {"id": provider_id, "name": name}
    except sqlite3.IntegrityError:
        db.rollback()
        raise ValueError(f"Provider name '{name}' is already in use by another provider.")
    except Exception as e:
        db.rollback()
        raise e

def is_provider_in_use(provider_id: int):
    """Checks if a provider is currently associated with any items."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT 1 FROM items WHERE provider_id = ? LIMIT 1", (provider_id,))
    return cursor.fetchone() is not None

def delete_provider(provider_id: int):
    """Deletes a provider from the database."""
    if is_provider_in_use(provider_id):
        raise ValueError("Cannot delete a provider that is currently in use by one or more items.")
    
    db = get_db(type='write')
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        if cursor.rowcount == 0:
            return False
        db.commit()
        run_background_sync()
        return True
    except Exception as e:
        db.rollback()
        raise e 