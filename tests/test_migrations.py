"""
Tests for Database Migrations: Fresh-install, Upgrade, Rerun, Interruption Recovery,
Foreign Keys, and Schema Version Verification.
"""
import shutil
import sqlite3
import tempfile
from pathlib import Path
import pytest

from app.migrations import (
    run_migrations,
    verify_schema_version,
    get_applied_migrations,
    get_available_migrations,
    compute_checksum,
    IncompatibleSchemaError,
    MigrationError,
    MigrationChecksumError,
    CURRENT_SCHEMA_VERSION
)


def test_fresh_install_migrations():
    """Verifies fresh install applies all migrations in order and sets schema version."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    applied = run_migrations(conn)
    assert applied == [1, 2]

    # Verify schema version
    current_version = verify_schema_version(conn, required_version=2)
    assert current_version == 2

    # Verify all tables exist
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row["name"] for row in cursor.fetchall()]

    expected_tables = [
        "categories", "destinations", "items", "leave_order_items", "leave_orders",
        "movement_logs", "operations", "providers", "purchase_order_items",
        "purchase_orders", "return_event_items", "return_events", "schema_migrations",
        "units", "users"
    ]
    for expected in expected_tables:
        assert expected in tables, f"Expected table '{expected}' missing from database"

    conn.close()


def test_migrations_rerun_is_idempotent():
    """Verifies that rerunning migrations on an already up-to-date database is a no-op."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    # First run
    applied_first = run_migrations(conn)
    assert applied_first == [1, 2]

    # Second run
    applied_second = run_migrations(conn)
    assert applied_second == []

    # Schema version remains current
    assert verify_schema_version(conn) == 2
    conn.close()


def test_upgrade_from_legacy_database():
    """
    Tests upgrading an existing production legacy database:
    - Pre-populated with baseline schema and legacy inventory data
    - Has no schema_migrations table
    - Verifies version 1 is baselined and version 2 is applied
    - Verifies legacy items and logs survive intact with null new audit columns
    """
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    # 1. Apply baseline 001
    migrations = get_available_migrations()
    v1_file = next(m[2] for m in migrations if m[0] == 1)
    conn.executescript(v1_file.read_text(encoding="utf-8"))

    # 2. Populate legacy data and an unmanaged deployed table (e.g. app_remote_settings)
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE app_remote_settings (id INTEGER PRIMARY KEY, is_locked INTEGER)")
    cursor.execute("INSERT INTO app_remote_settings (id, is_locked) VALUES (1, 0)")

    cursor.execute("INSERT INTO units (name) VALUES ('متر')")
    unit_id = cursor.lastrowid
    cursor.execute("INSERT INTO categories (name) VALUES ('خامات')")
    cat_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO items (name, unit_id, sub_category_id, current_quantity, status, barcode) VALUES ('سلك نحاس', ?, ?, 100, 'active', 'WIRE-01')",
        (unit_id, cat_id)
    )
    item_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO movement_logs (item_id, item_name, action_type, quantity_changed, resulting_quantity, person_name) VALUES (?, 'سلك نحاس', 'Addition', 100, 100, 'Legacy Worker')",
        (item_id,)
    )
    conn.commit()

    # 3. Run migrations on this legacy database
    applied = run_migrations(conn)
    assert applied == [2]  # Baselined 1, applied 2

    # 4. Verify version
    assert verify_schema_version(conn) == 2

    # 5. Verify unmanaged table app_remote_settings survived intact
    cursor.execute("SELECT is_locked FROM app_remote_settings WHERE id = 1")
    setting_row = cursor.fetchone()
    assert setting_row is not None
    assert setting_row["is_locked"] == 0

    # 6. Verify legacy item survived intact
    cursor.execute("SELECT name, current_quantity, status, barcode FROM items WHERE id = ?", (item_id,))
    item_row = cursor.fetchone()
    assert item_row["name"] == "سلك نحاس"
    assert item_row["current_quantity"] == 100
    assert item_row["status"] == "active"
    assert item_row["barcode"] == "WIRE-01"

    # 7. Verify legacy log survived with null new fields
    cursor.execute("SELECT item_name, action_type, person_name, user_id, operation_key, actor_name FROM movement_logs WHERE item_id = ?", (item_id,))
    log_row = cursor.fetchone()
    assert log_row["item_name"] == "سلك نحاس"
    assert log_row["action_type"] == "Addition"
    assert log_row["person_name"] == "Legacy Worker"
    assert log_row["user_id"] is None
    assert log_row["operation_key"] is None
    assert log_row["actor_name"] is None

    conn.close()


def test_interrupted_migration_recovery():
    """
    Tests that an interrupted/failing migration rolls back cleanly,
    leaves the prior version intact, and does not record the failed migration.
    """
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        # Copy valid 001
        migrations = get_available_migrations()
        v1_file = next(m[2] for m in migrations if m[0] == 1)
        shutil.copy(v1_file, tmp_dir / "001_initial_schema.sql")

        # Create broken 002 with intentional syntax/constraint failure midway
        broken_content = """
        CREATE TABLE should_rollback_tbl (id INTEGER PRIMARY KEY);
        INSERT INTO should_rollback_tbl VALUES (1);
        -- Intentional error on next line
        INSERT INTO non_existent_table_xyz VALUES (1);
        """
        (tmp_dir / "002_broken.sql").write_text(broken_content, encoding="utf-8")

        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row

        with pytest.raises(MigrationError) as exc:
            run_migrations(conn, migrations_dir=tmp_dir)
        assert "Migration 2" in str(exc.value)

        # Verify only migration 1 is recorded
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(version) FROM schema_migrations")
        assert cursor.fetchone()[0] == 1

        # Verify table created in broken migration was rolled back
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback_tbl'")
        assert cursor.fetchone() is None

        conn.close()
    finally:
        shutil.rmtree(tmp_dir)


def test_checksum_validation_detects_tampering():
    """Tests that modifying an already-applied migration file raises MigrationChecksumError."""
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        # Create migration 001
        mig1 = tmp_dir / "001_test.sql"
        mig1.write_text("CREATE TABLE t1 (id INT);", encoding="utf-8")

        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        run_migrations(conn, migrations_dir=tmp_dir)

        # Tamper with migration 001 content
        mig1.write_text("CREATE TABLE t1 (id INT, tampered INT);", encoding="utf-8")

        with pytest.raises(MigrationChecksumError, match="Checksum mismatch"):
            run_migrations(conn, migrations_dir=tmp_dir)

        conn.close()
    finally:
        shutil.rmtree(tmp_dir)


def test_verify_schema_version_rejection():
    """Verifies that verify_schema_version raises IncompatibleSchemaError when DB is outdated."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    # Unmigrated database
    with pytest.raises(IncompatibleSchemaError, match="Database schema version is 0"):
        verify_schema_version(conn, required_version=2)

    # Database at version 1
    cursor = conn.cursor()
    cursor.execute("INSERT INTO schema_migrations (version, name, checksum) VALUES (1, '001', 'chk')")
    conn.commit()

    with pytest.raises(IncompatibleSchemaError, match="version 2 is required"):
        verify_schema_version(conn, required_version=2)

    conn.close()
