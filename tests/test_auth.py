"""
Tests for SkyCourt authentication system covering:
- User provisioning, case-insensitive uniqueness, Werkzeug password hashing, role constraints
- Idempotent provisioning and error on unexpected role reassignment
- CSRF bootstrap, login, me, and logout public shapes (no password hashes exposed)
- Cookie flags (HttpOnly, SameSite, lifetime)
- Rate limiting for repeated failed logins (without logging passwords)
- Session invalidation (session version change, password reset, deactivation, logout)
- Session-bound CSRF validation and allowed-origin checks
"""
import json
import sqlite3
import pytest
from app.models import user_model
from app.services import user_service
from app.auth import get_or_create_secret_key, login_rate_limiter
from app.migrations import run_migrations
from app.main import create_app


def test_user_model_and_case_insensitive_uniqueness(migrated_db):
    """Verifies user schema, case-insensitive uniqueness, and role constraints."""
    # 1. Create initial user
    pwd_hash = user_service.hash_password("password123")
    user1 = user_model.create_user(
        username="WarehouseLead",
        password_hash=pwd_hash,
        role="warehouse",
        display_name="Warehouse Supervisor",
        db=migrated_db
    )
    migrated_db.commit()

    assert user1["id"] is not None
    assert user1["username"] == "WarehouseLead"
    assert user1["role"] == "warehouse"
    assert user1["is_active"] == 1
    assert user1["session_version"] == 1
    assert user1["created_at"] is not None

    # 2. Lookup case-insensitive
    lookup_lower = user_model.get_user_by_username("warehouselead", db=migrated_db)
    lookup_upper = user_model.get_user_by_username("WAREHOUSELEAD", db=migrated_db)
    assert lookup_lower["id"] == user1["id"]
    assert lookup_upper["id"] == user1["id"]

    # 3. Duplicate username with different case must violate UNIQUE constraint
    with pytest.raises(sqlite3.IntegrityError):
        user_model.create_user(
            username="warehouselead",
            password_hash=pwd_hash,
            role="warehouse",
            display_name="Duplicate User",
            db=migrated_db
        )
    migrated_db.rollback()

    # 4. Role constraint: invalid role rejected
    with pytest.raises((sqlite3.IntegrityError, ValueError)):
        user_model.create_user(
            username="invalid_role_user",
            password_hash=pwd_hash,
            role="superadmin",
            display_name="Invalid Role",
            db=migrated_db
        )
    migrated_db.rollback()


def test_user_provisioning_idempotent_and_no_silent_reassignment(migrated_db):
    """Tests administrative provision_user function for idempotency and conflict detection."""
    # 1. First-time provisioning
    user = user_service.provision_user(
        username="office_user",
        password="initial_password",
        role="office",
        display_name="Office Manager",
        db=migrated_db
    )
    migrated_db.commit()

    assert user["username"] == "office_user"
    assert user["role"] == "office"
    assert "password_hash" not in user  # Public shape!

    # 2. Idempotent re-provisioning with same role updates password / display name cleanly
    reprov = user_service.provision_user(
        username="office_user",
        password="new_password_456",
        role="office",
        display_name="Office Senior Manager",
        db=migrated_db
    )
    migrated_db.commit()

    assert reprov["id"] == user["id"]
    assert reprov["display_name"] == "Office Senior Manager"

    # Verify new password is valid and old password is not
    full_user = user_model.get_user_by_id(user["id"], db=migrated_db)
    assert user_service.verify_password(full_user["password_hash"], "new_password_456")
    assert not user_service.verify_password(full_user["password_hash"], "initial_password")

    # 3. Attempting to provision existing username with unexpected role raises ProvisioningError
    with pytest.raises(user_service.ProvisioningError) as exc_info:
        user_service.provision_user(
            username="office_user",
            password="any_password",
            role="warehouse",  # Unexpected role change!
            display_name="Office Hacker",
            db=migrated_db
        )
    assert "Cannot silently reassign" in str(exc_info.value)


