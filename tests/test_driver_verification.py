"""
Tests for Remote Engine and Pinned Driver Behavior Verification.
Covers:
- LibSQL pinned driver properties and connect parameter signature.
- Transaction boundaries, isolation, commit, and rollback.
- Constraint enforcement: CHECK, UNIQUE, and FOREIGN KEY.
- Driver exception typing (libsql raises ValueError for constraint violations).
- Row mapping compatibility (LibSQLRow vs sqlite3.Row duck-typing).
- Cursor wrapper methods (lastrowid, rowcount, fetchone, fetchall).
- Thread ownership and connection safety.
- Transient error classification for LibSQL and SQLite exceptions.
"""
import concurrent.futures
import sqlite3
import pytest

from app.models.db_utils import (
    LibSQLRow,
    LibSQLConnectionWrapper,
    LibSQLCursorWrapper,
    is_transient_error,
    create_connection,
    get_db,
)

try:
    import libsql
    LIBSQL_AVAILABLE = True
except ImportError:
    LIBSQL_AVAILABLE = False


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_connect_parameter_signature():
    """
    Verifies that the pinned libsql driver accepts 'database', '_check_same_thread',
    and 'auth_token', while rejecting 'path' or un-prefixed 'check_same_thread'.
    """
    # 1. Valid invocation with database and _check_same_thread
    conn = libsql.connect(database=":memory:", _check_same_thread=False)
    assert conn is not None
    conn.close()

    # 2. Rejecting un-prefixed 'check_same_thread'
    with pytest.raises(TypeError, match="unexpected keyword argument 'check_same_thread'"):
        libsql.connect(":memory:", check_same_thread=False)

    # 3. Rejecting 'path' keyword argument
    with pytest.raises(TypeError, match="unexpected keyword argument 'path'"):
        libsql.connect(path=":memory:")


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_no_native_row_factory():
    """
    Verifies that native libsql.Connection does NOT support row_factory assignment,
    confirming why the application must use LibSQLConnectionWrapper.
    """
    conn = libsql.connect(":memory:")
    with pytest.raises(AttributeError, match="has no attribute 'row_factory'"):
        conn.row_factory = sqlite3.Row
    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_transactions_and_rollback():
    """
    Verifies transaction isolation and rollback behavior on the pinned driver.
    Uncommitted rows must be completely discarded upon rollback.
    """
    conn = libsql.connect(":memory:")
    cur = conn.cursor()
    cur.execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER);")
    conn.commit()

    # Insert and rollback
    cur.execute("INSERT INTO accounts (balance) VALUES (100);")
    conn.rollback()

    cur.execute("SELECT COUNT(*) FROM accounts;")
    assert cur.fetchone()[0] == 0

    # Insert and commit
    cur.execute("INSERT INTO accounts (balance) VALUES (200);")
    conn.commit()

    cur.execute("SELECT balance FROM accounts;")
    assert cur.fetchone()[0] == 200
    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_constraint_enforcement_and_exception_types():
    """
    Characterizes exception types raised by the pinned driver on constraint violations.
    LibSQL 0.1.11 raises ValueError (not sqlite3.IntegrityError) for:
    - CHECK constraint violation
    - UNIQUE constraint violation
    - FOREIGN KEY constraint violation
    """
    conn = libsql.connect(":memory:")
    cur = conn.cursor()

    # 1. CHECK constraint
    cur.execute("CREATE TABLE items_stock (id INTEGER PRIMARY KEY, stock INTEGER CHECK(stock >= 0));")
    conn.commit()

    with pytest.raises(ValueError, match="CHECK constraint failed"):
        cur.execute("INSERT INTO items_stock (stock) VALUES (-5);")

    # 2. UNIQUE constraint
    cur.execute("CREATE TABLE unique_names (id INTEGER PRIMARY KEY, name TEXT UNIQUE);")
    conn.commit()
    cur.execute("INSERT INTO unique_names (name) VALUES ('Alpha');")
    conn.commit()

    with pytest.raises(ValueError, match="UNIQUE constraint failed"):
        cur.execute("INSERT INTO unique_names (name) VALUES ('Alpha');")

    # 3. FOREIGN KEY constraint
    cur.execute("PRAGMA foreign_keys = ON;")
    cur.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY);")
    cur.execute("CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));")
    conn.commit()

    with pytest.raises(ValueError, match="FOREIGN KEY constraint failed"):
        cur.execute("INSERT INTO child (id, parent_id) VALUES (1, 9999);")

    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_wrapper_full_duck_typing():
    """
    Verifies that LibSQLConnectionWrapper and LibSQLRow provide seamless sqlite3.Row
    duck-typing when wrapped around a real libsql Connection.
    """
    raw_conn = libsql.connect(":memory:")
    conn = LibSQLConnectionWrapper(raw_conn)
    conn.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT, price REAL);")
    conn.commit()

    c = conn.execute("INSERT INTO products (title, price) VALUES (?, ?)", ("Screwdriver", 15.5))
    assert c.lastrowid == 1
    assert c.rowcount == 1
    conn.commit()

    c2 = conn.execute("SELECT * FROM products WHERE id = ?", (1,))
    row = c2.fetchone()
    assert isinstance(row, LibSQLRow)

    # Positional access
    assert row[0] == 1
    assert row[1] == "Screwdriver"
    assert row[2] == 15.5

    # Case-insensitive and exact column access
    assert row["title"] == "Screwdriver"
    assert row["TITLE"] == "Screwdriver"
    assert row["Price"] == 15.5

    # Dict conversion and methods
    assert dict(row) == {"id": 1, "title": "Screwdriver", "price": 15.5}
    assert row.keys() == ["id", "title", "price"]
    assert row.values() == [1, "Screwdriver", 15.5]
    assert ("title", "Screwdriver") in row.items()
    assert row.get("missing", "default_val") == "default_val"
    assert "title" in row
    assert len(row) == 3
    assert list(row) == ["id", "title", "price"]

    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_wrapper_context_managers_and_methods():
    """
    Verifies that LibSQLConnectionWrapper and LibSQLCursorWrapper fully support:
    - Context manager protocol on connection ('with conn:' commits on success, rolls back on error)
    - Context manager protocol on cursor ('with cur:' closes cursor on exit)
    - fetchmany() and executemany()
    - arraysize and in_transaction properties
    """
    raw_conn = libsql.connect(":memory:")
    conn = LibSQLConnectionWrapper(raw_conn)

    # 1. Cursor context manager & executemany
    with conn.cursor() as cur:
        cur.execute("CREATE TABLE batches (id INTEGER PRIMARY KEY, name TEXT);")
        cur.executemany("INSERT INTO batches (name) VALUES (?)", [("A",), ("B",), ("C",)])
        assert cur.arraysize == 1
        cur.arraysize = 2
        assert cur.arraysize == 2

    # 2. Connection context manager normal exit commits
    with conn:
        conn.execute("INSERT INTO batches (name) VALUES (?)", ("D",))

    cur = conn.execute("SELECT COUNT(*) FROM batches;")
    assert cur.fetchone()[0] == 4

    # 3. fetchmany with row_factory transformation
    cur = conn.execute("SELECT * FROM batches ORDER BY id;")
    batch1 = cur.fetchmany(2)
    assert len(batch1) == 2
    assert isinstance(batch1[0], LibSQLRow)
    assert batch1[0]["name"] == "A"
    assert batch1[1]["name"] == "B"

    # 4. Connection context manager exception rolls back
    try:
        with conn:
            conn.execute("INSERT INTO batches (name) VALUES (?)", ("E",))
            raise RuntimeError("Forced abort")
    except RuntimeError:
        pass

    cur = conn.execute("SELECT COUNT(*) FROM batches WHERE name = 'E';")
    assert cur.fetchone()[0] == 0

    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_wrapper_exception_translation():
    """
    Verifies that LibSQLConnectionWrapper and LibSQLCursorWrapper translate
    raw libsql driver exceptions into standard Python DB-API / application exceptions:
    - UNIQUE constraint -> sqlite3.IntegrityError
    - CHECK constraint -> sqlite3.IntegrityError
    - Hrana network error -> DatabaseUnavailableError
    """
    raw_conn = libsql.connect(":memory:")
    conn = LibSQLConnectionWrapper(raw_conn)
    conn.execute("CREATE TABLE items_constrained (id INTEGER PRIMARY KEY, sku TEXT UNIQUE, qty INTEGER CHECK(qty >= 0));")
    conn.commit()

    # 1. UNIQUE constraint translated to sqlite3.IntegrityError
    conn.execute("INSERT INTO items_constrained (sku, qty) VALUES ('SKU-1', 10);")
    conn.commit()

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
        conn.execute("INSERT INTO items_constrained (sku, qty) VALUES ('SKU-1', 5);")

    # 2. CHECK constraint translated to sqlite3.IntegrityError
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        conn.execute("INSERT INTO items_constrained (sku, qty) VALUES ('SKU-2', -1);")

    # 3. Hrana network/connection error translated to DatabaseUnavailableError
    from app.models.db_utils import DatabaseUnavailableError
    cur = conn.cursor()
    # Mock inner cursor to raise a Hrana network failure
    class MockInnerCursor:
        def execute(self, *args, **kwargs):
            raise ValueError("Hrana: `api error: `status=503 Service Unavailable, body=Host unreachable``")
    cur._cursor = MockInnerCursor()

    with pytest.raises(DatabaseUnavailableError, match="Cloud database connection failure"):
        cur.execute("SELECT 1")

    conn.close()


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_libsql_thread_ownership_isolation():
    """
    Verifies that independent threads using isolated connections execute
    concurrently without colliding or sharing uncommitted transactions.
    """
    def worker(worker_id):
        raw = libsql.connect(":memory:", _check_same_thread=False)
        conn = LibSQLConnectionWrapper(raw)
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val INTEGER);")
        conn.execute("INSERT INTO t (val) VALUES (?)", (worker_id * 10,))
        conn.commit()
        cur = conn.execute("SELECT val FROM t WHERE id = 1")
        val = cur.fetchone()["val"]
        conn.close()
        return val

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(worker, i) for i in range(1, 5)]
        results = [f.result() for f in futures]

    assert results == [10, 20, 30, 40]


