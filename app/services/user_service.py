"""
User service for SkyCourt Warehouse System.
Provides business logic for user provisioning, password verification, and session invalidation.
"""
import logging
from typing import Optional, Dict, Any
from werkzeug.security import generate_password_hash, check_password_hash

from app.models import user_model
from app.models.db_utils import get_db
from app.validation import (
    ValidationError,
    validate_string,
    validate_enum,
    validate_positive_integer
)

logger = logging.getLogger(__name__)


class ProvisioningError(Exception):
    """Raised when user provisioning encounters a conflict or invalid state."""
    pass


def hash_password(password: str) -> str:
    """Hashes a plaintext password using Werkzeug's secure hashing."""
    if not password or not isinstance(password, str):
        raise ValidationError("Password must be a non-empty string.", "INVALID_PASSWORD")
    if len(password) < 6:
        raise ValidationError("Password must be at least 6 characters long.", "PASSWORD_TOO_SHORT")
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Verifies a plaintext password against a stored password hash."""
    if not password_hash or not password:
        return False
    return check_password_hash(password_hash, password)


def provision_user(
    username: str,
    password: str,
    role: str,
    display_name: str,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Explicit, idempotent administrative seed / provision function.
    
    Invariants:
    1. Case-insensitive unique usernames.
    2. Constrained roles ('office', 'warehouse', 'admin').
    3. Hashed passwords using Werkzeug.
    4. If the username already exists with the SAME role, updates credentials/display_name idempotently.
    5. If the username already exists with an UNEXPECTED role, raises ProvisioningError rather than silently reassigning.
    6. Never returns password hashes or credential internals.
    """
    cleaned_username = validate_string(username, "username", min_len=1, max_len=100).strip()
    cleaned_display_name = validate_string(display_name, "display_name", min_len=1, max_len=150).strip()
    validate_enum(role, "role", user_model.ALLOWED_ROLES)
    
    hashed = hash_password(password)

    conn = db if db is not None else get_db()
    caller_owned = db is not None

    try:
        existing = user_model.get_user_by_username(cleaned_username, db=conn)
        if existing:
            if existing["role"] != role:
                raise ProvisioningError(
                    f"User '{cleaned_username}' already exists with role '{existing['role']}'. "
                    f"Cannot silently reassign to '{role}'."
                )
            # Idempotent update for same role
            user_model.update_user_password(existing["id"], hashed, db=conn)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE users
                SET display_name = ?, is_active = 1
                WHERE id = ?
            """, (cleaned_display_name, existing["id"]))
            updated = user_model.get_user_by_id(existing["id"], db=conn)
            if not caller_owned:
                conn.commit()
            logger.info("Provisioned existing user '%s' with role '%s' idempotently.", cleaned_username, role)
            return user_model.to_public_user(updated)
        else:
            # Create fresh user
            created = user_model.create_user(
                username=cleaned_username,
                password_hash=hashed,
                role=role,
                display_name=cleaned_display_name,
                db=conn
            )
            if not caller_owned:
                conn.commit()
            logger.info("Provisioned new user '%s' with role '%s'.", cleaned_username, role)
            return user_model.to_public_user(created)
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def change_user_password(user_id: int, new_password: str, db: Optional[Any] = None) -> bool:
    """Updates password and increments session version to invalidate active sessions."""
    validate_positive_integer(user_id, "user_id")
    hashed = hash_password(new_password)
    conn = db if db is not None else get_db()
    caller_owned = db is not None
    try:
        success = user_model.update_user_password(user_id, hashed, db=conn)
        if not caller_owned:
            conn.commit()
        return success
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e


def deactivate_user(user_id: int, db: Optional[Any] = None) -> bool:
    """Deactivates a user and increments session version to invalidate active sessions."""
    validate_positive_integer(user_id, "user_id")
    conn = db if db is not None else get_db()
    caller_owned = db is not None
    try:
        success = user_model.set_user_active(user_id, False, db=conn)
        if not caller_owned:
            conn.commit()
        return success
    except Exception as e:
        if not caller_owned:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e
