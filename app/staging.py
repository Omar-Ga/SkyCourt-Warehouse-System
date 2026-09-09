"""
Staging inspection, backup, restore, and comparison module for SkyCourt Warehouse System.
Provides tools to inspect, back up, restore, and qualify migrated staging copies
against baseline row counts, stock balances, IDs, timestamps, foreign keys,
    inventory, remote settings, and unknown-schema preservation.
"""
import logging
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

logger = logging.getLogger(__name__)

CORE_TABLES = {
    "units", "categories", "destinations", "providers", "items", "movement_logs",
    "schema_migrations", "users", "operations", "purchase_orders",
    "purchase_order_items", "leave_orders", "leave_order_items",
    "return_events", "return_event_items", "leave_order_rejection_events"
}


def inspect_database(conn: Any) -> Dict[str, Any]:
    """
    Inspects a database connection and captures an authoritative baseline snapshot:
    - Tables list and row counts
    - Stock balances and per-item quantities
    - Item IDs and stock balance preservation
    - Movement logs summary and timestamps
    - Remote settings and unmanaged/unknown schema tables
    - Foreign key and integrity checks
    """
    cursor = conn.cursor()

    # 1. Discover all user tables
    cursor.execute("""
        SELECT name, sql FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' 
        ORDER BY name
    """)
    table_rows = cursor.fetchall()
    tables = [r[0] if isinstance(r, (tuple, list)) else r["name"] for r in table_rows]
    table_ddl = {
        (r[0] if isinstance(r, (tuple, list)) else r["name"]): 
        (r[1] if isinstance(r, (tuple, list)) else r["sql"])
        for r in table_rows
    }

    # 2. Row counts per table
    row_counts = {}
    for tbl in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM \"{tbl}\"")
            count_row = cursor.fetchone()
            count = count_row[0] if isinstance(count_row, (tuple, list)) else count_row["COUNT(*)"]
            row_counts[tbl] = count
        except Exception as e:
            logger.warning(f"Failed to count rows in table {tbl}: {e}")
            row_counts[tbl] = -1

    # 3. Items inspection
    items_summary = {}
    if "items" in tables:
        cursor.execute("SELECT id, name, current_quantity, status FROM items ORDER BY id")
        item_rows = cursor.fetchall()
        total_quantity = 0
        item_balances = {}
        status_counts = {"active": 0, "inactive": 0, "archived": 0}

        for r in item_rows:
            i_id = r[0] if isinstance(r, (tuple, list)) else r["id"]
            qty = r[2] if isinstance(r, (tuple, list)) else r["current_quantity"]
            st = r[3] if isinstance(r, (tuple, list)) else r["status"]

            total_quantity += (qty or 0)
            item_balances[i_id] = qty
            if st in status_counts:
                status_counts[st] += 1
            else:
                status_counts[st] = 1

        items_summary = {
            "count": len(item_rows),
            "total_quantity": total_quantity,
            "item_ids": sorted(list(item_balances.keys())),
            "item_balances": item_balances,
            "status_counts": status_counts
        }

    # 4. Movement logs inspection
    logs_summary = {}
    if "movement_logs" in tables:
        cursor.execute("""
            SELECT id, timestamp, action_type, quantity_changed, resulting_quantity, item_id
            FROM movement_logs ORDER BY id
        """)
        log_rows = cursor.fetchall()
        action_counts = {}
        earliest_ts = None
        latest_ts = None
        log_ids = []

        for r in log_rows:
            l_id = r[0] if isinstance(r, (tuple, list)) else r["id"]
            ts = r[1] if isinstance(r, (tuple, list)) else r["timestamp"]
            act = r[2] if isinstance(r, (tuple, list)) else r["action_type"]

            log_ids.append(l_id)
            action_counts[act] = action_counts.get(act, 0) + 1
            if ts:
                if earliest_ts is None or ts < earliest_ts:
                    earliest_ts = ts
                if latest_ts is None or ts > latest_ts:
                    latest_ts = ts

        log_timestamps = {
            (r[0] if isinstance(r, (tuple, list)) else r["id"]):
            (r[1] if isinstance(r, (tuple, list)) else r["timestamp"])
            for r in log_rows
        }

        logs_summary = {
            "total_logs": len(log_rows),
            "log_ids": log_ids,
            "log_timestamps": log_timestamps,
            "action_counts": action_counts,
            "earliest_timestamp": earliest_ts,
            "latest_timestamp": latest_ts
        }

    # 5. Remote settings inspection (e.g. app_remote_settings)
    remote_settings = None
    if "app_remote_settings" in tables:
        try:
            cursor.execute("SELECT id, is_locked FROM app_remote_settings WHERE id = 1")
            s_row = cursor.fetchone()
            if s_row:
                is_locked = s_row[1] if isinstance(s_row, (tuple, list)) else s_row["is_locked"]
                remote_settings = {"is_locked": is_locked}
        except Exception as e:
            logger.warning(f"Error inspecting app_remote_settings: {e}")

    # 6. Master entities IDs inspection (units, categories, destinations, providers)
    master_entity_ids = {}
    for me_tbl in ("units", "categories", "destinations", "providers"):
        if me_tbl in tables:
            cursor.execute(f"SELECT id FROM \"{me_tbl}\" ORDER BY id")
            master_entity_ids[me_tbl] = [
                r[0] if isinstance(r, (tuple, list)) else r["id"]
                for r in cursor.fetchall()
            ]

    # 7. Foreign key validation
    cursor.execute("PRAGMA foreign_key_check")
    fk_violations = cursor.fetchall()
    fk_clean = len(fk_violations) == 0

    # 8. Integrity check
    cursor.execute("PRAGMA integrity_check")
    integrity_rows = cursor.fetchall()
    integrity_clean = False
    if integrity_rows:
        first_val = integrity_rows[0][0] if isinstance(integrity_rows[0], (tuple, list)) else integrity_rows[0]["integrity_check"]
        integrity_clean = (first_val == "ok")

    # 9. Unknown/Unmanaged schema preservation
    unmanaged_tables = [t for t in tables if t not in CORE_TABLES]
    unmanaged_data = {}
    for ut in unmanaged_tables:
        cursor.execute(f"SELECT * FROM \"{ut}\"")
        unmanaged_data[ut] = cursor.fetchall()

    return {
        "tables": sorted(tables),
        "table_ddl": table_ddl,
        "row_counts": row_counts,
        "items_summary": items_summary,
        "logs_summary": logs_summary,
        "master_entity_ids": master_entity_ids,
        "remote_settings": remote_settings,
        "foreign_keys_valid": fk_clean,
        "foreign_key_violations": [list(v) if isinstance(v, (tuple, list)) else dict(v) for v in fk_violations],
        "integrity_check_passed": integrity_clean,
        "unmanaged_tables": sorted(unmanaged_tables),
        "unmanaged_data_counts": {ut: len(data) for ut, data in unmanaged_data.items()}
    }


