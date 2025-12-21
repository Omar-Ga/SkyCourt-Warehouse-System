import sqlite3
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from flask import g
import threading
from dotenv import load_dotenv

# Load env vars explicitly to ensure they are available
load_dotenv()

# Try to import libsql
try:
    import libsql
    LIBSQL_AVAILABLE = True
except ImportError:
    LIBSQL_AVAILABLE = False
    print("Warning: 'libsql' package not found. Cloud sync disabled.")

# Path to the database file
if getattr(sys, 'frozen', False):
    bundle_root = sys._MEIPASS
    DATABASE_NAME = os.path.join(bundle_root, 'database', 'warehouse.db')
    SCHEMA_PATH = os.path.join(bundle_root, 'database', 'schema.sql')
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    DATABASE_NAME = os.path.abspath(os.path.join(script_dir, '..', '..', 'database', 'warehouse.db'))
    SCHEMA_PATH = os.path.abspath(os.path.join(script_dir, '..', '..', 'database', 'schema.sql'))

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
    """
    def __init__(self, cursor, row_tuple):
        self._cursor = cursor
        self._row = row_tuple
    
    def keys(self):
        if not self._cursor.description:
             return []
        return [d[0] for d in self._cursor.description]

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._row[item]
        try:
            keys = [d[0] for d in self._cursor.description]
            idx = keys.index(item)
            return self._row[idx]
        except ValueError:
            raise IndexError(f"Column '{item}' not found")
            
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
    """
    global DB_INITIALIZED
    if DB_INITIALIZED:
        return

    # Check Turso Config
    turso_url = os.environ.get("TURSO_DATABASE_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN")
    
    print(f"DEBUG: LibSQL Available: {LIBSQL_AVAILABLE}")
    print(f"DEBUG: Turso URL Present: {bool(turso_url)}")
    print(f"DEBUG: Turso Token Present: {bool(turso_token)}")

    db_dir = os.path.dirname(DATABASE_NAME)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

    # 1. Try LibSQL Restore/Sync
    if LIBSQL_AVAILABLE and turso_url and turso_token:
        try:
            print(f"Initializing/Syncing from Turso: {turso_url}")
            # Connect to local file, configured to sync
            conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
            conn.sync()
            conn.close()
            
            DB_INITIALIZED = True
            print(">> Database restored/synced from Turso.")
            return
        except Exception as e:
            print(f"Warning: Turso Sync initialization failed: {e}")
            # If offline and no local DB, we must create schema. 
            # If offline and local DB exists, we are fine.

    if os.path.exists(DATABASE_NAME):
        # Database exists (either from previous run or sync attempt partially worked)
        DB_INITIALIZED = True
        return

    # 2. Fallback: Create from Schema (Fresh Local DB)
    print(f"Creating fresh local database from schema: {SCHEMA_PATH}")
    if not os.path.exists(SCHEMA_PATH):
        print(f"Error: Schema file not found at {SCHEMA_PATH}")
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
        print("Fresh database created successfully.")
    except Exception as e:
        print(f"Database initialization error: {e}")
    finally:
        if conn:
            conn.close()

def get_db():
    if 'db' not in g:
        g.db = get_db_connection()
    return g.db

def get_db_connection():
    """
    Returns the database connection. 
    Always attempts to use LibSQL with Sync if configured.
    """
    global DB_INITIALIZED
    if not DB_INITIALIZED:
        initialize_database()

    turso_url = os.environ.get("TURSO_DATABASE_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN")

    if LIBSQL_AVAILABLE and turso_url and turso_token:
        try:
            # LibSQL with Embedded Replica
            raw_conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
            
            # Sync Logic
            try:
                raw_conn.sync()
                # print(">> Sync OK") # fast sync, keep silent to reduce log noise
            except Exception as e:
                print(f">> Sync Failed (Running Offline): {e}")

            # Check if this is a fresh DB that needs schema (edge case: blank file created by connection)
            # Simple check: Try querying a table.
            try:
                raw_conn.execute("SELECT count(*) FROM items")
            except Exception:
                # If table missing, maybe sync failed on a brand new file?
                # We should run schema here if needed.
                # But initialize_database should have handled it.
                pass

            conn = LibSQLConnectionWrapper(raw_conn)
            conn.row_factory = LibSQLRow
            conn.execute("PRAGMA foreign_keys = ON;")
            return conn
            
        except Exception as e:
            print(f"LibSQL Connection Error: {e}. Fallback to standard SQLite.")
            # If LibSQL completely fails (e.g. DLL missing), fall back.

    # Standard SQLite
    conn = sqlite3.connect(DATABASE_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def get_sync_status():
    """
    Checks if Turso sync is possible.
    Returns: {"connected": bool, "mode": "cloud" | "local"}
    """
    turso_url = os.environ.get("TURSO_DATABASE_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN")
    
    if not LIBSQL_AVAILABLE or not turso_url or not turso_token:
        return {"connected": False, "mode": "local"}
        
    try:
        # Try a quick sync with a temporary connection to verify
        # (Using DATABASE_NAME ensures we use the same replica)
        test_conn = libsql.connect(DATABASE_NAME, sync_url=turso_url, auth_token=turso_token)
        test_conn.sync()
        test_conn.close()
        return {"connected": True, "mode": "cloud"}
    except Exception:
        return {"connected": False, "mode": "cloud"}

def backup_database(target_backup_path):
    """Creates a backup copy of the current SQLite database file."""
    if not os.path.exists(DATABASE_NAME):
        return False, f"Source database {DATABASE_NAME} not found."
    
    try:
        target_dir = os.path.dirname(target_backup_path)
        if target_dir and not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
            
        shutil.copy2(DATABASE_NAME, target_backup_path)
        return True, f"Database backed up successfully to {target_backup_path}"
    except Exception as e:
        print(f"Error backing up database: {e}")
        return False, str(e)

def create_timestamped_backup():
    try:
        app_data_dir = Path(os.getenv('APPDATA')) / 'WarehouseApp' / 'backups'
        app_data_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        backup_filename = f'warehouse_backup_{timestamp}.db'
        target_path = app_data_dir / backup_filename
        return backup_database(str(target_path))
    except Exception as e:
        return False, str(e) 