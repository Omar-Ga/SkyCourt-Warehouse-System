"""
Database utilities for SkyCourt Warehouse System.
Provides request-owned connections, transaction management, transient-conflict retries,
and compatibility adapters for SQLite and LibSQL.
"""
import logging
import os
import queue
import sqlite3
import threading
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


class StagingSafetyError(RuntimeError):
    """Raised when a staging operation could target the authoritative database."""
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

    if conn is None and has_request_context() and "db" in g:
        conn = g.db

    # 3. Connection explicitly flagged as offline or local replica
    if conn is not None and (
        getattr(conn, "is_offline", False) is True
        or getattr(conn, "replica_mode", None) == "offline"
    ):
        raise OfflineMutationGatedError(
            "Offline stock mutations are disabled in this release. An active cloud connection is required."
        )

    if conn is None:
        raise DatabaseUnavailableError("An authoritative cloud database connection is required.")

    # Local SQLite is a test-only escape hatch. Production must be positively
    # identified as an authenticated LibSQL connection, not merely non-offline.
    if isinstance(conn, sqlite3.Connection):
        if _local_sqlite_allowed():
            return
        raise DatabaseUnavailableError("Only an authenticated remote LibSQL connection may mutate stock.")

    if isinstance(conn, LibSQLConnectionWrapper) and conn.is_authenticated:
        return

    raise DatabaseUnavailableError("Only an authenticated remote LibSQL connection may mutate stock.")


def _local_sqlite_allowed() -> bool:
    """Returns whether local SQLite is explicitly enabled for tests."""
    if has_app_context() and current_app.config.get("TESTING", False):
        return True
    return os.environ.get("SKYCOURT_ALLOW_LOCAL_SQLITE_TESTS") == "1"


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
        self._last_rowcount = -1

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
        if isinstance(self._cursor, sqlite3.Cursor):
            return self._cursor.rowcount
        if self._last_rowcount != -1:
            return self._last_rowcount
        return getattr(self._cursor, "rowcount", -1)

    @property
    def arraysize(self):
        return getattr(self._cursor, "arraysize", 1)

    @arraysize.setter
    def arraysize(self, val):
        if hasattr(self._cursor, "arraysize"):
            self._cursor.arraysize = val

    def _flag_broken(self, exc: Exception) -> Exception:
        translated = _translate_driver_exception(exc)
        if isinstance(translated, DatabaseUnavailableError):
            if hasattr(self._conn_wrapper, "_is_broken"):
                self._conn_wrapper._is_broken = True
            if hasattr(self._conn_wrapper, "_real_conn") and getattr(self._conn_wrapper, "_real_conn"):
                self._conn_wrapper._real_conn._is_broken = True
        return translated

    def execute(self, sql, parameters=()):
        try:
            if isinstance(self._cursor, sqlite3.Cursor):
                self._cursor.execute(sql, parameters)
                return self
            prev_rc = getattr(self._cursor, "rowcount", 0) or 0
            self._cursor.execute(sql, parameters)
            curr_rc = getattr(self._cursor, "rowcount", 0) or 0
            self._last_rowcount = curr_rc - prev_rc if curr_rc >= prev_rc else curr_rc
            return self
        except Exception as e:
            raise self._flag_broken(e) from e

    def executemany(self, sql, seq_of_parameters):
        try:
            if isinstance(self._cursor, sqlite3.Cursor):
                self._cursor.executemany(sql, seq_of_parameters)
                return self
            prev_rc = getattr(self._cursor, "rowcount", 0) or 0
            self._cursor.executemany(sql, seq_of_parameters)
            curr_rc = getattr(self._cursor, "rowcount", 0) or 0
            self._last_rowcount = curr_rc - prev_rc if curr_rc >= prev_rc else curr_rc
            return self
        except Exception as e:
            raise self._flag_broken(e) from e

    def executescript(self, script):
        try:
            self._cursor.executescript(script)
            return self
        except Exception as e:
            raise self._flag_broken(e) from e

    def fetchone(self):
        try:
            row = self._cursor.fetchone()
        except Exception as e:
            raise self._flag_broken(e) from e
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
            raise self._flag_broken(e) from e
        if self._conn_wrapper.row_factory:
            return [self._conn_wrapper.row_factory(self, r) for r in rows]
        return rows

    def fetchall(self):
        try:
            rows = self._cursor.fetchall()
        except Exception as e:
            raise self._flag_broken(e) from e
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
            raise self._flag_broken(e) from e

    def close(self):
        self._cursor.close()


