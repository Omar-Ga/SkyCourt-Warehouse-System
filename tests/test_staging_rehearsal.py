"""
Tests for Staging Inspection, Backup, Restore, and Parity Qualification.
Validates Acceptance Criterion 1 and 2 for Issue #12.
"""
import sqlite3
import pytest
from pathlib import Path

from app.staging import (
    inspect_database,
    backup_database,
    restore_database,
    compare_database_snapshots,
    rehearse_staging_migration
)
from app.migrations import (
    run_migrations,
    get_available_migrations,
    verify_schema_version
)
from app.main import create_app


def create_populated_legacy_database():
    """Creates an in-memory SQLite database populated with legacy data, remote settings, and unmanaged tables."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")

    # 1. Apply baseline 001
    migrations = get_available_migrations()
    v1_file = next(m[2] for m in migrations if m[0] == 1)
    conn.executescript(v1_file.read_text(encoding="utf-8"))

    # 2. Add remote settings (unmanaged deployed table queried by run.py)
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE app_remote_settings (id INTEGER PRIMARY KEY, is_locked INTEGER);")
    cursor.execute("INSERT INTO app_remote_settings (id, is_locked) VALUES (1, 0);")

    # 3. Add custom unmanaged legacy table to test unknown-schema preservation
    cursor.execute("CREATE TABLE legacy_tags (id INTEGER PRIMARY KEY, tag_name TEXT);")
    cursor.execute("INSERT INTO legacy_tags (id, tag_name) VALUES (1, 'tag-alpha'), (2, 'tag-beta');")

    # 4. Populate baseline inventory records
    cursor.execute("INSERT INTO units (name) VALUES ('متر'), ('قطعة');")
    unit1_id = 1
    unit2_id = 2

    cursor.execute("INSERT INTO categories (name) VALUES ('خامات رئيسية');")
    cat_id = 1

    cursor.execute("INSERT INTO destinations (name) VALUES ('موقع المعادي');")
    dest_id = 1

    cursor.execute("INSERT INTO providers (name) VALUES ('شركة الأهرام');")
    prov_id = 1

    cursor.execute("""
        INSERT INTO items (id, name, unit_id, sub_category_id, provider_id, current_quantity, status, barcode)
        VALUES (101, 'سلك نحاس 4 ملم', ?, ?, ?, 150, 'active', 'EAN-101'),
               (102, 'مفتاح أحادي 16A', ?, ?, ?, 80, 'active', 'EAN-102'),
               (103, 'قاطع تيار قديم', ?, ?, ?, 0, 'archived', 'EAN-103');
    """, (unit1_id, cat_id, prov_id, unit2_id, cat_id, prov_id, unit2_id, cat_id, prov_id))

    cursor.execute("""
        INSERT INTO movement_logs (id, timestamp, item_id, item_name, action_type, quantity_changed, resulting_quantity, person_name)
        VALUES (1, '2026-08-01 10:00:00', 101, 'سلك نحاس 4 ملم', 'Addition', 150, 150, 'عامل المخزن 1'),
               (2, '2026-08-02 11:30:00', 102, 'مفتاح أحادي 16A', 'Addition', 100, 100, 'عامل المخزن 1'),
               (3, '2026-08-03 14:00:00', 102, 'مفتاح أحادي 16A', 'Removal', 20, 80, 'عامل المخزن 2');
    """)

    conn.commit()
    return conn


def test_inspect_database_captures_complete_metrics():
    """Verifies that inspect_database captures all tables, rows, balances, settings, and unknown schemas."""
    conn = create_populated_legacy_database()
    snapshot = inspect_database(conn)

    assert "items" in snapshot["tables"]
    assert "movement_logs" in snapshot["tables"]
    assert "app_remote_settings" in snapshot["tables"]
    assert "legacy_tags" in snapshot["tables"]

    # Row counts
    assert snapshot["row_counts"]["items"] == 3
    assert snapshot["row_counts"]["movement_logs"] == 3
    assert snapshot["row_counts"]["units"] == 2
    assert snapshot["row_counts"]["legacy_tags"] == 2

    # Items summary
    items_summary = snapshot["items_summary"]
    assert items_summary["count"] == 3
    assert items_summary["total_quantity"] == 230  # 150 + 80 + 0
    assert items_summary["item_balances"] == {101: 150, 102: 80, 103: 0}
    assert items_summary["barcodes"] == ["EAN-101", "EAN-102", "EAN-103"]
    assert items_summary["status_counts"]["active"] == 2
    assert items_summary["status_counts"]["archived"] == 1

    # Logs summary
    logs_summary = snapshot["logs_summary"]
    assert logs_summary["total_logs"] == 3
    assert logs_summary["action_counts"] == {"Addition": 2, "Removal": 1}
    assert logs_summary["earliest_timestamp"] == "2026-08-01 10:00:00"
    assert logs_summary["latest_timestamp"] == "2026-08-03 14:00:00"

    # Remote settings
    assert snapshot["remote_settings"] == {"is_locked": 0}

    # Foreign keys and integrity
    assert snapshot["foreign_keys_valid"] is True
    assert snapshot["integrity_check_passed"] is True

    # Unknown schema
    assert "legacy_tags" in snapshot["unmanaged_tables"]
    assert snapshot["unmanaged_data_counts"]["legacy_tags"] == 2

    conn.close()


def test_backup_and_restore_sqlite():
    """Verifies atomic SQLite backup and restore cycle."""
    source_conn = create_populated_legacy_database()
    baseline = inspect_database(source_conn)

    # Backup to secondary in-memory connection
    backup_conn = sqlite3.connect(":memory:")
    backup_conn.row_factory = sqlite3.Row
    backup_database(source_conn, backup_conn)

    # Mutate source database (e.g. corrupt or drop data)
    source_conn.execute("DELETE FROM items WHERE id = 103;")
    source_conn.execute("DROP TABLE legacy_tags;")
    source_conn.commit()

    mutated = inspect_database(source_conn)
    assert mutated["row_counts"]["items"] == 2
    assert "legacy_tags" not in mutated["tables"]

    # Restore from backup
    restore_database(backup_conn, source_conn)

    restored = inspect_database(source_conn)
    comparison = compare_database_snapshots(baseline, restored)
    assert comparison["passed"] is True
    assert comparison["discrepancies"] == []
    assert restored["items_summary"]["total_quantity"] == 230

    source_conn.close()
    backup_conn.close()


def test_compare_snapshots_exact_match():
    """Verifies that comparing identical snapshots passes without discrepancies."""
    conn = create_populated_legacy_database()
    snap1 = inspect_database(conn)
    snap2 = inspect_database(conn)
    result = compare_database_snapshots(snap1, snap2)
    assert result["passed"] is True
    assert len(result["discrepancies"]) == 0
    conn.close()


def test_compare_snapshots_detects_balance_discrepancy():
    """Verifies that any stock balance drift is detected and fails comparison."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    # Alter stock
    conn.execute("UPDATE items SET current_quantity = 145 WHERE id = 101;")
    conn.commit()
    altered = inspect_database(conn)

    result = compare_database_snapshots(baseline, altered)
    assert result["passed"] is False
    assert any("Total stock balance mismatch" in d for d in result["discrepancies"])
    assert any("Item ID 101 quantity changed" in d for d in result["discrepancies"])
    conn.close()


