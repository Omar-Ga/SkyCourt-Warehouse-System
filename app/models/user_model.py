"""
User model for SkyCourt Warehouse System.
Provides database access for user records, session versions, and role constraints.
"""
import logging
from typing import Optional, Dict, Any, List
from .db_utils import get_db

logger = logging.getLogger(__name__)

ALLOWED_ROLES = ('office', 'warehouse', 'admin')


def to_public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Serializes a user row into the defined public user shape.
    Never exposes password_hash or sensitive credential internals.
    """
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"]
    }


def _row_to_user(row: Any) -> Optional[Dict[str, Any]]:
    """Converts a sqlite3.Row or tuple into a canonical user dictionary."""
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    if hasattr(row, "keys"):
        return dict(row)
    return {
        "id": row[0],
        "username": row[1],
        "password_hash": row[2],
        "role": row[3],
        "display_name": row[4],
        "is_active": row[5],
        "session_version": row[6],
        "created_at": row[7]
    }


def get_user_by_id(user_id: int, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """Retrieves a user by primary key ID."""
    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, password_hash, role, display_name, is_active, session_version, created_at
        FROM users
        WHERE id = ?
    """, (user_id,))
    return _row_to_user(cursor.fetchone())


def get_user_by_username(username: str, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """Retrieves a user by case-insensitive username."""
    if not username:
        return None
    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, password_hash, role, display_name, is_active, session_version, created_at
        FROM users
        WHERE username = ? COLLATE NOCASE
    """, (username.strip(),))
    return _row_to_user(cursor.fetchone())


def create_user(
    username: str,
    password_hash: str,
    role: str,
    display_name: str,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Creates a new user record."""
    if role not in ALLOWED_ROLES:
        raise ValueError(f"Invalid role: '{role}'. Must be one of {ALLOWED_ROLES}")

    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO users (username, password_hash, role, display_name, is_active, session_version)
        VALUES (?, ?, ?, ?, 1, 1)
    """, (username.strip(), password_hash, role, display_name.strip()))
    
    user_id = cursor.lastrowid
    return get_user_by_id(user_id, db=conn)


def update_user_password(user_id: int, password_hash: str, db: Optional[Any] = None) -> bool:
    """Updates password hash and increments session_version to invalidate prior sessions."""
    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users
        SET password_hash = ?, session_version = session_version + 1
        WHERE id = ?
    """, (password_hash, user_id))
    return cursor.rowcount > 0


def set_user_active(user_id: int, is_active: bool, db: Optional[Any] = None) -> bool:
    """Updates active flag and increments session_version to invalidate prior sessions."""
    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    int_active = 1 if is_active else 0
    cursor.execute("""
        UPDATE users
        SET is_active = ?, session_version = session_version + 1
        WHERE id = ?
    """, (int_active, user_id))
    return cursor.rowcount > 0


def increment_session_version(user_id: int, db: Optional[Any] = None) -> int:
    """Increments user's session_version and returns the new version."""
    conn = db if db is not None else get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users
        SET session_version = session_version + 1
        WHERE id = ?
    """, (user_id,))
    user = get_user_by_id(user_id, db=conn)
    return user["session_version"] if user else 0
