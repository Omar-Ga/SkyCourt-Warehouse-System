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
            if row and (row[0] == 1 or (isinstance(row, dict) and row.get("is_locked") == 1)):
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


import atexit
import subprocess
import urllib.request


def _is_server_reachable(url: str, timeout: float = 1.0) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SkyCourt-HealthCheck"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 304)
    except Exception:
        return False


if __name__ == '__main__':
    dev_mode = '--dev' in sys.argv or os.environ.get("SKYCOURT_DEV") == "1"
    vite_proc = None
    target_url = None

    if dev_mode:
        dev_url = "http://localhost:5173/"
        target_url = dev_url
        if not _is_server_reachable(dev_url):
            ui_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "UI")
            logger.info("Starting Vite development server (live HMR enabled)...")
            vite_proc = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=ui_dir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            def _cleanup_vite():
                if vite_proc and vite_proc.poll() is None:
                    vite_proc.terminate()

            atexit.register(_cleanup_vite)

    try:
        check_remote_lock()
        start_app(target_url=target_url)
    except Exception as e:
        import traceback
        log_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
        crash_file = os.path.join(log_dir, 'crash.log')
        try:
            with open(crash_file, 'w', encoding='utf-8') as f:
                f.write(traceback.format_exc())
        except Exception:
            pass
        logger.critical(f"Fatal startup error: {e}", exc_info=True)

        # On Windows, display native error popup so errors are never silent
        if sys.platform == 'win32':
            try:
                import ctypes
                error_msg = f"Fatal Startup Error:\n\n{e}\n\nA detailed report was saved to:\n{crash_file}"
                ctypes.windll.user32.MessageBoxW(0, error_msg, "SkyCourt Warehouse - Startup Error", 0x10)
            except Exception:
                pass
        raise
    finally:
        if vite_proc and vite_proc.poll() is None:
            vite_proc.terminate() 