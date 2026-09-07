"""
Database utilities for SkyCourt Warehouse System.
Provides request-owned connections, transaction management, transient-conflict retries,
and compatibility adapters for SQLite and LibSQL.
"""
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from flask import current_app, g, has_app_context, has_request_context

from ..config import (
    TURSO_DATABASE_URL, 
    TURSO_AUTH_TOKEN, 
    LIBSQL_AVAILABLE
)

logger = logging.getLogger(__name__)


class DatabaseUnavailableError(RuntimeError):
    """Raised when the database cannot be reached or connected to."""
    pass


class ConcurrencyConflictError(RuntimeError):
    """Raised when a concurrent modification conflict cannot be resolved."""
    pass


class OfflineMutationGatedError(RuntimeError):
    """Raised when a stock-affecting mutation is attempted in offline or disconnected replica mode."""
    pass


# Offline mutation gate configuration
OFFLINE_STOCK_MUTATIONS_ENABLED = False


def is_offline_mutation_allowed() -> bool:
    """
    Returns whether stock mutations are permitted while operating in offline replica mode.
    Per ADR-0001 and Task #2, offline stock mutations are strictly gated and disabled
    pending qualification of an immutable ledger / reconciliation architecture.
    """
    return OFFLINE_STOCK_MUTATIONS_ENABLED


def check_stock_mutation_allowed(conn: Any = None):
    """
    Verifies that stock mutations are allowed in the current operational mode.
    Raises OfflineMutationGatedError if stock mutations are attempted while offline or
    if offline mutations have been disallowed.
    """
    if not is_offline_mutation_allowed():
        # 1. Flagged via Flask request context
        if has_request_context() and getattr(g, "offline_mode", False):
            raise OfflineMutationGatedError(
                "Offline stock mutations are disabled in this release. An active cloud connection is required."
            )

        # 2. Flagged via Flask app configuration
        if has_app_context() and current_app.config.get("OFFLINE_MODE", False):
            raise OfflineMutationGatedError(
                "Offline stock mutations are disabled in this release. An active cloud connection is required."
            )

        # 3. Connection explicitly flagged as offline or local replica
        if conn is not None:
            if getattr(conn, "is_offline", False) is True or getattr(conn, "replica_mode", None) == "offline":
                raise OfflineMutationGatedError(
                    "Offline stock mutations are disabled in this release. An active cloud connection is required."
                )


def _translate_driver_exception(e: Exception) -> Exception:
    """
    Translates raw libsql driver exceptions into standard Python DB-API / application exceptions:
    - Constraint violations (UNIQUE, CHECK, FOREIGN KEY, NOT NULL) -> sqlite3.IntegrityError
    - Hrana network/connection/stream/host errors -> DatabaseUnavailableError
    - Database locked/busy errors -> sqlite3.OperationalError
    """
    msg = str(e)
    msg_lower = msg.lower()

    # 1. Constraint violations
    if any(c in msg_lower for c in ("unique constraint", "sqlite_constraint_unique")) or ("unique" in msg_lower and "constraint" in msg_lower):
        return sqlite3.IntegrityError(msg)
    if any(c in msg_lower for c in ("check constraint", "foreign key constraint", "not null constraint", "sqlite_constraint")):
        return sqlite3.IntegrityError(msg)

    # 2. Hrana network and connection errors
    if "hrana:" in msg_lower:
        if any(term in msg_lower for term in (
            "api error", "host not found", "stream closed", "stream error",
            "connection refused", "connection reset", "connection closed",
            "status=50", "status=404", "unreachable", "timeout", "timed out",
            "network", "socket"
        )):
            return DatabaseUnavailableError(f"Cloud database connection failure: {msg}")
        if any(term in msg_lower for term in ("busy", "locked", "status=429")):
            return sqlite3.OperationalError(msg)

    # 3. Generic network / connection errors on raw exceptions
    if any(term in msg_lower for term in ("connection refused", "connection reset", "unreachable", "timed out", "host not found")):
        return DatabaseUnavailableError(f"Cloud database connection failure: {msg}")

    return e