def _dump_and_load_connection(source_conn: Any, target_conn: Any):
    """
    Universal lossless schema and data copier between two DB-API connections.
    Works across SQLite, LibSQL, and wrapper objects without requiring native backup API.
    """
    src_cursor = source_conn.cursor()
    tgt_cursor = target_conn.cursor()

    try:
        tgt_cursor.execute("PRAGMA foreign_keys = OFF;")
    except Exception:
        pass

    # 1. Fetch user tables
    src_cursor.execute("""
        SELECT name, sql FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL 
        ORDER BY name
    """)
    tables = src_cursor.fetchall()

    for row in tables:
        t_name = row[0] if isinstance(row, (tuple, list)) else row["name"]
        t_sql = row[1] if isinstance(row, (tuple, list)) else row["sql"]
        tgt_cursor.execute(t_sql)

        # Copy table data
        src_cursor.execute(f'SELECT * FROM "{t_name}"')
        rows = src_cursor.fetchall()
        if rows:
            col_count = len(rows[0])
            placeholders = ", ".join(["?"] * col_count)
            insert_sql = f'INSERT INTO "{t_name}" VALUES ({placeholders})'
            data = [tuple(r) for r in rows]
            tgt_cursor.executemany(insert_sql, data)

    # 2. Recreate indexes, triggers, and views
    src_cursor.execute("""
        SELECT type, name, sql FROM sqlite_master 
        WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL 
        ORDER BY type DESC, name ASC
    """)
    other_objects = src_cursor.fetchall()
    for row in other_objects:
        obj_sql = row[2] if isinstance(row, (tuple, list)) else row["sql"]
        try:
            tgt_cursor.execute(obj_sql)
        except Exception:
            pass

    target_conn.commit()


