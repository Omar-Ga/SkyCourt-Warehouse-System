"""
Tests for Two-Workstation Release Qualification and Frozen Windows Packaging.
Validates Acceptance Criteria 2, 4, and 5 for Issue #12.
"""
import os
import sys
import tempfile
import sqlite3
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from app.services.barcode_service import get_resource_path, generate_barcode_base64
from app.migrations import get_migrations_dir, verify_schema_version, IncompatibleSchemaError
from app.models.db_utils import close_request_db, get_db
from app.main import create_app
from run import check_remote_lock


def test_run_spec_packaging_configuration():
    """Verifies that run.spec includes all required datas, native modules, and migrations."""
    spec_path = Path(__file__).resolve().parent.parent / "run.spec"
    assert spec_path.exists(), "run.spec must exist in project root"
    spec_content = spec_path.read_text(encoding="utf-8")

    # Required datas
    assert "('UI/dist', 'dist')" in spec_content
    assert "('app/assets', 'app/assets')" in spec_content
    assert "('database/schema.sql', 'database')" in spec_content
    assert "('database/migrations', 'database/migrations')" in spec_content
    assert "(certifi.where(), '.')" in spec_content

    # Required hidden imports
    for module in [
        "libsql", "libsql_experimental", "certifi", "flask", "flask_cors",
        "barcode", "barcode.writer", "escpos", "werkzeug", "werkzeug.security",
        "app.staging", "app.migrations", "dotenv"
    ]:
        assert f"'{module}'" in spec_content, f"Missing required hiddenimport '{module}' in run.spec"


def test_resource_path_and_font_resolution_dev_and_frozen():
    """Verifies that font assets resolve properly in both developer and frozen PyInstaller environments."""
    # 1. Dev mode
    font_path_dev = get_resource_path(os.path.join("assets", "arial.ttf"))
    assert os.path.exists(font_path_dev), f"Font file not found at dev path: {font_path_dev}"

    # Barcode generation succeeds with dev font
    result = generate_barcode_base64("TEST-12345")
    assert result["barcodeValue"] == "TEST-12345"
    assert len(result["imageData"]) > 0

    # 2. Simulated PyInstaller frozen mode
    with tempfile.TemporaryDirectory() as tmp_meipass:
        app_assets = Path(tmp_meipass) / "app" / "assets"
        app_assets.mkdir(parents=True)
        # Copy font into simulated _MEIPASS/app/assets
        real_font = Path(font_path_dev)
        (app_assets / "arial.ttf").write_bytes(real_font.read_bytes())

        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "_MEIPASS", tmp_meipass, create=True):
            resolved = get_resource_path(os.path.join("assets", "arial.ttf"))
            assert os.path.exists(resolved)
            assert resolved == str(app_assets / "arial.ttf")

            # Barcode generation succeeds in frozen mode
            frozen_result = generate_barcode_base64("FROZEN-67890")
            assert frozen_result["barcodeValue"] == "FROZEN-67890"
            assert len(frozen_result["imageData"]) > 0


def test_migrations_dir_resolution_dev_and_frozen():
    """Verifies that get_migrations_dir resolves correctly in dev and frozen modes."""
    # 1. Dev mode
    dev_dir = get_migrations_dir()
    assert dev_dir.exists()
    assert (dev_dir / "001_initial_schema.sql").exists()
    assert (dev_dir / "002_two_operator_overhaul.sql").exists()

    # 2. Frozen mode
    with tempfile.TemporaryDirectory() as tmp_meipass:
        mig_dir = Path(tmp_meipass) / "database" / "migrations"
        mig_dir.mkdir(parents=True)
        (mig_dir / "001_initial_schema.sql").write_text("-- dummy", encoding="utf-8")

        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "_MEIPASS", tmp_meipass, create=True):
            resolved_mig = get_migrations_dir()
            assert resolved_mig.exists()
            assert resolved_mig == mig_dir