class LibSQLRow:
    """
    Mimics sqlite3.Row behavior for LibSQL tuples.
    Captures column names at creation time to allow cursor reuse.
    Provides dictionary-like and positional access.
    """
    def __init__(self, cursor, row_tuple):
        if cursor.description:
            self._keys = [d[0] for d in cursor.description]
        else:
            self._keys = []
        self._row = tuple(row_tuple)
        self._keys_lower = [k.lower() for k in self._keys]

    def keys(self) -> list[str]:
        return list(self._keys)

    def get(self, item: str, default: Any = None) -> Any:
        try:
            return self[item]
        except (IndexError, KeyError):
            return default

    def values(self) -> list[Any]:
        return list(self._row)

    def items(self) -> list[tuple[str, Any]]:
        return list(zip(self._keys, self._row))

    def __getitem__(self, item: Any) -> Any:
        if isinstance(item, int):
            return self._row[item]
        if not isinstance(item, str):
            raise TypeError(f"Row indices must be integers or strings, not {type(item).__name__}")

        # Exact match first
        if item in self._keys:
            idx = self._keys.index(item)
            return self._row[idx]

        # Case-insensitive fallback
        item_lower = item.lower()
        if item_lower in self._keys_lower:
            idx = self._keys_lower.index(item_lower)
            return self._row[idx]

        raise IndexError(f"Column '{item}' not found. Available keys: {self._keys}")

    def __contains__(self, item: Any) -> bool:
        if not isinstance(item, str):
            return False
        return item in self._keys or item.lower() in self._keys_lower

    def __iter__(self):
        for col_name in self._keys:
            yield col_name

    def __len__(self) -> int:
        return len(self._row)

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, LibSQLRow):
            return self._row == other._row and self._keys == other._keys
        if isinstance(other, dict):
            return dict(self) == other
        return self._row == other

    def __repr__(self) -> str:
        return f"<LibSQLRow {dict(self)}>"


class LibSQLCursorWrapper:
    """Wrapper for LibSQL Cursor to support row_factory, context manager, exception translation, and duck-typing."""
    def __init__(self, real_cursor, connection_wrapper):
        self._cursor = real_cursor
        self._conn_wrapper = connection_wrapper

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    @property
    def description(self):
        return self._cursor.description

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def arraysize(self):
        return getattr(self._cursor, "arraysize", 1)

    @arraysize.setter
    def arraysize(self, val):
        if hasattr(self._cursor, "arraysize"):
            self._cursor.arraysize = val

    def execute(self, sql, parameters=()):
        try:
            self._cursor.execute(sql, parameters)
            return self
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def executemany(self, sql, seq_of_parameters):
        try:
            self._cursor.executemany(sql, seq_of_parameters)
            return self
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def executescript(self, script):
        try:
            self._cursor.executescript(script)
            return self
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def fetchone(self):
        try:
            row = self._cursor.fetchone()
        except Exception as e:
            raise _translate_driver_exception(e) from e
        if row is None:
            return None
        if self._conn_wrapper.row_factory:
            return self._conn_wrapper.row_factory(self, row)
        return row

    def fetchmany(self, size=None):
        try:
            if size is None:
                rows = self._cursor.fetchmany()
            else:
                rows = self._cursor.fetchmany(size)
        except Exception as e:
            raise _translate_driver_exception(e) from e
        if self._conn_wrapper.row_factory:
            return [self._conn_wrapper.row_factory(self, r) for r in rows]
        return rows

    def fetchall(self):
        try:
            rows = self._cursor.fetchall()
        except Exception as e:
            raise _translate_driver_exception(e) from e
        if self._conn_wrapper.row_factory:
            return [self._conn_wrapper.row_factory(self, r) for r in rows]
        return rows

    def __iter__(self):
        try:
            for row in self._cursor:
                if self._conn_wrapper.row_factory:
                    yield self._conn_wrapper.row_factory(self, row)
                else:
                    yield row
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def close(self):
        self._cursor.close()