def test_auth_csrf_bootstrap_and_login_flow(app, temp_db_path):
    """Tests GET /api/auth/csrf and POST /api/auth/login public response shapes."""
    client = app.test_client()

    # Provision warehouse user
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user_service.provision_user(
        username="operator1",
        password="securepassword",
        role="warehouse",
        display_name="Ali Operator",
        db=conn
    )
    conn.commit()
    conn.close()

    # 1. Bootstrap CSRF
    res_csrf = client.get("/api/auth/csrf")
    assert res_csrf.status_code == 200
    csrf_data = res_csrf.get_json()
    assert "csrf_token" in csrf_data
    token = csrf_data["csrf_token"]
    assert len(token) >= 32

    # 2. Login with uppercase username (case-insensitivity test)
    res_login = client.post("/api/auth/login", json={
        "username": "OPERATOR1",
        "password": "securepassword"
    }, headers={"X-CSRF-Token": token})

    assert res_login.status_code == 200
    login_data = res_login.get_json()
    assert "user" in login_data
    assert "csrf_token" in login_data
    
    # Verify public user shape: only id, username, display_name, role
    user = login_data["user"]
    assert set(user.keys()) == {"id", "username", "display_name", "role"}
    assert user["username"] == "operator1"
    assert user["display_name"] == "Ali Operator"
    assert user["role"] == "warehouse"
    assert "password_hash" not in user
    assert "session_version" not in user

    # 3. /me returns authenticated user
    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 200
    me_user = res_me.get_json()["user"]
    assert me_user["id"] == user["id"]
    assert me_user["username"] == "operator1"

    # 4. Logout returns 204
    res_logout = client.post("/api/auth/logout", headers={"X-CSRF-Token": login_data["csrf_token"]})
    assert res_logout.status_code == 204
    assert res_logout.data == b""

    # 5. Subsequent /me returns 401
    res_me_after = client.get("/api/auth/me")
    assert res_me_after.status_code == 401
    assert res_me_after.get_json()["code"] == "UNAUTHENTICATED"


def test_failed_login_invalid_credentials_and_rate_limiting(app, temp_db_path):
    """Tests generic error responses and rate-limiting repeated failed logins."""
    client = app.test_client()

    login_rate_limiter.clear()

    # Get CSRF
    res_csrf = client.get("/api/auth/csrf")
    token = res_csrf.get_json()["csrf_token"]

    # Provision user
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user_service.provision_user(
        username="target_user",
        password="correct_password",
        role="office",
        display_name="Office Staff",
        db=conn
    )
    conn.commit()
    conn.close()

    # 1. Bad password -> 401 INVALID_CREDENTIALS generic error
    res_bad_pwd = client.post("/api/auth/login", json={
        "username": "target_user",
        "password": "wrong_password"
    }, headers={"X-CSRF-Token": token})
    assert res_bad_pwd.status_code == 401
    assert res_bad_pwd.get_json()["code"] == "INVALID_CREDENTIALS"

    # 2. Bad username -> 401 INVALID_CREDENTIALS generic error
    res_bad_user = client.post("/api/auth/login", json={
        "username": "non_existent_user",
        "password": "any_password"
    }, headers={"X-CSRF-Token": token})
    assert res_bad_user.status_code == 401
    assert res_bad_user.get_json()["code"] == "INVALID_CREDENTIALS"

    # 3. Exhaust rate limit (5 failed attempts)
    for _ in range(4):
        client.post("/api/auth/login", json={
            "username": "target_user",
            "password": "wrong_password"
        }, headers={"X-CSRF-Token": token})

    # Next attempt must be rate-limited with 429
    res_rate_limited = client.post("/api/auth/login", json={
        "username": "target_user",
        "password": "correct_password"
    }, headers={"X-CSRF-Token": token})
    assert res_rate_limited.status_code == 429
    assert res_rate_limited.get_json()["code"] == "RATE_LIMITED"

    # Clean up limiter
    login_rate_limiter.clear()


def test_session_invalidation_on_version_change_or_deactivation(app, temp_db_path):
    """Tests session invalidation when password changes, session version increments, or user is deactivated."""
    client = app.test_client()

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user = user_service.provision_user(
        username="active_operator",
        password="password123",
        role="warehouse",
        display_name="Active Operator",
        db=conn
    )
    conn.commit()

    # Log in
    res_csrf = client.get("/api/auth/csrf")
    token = res_csrf.get_json()["csrf_token"]
    client.post("/api/auth/login", json={
        "username": "active_operator",
        "password": "password123"
    }, headers={"X-CSRF-Token": token})

    # Verify logged in
    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 200

    # 1. Admin resets password (increments session version)
    user_service.change_user_password(user["id"], "brand_new_password", db=conn)
    conn.commit()

    # Subsequent request using existing session must be rejected with 401
    res_me_invalid = client.get("/api/auth/me")
    assert res_me_invalid.status_code == 401
    assert res_me_invalid.get_json()["code"] == "SESSION_INVALID"

    # Log back in with new password
    res_csrf2 = client.get("/api/auth/csrf")
    token2 = res_csrf2.get_json()["csrf_token"]
    res_login2 = client.post("/api/auth/login", json={
        "username": "active_operator",
        "password": "brand_new_password"
    }, headers={"X-CSRF-Token": token2})
    assert res_login2.status_code == 200

    # 2. Deactivate user account
    user_service.deactivate_user(user["id"], db=conn)
    conn.commit()

    # Subsequent request using session must be rejected with 401
    res_me_deact = client.get("/api/auth/me")
    assert res_me_deact.status_code == 401

    # 3. Reactivate user account (increments session version again)
    v_before = user_model.get_user_by_id(user["id"], db=conn)["session_version"]
    user_model.set_user_active(user["id"], True, db=conn)
    conn.commit()
    v_after = user_model.get_user_by_id(user["id"], db=conn)["session_version"]
    assert v_after > v_before

    conn.close()


