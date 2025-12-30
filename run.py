import sys
import os

# This is the crucial part for PyInstaller.
# It tells Python to look for modules in the current directory,
# which allows it to find the 'app' package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


from app.main import start_app
from app.config import TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_AVAILABLE

def check_remote_lock():
    """
    Checks the remote Turso database for a 'kill switch' flag.
    If is_locked is 1, the app exits silently.
    If offline or error, it proceeds (Fail-Safe).
    """
    if not LIBSQL_AVAILABLE:
        return

    try:
        # Use libsql-experimental if available, or libsql
        try:
            import libsql_experimental as libsql
        except ImportError:
            import libsql

        # Connect directly to remote using the URL found in config
        url = TURSO_DATABASE_URL
        if url.startswith("https://"):
            url = url.replace("https://", "libsql://")

        conn = libsql.connect(url, auth_token=TURSO_AUTH_TOKEN)
        cursor = conn.cursor()
        
        cursor.execute("SELECT is_locked FROM app_remote_settings WHERE id = 1")
        row = cursor.fetchone()
        conn.close()

        if row and row[0] == 1:
            # LOCKED: Silent Exit
            sys.exit(0)

    except SystemExit:
        raise
    except Exception:
        # FAIL-SAFE: If we can't check (offline, error), we ALLOW run.
        pass

if __name__ == '__main__':
    check_remote_lock()
    start_app() 