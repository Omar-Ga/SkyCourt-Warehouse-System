import threading
import time
from ..config import DATABASE_NAME, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_AVAILABLE

# Global sync status
SYNC_STATUS = {"connected": False, "last_check": 0, "mode": "local"}

def get_latest_sync_status():
    """Returns the latest known sync status."""
    return SYNC_STATUS

def _perform_sync():
    """
    Core sync logic. attempts to sync and updates global status.
    Blocking function, should be run in a thread.
    """
    global SYNC_STATUS
    try:
        if LIBSQL_AVAILABLE and TURSO_DATABASE_URL and TURSO_AUTH_TOKEN:
            import libsql
            conn = libsql.connect(
                DATABASE_NAME, 
                sync_url=TURSO_DATABASE_URL, 
                auth_token=TURSO_AUTH_TOKEN
            )
            conn.sync()
            conn.close()
            SYNC_STATUS["connected"] = True
            SYNC_STATUS["mode"] = "cloud"
            SYNC_STATUS["last_check"] = time.time()
        else:
            # If config is missing, we are effectively local-only, but "connected" is false regarding cloud
            SYNC_STATUS["connected"] = False
            SYNC_STATUS["mode"] = "local"
    except Exception:
        # Failure means we are offline regarding the cloud
        SYNC_STATUS["connected"] = False
        SYNC_STATUS["mode"] = "cloud" if (TURSO_DATABASE_URL and TURSO_AUTH_TOKEN) else "local"

def run_background_sync():
    """
    Spawns a one-off background thread to perform the database sync.
    Triggered after writes.
    """
    # Use daemon=True so the thread doesn't prevent the app from shutting down
    thread = threading.Thread(target=_perform_sync, daemon=True)
    thread.start()

def start_periodic_sync(interval=20):
    """
    Starts a background thread that runs the sync periodically.
    Acts as a connectivity heartbeat.
    """
    def _loop():
        while True:
            _perform_sync()
            time.sleep(interval)
            
    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
