"""
Automated tests for Issue #11:
Cross-Workflow Freshness, Ticket Badges, and Reporting Updates.
Verifies Cairo-local date boundaries, Return events and returns_today, legacy timestamp
normalization, error path status codes, sync-status and manual sync contracts.
"""
import sqlite3
import zoneinfo
from app.models.db_utils import get_sync_status, record_sync_success, record_sync_error
from app.models.movement_log_model import add_log_entry

CAIRO_TZ = zoneinfo.ZoneInfo("Africa/Cairo")


def test_daily_summary_distinguishes_returns_and_preserves_semantics(client, temp_db_path):
    """
    Acceptance Criteria 5:
    Daily summary distinguishes Return events and returns_today while preserving
    Addition, Removal, and Creation meanings and positive quantity magnitudes.
    """
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()

    # Create item
    cursor.execute("INSERT INTO items (name, current_quantity, unit_id, sub_category_id) VALUES ('Freshness Item', 100, 1, 1)")
    item_id = cursor.lastrowid
    conn.commit()

    # Get baseline summary
    res_base = client.get("/api/movement-logs/summary/today")
    assert res_base.status_code == 200
    base_data = res_base.get_json()
    base_adds = base_data["additions_today"]
    base_removals = base_data["withdrawals_today"]
    base_returns = base_data["returns_today"]

    # 1. Add an Addition event
    add_log_entry(
        item_id=item_id,
        item_name="Freshness Item",
        action_type="Addition",
        quantity_changed=10,
        resulting_quantity=110,
        db=conn,
        user_id=1,
        actor_name="Warehouse Operator"
    )

    # 2. Add a Removal event
    add_log_entry(
        item_id=item_id,
        item_name="Freshness Item",
        action_type="Removal",
        quantity_changed=-5,
        resulting_quantity=105,
        db=conn,
        user_id=1,
        actor_name="Warehouse Operator"
    )

    # 3. Add a Return event
    add_log_entry(
        item_id=item_id,
        item_name="Freshness Item",
        action_type="Return",
        quantity_changed=3,
        resulting_quantity=108,
        db=conn,
        user_id=1,
        actor_name="Office Operator",
        return_event_id=42
    )

    # 4. Add a Creation / status event (should NOT increment Addition, Removal, or Return)
    add_log_entry(
        item_id=item_id,
        item_name="Freshness Item",
        action_type="Status Changed to Active",
        quantity_changed=0,
        resulting_quantity=108,
        db=conn,
        user_id=1,
        actor_name="Warehouse Operator"
    )
    conn.commit()
    conn.close()

    # Check daily summary
    res = client.get("/api/movement-logs/summary/today")
    assert res.status_code == 200
    data = res.get_json()
    assert data["additions_today"] == base_adds + 1
    assert data["withdrawals_today"] == base_removals + 1
    assert data["returns_today"] == base_returns + 1