def test_compare_snapshots_detects_lost_legacy_rows():
    """Verifies that missing legacy rows are detected and fail comparison."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    conn.execute("DELETE FROM movement_logs WHERE id = 3;")
    conn.commit()
    altered = inspect_database(conn)

    result = compare_database_snapshots(baseline, altered)
    assert result["passed"] is False
    assert any("Table 'movement_logs' lost rows" in d for d in result["discrepancies"])
    conn.close()


def test_compare_snapshots_detects_remote_settings_change():
    """Verifies that remote lock flag change is flagged."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    conn.execute("UPDATE app_remote_settings SET is_locked = 1 WHERE id = 1;")
    conn.commit()
    altered = inspect_database(conn)

    result = compare_database_snapshots(baseline, altered)
    assert result["passed"] is False
    assert any("Remote settings 'is_locked' changed" in d for d in result["discrepancies"])
    conn.close()


def test_compare_snapshots_detects_unmanaged_table_loss():
    """Verifies that loss of unmanaged custom tables is detected."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    conn.execute("DROP TABLE legacy_tags;")
    conn.commit()
    altered = inspect_database(conn)

    result = compare_database_snapshots(baseline, altered)
    assert result["passed"] is False
    assert any("Unmanaged table 'legacy_tags' was lost" in d for d in result["discrepancies"])
    conn.close()


def test_compare_snapshots_detects_foreign_key_violation():
    """Verifies that foreign key violations post-migration fail comparison."""
    conn = create_populated_legacy_database()
    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute("INSERT INTO items (id, name, unit_id, current_quantity) VALUES (999, 'يتيم', 99999, 10);")
    conn.commit()

    snapshot = inspect_database(conn)
    assert snapshot["foreign_keys_valid"] is False
    assert len(snapshot["foreign_key_violations"]) > 0

    result = compare_database_snapshots(snapshot, snapshot)
    assert result["passed"] is False
    assert any("Foreign key violations detected" in d for d in result["discrepancies"])
    conn.close()


def test_end_to_end_rehearse_staging_migration():
    """
    Full rehearsal test:
    - Pre-migrated staging copy inspected
    - In-memory backup taken
    - Migrations executed (1 baselined, 2 applied)
    - Schema version upgraded to 2
    - All legacy stock balances, IDs, timestamps, remote settings, and unmanaged tables 100% preserved.
    """
    conn = create_populated_legacy_database()
    report = rehearse_staging_migration(conn)

    assert report["passed"] is True, f"Rehearsal failed with discrepancies: {report['discrepancies']}"
    assert report["applied_versions"] == [2]
    assert report["current_version"] == 2
    assert report["discrepancies"] == []

    # Verify new tables exist and are clean
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    tables = [r[0] for r in cursor.fetchall()]
    assert "users" in tables
    assert "purchase_orders" in tables
    assert "leave_orders" in tables
    assert "return_events" in tables
    assert "operations" in tables

    # Verify unmanaged tables and remote settings still present
    assert "legacy_tags" in tables
    assert "app_remote_settings" in tables

    # Verify stock balance intact
    cursor.execute("SELECT SUM(current_quantity) FROM items;")
    assert cursor.fetchone()[0] == 230

    conn.close()


def test_flask_cli_staging_and_migration_commands(tmp_path):
    """Verifies that Flask CLI commands staging-inspect, staging-rehearsal, and migrate execute properly."""
    db_file = str(tmp_path / "cli_test.db")
    app = create_app({"TESTING": True, "DATABASE": db_file})
    runner = app.test_cli_runner()

    # 1. Inspect on fresh DB
    res_inspect = runner.invoke(args=["staging-inspect"])
    assert res_inspect.exit_code == 0
    assert "Total inventory quantity" in res_inspect.output

    # 2. Check migration status (requires migration)
    res_check = runner.invoke(args=["migrate", "--check"])
    assert res_check.exit_code != 0  # Not yet migrated

    # 3. Apply migrations
    res_migrate = runner.invoke(args=["migrate"])
    assert res_migrate.exit_code == 0
    assert "[1, 2]" in res_migrate.output

    # 4. Check migration status again (now compatible)
    res_check_after = runner.invoke(args=["migrate", "--check"])
    assert res_check_after.exit_code == 0
    assert "Database schema is compatible at version 2." in res_check_after.output

    # 5. Staging rehearsal
    res_rehearse = runner.invoke(args=["staging-rehearsal"])
    assert res_rehearse.exit_code == 0
    assert "Staging rehearsal PASSED" in res_rehearse.output


def test_backup_and_restore_wrapped_connection_lossless():
    """
    Verifies that backup_database and restore_database work seamlessly on wrapped connections
    lacking the native C-level .backup() API, copying 100% of rows, columns, and data.
    """
    class WrappedCursor:
        def __init__(self, cur):
            self._cur = cur
        def execute(self, sql, params=()):
            return self._cur.execute(sql, params)
        def executemany(self, sql, seq_params):
            return self._cur.executemany(sql, seq_params)
        def fetchall(self):
            return self._cur.fetchall()
        def fetchone(self):
            return self._cur.fetchone()
        def close(self):
            pass

    class WrappedConnection:
        def __init__(self, real_conn):
            self._real = real_conn
        def cursor(self):
            return WrappedCursor(self._real.cursor())
        def execute(self, sql, params=()):
            return self._real.execute(sql, params)
        def commit(self):
            self._real.commit()
        def rollback(self):
            self._real.rollback()
        def close(self):
            self._real.close()

    # Source wrapped connection
    real_src = create_populated_legacy_database()
    wrapped_src = WrappedConnection(real_src)
    baseline = inspect_database(real_src)

    # Backup into fresh in-memory SQLite target
    target_conn = sqlite3.connect(":memory:")
    target_conn.row_factory = sqlite3.Row
    backup_database(wrapped_src, target_conn)

    # Verify target backup has identical data
    backup_snapshot = inspect_database(target_conn)
    cmp_backup = compare_database_snapshots(baseline, backup_snapshot)
    assert cmp_backup["passed"] is True, f"Backup discrepancies: {cmp_backup['discrepancies']}"
    assert backup_snapshot["items_summary"]["total_quantity"] == 230
    assert backup_snapshot["row_counts"]["items"] == 3

    # Restore from target_conn into a wrapped destination
    real_dest = sqlite3.connect(":memory:")
    real_dest.row_factory = sqlite3.Row
    wrapped_dest = WrappedConnection(real_dest)

    restore_database(target_conn, wrapped_dest)

    # Verify destination matches baseline 100%
    restored_snapshot = inspect_database(real_dest)
    cmp_restore = compare_database_snapshots(baseline, restored_snapshot)
    assert cmp_restore["passed"] is True, f"Restore discrepancies: {cmp_restore['discrepancies']}"
    assert restored_snapshot["items_summary"]["total_quantity"] == 230

    real_src.close()
    target_conn.close()
    real_dest.close()


def test_compare_snapshots_detects_lost_item_ids_and_master_entity_ids():
    """Verifies that missing item IDs or master entity IDs fail snapshot comparison."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    # 1. Alter item IDs: replace item 101 with item 999 having same quantity
    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute("UPDATE items SET id = 999 WHERE id = 101;")
    conn.commit()
    altered = inspect_database(conn)

    res = compare_database_snapshots(baseline, altered)
    assert res["passed"] is False
    assert any("Baseline item IDs lost during migration" in d for d in res["discrepancies"])

    # 2. Alter master entity IDs (units)
    conn.execute("UPDATE units SET id = 99 WHERE id = 1;")
    conn.commit()
    altered_units = inspect_database(conn)

    res_units = compare_database_snapshots(baseline, altered_units)
    assert res_units["passed"] is False
    assert any("Master table 'units' lost IDs" in d for d in res_units["discrepancies"])

    conn.close()


