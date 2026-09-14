"""
Adversarial Verification Suite for LibSQL Connection Pooling.
Stress-tests thread safety, request context ownership, transaction rollbacks,
broken connection eviction, stale health checks, and local test isolation.
"""
import os
import queue
import sqlite3
import threading
import time
import random
import pytest
from flask import Flask, g

from app.models.db_utils import (
    LibSQLConnectionPool,
    PooledConnection,
    LibSQLConnectionWrapper,
    LibSQLRow,
    DatabaseUnavailableError,
    get_db,
    close_request_db,
    get_connection_pool,
    reset_connection_pool,
    _acquire_connection_for_context,
)
import app.models.db_utils as db_utils


class MockLibSQLDriverConn:
    """Mock connection simulating LibSQL driver socket behavior."""
    def __init__(self, conn_id: int, target: str = "libsql://mock-cloud"):
        self.conn_id = conn_id
        self.database_target = target
        self.is_authenticated = True
        self._is_broken = False
        self.row_factory = LibSQLRow
        self._in_use = False
        self._lock = threading.Lock()
        self.executed = []
        self.fail_on_execute = False
        self.fail_on_rollback = False

    def cursor(self):
        return self

    def execute(self, sql, params=()):
        with self._lock:
            if self._in_use:
                raise RuntimeError(f"CONCURRENCY VIOLATION: MockLibSQL {self.conn_id} used concurrently!")
            self._in_use = True
        try:
            if self.fail_on_execute:
                raise DatabaseUnavailableError("Simulated remote stream error")
            self.executed.append((sql, params))
            time.sleep(random.uniform(0.0005, 0.002))
            return self
        finally:
            with self._lock:
                self._in_use = False

    def fetchone(self):
        return {"ping": 1}

    def rollback(self):
        if self.fail_on_rollback:
            raise RuntimeError("Simulated rollback network error")
        self.executed.append(("ROLLBACK", ()))

    def commit(self):
        self.executed.append(("COMMIT", ()))

    def close(self):
        self.executed.append(("CLOSE", ()))


@pytest.fixture(autouse=True)
def clean_pool():
    """Ensure pool is cleanly reset before and after each test."""
    reset_connection_pool()
    yield
    reset_connection_pool()


