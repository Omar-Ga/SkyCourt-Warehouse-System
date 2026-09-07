"""
Tests for Request Database Ownership, Teardown, Concurrency, and Adapter Compatibility.
"""
import concurrent.futures
import sqlite3
import pytest
from flask import g

from app.models.db_utils import (
    get_db,
    create_connection,
    LibSQLRow,
    LibSQLConnectionWrapper,
    LibSQLCursorWrapper
)


def test_request_connection_ownership(app):
    """Verifies that each request context receives its own connection in g.db."""
    with app.test_request_context():
        db1 = get_db()
        assert g.db is db1
        assert get_db() is db1

    with app.test_request_context():
        db2 = get_db()
        assert g.db is db2
        # Different request context has different connection
        assert db2 is not db1


def test_teardown_rolls_back_uncommitted_changes(app, sample_metadata):
    """Verifies that an uncommitted transaction in a request context is rolled back on teardown."""
    unit_id = sample_metadata["unit_id"]

    try:
        with app.test_request_context():
            db = get_db()
            cursor = db.cursor()
            cursor.execute(
                "INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Uncommitted Item', ?, 10, 'active')",
                (unit_id,)
            )
            # Do NOT commit! Simulate an error or unfinished request.
            raise RuntimeError("Simulated request failure")
    except RuntimeError:
        pass

    # Verify in a new request that the uncommitted item does NOT exist
    with app.test_request_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT * FROM items WHERE name = 'Uncommitted Item'")
        assert cursor.fetchone() is None


def test_teardown_rolls_back_uncommitted_changes_without_exception(app, sample_metadata):
    """Verifies that an uncommitted transaction is rolled back on teardown even when no exception is raised."""
    unit_id = sample_metadata["unit_id"]

    with app.test_request_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Clean Exit Uncommitted', ?, 10, 'active')",
            (unit_id,)
        )
        # Completes normally without commit

    with app.test_request_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT * FROM items WHERE name = 'Clean Exit Uncommitted'")
        assert cursor.fetchone() is None


def test_concurrent_requests_isolation(app, sample_metadata):
    """
    Tests that multiple concurrent Flask requests do not share connection state
    or see each other's uncommitted writes.
    """
    unit_id = sample_metadata["unit_id"]
    results = []

    def worker(worker_id):
        with app.test_request_context():
            db = get_db()
            cursor = db.cursor()
            item_name = f"Worker Item {worker_id}"
            cursor.execute(
                "INSERT INTO items (name, unit_id, current_quantity, status) VALUES (?, ?, 5, 'active')",
                (item_name, unit_id)
            )
            # Verify the worker sees its own write before commit
            cursor.execute("SELECT COUNT(*) FROM items WHERE name = ?", (item_name,))
            count = cursor.fetchone()[0]
            db.commit()
            return count

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(worker, i) for i in range(5)]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())

    assert all(c == 1 for c in results)

    # Verify all 5 items committed cleanly
    with app.test_request_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM items WHERE name LIKE 'Worker Item %'")
        assert cursor.fetchone()[0] == 5


def test_foreign_keys_always_enforced(app):
    """Verifies PRAGMA foreign_keys is strictly ON for all created connections."""
    with app.test_request_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute("PRAGMA foreign_keys")
        fk_status = cursor.fetchone()[0]
        assert fk_status == 1

        # Attempting to insert an item with non-existent unit_id must fail
        with pytest.raises(sqlite3.IntegrityError):
            cursor.execute(
                "INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Bad Item', 99999, 1, 'active')"
            )


def test_libsql_row_adapter_compatibility():
    """
    Tests that LibSQLRow provides full duck-typing with sqlite3.Row:
    - dict(row)
    - named access (exact and case-insensitive)
    - positional access
    - keys(), values(), items()
    - iter() yielding column names
    - len()
    """
    class MockCursor:
        description = (
            ("id", None, None, None, None, None, None),
            ("item_name", None, None, None, None, None, None),
            ("Quantity", None, None, None, None, None, None)
        )

    raw_tuple = (42, "Widget", 100)
    row = LibSQLRow(MockCursor(), raw_tuple)

    # Positional access
    assert row[0] == 42
    assert row[1] == "Widget"
    assert row[2] == 100

    # Named access (exact)
    assert row["id"] == 42
    assert row["item_name"] == "Widget"
    assert row["Quantity"] == 100

    # Case-insensitive access
    assert row["ID"] == 42
    assert row["ITEM_NAME"] == "Widget"
    assert row["quantity"] == 100

    # dict(row)
    as_dict = dict(row)
    assert as_dict == {"id": 42, "item_name": "Widget", "Quantity": 100}

    # keys, values, items
    assert row.keys() == ["id", "item_name", "Quantity"]
    assert row.values() == [42, "Widget", 100]
    assert row.items() == [("id", 42), ("item_name", "Widget"), ("Quantity", 100)]

    # get()
    assert row.get("id") == 42
    assert row.get("non_existent", "default_val") == "default_val"

    # len and iter
    assert len(row) == 3
    assert list(row) == ["id", "item_name", "Quantity"]

    # contains
    assert "item_name" in row
    assert "ITEM_NAME" in row
    assert "missing" not in row

    # Out of bound / unknown key
    with pytest.raises(IndexError):
        _ = row[99]

    with pytest.raises(IndexError):
        _ = row["unknown_column"]


def test_libsql_connection_wrapper_compatibility():
    """Tests LibSQLConnectionWrapper executes, commits, rolls back, and provides lastrowid/rowcount."""
    # Use real sqlite3 connection wrapped in LibSQLConnectionWrapper to test wrapper behavior
    real_conn = sqlite3.connect(":memory:")
    real_conn.execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT);")

    wrapper = LibSQLConnectionWrapper(real_conn)

    # Execute insert and check lastrowid
    c = wrapper.execute("INSERT INTO test_table (val) VALUES (?)", ("alpha",))
    assert c.lastrowid == 1
    assert c.rowcount == 1
    wrapper.commit()

    # Fetch with row factory
    c2 = wrapper.execute("SELECT * FROM test_table WHERE id = ?", (1,))
    row = c2.fetchone()
    assert row is not None
    assert row["val"] == "alpha"
    assert row[1] == "alpha"
    assert dict(row) == {"id": 1, "val": "alpha"}

    # Rollback test
    wrapper.execute("INSERT INTO test_table (val) VALUES (?)", ("beta",))
    wrapper.rollback()

    c3 = wrapper.execute("SELECT COUNT(*) as cnt FROM test_table")
    assert c3.fetchone()["cnt"] == 1

    wrapper.close()