def test_compare_snapshots_detects_modified_log_timestamps_and_ids():
    """Verifies that modified movement log timestamps or lost log IDs fail snapshot comparison."""
    conn = create_populated_legacy_database()
    baseline = inspect_database(conn)

    # 1. Modify a log timestamp
    conn.execute("UPDATE movement_logs SET timestamp = '2026-08-01 12:00:00' WHERE id = 1;")
    conn.commit()
    altered_ts = inspect_database(conn)

    res_ts = compare_database_snapshots(baseline, altered_ts)
    assert res_ts["passed"] is False
    assert any("Movement log ID 1 timestamp modified" in d for d in res_ts["discrepancies"])

    # 2. Modify a log ID
    conn.execute("UPDATE movement_logs SET id = 99 WHERE id = 2;")
    conn.commit()
    altered_id = inspect_database(conn)

    res_id = compare_database_snapshots(baseline, altered_id)
    assert res_id["passed"] is False
    assert any("Movement log IDs lost during migration" in d for d in res_id["discrepancies"])

    conn.close()


def test_rehearsal_includes_restore_verification():
    """Verifies that rehearse_staging_migration confirms restore_verified == True."""
    conn = create_populated_legacy_database()
    report = rehearse_staging_migration(conn)
    assert report["passed"] is True
    assert report["restore_verified"] is True
    conn.close()

