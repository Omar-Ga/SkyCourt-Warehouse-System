"""
Idempotency service for SkyCourt Warehouse System.
Provides atomic operation key reservation, canonical request hashing,
safe replay of completed responses, and rejection of conflicting parameters.
"""
import hashlib
import json
import logging
import sqlite3
from typing import Any, Optional

logger = logging.getLogger(__name__)


class IdempotencyError(Exception):
    """Base exception for idempotency issues."""
    def __init__(self, message: str, code: str = "IDEMPOTENCY_ERROR", status_code: int = 409):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code

    def to_dict(self):
        return {
            "error": self.message,
            "code": self.code
        }


class IdempotencyConflictError(IdempotencyError):
    """Raised when an idempotency key is reused with a different actor, operation type, or payload."""
    def __init__(self, message: str):
        super().__init__(message, code="IDEMPOTENCY_KEY_CONFLICT", status_code=409)


class IdempotencyInProgressError(IdempotencyError):
    """Raised when an operation with the same idempotency key is currently running."""
    def __init__(self, message: str = "A request with this Idempotency-Key is currently in progress"):
        super().__init__(message, code="IDEMPOTENCY_IN_PROGRESS", status_code=409)


class StateConflictError(IdempotencyError):
    """Raised when an operation encounters a state conflict or optimistic concurrency revision mismatch."""
    def __init__(self, message: str, code: str = "STATE_CONFLICT"):
        super().__init__(message, code=code, status_code=409)


def compute_request_hash(payload: Any) -> str:
    """
    Computes a canonical SHA-256 hash for a given request payload.
    Dictionaries are sorted by key to ensure deterministic representation.
    """
    if payload is None:
        canonical_str = ""
    elif isinstance(payload, (dict, list)):
        canonical_str = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    else:
        canonical_str = str(payload)

    return hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()


def _check_existing_operation(
    row: Any,
    operation_key: str,
    operation_type: str,
    actor_id: Optional[int],
    request_hash: str
) -> dict:
    """Helper to inspect an existing operation row and either return replay data or raise conflict."""
    existing_actor = row["actor_id"] if hasattr(row, "__getitem__") and "actor_id" in row else row[0]
    existing_type = row["operation_type"] if hasattr(row, "__getitem__") and "operation_type" in row else row[1]
    existing_hash = row["request_hash"] if hasattr(row, "__getitem__") and "request_hash" in row else row[2]
    existing_status = row["status"] if hasattr(row, "__getitem__") and "status" in row else row[3]
    existing_resp_status = row["response_status"] if hasattr(row, "__getitem__") and "response_status" in row else row[4]
    existing_resp_body = row["response_body"] if hasattr(row, "__getitem__") and "response_body" in row else row[5]

    # Check for conflicts
    if existing_type != operation_type:
        raise IdempotencyConflictError(
            f"Idempotency key '{operation_key}' was previously used with a different operation type ('{existing_type}')"
        )

    if existing_hash != request_hash:
        raise IdempotencyConflictError(
            f"Idempotency key '{operation_key}' was previously used with a different request payload"
        )

    if existing_actor != actor_id:
        raise IdempotencyConflictError(
            f"Idempotency key '{operation_key}' was previously used by a different actor"
        )

    if existing_status == "completed":
        parsed_body = None
        if existing_resp_body:
            try:
                parsed_body = json.loads(existing_resp_body)
            except Exception:
                parsed_body = existing_resp_body
        return {
            "replayed": True,
            "response_status": existing_resp_status,
            "response_body": parsed_body
        }

    if existing_status == "in_progress":
        raise IdempotencyInProgressError(
            f"An operation with idempotency key '{operation_key}' is currently in progress"
        )

    # If previously failed, reject reuse of key
    raise IdempotencyConflictError(
        f"Operation with idempotency key '{operation_key}' previously failed; submit with a new key"
    )


def reserve_operation(
    conn,
    operation_key: str,
    operation_type: str,
    actor_id: Optional[int],
    request_hash: str
) -> dict:
    """
    Atomically checks/reserves an idempotency key within the caller's transaction.
    
    If the key is already completed with identical parameters:
        Returns {"replayed": True, "response_status": ..., "response_body": ...}
    If the key is in progress:
        Raises IdempotencyInProgressError
    If parameters (type, payload, or actor) differ:
        Raises IdempotencyConflictError
    If the key is new:
        Inserts an 'in_progress' record and returns {"replayed": False}
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT actor_id, operation_type, request_hash, status, response_status, response_body
        FROM operations
        WHERE operation_key = ?
        """,
        (operation_key,)
    )
    row = cursor.fetchone()

    if row is not None:
        return _check_existing_operation(row, operation_key, operation_type, actor_id, request_hash)

    # Insert new in-progress reservation, handling concurrent insert collision safely
    try:
        cursor.execute(
            """
            INSERT INTO operations (
                operation_key, actor_id, operation_type, request_hash, status
            ) VALUES (?, ?, ?, ?, 'in_progress')
            """,
            (operation_key, actor_id, operation_type, request_hash)
        )
    except (sqlite3.IntegrityError, Exception) as e:
        # Check if this was a unique constraint violation from a concurrent request
        if isinstance(e, sqlite3.IntegrityError) or "UNIQUE" in str(e).upper():
            cursor.execute(
                """
                SELECT actor_id, operation_type, request_hash, status, response_status, response_body
                FROM operations
                WHERE operation_key = ?
                """,
                (operation_key,)
            )
            collided_row = cursor.fetchone()
            if collided_row is not None:
                return _check_existing_operation(collided_row, operation_key, operation_type, actor_id, request_hash)
        raise

    return {"replayed": False}


def complete_operation(
    conn,
    operation_key: str,
    response_status: int,
    response_body: Any
) -> None:
    """
    Updates the reserved operation record to 'completed' with its HTTP response status and body.
    Must be called before committing the business transaction.
    """
    cursor = conn.cursor()
    serialized_body = json.dumps(response_body, ensure_ascii=False) if response_body is not None else None

    cursor.execute(
        """
        UPDATE operations
        SET status = 'completed',
            response_status = ?,
            response_body = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE operation_key = ?
        """,
        (response_status, serialized_body, operation_key)
    )

    if cursor.rowcount == 0:
        raise IdempotencyError(
            f"Operation with key '{operation_key}' was not found to complete",
            code="OPERATION_NOT_FOUND",
            status_code=404
        )
