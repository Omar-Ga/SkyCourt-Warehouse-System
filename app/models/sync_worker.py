import threading
from ..config import DATABASE_NAME, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_AVAILABLE

def run_background_sync():
    """
    Spawns a background thread to perform the database sync.
    This function returns immediately to the caller, preventing UI blocking.
    """
    def _sync_task():
        # A fresh connection and import is required as LibSQL objects might not be thread-safe across boundaries
        # or we just want a clean slate.
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
                # print("Background sync finished successfully.") # Optional: toggle for debugging
        except Exception:
            # Failure is silent in background mode to avoid user disruption; 
            # sync will retry on next trigger anyway.
            pass

    # Use daemon=True so the thread doesn't prevent the app from shutting down
    thread = threading.Thread(target=_sync_task, daemon=True)
    thread.start()