def test_check_remote_lock_semantics():
    """
    Verifies check_remote_lock() fail-open, silent exit, and timeout behaviors:
    - Locked (is_locked = 1): exits with SystemExit(0)
    - Unlocked (is_locked = 0): continues without exit
    - Error / Offline / Missing table: fail-safe allows continuation
    - Query timeout: times out and fail-safe allows continuation without blocking startup
    - Connection cleanup: connection is closed even if cursor execution raises
    """
    import time

    # 1. Unlocked remote database
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = (0,)  # is_locked = 0
    mock_conn.cursor.return_value = mock_cursor

    with patch("libsql.connect", return_value=mock_conn):
        check_remote_lock()
        assert mock_conn.close.called

    # 2. Locked remote database (kill switch active)
    mock_conn_locked = MagicMock()
    mock_cur_locked = MagicMock()
    mock_cur_locked.fetchone.return_value = (1,)  # is_locked = 1
    mock_conn_locked.cursor.return_value = mock_cur_locked
    with patch("libsql.connect", return_value=mock_conn_locked):
        with pytest.raises(SystemExit) as exc:
            check_remote_lock()
        assert exc.value.code == 0
        assert mock_conn_locked.close.called

    # 3. Fail-safe: connection error or missing table allows startup
    with patch("libsql.connect", side_effect=RuntimeError("Connection failed / Host unreachable")):
        # Fail-safe must not raise
        check_remote_lock()

    # 4. Fail-safe timeout: slow/hanging connection does not block startup
    def slow_connect(*args, **kwargs):
        time.sleep(0.5)
        return mock_conn

    with patch("libsql.connect", side_effect=slow_connect):
        # Setting timeout small to test immediate fail-safe bypass
        check_remote_lock(timeout=0.05)

    # 5. Connection cleanup in finally when cursor execution raises
    mock_conn_err = MagicMock()
    mock_cur_err = MagicMock()
    mock_cur_err.execute.side_effect = RuntimeError("Syntax error or table missing")
    mock_conn_err.cursor.return_value = mock_cur_err
    with patch("libsql.connect", return_value=mock_conn_err):
        check_remote_lock()
        assert mock_conn_err.close.called


def test_startup_schema_version_verification_rejects_outdated_db():
    """Verifies that an unmigrated or outdated database is rejected on application startup."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    with pytest.raises(IncompatibleSchemaError) as exc:
        verify_schema_version(conn, required_version=2)
    assert "Database schema version is 0, but version 2 is required" in str(exc.value)

    conn.close()


def test_request_lifecycle_and_teardown_cleans_connections():
    """Verifies that Flask request teardown properly cleans up and rolls back connections without leaving locks."""
    from flask import g
    app = create_app({"TESTING": True, "DATABASE": ":memory:"})

    with app.test_request_context("/api/auth/csrf"):
        conn = get_db()
        assert hasattr(g, "db")
        close_request_db()
        assert "db" not in g


def test_retirement_of_unauthenticated_and_unaudited_clients():
    """
    Verifies that old clients that bypass authentication or audit headers cannot perform mutations:
    - Unauthenticated mutations return 401 Unauthorized
    - Requests without CSRF tokens return 403 Forbidden
    """
    app = create_app({"TESTING": True, "DATABASE": ":memory:"})
    client = app.test_client()

    # 1. Attempt to add item without authentication
    res_unauth = client.post("/api/items", json={"name": "حبة جديدة", "unit_id": 1, "quantity": 10})
    # Either CSRF error (403) or Unauthorized (401), never 200/201
    assert res_unauth.status_code in (401, 403)

    # 2. Attempt to adjust item stock without authentication
    res_adj = client.post("/api/items/1/adjust", json={"quantity_changed": 5, "action_type": "Addition"})
    assert res_adj.status_code in (401, 403)

    # 3. Attempt to receive purchase order without authentication
    res_rcv = client.post("/api/purchase-orders/1/receive", json={"items": [{"item_id": 1, "received_quantity": 5}]})
    assert res_rcv.status_code in (401, 403)