class LibSQLConnectionWrapper:
    """Wrapper for LibSQL Connection supporting row_factory, transaction management, context manager, and duck-typing."""
    def __init__(self, real_connection, database_target: Optional[str] = None, authenticated: bool = False):
        self._conn = real_connection
        self.row_factory = LibSQLRow
        self.database_target = database_target
        self.is_authenticated = authenticated
        self._is_broken = False

    def _flag_broken(self, exc: Exception) -> Exception:
        translated = _translate_driver_exception(exc)
        if isinstance(translated, DatabaseUnavailableError):
            self._is_broken = True
        return translated

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
            raise self._flag_broken(e) from e

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception as e:
            raise self._flag_broken(e) from e

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


class PooledConnection(LibSQLConnectionWrapper):
    """
    Proxy wrapping a persistent LibSQLConnectionWrapper.
    Safely delegates operations to the underlying connection and returns it
    to the pool upon close() without severing the remote transport socket.
    """
    def __init__(self, pool: 'LibSQLConnectionPool', real_conn: LibSQLConnectionWrapper):
        self._pool = pool
        self._real_conn = real_conn
        self._closed = False
        super().__init__(
            real_conn._conn,
            database_target=getattr(real_conn, "database_target", None),
            authenticated=getattr(real_conn, "is_authenticated", False)
        )
        self.row_factory = getattr(real_conn, "row_factory", LibSQLRow)
        self._is_broken = getattr(real_conn, "_is_broken", False)

    def _check_closed(self):
        if self._closed or self._real_conn is None:
            raise sqlite3.ProgrammingError("Cannot operate on a closed connection.")

    def close(self):
        if not self._closed and self._pool is not None and self._real_conn is not None:
            self._closed = True
            pool = self._pool
            conn = self._real_conn
            self._pool = None
            self._real_conn = None
            if getattr(self, "_is_broken", False):
                conn._is_broken = True
            pool.release(conn)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def __enter__(self):
        self._check_closed()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._closed:
            return
        if exc_type is not None:
            try:
                self.rollback()
            except Exception:
                pass
        else:
            try:
                self.commit()
            except Exception:
                pass

    @property
    def in_transaction(self) -> bool:
        self._check_closed()
        return getattr(self._conn, "in_transaction", False)

    @property
    def isolation_level(self):
        self._check_closed()
        return getattr(self._conn, "isolation_level", None)

    @isolation_level.setter
    def isolation_level(self, val):
        self._check_closed()
        if hasattr(self._conn, "isolation_level"):
            self._conn.isolation_level = val

    @property
    def autocommit(self):
        self._check_closed()
        return getattr(self._conn, "autocommit", False)

    @autocommit.setter
    def autocommit(self, val):
        self._check_closed()
        if hasattr(self._conn, "autocommit"):
            self._conn.autocommit = val

    def sync(self):
        self._check_closed()
        if hasattr(self._conn, "sync"):
            return self._conn.sync()

    def cursor(self):
        self._check_closed()
        return LibSQLCursorWrapper(self._conn.cursor(), self)

    def commit(self):
        self._check_closed()
        try:
            self._real_conn.commit()
        except Exception as e:
            translated = self._flag_broken(e)
            if self._real_conn is not None and getattr(self, "_is_broken", False):
                self._real_conn._is_broken = True
            raise translated from e

    def rollback(self):
        self._check_closed()
        try:
            self._real_conn.rollback()
        except Exception as e:
            translated = self._flag_broken(e)
            if self._real_conn is not None and getattr(self, "_is_broken", False):
                self._real_conn._is_broken = True
            raise translated from e

    def execute(self, sql, parameters=()):
        self._check_closed()
        c = self.cursor()
        c.execute(sql, parameters)
        return c

    def executemany(self, sql, seq_of_parameters):
        self._check_closed()
        c = self.cursor()
        c.executemany(sql, seq_of_parameters)
        return c

    def executescript(self, script):
        self._check_closed()
        c = self.cursor()
        c.executescript(script)
        return c

    def __getattr__(self, name):
        self._check_closed()
        return getattr(self._real_conn, name)