def test_cairo_local_day_boundary_and_legacy_normalization(client, temp_db_path):
    """
    Acceptance Criteria 6:
    New timestamps use UTC with Africa/Cairo day filters; legacy timestamp text and
    provenance are preserved with tested normalization and boundary or DST behavior.
    """
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()

    cursor.execute("INSERT INTO items (name, current_quantity, unit_id, sub_category_id) VALUES ('Boundary Item', 50, 1, 1)")
    item_id = cursor.lastrowid

    # 1. Insert a legacy naive local timestamp from 2024 (before multi-operator audit schema)
    # user_id is NULL, actor_name is NULL, timestamp has no 'Z'
    legacy_ts = "2024-05-15 14:30:00"
    cursor.execute("""
        INSERT INTO movement_logs (
            item_id, item_name, action_type, quantity_changed, resulting_quantity,
            person_name, timestamp, user_id, actor_name
        ) VALUES (?, 'Boundary Item', 'Addition', 25, 50, 'Legacy Worker', ?, NULL, NULL)
    """, (item_id, legacy_ts))

    # 2. Insert an event that occurred late in UTC (23:30:00 UTC) on 2026-07-10.
    # In Egypt (UTC+3 DST in July), 23:30:00 on 2026-07-10 is 02:30:00 on 2026-07-11!
    utc_cross_ts = "2026-07-10 23:30:00Z"
    cursor.execute("""
        INSERT INTO movement_logs (
            item_id, item_name, action_type, quantity_changed, resulting_quantity,
            person_name, timestamp, user_id, actor_name
        ) VALUES (?, 'Boundary Item', 'Return', 5, 55, 'Office Worker', ?, 2, 'Office Worker')
    """, (item_id, utc_cross_ts))

    # 3. Insert an event during Egyptian standard time (winter, UTC+2, e.g. January):
    # 22:30:00 UTC on 2026-01-14 is 00:30:00 on 2026-01-15 in Cairo!
    winter_cross_ts = "2026-01-14 22:30:00Z"
    cursor.execute("""
        INSERT INTO movement_logs (
            item_id, item_name, action_type, quantity_changed, resulting_quantity,
            person_name, timestamp, user_id, actor_name
        ) VALUES (?, 'Boundary Item', 'Removal', 2, 53, 'Warehouse Worker', ?, 1, 'Warehouse Worker')
    """, (item_id, winter_cross_ts))

    conn.commit()
    conn.close()

    # Query 1: Filter exactly for the legacy date 2024-05-15
    res_legacy = client.get("/api/movement-logs/?date_from=2024-05-15&date_to=2024-05-15")
    assert res_legacy.status_code == 200
    legacy_logs = res_legacy.get_json()["logs"]
    assert len(legacy_logs) == 1
    assert legacy_logs[0]["timestamp"] == legacy_ts  # Text preserved verbatim!
    assert legacy_logs[0]["person_name"] == "Legacy Worker"
    assert legacy_logs[0]["actor_name"] is None

    # Query 2: The summer late event (2026-07-10 23:30 UTC) must NOT be in 2026-07-10 in Cairo!
    res_july10 = client.get("/api/movement-logs/?date_from=2026-07-10&date_to=2026-07-10")
    assert res_july10.status_code == 200
    assert len(res_july10.get_json()["logs"]) == 0

    # It MUST be in 2026-07-11 in Cairo!
    res_july11 = client.get("/api/movement-logs/?date_from=2026-07-11&date_to=2026-07-11")
    assert res_july11.status_code == 200
    july11_logs = res_july11.get_json()["logs"]
    assert len(july11_logs) == 1
    assert july11_logs[0]["action_type"] == "Return"
    assert july11_logs[0]["timestamp"] == utc_cross_ts

    # Query 3: The winter late event (2026-01-14 22:30 UTC) must be in 2026-01-15 in Cairo!
    res_jan14 = client.get("/api/movement-logs/?date_from=2026-01-14&date_to=2026-01-14")
    assert res_jan14.status_code == 200
    assert len(res_jan14.get_json()["logs"]) == 0

    res_jan15 = client.get("/api/movement-logs/?date_from=2026-01-15&date_to=2026-01-15")
    assert res_jan15.status_code == 200
    assert len(res_jan15.get_json()["logs"]) == 1
    assert res_jan15.get_json()["logs"][0]["action_type"] == "Removal"


def test_daily_summary_error_returns_500(client, temp_db_path):
    """
    Acceptance Criteria 4 & Spec TASK-7:
    Failed summaries must not look like successful empty data.
    """
    conn = sqlite3.connect(temp_db_path)
    # Drop movement_logs temporarily to force a database error
    conn.execute("DROP TABLE movement_logs")
    conn.commit()
    conn.close()

    res = client.get("/api/movement-logs/summary/today")
    assert res.status_code == 500
    data = res.get_json()
    assert "error" in data


def test_sync_status_contract_and_manual_sync_endpoint(client, office_client, unauthenticated_client):
    """
    Acceptance Criteria 3 & 4:
    Expose sync status contract with nullable last_synced_at, last_error, revision, and pending_state.
    Manual sync endpoint POST /api/sync returns authoritative synchronization result.
    """
    # 1. Unauthenticated requests are rejected
    assert unauthenticated_client.get("/api/sync-status").status_code == 401
    assert unauthenticated_client.post("/api/sync").status_code == 401

    # 2. Authenticated sync-status
    res_status = client.get("/api/sync-status")
    assert res_status.status_code == 200
    status_data = res_status.get_json()
    assert "connected" in status_data
    assert "mode" in status_data
    assert "authoritative_writer" in status_data
    assert "last_synced_at" in status_data
    assert "last_error" in status_data
    assert "revision" in status_data
    assert "pending_state" in status_data
    assert status_data["connected"] is True
    assert status_data["pending_state"]["has_pending"] is False

    # 3. Manual sync endpoint POST /api/sync
    res_sync = office_client.post("/api/sync")
    assert res_sync.status_code == 200
    sync_data = res_sync.get_json()
    assert sync_data["synced"] is True
    assert sync_data["queued"] is False
    assert "status" in sync_data
    assert sync_data["status"]["last_synced_at"] is not None

    # Verify sync status now reflects the last_synced_at timestamp
    res_after = client.get("/api/sync-status")
    assert res_after.get_json()["last_synced_at"] == sync_data["status"]["last_synced_at"]


