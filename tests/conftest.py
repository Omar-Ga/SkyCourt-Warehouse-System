"""
Pytest configuration and shared fixtures for SkyCourt Warehouse System.
"""
import os
import sqlite3
import tempfile
import pytest
from pathlib import Path

from app.main import create_app
from app.migrations import run_migrations, get_migrations_dir
from app.models.db_utils import LibSQLRow, LibSQLConnectionWrapper


@pytest.fixture
def temp_db_path():
    """Creates a temporary database file for isolated tests."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.unlink(path)


@pytest.fixture
def migrated_db(temp_db_path):
    """Returns a SQLite connection to a freshly migrated database."""
    conn = sqlite3.connect(temp_db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    run_migrations(conn)
    yield conn
    conn.close()


@pytest.fixture
def app(temp_db_path):
    """Creates and configures a test Flask application with an isolated database."""
    # Run migrations on temp DB
    conn = sqlite3.connect(temp_db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    run_migrations(conn)
    conn.close()

    application = create_app({
        "TESTING": True,
        "DATABASE": temp_db_path,
        "SECRET_KEY": "test-secret-key"
    })
    return application


@pytest.fixture
def unauthenticated_client(app):
    """Unauthenticated Flask test client."""
    return app.test_client()


@pytest.fixture
def client(app, temp_db_path):
    """Default Flask test client authenticated as warehouse operator for regression suites."""
    from app.services.user_service import provision_user
    conn = sqlite3.connect(temp_db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    user = provision_user(
        username="default_warehouse",
        password="password123",
        role="warehouse",
        display_name="Warehouse Operator",
        db=conn
    )
    conn.commit()
    conn.close()

    c = app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = user["id"]
        sess["session_version"] = 1
        sess["csrf_token"] = "test-csrf-token"
    return c


@pytest.fixture
def office_client(app, temp_db_path):
    """Flask test client authenticated as office operator."""
    from app.services.user_service import provision_user
    conn = sqlite3.connect(temp_db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    user = provision_user(
        username="office_worker",
        password="password123",
        role="office",
        display_name="Office Operator",
        db=conn
    )
    conn.commit()
    conn.close()

    c = app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = user["id"]
        sess["session_version"] = 1
        sess["csrf_token"] = "test-csrf-token"
    return c


@pytest.fixture
def admin_client(app, temp_db_path):
    """Flask test client authenticated as admin."""
    from app.services.user_service import provision_user
    conn = sqlite3.connect(temp_db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    user = provision_user(
        username="admin_user",
        password="password123",
        role="admin",
        display_name="System Admin",
        db=conn
    )
    conn.commit()
    conn.close()

    c = app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = user["id"]
        sess["session_version"] = 1
        sess["csrf_token"] = "test-csrf-token"
    return c


@pytest.fixture
def sample_metadata(migrated_db):
    """Seeds standard units, categories, providers, destinations for testing."""
    cursor = migrated_db.cursor()
    cursor.execute("INSERT INTO units (name) VALUES ('قطعة')")
    unit_id = cursor.lastrowid

    cursor.execute("INSERT INTO categories (name) VALUES ('إلكترونيات')")
    cat_id = cursor.lastrowid

    cursor.execute("INSERT INTO categories (name, parent_id) VALUES ('هواتف', ?)", (cat_id,))
    sub_cat_id = cursor.lastrowid

    cursor.execute("INSERT INTO providers (name) VALUES ('شركة الأهرام')")
    provider_id = cursor.lastrowid

    cursor.execute("INSERT INTO destinations (name) VALUES ('مستودع 1')")
    destination_id = cursor.lastrowid

    migrated_db.commit()

    return {
        "unit_id": unit_id,
        "category_id": cat_id,
        "sub_category_id": sub_cat_id,
        "provider_id": provider_id,
        "destination_id": destination_id
    }