class LibSQLConnectionPool:
    """
    Thread-safe LIFO connection pool for remote LibSQL/Turso connections.
    Maintains a pool of warm LibSQLConnectionWrapper instances and provides
    PooledConnection proxies for request-isolated lifecycle management.
    """
    def __init__(self, max_size: int = 5, max_idle_seconds: float = 30.0, timeout: float = 10.0):
        self._max_size = max(1, max_size)
        self._max_idle_seconds = max_idle_seconds
        self._timeout = timeout
        self._pool: queue.LifoQueue = queue.LifoQueue(maxsize=self._max_size)
        self._lock = threading.Lock()
        self._created_count = 0

    @property
    def max_size(self) -> int:
        return self._max_size

    @property
    def created_count(self) -> int:
        with self._lock:
            return self._created_count

    @property
    def idle_count(self) -> int:
        return self._pool.qsize()

    def _close_conn_safely(self, conn: Any):
        try:
            conn.close()
        except Exception:
            pass

    def acquire(self, target_url: str, token: str) -> PooledConnection:
        """
        Acquires a connection from the pool, creating a new one if permitted by capacity,
        or waiting until an idle connection becomes available.
        Performs health check on idle connections before returning.
        """
        deadline = time.time() + self._timeout
        while True:
            # 1. Check for an idle connection without blocking
            try:
                raw_conn, last_used = self._pool.get_nowait()

                # Stale target URL verification
                if getattr(raw_conn, "database_target", None) != target_url:
                    self._close_conn_safely(raw_conn)
                    with self._lock:
                        self._created_count = max(0, self._created_count - 1)
                    continue

                # Broken connection check
                if getattr(raw_conn, "_is_broken", False):
                    self._close_conn_safely(raw_conn)
                    with self._lock:
                        self._created_count = max(0, self._created_count - 1)
                    continue

                # Stale idle check: if idle for more than max_idle_seconds, ping with SELECT 1
                if time.time() - last_used > self._max_idle_seconds:
                    try:
                        raw_conn.execute("SELECT 1;")
                    except Exception as e:
                        logger.warning(f"Discarding stale or unhealthy pooled connection: {e}")
                        self._close_conn_safely(raw_conn)
                        with self._lock:
                            self._created_count = max(0, self._created_count - 1)
                        continue

                return PooledConnection(self, raw_conn)
            except queue.Empty:
                pass

            # 2. Can we create a new connection?
            with self._lock:
                if self._created_count < self._max_size:
                    self._created_count += 1
                    can_create = True
                else:
                    can_create = False

            if can_create:
                try:
                    raw_conn = _create_raw_libsql_connection(target_url, token)
                    return PooledConnection(self, raw_conn)
                except Exception:
                    with self._lock:
                        self._created_count = max(0, self._created_count - 1)
                    raise

            # 3. Pool is at maximum capacity, wait for a returned connection
            remaining = deadline - time.time()
            if remaining <= 0:
                raise DatabaseUnavailableError("Timed out waiting for an available database connection in pool.")
            try:
                raw_conn, last_used = self._pool.get(timeout=min(remaining, 0.5))

                if getattr(raw_conn, "database_target", None) != target_url:
                    self._close_conn_safely(raw_conn)
                    with self._lock:
                        self._created_count = max(0, self._created_count - 1)
                    continue

                if getattr(raw_conn, "_is_broken", False):
                    self._close_conn_safely(raw_conn)
                    with self._lock:
                        self._created_count = max(0, self._created_count - 1)
                    continue

                if time.time() - last_used > self._max_idle_seconds:
                    try:
                        raw_conn.execute("SELECT 1;")
                    except Exception as e:
                        logger.warning(f"Discarding stale or unhealthy pooled connection: {e}")
                        self._close_conn_safely(raw_conn)
                        with self._lock:
                            self._created_count = max(0, self._created_count - 1)
                        continue

                return PooledConnection(self, raw_conn)
            except queue.Empty:
                continue

    def release(self, raw_conn: Any) -> None:
        """
        Releases a connection back to the pool after rolling back uncommitted changes.
        Discards broken connections.
        """
        if raw_conn is None:
            return

        if isinstance(raw_conn, PooledConnection):
            raw_conn = raw_conn._real_conn
            if raw_conn is None:
                return

        if getattr(raw_conn, "_is_broken", False):
            self._close_conn_safely(raw_conn)
            with self._lock:
                self._created_count = max(0, self._created_count - 1)
            return

        try:
            raw_conn.rollback()
        except Exception:
            self._close_conn_safely(raw_conn)
            with self._lock:
                self._created_count = max(0, self._created_count - 1)
            return

        raw_conn.row_factory = LibSQLRow

        try:
            self._pool.put_nowait((raw_conn, time.time()))
        except (queue.Full, Exception):
            self._close_conn_safely(raw_conn)
            with self._lock:
                self._created_count = max(0, self._created_count - 1)

    def close_all(self) -> None:
        """Closes and discards all idle connections in the pool."""
        with self._lock:
            while not self._pool.empty():
                try:
                    conn_info = self._pool.get_nowait()
                    self._close_conn_safely(conn_info[0])
                except queue.Empty:
                    break
            self._created_count = 0


_global_libsql_pool: Optional[LibSQLConnectionPool] = None
_pool_lock = threading.Lock()


def get_connection_pool() -> LibSQLConnectionPool:
    """Returns the global LibSQLConnectionPool singleton."""
    global _global_libsql_pool
    if _global_libsql_pool is None:
        with _pool_lock:
            if _global_libsql_pool is None:
                max_size = 5
                max_idle = 30.0
                timeout = 10.0
                if has_app_context():
                    max_size = current_app.config.get("DATABASE_POOL_SIZE", 5)
                    max_idle = current_app.config.get("DATABASE_POOL_MAX_IDLE_SECONDS", 30.0)
                    timeout = current_app.config.get("DATABASE_POOL_TIMEOUT", 10.0)
                _global_libsql_pool = LibSQLConnectionPool(
                    max_size=max_size,
                    max_idle_seconds=max_idle,
                    timeout=timeout
                )
    return _global_libsql_pool


