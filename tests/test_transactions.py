"""
Tests for Atomic Transactions, Conditional Stock Updates, Rollback on Failure, and Transient Retry.
"""
import concurrent.futures
import sqlite3
import pytest
from app.services.item_service import adjust_stock_primitive, record_quantity_adjustment
from app.models.db_utils import run_in_transaction
from app.models import item_model


def test_adjust_stock_primitive_addition(migrated_db, sample_metadata):
    """Verifies that adjust_stock_primitive increments stock and writes an Addition log."""
    unit_id = sample_metadata["unit_id"]
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Item A', ?, 10, 'active')", (unit_id,))
    item_id = cursor.lastrowid
    migrated_db.commit()

    # Seed user for actor_id
    cursor.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('admin', 'dummy_hash', 'admin', 'Admin')")
    user_id = cursor.lastrowid

    # Call primitive in caller's transaction
    result = adjust_stock_primitive(
        conn=migrated_db,
        item_id=item_id,
        change_amount=5,
        action_type="addition",
        actor_id=user_id,
        actor_name="Admin",
        operation_key="op-add-1"
    )

    assert result["resulting_quantity"] == 15
    assert result["quantity_changed"] == 5
    assert result["action_type"] == "Addition"

    # Commit and verify in DB
    migrated_db.commit()
    cursor.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert cursor.fetchone()[0] == 15

    # Verify log entry
    cursor.execute("SELECT action_type, quantity_changed, resulting_quantity, operation_key FROM movement_logs WHERE item_id = ?", (item_id,))
    log = cursor.fetchone()
    assert log["action_type"] == "Addition"
    assert log["quantity_changed"] == 5
    assert log["resulting_quantity"] == 15
    assert log["operation_key"] == "op-add-1"


def test_adjust_stock_primitive_removal_conditional(migrated_db, sample_metadata):
    """Verifies that adjust_stock_primitive decrements stock conditionally and rejects insufficient stock."""
    unit_id = sample_metadata["unit_id"]
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Item B', ?, 10, 'active')", (unit_id,))
    item_id = cursor.lastrowid
    migrated_db.commit()

    # Successful deduction of 4
    result = adjust_stock_primitive(
        conn=migrated_db,
        item_id=item_id,
        change_amount=4,
        action_type="removal"
    )
    assert result["resulting_quantity"] == 6

    # Attempting to deduct 10 when balance is 6 must raise ValueError
    with pytest.raises(ValueError, match="Insufficient stock"):
        adjust_stock_primitive(
            conn=migrated_db,
            item_id=item_id,
            change_amount=10,
            action_type="removal"
        )


def test_concurrent_conditional_stock_deduction(temp_db_path, sample_metadata):
    """
    Simulates two competing callers attempting to deduct units from the same item.
    Stock must never become negative; exactly one should succeed if requested > remaining.
    """
    unit_id = sample_metadata["unit_id"]
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Limited Stock', ?, 10, 'active')", (unit_id,))
    item_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Two competing threads try to deduct 7 each from a total of 10
    successes = 0
    failures = 0

    def attempt_deduction():
        thread_conn = sqlite3.connect(temp_db_path, check_same_thread=False)
        thread_conn.row_factory = sqlite3.Row
        thread_conn.execute("PRAGMA foreign_keys = ON;")
        thread_conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            thread_cursor = thread_conn.cursor()
            item_model.subtract_item_quantity_conditional(thread_cursor, item_id, 7)
            thread_conn.commit()
            return True
        except ValueError:
            thread_conn.rollback()
            return False
        finally:
            thread_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(attempt_deduction)
        f2 = executor.submit(attempt_deduction)
        results = [f1.result(), f2.result()]

    successes = sum(1 for r in results if r is True)
    failures = sum(1 for r in results if r is False)

    assert successes == 1
    assert failures == 1

    # Verify final balance is 10 - 7 = 3, never negative
    verify_conn = sqlite3.connect(temp_db_path)
    c = verify_conn.cursor()
    c.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    assert c.fetchone()[0] == 3
    verify_conn.close()


def test_multi_line_atomic_rollback(migrated_db, sample_metadata):
    """
    Characterizes R02 from spec review:
    Simulates a multi-line business operation (e.g. PO receipt or leave order).
    If line 2 fails, calling rollback rolls back line 1 stock change and line 1 log entry completely!
    """
    unit_id = sample_metadata["unit_id"]
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Item 1', ?, 20, 'active')", (unit_id,))
    item1_id = cursor.lastrowid
    migrated_db.commit()

    # Begin multi-line transaction
    try:
        # Line 1: deduct 5 from Item 1
        adjust_stock_primitive(
            conn=migrated_db,
            item_id=item1_id,
            change_amount=5,
            action_type="removal",
            details="Line 1 of order"
        )

        # Line 2: non-existent item ID 99999 -> raises ValueError
        adjust_stock_primitive(
            conn=migrated_db,
            item_id=99999,
            change_amount=3,
            action_type="removal",
            details="Line 2 of order"
        )

        migrated_db.commit()
    except Exception:
        migrated_db.rollback()

    # Verify Line 1 was completely rolled back
    cursor.execute("SELECT current_quantity FROM items WHERE id = ?", (item1_id,))
    assert cursor.fetchone()[0] == 20

    # Verify no movement logs were committed
    cursor.execute("SELECT COUNT(*) FROM movement_logs WHERE item_id = ?", (item1_id,))
    assert cursor.fetchone()[0] == 0


def test_return_adds_stock_even_if_inactive_or_archived(migrated_db, sample_metadata):
    """
    Verifies that action_type='return' adds stock to items even if inactive or archived,
    and logs Return action.
    """
    unit_id = sample_metadata["unit_id"]
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity, status) VALUES ('Archived Item', ?, 0, 'archived')", (unit_id,))
    item_id = cursor.lastrowid
    migrated_db.commit()

    # Return 3 units
    result = adjust_stock_primitive(
        conn=migrated_db,
        item_id=item_id,
        change_amount=3,
        action_type="return",
        details="Ticket return"
    )

    assert result["resulting_quantity"] == 3
    assert result["action_type"] == "Return"
    migrated_db.commit()

    # Check balance and status
    cursor.execute("SELECT current_quantity, status FROM items WHERE id = ?", (item_id,))
    row = cursor.fetchone()
    assert row["current_quantity"] == 3
    assert row["status"] == "archived"  # status unchanged

    # Check log
    cursor.execute("SELECT action_type, quantity_changed FROM movement_logs WHERE item_id = ?", (item_id,))
    log = cursor.fetchone()
    assert log["action_type"] == "Return"
    assert log["quantity_changed"] == 3


def test_transient_conflict_retry_policy():
    """
    Tests that run_in_transaction retries transient errors up to max_retries,
    and raises non-transient errors immediately without retry.
    """
    attempts = 0

    def transient_flaky_operation(conn):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise sqlite3.OperationalError("database is locked")
        return "success"

    real_conn = sqlite3.connect(":memory:")
    result = run_in_transaction(real_conn, transient_flaky_operation, max_retries=3, initial_delay=0.01)
    assert result == "success"
    assert attempts == 3

    # Non-transient error (ValueError) must NOT be retried
    attempts_nt = 0

    def non_transient_operation(conn):
        nonlocal attempts_nt
        attempts_nt += 1
        raise ValueError("Invalid business input")

    with pytest.raises(ValueError, match="Invalid business input"):
        run_in_transaction(real_conn, non_transient_operation, max_retries=3, initial_delay=0.01)

    assert attempts_nt == 1
    real_conn.close()
