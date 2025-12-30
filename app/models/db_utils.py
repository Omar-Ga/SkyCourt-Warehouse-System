"""
Database utilities for connecting to the remote Turso database.
Uses a persistent connection singleton to avoid repeated handshakes.
"""
import logging
from flask import g

from ..config import (
    TURSO_DATABASE_URL, 
    TURSO_AUTH_TOKEN, 
    LIBSQL_AVAILABLE
)

logger = logging.getLogger(__name__)

# Global persistent connection (created once at startup)
_PERSISTENT_CONNECTION = None
_CONNECTION_INITIALIZED = False


class LibSQLConnectionWrapper:
    """
    Wrapper for LibSQL Connection to support row_factory and duck-typing with sqlite3.
    """
    def __init__(self, real_connection):
        self._conn = real_connection
        self.row_factory = None

    def cursor(self):
        return LibSQLCursorWrapper(self._conn.cursor(), self)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        # Don't actually close the persistent connection
        pass

    def execute(self, sql, parameters=()):
        c = self.cursor()
        c.execute(sql, parameters)
        return c


class LibSQLCursorWrapper:
    """
    Wrapper for LibSQL Cursor to support row_factory.
    """
    def __init__(self, real_cursor, connection_wrapper):
        self._cursor = real_cursor
        self._conn_wrapper = connection_wrapper

    @property
    def description(self):
        return self._cursor.description

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def execute(self, sql, parameters=()):
        self._cursor.execute(sql, parameters)
        return self

    def executescript(self, script):
        self._cursor.executescript(script)
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        if self._conn_wrapper.row_factory:
            return self._conn_wrapper.row_factory(self, row)
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        if self._conn_wrapper.row_factory:
            return [self._conn_wrapper.row_factory(self, r) for r in rows]
        return rows

    def __iter__(self):
        for row in self._cursor:
            if self._conn_wrapper.row_factory:
                yield self._conn_wrapper.row_factory(self, row)
            else:
                yield row
    
    def close(self):
        self._cursor.close()


class LibSQLRow:
    """
    Mimics sqlite3.Row behavior for LibSQL tuples.
    Captures column names at creation time to allow cursor reuse.
    """
    def __init__(self, cursor, row_tuple):
        # Capture description immediately because cursor state might change
        if cursor.description:
            self._keys = [d[0] for d in cursor.description]
        else:
            self._keys = []
        self._row = row_tuple
    
    def keys(self):
        return self._keys

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._row[item]
        try:
            # Case-insensitive lookup using cached keys
            if item in self._keys:
                idx = self._keys.index(item)
                return self._row[idx]
            
            # Try case-insensitive fallback
            keys_lower = [k.lower() for k in self._keys]
            item_lower = item.lower()
            if item_lower in keys_lower:
                idx = keys_lower.index(item_lower)
                return self._row[idx]
                
            raise ValueError
        except ValueError:
             raise IndexError(f"Column '{item}' not found. Available keys: {self._keys}")

    def __iter__(self):
        for col_name in self.keys():
            yield col_name

    def __len__(self):
        return len(self._row)
        
    def __eq__(self, other):
        return self._row == other


def _get_persistent_connection():
    """
    Returns the singleton persistent connection to Turso.
    Creates the connection on first call.
    """
    global _PERSISTENT_CONNECTION, _CONNECTION_INITIALIZED
    
    if _PERSISTENT_CONNECTION is not None:
        return _PERSISTENT_CONNECTION
    
    if not LIBSQL_AVAILABLE:
        raise RuntimeError("libsql package is not available. Cannot connect to Turso.")
    
    if not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
        raise RuntimeError("Turso credentials are not configured.")
    
    try:
        import libsql
        logger.info("Creating persistent connection to Turso...")
        raw_conn = libsql.connect(TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
        _PERSISTENT_CONNECTION = LibSQLConnectionWrapper(raw_conn)
        _PERSISTENT_CONNECTION.row_factory = LibSQLRow
        _PERSISTENT_CONNECTION.execute("PRAGMA foreign_keys = ON;")
        _CONNECTION_INITIALIZED = True
        logger.info("Persistent Turso connection established.")
        return _PERSISTENT_CONNECTION
    except Exception as e:
        logger.error(f"Failed to connect to Turso: {e}")
        raise RuntimeError(f"Failed to connect to Turso database: {e}")


def initialize_database():
    """
    Initializes the database connection at startup.
    Verifies connectivity to the remote Turso database.
    """
    global _CONNECTION_INITIALIZED
    if _CONNECTION_INITIALIZED:
        return
    
    # This will create the persistent connection and raise if it fails
    conn = _get_persistent_connection()
    
    # Verify we can query the database
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        logger.info("Database connection verified successfully.")
    except Exception as e:
        logger.error(f"Database verification failed: {e}")
        raise


def get_db(type='read'):
    """
    Returns the database connection.
    The 'type' parameter is kept for backward compatibility but is ignored.
    All operations now use the same persistent Turso connection.
    """
    # Use Flask's g object to cache per-request if needed,
    # but always return the same persistent connection
    if 'db' not in g:
        g.db = _get_persistent_connection()
    return g.db





def get_sync_status():
    """
    Returns the sync status.
    Since we're now using a direct remote connection, this always returns connected.
    """
    global _CONNECTION_INITIALIZED
    if _CONNECTION_INITIALIZED:
        return {"connected": True, "mode": "cloud"}
    return {"connected": False, "mode": "cloud"}