def test_transient_error_classification_exhaustive():
    """
    Verifies that is_transient_error properly distinguishes transient retriable conflicts
    from non-retriable constraint failures across both SQLite and LibSQL exceptions.
    """
    # 1. Retriable errors
    assert is_transient_error(sqlite3.OperationalError("database is locked")) is True
    assert is_transient_error(sqlite3.OperationalError("database table is busy")) is True
    assert is_transient_error(RuntimeError("Connection timeout occurred")) is True
    assert is_transient_error(RuntimeError("Disk I/O error")) is True
    assert is_transient_error(RuntimeError("Temporarily unavailable")) is True
    assert is_transient_error(ValueError("Hrana: `stream error: `stream closed``")) is True
    assert is_transient_error(ValueError("Hrana: `api error: `status=503 Service Unavailable``")) is True
    assert is_transient_error(ValueError("Hrana: `api error: `status=429 Too Many Requests``")) is True

    if LIBSQL_AVAILABLE:
        assert is_transient_error(libsql.Error("database is locked")) is True
        assert is_transient_error(libsql.Error("connection timeout")) is True

    # 2. Non-retriable constraint errors (must NOT be retried!)
    assert is_transient_error(sqlite3.IntegrityError("UNIQUE constraint failed: items.name")) is False
    assert is_transient_error(sqlite3.IntegrityError("CHECK constraint failed: current_quantity >= 0")) is False
    assert is_transient_error(ValueError("UNIQUE constraint failed: items.name")) is False
    assert is_transient_error(ValueError("CHECK constraint failed: current_quantity >= 0")) is False
    assert is_transient_error(ValueError("FOREIGN KEY constraint failed")) is False
    assert is_transient_error(ValueError("validation error: invalid integer")) is False