def test_manual_sync_failure_reporting(client, monkeypatch):
    """
    Verifies that when database connection fails during manual sync,
    it returns 500 with error details and records last_error.
    """
    import app.main

    def broken_get_db():
        raise sqlite3.OperationalError("Simulated sync failure")

    monkeypatch.setattr(app.main, "get_db", broken_get_db)

    res = client.post("/api/sync")
    assert res.status_code == 500
    data = res.get_json()
    assert data["synced"] is False
    assert "Simulated sync failure" in data["error"]


def test_egypt_dst_transition_and_microsecond_boundary(client, temp_db_path):
    """
    Verifies that movement log queries properly capture events occurring during:
    1. Egyptian DST fall-back transition (repeated hour at 21:30 UTC on Oct 29, 2026).
    2. Fractional-second timestamps at the very end of the Cairo day (20:59:59.850Z on July 11).
    """
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()

    cursor.execute("INSERT INTO items (name, current_quantity, unit_id, sub_category_id) VALUES ('DST Item', 50, 1, 1)")
    item_id = cursor.lastrowid

    # 1. Oct 29, 2026 DST fall-back: 21:30:00 UTC is 23:30 standard time in Cairo on Oct 29.
    oct29_dst_ts = "2026-10-29 21:30:00Z"
    cursor.execute("""
        INSERT INTO movement_logs (
            item_id, item_name, action_type, quantity_changed, resulting_quantity,
            timestamp, user_id, actor_name
        ) VALUES (?, 'DST Item', 'Return', 1, 51, ?, 1, 'Operator')
    """, (item_id, oct29_dst_ts))

    # 2. July 11, 2026 microsecond timestamp at 20:59:59.850000Z (23:59:59.850 in Cairo DST)
    july11_subsecond_ts = "2026-07-11 20:59:59.850000Z"
    cursor.execute("""
        INSERT INTO movement_logs (
            item_id, item_name, action_type, quantity_changed, resulting_quantity,
            timestamp, user_id, actor_name
        ) VALUES (?, 'DST Item', 'Addition', 5, 56, ?, 1, 'Operator')
    """, (item_id, july11_subsecond_ts))

    conn.commit()
    conn.close()

    # Query 1: Filter on Oct 29 must include the fall-back transition event
    res_oct29 = client.get("/api/movement-logs/?date_from=2026-10-29&date_to=2026-10-29")
    assert res_oct29.status_code == 200
    oct29_logs = res_oct29.get_json()["logs"]
    assert len(oct29_logs) == 1
    assert oct29_logs[0]["timestamp"] == oct29_dst_ts

    # It must NOT appear on Oct 30
    res_oct30 = client.get("/api/movement-logs/?date_from=2026-10-30&date_to=2026-10-30")
    assert res_oct30.status_code == 200
    assert len(res_oct30.get_json()["logs"]) == 0

    # Query 2: Sub-second boundary on July 11 must be included in July 11 filter
    res_july11 = client.get("/api/movement-logs/?date_from=2026-07-11&date_to=2026-07-11")
    assert res_july11.status_code == 200
    july11_logs = res_july11.get_json()["logs"]
    assert any(log["timestamp"] == july11_subsecond_ts for log in july11_logs)


def test_movement_log_routes_error_handling_returns_500(client, temp_db_path):
    """
    Verifies that /api/movement-logs and /api/movement-logs/all_filtered return HTTP 500
    on database errors instead of returning false-success empty lists.
    """
    conn = sqlite3.connect(temp_db_path)
    conn.execute("DROP TABLE movement_logs")
    conn.commit()
    conn.close()

    # 1. Paginated list route
    res_list = client.get("/api/movement-logs")
    assert res_list.status_code == 500
    assert "error" in res_list.get_json()

    # 2. All filtered export/print route
    res_all = client.get("/api/movement-logs/all_filtered")
    assert res_all.status_code == 500
    assert "error" in res_all.get_json()


def test_sync_status_preserves_last_error_even_when_connected(client):
    """
    Verifies that get_sync_status exposes last_error accurately even when the database
    connection itself is currently available.
    """
    record_sync_error("Remote replica push timed out")
    status = get_sync_status()
    assert status["connected"] is True
    assert status["last_error"] == "Remote replica push timed out"

    # Reset with success
    record_sync_success()
    status_cleared = get_sync_status()
    assert status_cleared["last_error"] is None