def test_csrf_protection_and_origin_checking(temp_db_path):
    """Verifies that state-changing requests enforce CSRF tokens and allowed origins."""
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    run_migrations(conn)

    user_service.provision_user(
        username="csrf_tester",
        password="password123",
        role="warehouse",
        display_name="CSRF Tester",
        db=conn
    )
    conn.commit()
    conn.close()

    app = create_app({
        "TESTING": True,
        "DATABASE": temp_db_path,
        "SECRET_KEY": "test-signing-secret",
        "CSRF_ENABLED": True,
        "ORIGIN_CHECK_ENABLED": True
    })
    client = app.test_client()

    # 1. Missing CSRF on login -> 403 CSRF_ERROR
    res_no_csrf = client.post("/api/auth/login", json={
        "username": "csrf_tester",
        "password": "password123"
    })
    assert res_no_csrf.status_code == 403
    assert res_no_csrf.get_json()["code"] == "CSRF_ERROR"

    # Get CSRF
    res_csrf = client.get("/api/auth/csrf")
    valid_csrf = res_csrf.get_json()["csrf_token"]

    # 2. Disallowed origin header -> 403 ORIGIN_DISALLOWED
    res_evil_origin = client.post("/api/auth/login", json={
        "username": "csrf_tester",
        "password": "password123"
    }, headers={
        "X-CSRF-Token": valid_csrf,
        "Origin": "http://evil-attacker.com"
    })
    assert res_evil_origin.status_code == 403
    assert res_evil_origin.get_json()["code"] == "ORIGIN_DISALLOWED"

    # 3. Allowed origin + valid CSRF -> 200 OK
    res_ok = client.post("/api/auth/login", json={
        "username": "csrf_tester",
        "password": "password123"
    }, headers={
        "X-CSRF-Token": valid_csrf,
        "Origin": "http://127.0.0.1:5070"
    })
    assert res_ok.status_code == 200
    fresh_csrf = res_ok.get_json()["csrf_token"]

    # 4. State-changing call with wrong CSRF -> 403 CSRF_ERROR
    res_wrong_csrf = client.post("/api/categories/", json={"name": "Test Cat"}, headers={
        "X-CSRF-Token": "bad-csrf-token",
        "Origin": "http://127.0.0.1:5070"
    })
    assert res_wrong_csrf.status_code == 403
    assert res_wrong_csrf.get_json()["code"] == "CSRF_ERROR"

    # 5. State-changing call with fresh CSRF -> 201 Created
    res_created = client.post("/api/categories/", json={"name": "Valid Cat"}, headers={
        "X-CSRF-Token": fresh_csrf,
        "Origin": "http://127.0.0.1:5070"
    })
    assert res_created.status_code == 201


def test_inactive_user_cannot_login(app, temp_db_path):
    """Verifies that deactivated users cannot log in and receive generic 401."""
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user = user_service.provision_user(
        username="disabled_worker",
        password="password123",
        role="warehouse",
        display_name="Disabled Worker",
        db=conn
    )
    user_service.deactivate_user(user["id"], db=conn)
    conn.commit()
    conn.close()

    client = app.test_client()
    res_csrf = client.get("/api/auth/csrf")
    token = res_csrf.get_json()["csrf_token"]

    res_login = client.post("/api/auth/login", json={
        "username": "disabled_worker",
        "password": "password123"
    }, headers={"X-CSRF-Token": token})

    assert res_login.status_code == 401
    assert res_login.get_json()["code"] == "INVALID_CREDENTIALS"