def reset_connection_pool() -> None:
    """Resets and closes all connections in the global connection pool."""
    global _global_libsql_pool
    with _pool_lock:
        if _global_libsql_pool is not None:
            _global_libsql_pool.close_all()
            _global_libsql_pool = None


def _create_raw_libsql_connection(target_url: str, token: str) -> LibSQLConnectionWrapper:
    """Establishes a new authenticated LibSQL connection wrapper."""
    if not LIBSQL_AVAILABLE:
        raise DatabaseUnavailableError("The LibSQL driver is unavailable; cloud database access is disabled.")

    if not target_url or not token:
        raise DatabaseUnavailableError("Remote database target URL or auth token is missing.")

    try:
        import libsql
        raw_conn = libsql.connect(target_url, auth_token=token)
        wrapper = LibSQLConnectionWrapper(raw_conn, database_target=target_url, authenticated=True)
        wrapper.row_factory = LibSQLRow
        wrapper.execute("PRAGMA foreign_keys = ON;")
        return wrapper
    except Exception as e:
        logger.error(f"Failed to connect to database at {target_url}: {e}")
        raise DatabaseUnavailableError(f"Failed to connect to database: {e}") from e


def create_connection(database_target: Optional[str] = None, auth_token: Optional[str] = None):
    """
    Creates a new unpooled database connection based on configuration.
    Supports local SQLite only in explicit test mode and remote LibSQL in production.
    Always enforces PRAGMA foreign_keys = ON.
    """
    # 1. Target explicitly passed or in app config
    if database_target is None and has_app_context():
        database_target = current_app.config.get("DATABASE") or current_app.config.get("DATABASE_PATH")

    # 2. Check if an explicit local SQLite target was requested. Remote URLs
    # also contain slashes, so classify them before checking path-like values.
    is_remote_target = bool(database_target) and database_target.lower().startswith(("libsql://", "https://", "wss://", "ws://"))
    is_local_target = bool(database_target) and (
        database_target == ":memory:"
        or database_target.startswith("file:")
        or database_target.endswith((".db", ".sqlite"))
        or (not is_remote_target and ("/" in database_target or "\\" in database_target))
    )
    if is_local_target:
        if not _local_sqlite_allowed():
            raise DatabaseUnavailableError("Local SQLite databases are permitted only in explicit test mode.")
        conn = sqlite3.connect(database_target, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    # 3. Remote LibSQL mode
    target_url = database_target or TURSO_DATABASE_URL
    token = auth_token or TURSO_AUTH_TOKEN
    return _create_raw_libsql_connection(target_url, token)


def _acquire_connection_for_context(database_target: Optional[str] = None, auth_token: Optional[str] = None):
    """
    Acquires a connection for the active context.
    Borrows from the LibSQL connection pool for remote LibSQL targets.
    Local SQLite targets (used in automated tests) remain direct and unpooled.
    """
    if database_target is None and has_app_context():
        database_target = current_app.config.get("DATABASE") or current_app.config.get("DATABASE_PATH")

    is_remote_target = bool(database_target) and database_target.lower().startswith(("libsql://", "https://", "wss://", "ws://"))
    is_local_target = bool(database_target) and (
        database_target == ":memory:"
        or database_target.startswith("file:")
        or database_target.endswith((".db", ".sqlite"))
        or (not is_remote_target and ("/" in database_target or "\\" in database_target))
    )
    if is_local_target:
        return create_connection(database_target, auth_token)

    target_url = database_target or TURSO_DATABASE_URL
    token = auth_token or TURSO_AUTH_TOKEN
    pool = get_connection_pool()
    return pool.acquire(target_url, token)


def get_db(type: str = "read"):
    """
    Returns the request-owned database connection when inside a Flask request.
    If called outside a request context, returns an isolated connection.
    Borrows from the LibSQL connection pool for remote LibSQL databases.
    Local SQLite targets (test databases) remain unpooled.
    The 'type' parameter is retained for backwards compatibility.
    """
    if has_request_context():
        if "db" not in g:
            g.db = _acquire_connection_for_context()
        return g.db

    # Outside request context (CLI, scripts, tests)
    return _acquire_connection_for_context()


def close_request_db(exception: Optional[BaseException] = None):
    """
    Teardown hook for Flask request contexts.
    Rolls back any unfinished transaction and closes the request-owned connection.
    For PooledConnection, close() safely returns the connection to the pool without closing the socket.
    """
    db = g.pop("db", None) if (has_app_context() or has_request_context()) else None
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