def test_adversarial_concurrency_high_load_no_leaks(monkeypatch):
    """Stress tests pool under high thread concurrency, verifying no simultaneous socket use or count leaks."""
    created_count = 0
    create_lock = threading.Lock()

    def mock_create(target, token):
        nonlocal created_count
        with create_lock:
            created_count += 1
            return LibSQLConnectionWrapper(MockLibSQLDriverConn(created_count, target), target, True)

    monkeypatch.setattr(db_utils, "_create_raw_libsql_connection", mock_create)

    pool = LibSQLConnectionPool(max_size=4, timeout=5.0)
    violations = []
    thread_count = 20
    iterations_per_thread = 15

    def worker(worker_id):
        try:
            for _ in range(iterations_per_thread):
                conn = pool.acquire("libsql://mock-cloud", "token")
                conn.execute(f"SELECT {worker_id};")
                time.sleep(random.uniform(0.001, 0.003))
                conn.close()
        except Exception as e:
            violations.append((worker_id, e))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(thread_count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(violations) == 0, f"Encountered concurrency violations: {violations}"
    assert pool.created_count <= 4, f"Created count exceeded max_size: {pool.created_count}"
    assert pool.idle_count == pool.created_count, "Not all connections returned to idle queue"


def test_adversarial_pool_timeout_and_waiter_resumption(monkeypatch):
    """Verifies that threads timeout cleanly when pool is exhausted, and resume immediately upon release."""
    mock_conn = MockLibSQLDriverConn(1)
    monkeypatch.setattr(
        db_utils,
        "_create_raw_libsql_connection",
        lambda target, token: LibSQLConnectionWrapper(mock_conn, target, True)
    )

    pool = LibSQLConnectionPool(max_size=1, timeout=0.15)
    c1 = pool.acquire("libsql://mock-cloud", "token")

    # Second acquire must time out
    t0 = time.perf_counter()
    with pytest.raises(DatabaseUnavailableError) as exc_info:
        pool.acquire("libsql://mock-cloud", "token")
    elapsed = time.perf_counter() - t0

    assert "Timed out waiting for an available database connection" in str(exc_info.value)
    assert 0.12 <= elapsed <= 0.35

    # Release c1 and verify next acquire succeeds instantly
    c1.close()
    assert pool.idle_count == 1

    c2 = pool.acquire("libsql://mock-cloud", "token")
    assert not c2._closed
    c2.close()
    assert pool.idle_count == 1


def test_adversarial_double_close_and_barrier_race():
    """Verifies that calling close() concurrently or multiple times never releases duplicates to the pool."""
    pool = LibSQLConnectionPool(max_size=10)
    mock = MockLibSQLDriverConn(1)
    raw = LibSQLConnectionWrapper(mock, "libsql://mock-cloud", True)
    pconn = PooledConnection(pool, raw)

    barrier = threading.Barrier(5)

    def closer():
        barrier.wait()
        pconn.close()

    threads = [threading.Thread(target=closer) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert pool.idle_count == 1, f"Double close race resulted in duplicate queue entries: {pool.idle_count}"
    # Further explicit close must be a no-op
    pconn.close()
    assert pool.idle_count == 1


def test_adversarial_request_context_ownership_and_closed_invalidation(monkeypatch):
    """Verifies request-level g.db scoping, proxy differentiation, and ProgrammingError on post-teardown calls."""
    mock = MockLibSQLDriverConn(1)
    monkeypatch.setattr(
        db_utils,
        "_create_raw_libsql_connection",
        lambda target, token: LibSQLConnectionWrapper(mock, target, True)
    )

    app = Flask("ownership_test")
    app.config["DATABASE"] = "libsql://mock-cloud"
    app.teardown_appcontext(close_request_db)

    with app.test_request_context():
        db1 = get_db()
        assert g.db is db1
        assert get_db() is db1
        assert isinstance(db1, PooledConnection)
        db1.execute("SELECT 1;")

    # Context 1 torn down: db1 must be invalidated
    with pytest.raises(sqlite3.ProgrammingError) as exc_info:
        db1.execute("SELECT 2;")
    assert "closed" in str(exc_info.value).lower()

    # Context 2: Must receive a distinct proxy wrapping the same underlying connection
    with app.test_request_context():
        db2 = get_db()
        assert db2 is not db1
        assert not db2._closed
        db2.execute("SELECT 3;")

    with pytest.raises(sqlite3.ProgrammingError):
        db2.commit()


def test_adversarial_transaction_rollback_and_state_sanitization(monkeypatch):
    """Verifies uncommitted writes are rolled back, altered row_factory is reset, and dirty state does not leak."""
    # Use real in-memory SQLite with shared cache to model state persistence across connections
    shared_uri = "file:adv_test_mem?mode=memory&cache=shared"
    master = sqlite3.connect(shared_uri, uri=True, check_same_thread=False)
    master.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);")
    master.commit()

    def make_conn(target, token):
        c = sqlite3.connect(shared_uri, uri=True, check_same_thread=False)
        return LibSQLConnectionWrapper(c, target, True)

    monkeypatch.setattr(db_utils, "_create_raw_libsql_connection", make_conn)

    app = Flask("rollback_test")
    app.config["DATABASE"] = "libsql://mock-cloud"
    app.teardown_appcontext(close_request_db)

    # 1. Uncommitted write during exception
    try:
        with app.test_request_context():
            db = get_db()
            db.execute("INSERT INTO products (name) VALUES ('Aborted');")
            raise RuntimeError("Simulated crash")
    except RuntimeError:
        pass

    with app.test_request_context():
        db = get_db()
        row = db.execute("SELECT * FROM products WHERE name = 'Aborted';").fetchone()
        assert row is None, "Uncommitted write leaked past exception teardown!"

    # 2. Uncommitted write during clean exit (omitted commit)
    with app.test_request_context():
        db = get_db()
        db.execute("INSERT INTO products (name) VALUES ('CleanExitUncommitted');")

    with app.test_request_context():
        db = get_db()
        row = db.execute("SELECT * FROM products WHERE name = 'CleanExitUncommitted';").fetchone()
        assert row is None, "Uncommitted write leaked past normal request teardown!"

    # 3. Row factory mutation sanitization
    with app.test_request_context():
        db = get_db()
        db.row_factory = None  # User alters row_factory
        db.execute("INSERT INTO products (name) VALUES ('Real');")
        db.commit()

    with app.test_request_context():
        db = get_db()
        row = db.execute("SELECT * FROM products WHERE name = 'Real';").fetchone()
        assert row is not None
        assert isinstance(row, LibSQLRow) or hasattr(row, "keys"), "row_factory was not restored to LibSQLRow!"
        assert row["name"] == "Real"

    master.close()


def test_adversarial_broken_socket_and_failed_rollback_eviction():
    """Verifies that broken connections or rollback failures evict the connection and decrement created_count."""
    pool = LibSQLConnectionPool(max_size=2)
    mock = MockLibSQLDriverConn(1)
    raw = LibSQLConnectionWrapper(mock, "libsql://mock-cloud", True)
    pconn = PooledConnection(pool, raw)
    with pool._lock:
        pool._created_count = 1

    # Case 1: Connection flagged broken
    pconn._is_broken = True
    pconn.close()

    assert pool.idle_count == 0, "Broken connection was returned to idle queue!"
    assert pool.created_count == 0, "Created count was not decremented on broken socket eviction!"

    # Case 2: Rollback fails on release
    mock2 = MockLibSQLDriverConn(2)
    mock2.fail_on_rollback = True
    raw2 = LibSQLConnectionWrapper(mock2, "libsql://mock-cloud", True)
    pconn2 = PooledConnection(pool, raw2)
    with pool._lock:
        pool._created_count = 1

    pconn2.close()
    assert pool.idle_count == 0, "Connection with failed rollback was returned to idle queue!"
    assert pool.created_count == 0, "Created count was not decremented on failed rollback!"


def test_adversarial_stale_connection_ping_and_replacement(monkeypatch):
    """Verifies that connections idle longer than max_idle_seconds undergo health check (SELECT 1)."""
    mock = MockLibSQLDriverConn(1)
    raw = LibSQLConnectionWrapper(mock, "libsql://mock-cloud", True)

    pool = LibSQLConnectionPool(max_size=2, max_idle_seconds=0.01)
    pconn = PooledConnection(pool, raw)
    with pool._lock:
        pool._created_count = 1
    pconn.close()

    # Sleep beyond max_idle_seconds
    time.sleep(0.02)

    # Acquire should trigger health check SELECT 1;
    pconn2 = pool.acquire("libsql://mock-cloud", "token")
    assert any("SELECT 1;" in str(call) for call in mock.executed), "Health check ping was not executed!"
    pconn2.close()


def test_adversarial_local_sqlite_never_pooled(temp_db_path):
    """Ensures local SQLite files, temp files, and :memory: bypass pooling completely and do not contaminate pool."""
    reset_connection_pool()
    pool = get_connection_pool()
    assert pool.idle_count == 0
    assert pool.created_count == 0

    app = Flask("local_test")
    app.config["TESTING"] = True
    app.config["DATABASE"] = temp_db_path
    app.teardown_appcontext(close_request_db)

    with app.test_request_context():
        db = get_db()
        assert not isinstance(db, PooledConnection), f"Local SQLite must NOT be pooled! Got: {type(db)}"
        assert isinstance(db, sqlite3.Connection)
        db.execute("CREATE TABLE test_local (id INTEGER);")
        db.commit()

    # Pool state must remain zeroed
    assert pool.idle_count == 0
    assert pool.created_count == 0

    # Ensure another temp db has zero interference
    fd, path2 = os.path.split(temp_db_path)
    path2 = os.path.join(fd, "second_" + path2)
    try:
        app2 = Flask("local_test_2")
        app2.config["TESTING"] = True
        app2.config["DATABASE"] = path2
        app2.teardown_appcontext(close_request_db)

        with app2.test_request_context():
            db2 = get_db()
            cur = db2.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='test_local';")
            assert cur.fetchone()[0] == 0, "Test isolation violation: table leaked to second local DB!"
    finally:
        if os.path.exists(path2):
            os.unlink(path2)