def backup_database(source_conn: Any, target_conn_or_path: Union[sqlite3.Connection, str, Path]):
    """
    Creates an atomic backup of source database into target connection or path.
    Uses native SQLite backup API when available on both ends, and falls back to
    lossless schema+data export for wrapped or remote drivers.
    """
    should_close_target = False
    if isinstance(target_conn_or_path, (str, Path)):
        target_conn = sqlite3.connect(str(target_conn_or_path))
        target_conn.row_factory = sqlite3.Row
        should_close_target = True
    else:
        target_conn = target_conn_or_path

    try:
        raw_source = getattr(source_conn, "_conn", source_conn)
        raw_target = getattr(target_conn, "_conn", target_conn)

        if hasattr(raw_source, "backup") and isinstance(raw_target, sqlite3.Connection):
            raw_source.backup(raw_target)
        else:
            _dump_and_load_connection(source_conn, target_conn)
    finally:
        if should_close_target:
            target_conn.close()


def restore_database(backup_conn_or_path: Union[sqlite3.Connection, str, Path], target_conn: Any):
    """
    Restores a database from a backup copy into the target connection.
    Supports native SQLite backup API and universal schema+data restore for wrapped connections.
    """
    should_close_source = False
    if isinstance(backup_conn_or_path, (str, Path)):
        source_conn = sqlite3.connect(str(backup_conn_or_path))
        source_conn.row_factory = sqlite3.Row
        should_close_source = True
    else:
        source_conn = backup_conn_or_path

    try:
        raw_source = getattr(source_conn, "_conn", source_conn)
        raw_target = getattr(target_conn, "_conn", target_conn)

        if hasattr(raw_source, "backup") and isinstance(raw_target, sqlite3.Connection):
            raw_source.backup(raw_target)
        else:
            # Universal restore: clear target first, then load from source
            tgt_cursor = target_conn.cursor()
            try:
                tgt_cursor.execute("PRAGMA foreign_keys = OFF;")
            except Exception:
                pass
            tgt_cursor.execute("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
            existing = tgt_cursor.fetchall()
            for row in existing:
                o_name = row[0] if isinstance(row, (tuple, list)) else row["name"]
                o_type = row[1] if isinstance(row, (tuple, list)) else row["type"]
                if o_type == "table":
                    tgt_cursor.execute(f'DROP TABLE IF EXISTS "{o_name}"')
                elif o_type == "view":
                    tgt_cursor.execute(f'DROP VIEW IF EXISTS "{o_name}"')
            target_conn.commit()

            _dump_and_load_connection(source_conn, target_conn)
    finally:
        if should_close_source:
            source_conn.close()


def compare_database_snapshots(baseline: Dict[str, Any], post_migration: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compares baseline and post-migration snapshots and reports discrepancies:
    - Baseline table existence and row preservation across all baseline tables
    - Stock balances and per-item quantity equality
    - Item IDs and deliberate retirement of legacy identifiers
    - Master entity IDs preservation (units, categories, destinations, providers)
    - Movement logs row count, actions, IDs, and per-log timestamp integrity
    - Foreign key validity (0 violations)
    - Remote settings preservation
    - Unknown/Unmanaged schema preservation
    """
    discrepancies: List[str] = []

    # 1. Foreign Key and Integrity Checks
    if not post_migration.get("foreign_keys_valid"):
        discrepancies.append(
            f"Foreign key violations detected post-migration: {post_migration.get('foreign_key_violations')}"
        )
    if not post_migration.get("integrity_check_passed"):
        discrepancies.append("Database integrity check failed post-migration.")

    # 2. Table preservation: Every baseline table must exist post-migration
    for tbl in baseline.get("tables", []):
        if tbl not in post_migration.get("tables", []):
            discrepancies.append(f"Table '{tbl}' existed in baseline but is missing post-migration.")

    # 3. Row count preservation for ALL tables that existed in baseline
    for tbl, base_cnt in baseline.get("row_counts", {}).items():
        if tbl in post_migration.get("row_counts", {}):
            post_cnt = post_migration["row_counts"][tbl]
            if post_cnt < base_cnt:
                discrepancies.append(
                    f"Table '{tbl}' lost rows during migration: baseline had {base_cnt}, post-migration has {post_cnt}."
                )

    # 4. Stock balances equality & Item IDs preservation
    b_items = baseline.get("items_summary", {})
    p_items = post_migration.get("items_summary", {})

    if b_items and p_items:
        if b_items.get("total_quantity") != p_items.get("total_quantity"):
            discrepancies.append(
                f"Total stock balance mismatch: baseline had {b_items.get('total_quantity')}, "
                f"post-migration has {p_items.get('total_quantity')}."
            )

        # Baseline Item IDs preservation
        base_item_ids = set(b_items.get("item_ids", []))
        post_item_ids = set(p_items.get("item_ids", []))
        missing_item_ids = base_item_ids - post_item_ids
        if missing_item_ids:
            discrepancies.append(
                f"Baseline item IDs lost during migration: {sorted(list(missing_item_ids))}."
            )

        # Per-item balance comparison
        for item_id, base_qty in b_items.get("item_balances", {}).items():
            post_qty = p_items.get("item_balances", {}).get(item_id)
            if post_qty != base_qty:
                discrepancies.append(
                    f"Item ID {item_id} quantity changed: baseline had {base_qty}, post-migration has {post_qty}."
                )


    # 5. Master Entity IDs preservation (units, categories, destinations, providers)
    b_me = baseline.get("master_entity_ids", {})
    p_me = post_migration.get("master_entity_ids", {})
    for me_tbl, b_ids in b_me.items():
        p_ids = set(p_me.get(me_tbl, []))
        lost_me_ids = set(b_ids) - p_ids
        if lost_me_ids:
            discrepancies.append(
                f"Master table '{me_tbl}' lost IDs during migration: {sorted(list(lost_me_ids))}."
            )

    # 6. Movement log preservation
    b_logs = baseline.get("logs_summary", {})
    p_logs = post_migration.get("logs_summary", {})

    if b_logs and p_logs:
        if p_logs.get("total_logs", 0) < b_logs.get("total_logs", 0):
            discrepancies.append(
                f"Movement logs lost: baseline had {b_logs.get('total_logs')}, post-migration has {p_logs.get('total_logs')}."
            )
        # Verify log IDs preservation
        base_log_ids = set(b_logs.get("log_ids", []))
        post_log_ids = set(p_logs.get("log_ids", []))
        missing_log_ids = base_log_ids - post_log_ids
        if missing_log_ids:
            discrepancies.append(
                f"Movement log IDs lost during migration: {sorted(list(missing_log_ids))}."
            )
        # Verify per-log timestamp preservation
        b_ts = b_logs.get("log_timestamps", {})
        p_ts = p_logs.get("log_timestamps", {})
        for l_id, expected_ts in b_ts.items():
            actual_ts = p_ts.get(l_id)
            if actual_ts != expected_ts:
                discrepancies.append(
                    f"Movement log ID {l_id} timestamp modified: baseline was '{expected_ts}', post-migration is '{actual_ts}'."
                )
        # Verify earliest timestamp preserved
        if b_logs.get("earliest_timestamp") != p_logs.get("earliest_timestamp"):
            discrepancies.append(
                f"Movement log earliest timestamp changed: baseline was {b_logs.get('earliest_timestamp')}, "
                f"post-migration is {p_logs.get('earliest_timestamp')}."
            )
        # Verify legacy action counts
        for act, cnt in b_logs.get("action_counts", {}).items():
            p_cnt = p_logs.get("action_counts", {}).get(act, 0)
            if p_cnt < cnt:
                discrepancies.append(
                    f"Movement log action '{act}' count decreased from {cnt} to {p_cnt}."
                )

    # 7. Remote settings preservation
    if baseline.get("remote_settings") is not None:
        p_settings = post_migration.get("remote_settings")
        if p_settings is None:
            discrepancies.append("Remote settings table was lost post-migration.")
        elif p_settings.get("is_locked") != baseline["remote_settings"].get("is_locked"):
            discrepancies.append(
                f"Remote settings 'is_locked' changed from {baseline['remote_settings'].get('is_locked')} "
                f"to {p_settings.get('is_locked')}."
            )

    # 8. Unknown / Unmanaged schema preservation
    for ut in baseline.get("unmanaged_tables", []):
        if ut not in post_migration.get("unmanaged_tables", []):
            discrepancies.append(f"Unmanaged table '{ut}' was lost post-migration.")
        else:
            base_cnt = baseline.get("unmanaged_data_counts", {}).get(ut, 0)
            post_cnt = post_migration.get("unmanaged_data_counts", {}).get(ut, 0)
            if base_cnt != post_cnt:
                discrepancies.append(
                    f"Unmanaged table '{ut}' row count mismatch: baseline had {base_cnt}, post-migration has {post_cnt}."
                )

    passed = (len(discrepancies) == 0)
    return {
        "passed": passed,
        "discrepancies": discrepancies,
        "baseline_summary": {
            "tables_count": len(baseline.get("tables", [])),
            "items_count": b_items.get("count", 0),
            "total_quantity": b_items.get("total_quantity", 0),
            "logs_count": b_logs.get("total_logs", 0)
        },
        "post_migration_summary": {
            "tables_count": len(post_migration.get("tables", [])),
            "items_count": p_items.get("count", 0),
            "total_quantity": p_items.get("total_quantity", 0),
            "logs_count": p_logs.get("total_logs", 0)
        }
    }


def rehearse_staging_migration(conn: Any, migrations_dir: Optional[Path] = None) -> Dict[str, Any]:
    """
    Executes a complete staging migration rehearsal:
    1. Inspects baseline staging copy
    2. Takes an in-memory backup snapshot
    3. Restores backup into validation connection and verifies 100% restore fidelity
    4. Runs pending migrations on staging connection
    5. Inspects post-migration state
    6. Compares baseline to post-migration
    Returns full qualification report.
    """
    from app.migrations import run_migrations, verify_schema_version, CURRENT_SCHEMA_VERSION

    # 1. Baseline inspection
    baseline_snapshot = inspect_database(conn)

    # 2. Rehearsal backup
    backup_conn = sqlite3.connect(":memory:")
    backup_conn.row_factory = sqlite3.Row
    backup_database(conn, backup_conn)

    # 3. Restore verification: restore backup into fresh validation connection
    validation_conn = sqlite3.connect(":memory:")
    validation_conn.row_factory = sqlite3.Row
    restore_database(backup_conn, validation_conn)
    restored_snapshot = inspect_database(validation_conn)
    restore_comparison = compare_database_snapshots(baseline_snapshot, restored_snapshot)
    validation_conn.close()

    # 4. Apply migrations
    applied_versions = run_migrations(conn, migrations_dir=migrations_dir)
    current_version = verify_schema_version(conn, required_version=CURRENT_SCHEMA_VERSION)

    # 5. Post-migration inspection
    post_snapshot = inspect_database(conn)

    # 6. Snapshot comparison
    comparison = compare_database_snapshots(baseline_snapshot, post_snapshot)
    comparison["applied_versions"] = applied_versions
    comparison["current_version"] = current_version
    comparison["restore_verified"] = restore_comparison["passed"]
    if not restore_comparison["passed"]:
        comparison["passed"] = False
        comparison["discrepancies"].extend(
            [f"Restore validation failure: {d}" for d in restore_comparison["discrepancies"]]
        )

    backup_conn.close()
    return comparison


if __name__ == "__main__":
    import argparse
    from app.models.db_utils import get_db

    parser = argparse.ArgumentParser(description="SkyCourt Warehouse Staging Rehearsal Tool")
    parser.add_argument("--rehearse", action="store_true", help="Run full staging migration rehearsal")
    parser.add_argument("--inspect", action="store_true", help="Inspect current database state")
    args = parser.parse_args()

    conn = get_db()
    try:
        if args.inspect:
            snapshot = inspect_database(conn)
            print("Database Inspection Snapshot:")
            print(f"- Tables ({len(snapshot['tables'])}): {', '.join(snapshot['tables'])}")
            print(f"- Row Counts: {snapshot['row_counts']}")
            print(f"- Items: {snapshot['items_summary'].get('count', 0)} items, total quantity: {snapshot['items_summary'].get('total_quantity', 0)}")
            print(f"- Movement Logs: {snapshot['logs_summary'].get('total_logs', 0)}")
            print(f"- Foreign Keys Valid: {snapshot['foreign_keys_valid']}")
            print(f"- Integrity Check Passed: {snapshot['integrity_check_passed']}")
        elif args.rehearse:
            report = rehearse_staging_migration(conn)
            print("Staging Rehearsal Report:")
            print(f"- Passed: {report['passed']}")
            print(f"- Applied Migrations: {report.get('applied_versions')}")
            print(f"- Schema Version: {report.get('current_version')}")
            if report.get("discrepancies"):
                print("Discrepancies found:")
                for d in report["discrepancies"]:
                    print(f"  * {d}")
            else:
                print("100% preservation verified across all row counts, balances, IDs, and settings.")
    finally:
        conn.close()