class LibSQLConnectionWrapper:
    """Wrapper for LibSQL Connection supporting row_factory, transaction management, context manager, and duck-typing."""
    def __init__(self, real_connection):
        self._conn = real_connection
        self.row_factory = LibSQLRow

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()

    @property
    def in_transaction(self) -> bool:
        return getattr(self._conn, "in_transaction", False)

    @property
    def isolation_level(self):
        return getattr(self._conn, "isolation_level", None)

    @isolation_level.setter
    def isolation_level(self, val):
        if hasattr(self._conn, "isolation_level"):
            self._conn.isolation_level = val

    @property
    def autocommit(self):
        return getattr(self._conn, "autocommit", False)

    @autocommit.setter
    def autocommit(self, val):
        if hasattr(self._conn, "autocommit"):
            self._conn.autocommit = val

    def sync(self):
        if hasattr(self._conn, "sync"):
            return self._conn.sync()

    def cursor(self):
        return LibSQLCursorWrapper(self._conn.cursor(), self)

    def commit(self):
        try:
            self._conn.commit()
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception as e:
            raise _translate_driver_exception(e) from e

    def close(self):
        self._conn.close()

    def execute(self, sql, parameters=()):
        c = self.cursor()
        c.execute(sql, parameters)
        return c

    def executemany(self, sql, seq_of_parameters):
        c = self.cursor()
        c.executemany(sql, seq_of_parameters)
        return c

    def executescript(self, script):
        c = self.cursor()
        c.executescript(script)
        return c