@pytest.mark.skipif(not LIBSQL_AVAILABLE, reason="libsql driver is not installed")
def test_remote_engine_live_verification():
    """
    Verifies the actual remote Turso engine and driver behavior under live network conditions:
    - Connects directly to remote Turso database
    - Isolation, transactions, and rollback discard uncommitted changes on remote engine
    - Remote constraint enforcement (UNIQUE) translated to sqlite3.IntegrityError
    - Cursor wrapping and LibSQLRow access against remote engine
    """
    from app.config import TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
    if not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
        pytest.skip("Remote Turso credentials not available.")

    url = TURSO_DATABASE_URL
    if url.startswith("https://"):
        url = url.replace("https://", "libsql://")

    try:
        raw_conn = libsql.connect(url, auth_token=TURSO_AUTH_TOKEN)
        # Verify basic connectivity; if network down, skip test
        cur = raw_conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
    except Exception as e:
        pytest.skip(f"Remote Turso endpoint unreachable: {e}")

    conn = LibSQLConnectionWrapper(raw_conn)
    table_name = "_test_remote_engine_verification"

    try:
        with conn:
            conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} (id INTEGER PRIMARY KEY, sku TEXT UNIQUE, val INTEGER);")

        # 1. Rollback test on remote engine
        conn.execute(f"INSERT INTO {table_name} (sku, val) VALUES (?, ?);", ("ROLLBACK_TEST", 999))
        conn.rollback()

        cur = conn.execute(f"SELECT COUNT(*) FROM {table_name} WHERE sku = ?;", ("ROLLBACK_TEST",))
        assert cur.fetchone()[0] == 0, "Rollback failed on remote Turso engine!"

        # 2. Commit and Row mapping test on remote engine
        with conn:
            conn.execute(f"INSERT INTO {table_name} (sku, val) VALUES (?, ?);", ("REMOTE_TEST", 123))

        cur = conn.execute(f"SELECT sku, val FROM {table_name} WHERE sku = ?;", ("REMOTE_TEST",))
        row = cur.fetchone()
        assert isinstance(row, LibSQLRow)
        assert row["sku"] == "REMOTE_TEST"
        assert row["val"] == 123

        # 3. Remote UNIQUE constraint enforcement & translation
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(f"INSERT INTO {table_name} (sku, val) VALUES (?, ?);", ("REMOTE_TEST", 456))

    finally:
        try:
            with conn:
                conn.execute(f"DROP TABLE IF EXISTS {table_name};")
        except Exception:
            pass
        conn.close()

