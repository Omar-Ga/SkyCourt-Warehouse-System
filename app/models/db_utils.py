import sqlite3
import os
import sys
from datetime import datetime
from flask import g

# Import configuration and sync worker
from ..config import (
    DATABASE_NAME, 
    SCHEMA_PATH, 
    TURSO_DATABASE_URL, 
    TURSO_AUTH_TOKEN, 
    LIBSQL_AVAILABLE
)
from .sync_worker import run_background_sync

# Global initialization flag
DB_INITIALIZED = False

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
        self._conn.close()

    def execute(self, sql, parameters=()):
        c = self.cursor()
        c.execute(sql, parameters)
        return c
    
    def sync(self):
        if hasattr(self._conn, 'sync'):
            self._conn.sync()

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

def initialize_database():
    """
    Ensures the database is ready.
    If using Turso, it attempts to SYNC (Restore) first.
    Blocking wait here is acceptable as it occurs only on startup.
    """
    global DB_INITIALIZED
    if DB_INITIALIZED:
        return

    turso_url = TURSO_DATABASE_URL
    turso_token = TURSO_AUTH_TOKEN
    
    # Imports inside function to avoid top-level optional import issues if libs missing
    try:
        import libsql
    except ImportError:
        pass

    db_dir = os.path.dirname(DATABASE_NAME)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

    # 1. Try LibSQL Restore/Sync (Startup Only - Blocking is fine)
    if LIBSQL_AVAILABLE and turso_url and turso_token:
        try:
            # Connect to local file, configured to sync
            conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
            conn.sync()
            conn.close()
            
            DB_INITIALIZED = True
            return
        except Exception:
            # If offline and no local DB, we must create schema. 
            # If offline and local DB exists, we are fine.
            pass

    if os.path.exists(DATABASE_NAME):
        # Database exists (either from previous run or sync attempt partially worked)
        DB_INITIALIZED = True
        return

    # 2. Fallback: Create from Schema (Fresh Local DB)
    if not os.path.exists(SCHEMA_PATH):
        return

    conn = None
    try:
        conn = sqlite3.connect(DATABASE_NAME)
        cursor = conn.cursor()
        with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
            schema_script = f.read()
        cursor.executescript(schema_script)
        conn.commit()
        DB_INITIALIZED = True
    except Exception:
        pass
    finally:
        if conn:
            conn.close()

def get_db(type='read'):
    """
    Returns a database connection based on the requested type.
    type='read': Uses standard SQLite (Fast, for UI).
    type='write': Uses LibSQL (Sync-enabled, for Data Persistence).
    """
    if type == 'write':
        if 'db_write' not in g:
            g.db_write = get_db_connection(type='write')
        return g.db_write
    else:
        if 'db_read' not in g:
            g.db_read = get_db_connection(type='read')
        return g.db_read

def get_db_connection(type='read'):
    """
    Returns the database connection. 
    type='write': Forces LibSQL connection to ensure replication tracking.
    type='read': Uses standard SQLite for performance.
    """
    global DB_INITIALIZED
    try:
        import libsql
    except ImportError:
        pass

    if not DB_INITIALIZED:
        initialize_database()

    turso_url = TURSO_DATABASE_URL
    turso_token = TURSO_AUTH_TOKEN

    # --- HYBRID CONNECTION STRATEGY ---
    # Write operations MUST use LibSQL to ensure changes are replicated to Turso.
    # Read operations use standard SQLite for maximum UI responsiveness (0 latency).
    
    if type == 'write' and LIBSQL_AVAILABLE and turso_url and turso_token:
        try:
            # LibSQL with Embedded Replica for WRITES
            # This ensures the replication log (WAL) is properly managed for sync.
            raw_conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
            
            # Note: We do NOT sync here to avoid race conditions. 
            # Sync is triggered via run_background_sync() AFTER commit.

            conn = LibSQLConnectionWrapper(raw_conn)
            conn.row_factory = LibSQLRow
            conn.execute("PRAGMA foreign_keys = ON;")
            return conn
            
        except Exception:
            # Fallback to local SQLite means no sync, but app keeps working.
            pass

    # Standard SQLite (Read-Only optimization, or Fallback)
    conn = sqlite3.connect(DATABASE_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn



def get_sync_status():
    """
    Checks if Turso sync is possible.
    Returns: {"connected": bool, "mode": "cloud" | "local"}
    """
    turso_url = TURSO_DATABASE_URL
    turso_token = TURSO_AUTH_TOKEN
    
    if not LIBSQL_AVAILABLE or not turso_url or not turso_token:
        return {"connected": False, "mode": "local"}
    
    try:
        import libsql
        # Try a quick sync with a temporary connection to verify
        # (Using DATABASE_NAME ensures we use the same replica)
        # Note: This is an explicit status check, so blocking here is arguably okay,
        # but for a status pill it might be slow. 
        # For now, we keep it as a 'verify' action.
        test_conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
        test_conn.sync()
        test_conn.close()
        return {"connected": True, "mode": "cloud"}
    except Exception:
        return {"connected": False, "mode": "cloud"}

