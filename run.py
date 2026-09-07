import sys
import os

# This is the crucial part for PyInstaller.
# It tells Python to look for modules in the current directory,
# which allows it to find the 'app' package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


import concurrent.futures
import logging

logger = logging.getLogger(__name__)

from app.main import start_app
from app.config import TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_AVAILABLE

def _query_remote_lock() -> bool:
    """Queries remote Turso database for is_locked flag. Returns True if locked."""
    if not LIBSQL_AVAILABLE or not TURSO_DATABASE_URL:
        return False

    try:
        try:
            import libsql_experimental as libsql
        except ImportError:
            import libsql

        url = TURSO_DATABASE_URL
        if url.startswith("https://"):
            url = url.replace("https://", "libsql://")

        conn = libsql.connect(url, auth_token=TURSO_AUTH_TOKEN)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT is_locked FROM app_remote_settings WHERE id = 1")
            row = cursor.fetchone()
            if row and (row[0] == 1 or (hasattr(row, "__getitem__") and row.get("is_locked") == 1)):
                return True
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"Remote lock check query failed (non-fatal): {e}")
    return False


def check_remote_lock(timeout: float = 3.0):
    """
    Checks the remote Turso database for a 'kill switch' flag within a timeout window.
    If is_locked is 1, the app exits silently (sys.exit(0)).
    If timeout, offline, or error, it proceeds (Fail-Safe).
    """
    if not LIBSQL_AVAILABLE or not TURSO_DATABASE_URL:
        return

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_query_remote_lock)
            is_locked = future.result(timeout=timeout)
            if is_locked:
                sys.exit(0)
    except SystemExit:
        raise
    except Exception as e:
        # FAIL-SAFE: If we can't check (offline, error, timeout), we ALLOW run.
        logger.info(f"Remote lock check bypassed (fail-safe active): {e}")


if __name__ == '__main__':
    check_remote_lock()
    start_app() 