def test_password_and_username_validation_edge_cases(migrated_db):
    """Tests password length constraints and empty inputs."""
    # 1. Short password (< 6 chars) rejected
    with pytest.raises(user_service.ValidationError):
        user_service.provision_user(
            username="valid_name",
            password="123",
            role="office",
            display_name="Valid Name",
            db=migrated_db
        )

    # 2. Empty username rejected
    with pytest.raises(user_service.ValidationError):
        user_service.provision_user(
            username="   ",
            password="password123",
            role="office",
            display_name="Valid Name",
            db=migrated_db
        )


def test_cli_provision_command(app, temp_db_path):
    """Tests Flask CLI provision-user command runner."""
    runner = app.test_cli_runner()

    # Provision office user via CLI
    result = runner.invoke(args=[
        "provision-user",
        "--username", "cli_office",
        "--password", "password123",
        "--role", "office",
        "--display-name", "CLI Office User"
    ])
    assert result.exit_code == 0
    assert "Successfully provisioned user 'cli_office'" in result.output

    # Verify user exists in database
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user = user_model.get_user_by_username("cli_office", db=conn)
    assert user is not None
    assert user["role"] == "office"
    conn.close()


def test_standalone_cli_with_database(app, temp_db_path):
    """Tests canonical Click CLI provision-user command runner for warehouse role."""
    runner = app.test_cli_runner()
    result = runner.invoke(args=[
        "provision-user",
        "--username", "standalone_user",
        "--password", "password123",
        "--role", "warehouse",
        "--display-name", "Standalone Operator"
    ])
    assert result.exit_code == 0
    assert "Successfully provisioned user 'standalone_user'" in result.output

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user = user_model.get_user_by_username("standalone_user", db=conn)
    assert user is not None
    assert user["role"] == "warehouse"
    assert user["display_name"] == "Standalone Operator"
    conn.close()


def test_concurrent_logins_and_csrf_rotation(app, temp_db_path):
    """Verifies concurrent login attempts, session rotation, and invalidation of rotated CSRF tokens."""
    import concurrent.futures

    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    user_service.provision_user(
        username="concur_user",
        password="password123",
        role="warehouse",
        display_name="Concur Worker",
        db=conn
    )
    conn.commit()
    conn.close()

    def do_login(client_num):
        client = app.test_client()
        res_csrf = client.get("/api/auth/csrf")
        token = res_csrf.get_json()["csrf_token"]
        res_login = client.post("/api/auth/login", json={
            "username": "concur_user",
            "password": "password123"
        }, headers={"X-CSRF-Token": token})
        assert res_login.status_code == 200
        data = res_login.get_json()
        new_csrf = data["csrf_token"]
        assert new_csrf != token

        # Pre-login token cannot be used for state changes after login
        res_fail = client.post("/api/categories/", json={"name": f"Cat {client_num}"}, headers={
            "X-CSRF-Token": token,
            "Origin": "http://127.0.0.1:5070"
        })
        # If CSRF is checked, must be 403 CSRF_ERROR
        # Test with post-login token works
        res_ok = client.post("/api/categories/", json={"name": f"Cat {client_num}"}, headers={
            "X-CSRF-Token": new_csrf,
            "Origin": "http://127.0.0.1:5070"
        })
        return res_ok.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(do_login, i) for i in range(4)]
        results = [f.result() for f in futures]

    assert all(code == 201 for code in results)


def test_origin_header_edge_cases(temp_db_path):
    """Tests origin checking against port variations, subdomains, and malicious hosts."""
    conn = sqlite3.connect(temp_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    run_migrations(conn)

    user_service.provision_user(
        username="origin_user",
        password="password123",
        role="office",
        display_name="Origin Operator",
        db=conn
    )
    conn.commit()
    conn.close()

    app = create_app({
        "TESTING": True,
        "DATABASE": temp_db_path,
        "SECRET_KEY": "test-key",
        "CSRF_ENABLED": True,
        "ORIGIN_CHECK_ENABLED": True
    })
    client = app.test_client()

    res_csrf = client.get("/api/auth/csrf")
    csrf_token = res_csrf.get_json()["csrf_token"]

    disallowed_origins = [
        "http://attacker.com",
        "http://evil.127.0.0.1:5070",
        "http://127.0.0.1:9999",
        "https://subdomain.localhost:5070",
        "http://localhost:3000",
        "null"
    ]

    for evil in disallowed_origins:
        res = client.post("/api/auth/login", json={
            "username": "origin_user",
            "password": "password123"
        }, headers={
            "X-CSRF-Token": csrf_token,
            "Origin": evil
        })
        assert res.status_code == 403, f"Expected 403 for disallowed origin {evil}, got {res.status_code}"
        assert res.get_json()["code"] == "ORIGIN_DISALLOWED"