def create_connection(database_target: Optional[str] = None, auth_token: Optional[str] = None):
    """
    Creates a new database connection based on configuration.
    Supports local SQLite (:memory: or file path) and remote LibSQL.
    Always enforces PRAGMA foreign_keys = ON.
    """
    # 1. Target explicitly passed or in app config
    if database_target is None and has_app_context():
        database_target = current_app.config.get("DATABASE") or current_app.config.get("DATABASE_PATH")

    # 2. Check if SQLite target requested (memory or local path)
    if database_target and (database_target == ":memory:" or database_target.endswith(".db") or database_target.endswith(".sqlite") or "/" in database_target or "\\" in database_target):
        conn = sqlite3.connect(database_target, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    # 3. Remote LibSQL mode
    target_url = database_target or TURSO_DATABASE_URL
    token = auth_token or TURSO_AUTH_TOKEN

    if not LIBSQL_AVAILABLE:
        # Fall back to sqlite3 in-memory if libsql not installed
        logger.warning("libsql is unavailable. Falling back to local in-memory SQLite database.")
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    if not target_url or not token:
        raise DatabaseUnavailableError("Remote database target URL or auth token is missing.")

    try:
        import libsql
        raw_conn = libsql.connect(target_url, auth_token=token)
        wrapper = LibSQLConnectionWrapper(raw_conn)
        wrapper.row_factory = LibSQLRow
        wrapper.execute("PRAGMA foreign_keys = ON;")
        return wrapper
    except Exception as e:
        logger.error(f"Failed to connect to database at {target_url}: {e}")
        raise DatabaseUnavailableError(f"Failed to connect to database: {e}") from e


def get_db(type: str = "read"):
    """
    Returns the request-owned database connection when inside a Flask request.
    If called outside a request context, returns an isolated new connection.
    The 'type' parameter is retained for backwards compatibility.
    """
    if has_request_context():
        if "db" not in g:
            g.db = create_connection()
        return g.db

    # Outside request context (CLI, scripts, tests)
    return create_connection()


def close_request_db(exception: Optional[BaseException] = None):
    """
    Teardown hook for Flask request contexts.
    Rolls back any unfinished transaction and closes the request-owned connection.
    """
    db = g.pop("db", None) if has_request_context() else None
    if db is not None:
        try:
            db.rollback()
        except Exception as e:
            logger.warning(f"Error rolling back connection during teardown: {e}")
        finally:
            try:
                db.close()
            except Exception as e:
                logger.warning(f"Error closing request connection during teardown: {e}")


def is_transient_error(exc: Exception) -> bool:
    """Classifies whether an exception is a transient conflict eligible for retry."""
    msg = str(exc).lower()
    # Constraint violations and validation errors must never be retried
    if any(term in msg for term in ("unique constraint", "check constraint", "foreign key constraint", "not null constraint", "validation error")):
        return False
    if isinstance(exc, (sqlite3.OperationalError, sqlite3.DatabaseError)):
        if any(term in msg for term in ("locked", "busy", "timeout", "disk i/o error")):
            return True
    if any(term in msg for term in (
        "locked", "busy", "timeout", "disk i/o error", "temporarily unavailable",
        "connection reset", "stream closed", "stream error", "status=429",
        "status=502", "status=503", "status=504", "bad gateway", "gateway timeout"
    )):
        return True
    exc_name = type(exc).__name__.lower()
    if any(term in exc_name for term in ("timeout", "connection", "temporary")):
        return True
    return False


def run_in_transaction(
    conn_factory_or_conn: Any,
    operation_fn: Callable[[Any], Any],
    max_retries: int = 3,
    initial_delay: float = 0.05,
    backoff_factor: float = 2.0
) -> Any:
    """
    Executes operation_fn(conn) in a transaction with bounded retry for transient conflicts.
    Reruns the complete transaction on transient failure.
    Non-transient errors (validation, constraints, business conflicts) are raised without retry.
    """
    attempt = 0
    delay = initial_delay

    while True:
        attempt += 1
        is_connection = hasattr(conn_factory_or_conn, "cursor")
        conn = conn_factory_or_conn if is_connection else conn_factory_or_conn()
        is_managed = not is_connection

        try:
            result = operation_fn(conn)
            conn.commit()
            return result
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass

            if is_managed:
                try:
                    conn.close()
                except Exception:
                    pass

            if attempt < max_retries and is_transient_error(exc):
                logger.warning(
                    f"Transient conflict on attempt {attempt}/{max_retries}: {exc}. "
                    f"Retrying complete transaction in {delay:.3f}s..."
                )
                time.sleep(delay)
                delay *= backoff_factor
                continue

            raise


def initialize_database():
    """Initializes database connectivity check at application startup."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        logger.info("Database connection verified successfully.")
    except Exception as e:
        logger.error(f"Database verification failed: {e}")
        raise
    finally:
        if not has_request_context():
            conn.close()


_last_synced_at: Optional[str] = None
_last_sync_error: Optional[str] = None


def record_sync_success(dt: Optional[datetime] = None):
    """Records a successful synchronization timestamp."""
    global _last_synced_at, _last_sync_error
    if dt is None:
        dt = datetime.now(timezone.utc)
    _last_synced_at = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    _last_sync_error = None


def record_sync_error(err: str):
    """Records a synchronization error."""
    global _last_sync_error
    _last_sync_error = err


def get_sync_status():
    """
    Returns database connection and synchronization status.
    Authoritative writer: Cloud LibSQL database.
    Offline stock mutations: strictly gated and disabled.
    """
    global _last_synced_at, _last_sync_error
    # Check if application or context is explicitly configured in offline mode
    is_offline = False
    if has_request_context() and getattr(g, "offline_mode", False):
        is_offline = True
    elif has_app_context() and current_app.config.get("OFFLINE_MODE", False):
        is_offline = True

    connected = not is_offline
    conn = None
    db_version = getattr(sqlite3, "sqlite_version", "Unknown")
    db_engine = "SQLite"
    db_revision = None

    if connected:
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT sqlite_version()")
            row = cursor.fetchone()
            if row:
                db_version = str(row[0] if isinstance(row, (tuple, list)) else (row["sqlite_version()"] if hasattr(row, "__getitem__") else row))
            try:
                cursor.execute("PRAGMA data_version")
                dv_row = cursor.fetchone()
                if dv_row:
                    db_revision = dv_row[0] if isinstance(dv_row, (tuple, list)) else (dv_row["data_version"] if hasattr(dv_row, "__getitem__") else dv_row)
            except Exception:
                db_revision = None
            if isinstance(conn, LibSQLConnectionWrapper) or hasattr(conn, "sync"):
                db_engine = "LibSQL"
            else:
                db_engine = "SQLite"
        except Exception as e:
            connected = False
            _last_sync_error = str(e)
        finally:
            if not has_request_context() and conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    return {
        "connected": connected,
        "mode": "offline" if is_offline else "cloud",
        "engine": db_engine,
        "version": db_version,
        "authoritative_writer": "remote_libsql",
        "offline_mutations_allowed": is_offline_mutation_allowed(),
        "last_synced_at": _last_synced_at,
        "last_error": _last_sync_error,
        "revision": db_revision,
        "pending_state": {
            "has_pending": False,
            "pending_count": 0,
            "conflicts": 0
        }
    }
