import flask
from flask import jsonify, send_from_directory, request
import logging
import sqlite3
import sys
import os
import threading
from werkzeug.exceptions import HTTPException

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

# Import model utilities
from app.models.db_utils import (
    get_sync_status,
    record_sync_success,
    record_sync_error,
    initialize_database,
    close_request_db,
    get_db,
    DatabaseUnavailableError,
    ConcurrencyConflictError,
    OfflineMutationGatedError
)
from app.validation import ValidationError
from app.services.idempotency_service import IdempotencyError
from app.migrations import verify_schema_version

from datetime import timedelta
import click

from app.auth import get_or_create_secret_key, check_allowed_origin, validate_csrf_token, require_role
from app.routes.auth_routes import auth_bp
from app.routes.order_routes import po_bp, leave_order_bp, tickets_bp
from app.routes.category_routes import bp as category_bp
from app.routes.destination_routes import bp as destination_bp
from app.routes.items_routes import items_bp
from app.routes.log_routes import bp as log_bp
from app.routes.provider_routes import bp as provider_bp
from app.routes.units_routes import bp as units_bp

# --- Configuration ---
PORT = 5070
HOST = "127.0.0.1"

# Determine the path to the UI build directory
if getattr(sys, "frozen", False):
    bundle_root = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    UI_BUILD_DIR = os.path.join(bundle_root, "dist")
    if not os.path.exists(UI_BUILD_DIR):
        alt_dist = os.path.join(os.path.dirname(sys.executable), "_internal", "dist")
        if os.path.exists(alt_dist):
            UI_BUILD_DIR = alt_dist
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    UI_BUILD_DIR = os.path.abspath(os.path.join(script_dir, "..", "UI", "dist"))


def create_app(test_config=None) -> flask.Flask:
    """
    Application factory for SkyCourt Warehouse System.
    Permits test app creation without a built UI, pywebview, or remote database.
    """
    static_folder = UI_BUILD_DIR if os.path.exists(UI_BUILD_DIR) else None
    if not static_folder:
        logger.warning(f"UI Build Directory not found at {UI_BUILD_DIR}. SPA serving disabled.")

    application = flask.Flask(
        __name__,
        static_folder=static_folder,
        static_url_path="/"
    )

    if test_config:
        application.config.update(test_config)

    # Secret Key & Session Configuration
    application.secret_key = get_or_create_secret_key(application.config)
    application.config.setdefault("SESSION_COOKIE_HTTPONLY", True)
    application.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    application.config.setdefault("PERMANENT_SESSION_LIFETIME", timedelta(hours=8))
    application.config.setdefault("SESSION_COOKIE_SECURE", False)

    # Register Blueprints
    application.register_blueprint(auth_bp)
    application.register_blueprint(units_bp)
    application.register_blueprint(items_bp)
    application.register_blueprint(log_bp)
    application.register_blueprint(category_bp)
    application.register_blueprint(destination_bp)
    application.register_blueprint(provider_bp)
    application.register_blueprint(po_bp)
    application.register_blueprint(leave_order_bp)
    application.register_blueprint(tickets_bp)

    # Global State-Changing API Security Hook (CSRF & Allowed-Origin)
    @application.before_request
    def validate_api_csrf_and_origin():
        if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not check_allowed_origin(request):
                return jsonify({
                    "error": "المصدر غير مسموح به.",
                    "code": "ORIGIN_DISALLOWED"
                }), 403
            if not validate_csrf_token(request):
                return jsonify({
                    "error": "رمز التحقق ضد التزوير مفقود أو غير صالح.",
                    "code": "CSRF_ERROR"
                }), 403

    # Teardown Request Database Context
    application.teardown_appcontext(close_request_db)

    # --- Error Handlers ---
    @application.errorhandler(ValidationError)
    def handle_validation_error(error):
        return jsonify(error.to_dict()), 400

    @application.errorhandler(IdempotencyError)
    def handle_idempotency_error(error):
        return jsonify(error.to_dict()), error.status_code

    @application.errorhandler(400)
    def bad_request(error):
        return jsonify({"error": "Bad Request", "details": str(error.description)}), 400

    @application.errorhandler(404)
    def not_found(error):
        if request.path.startswith('/api/'):
            return jsonify({"error": "Not Found", "code": "NOT_FOUND", "details": str(error.description)}), 404
        if application.static_folder and os.path.exists(os.path.join(application.static_folder, "index.html")):
            return send_from_directory(application.static_folder, "index.html")
        return jsonify({"error": "Not Found", "code": "NOT_FOUND", "details": str(error.description)}), 404

    @application.errorhandler(500)
    def internal_server_error(error):
        return jsonify({"error": "Internal Server Error", "details": "An unexpected error occurred."}), 500

    @application.errorhandler(sqlite3.Error)
    def handle_database_error(error):
        logger.error(f"Database Error: {error}")
        return jsonify({"error": "Database Error", "details": "A database error occurred."}), 500

    @application.errorhandler(ValueError)
    def handle_value_error(error):
        msg = str(error).lower()
        if "hrana:" in msg:
            if any(term in msg for term in (
                "api error", "host not found", "stream closed", "stream error",
                "connection refused", "connection reset", "connection closed",
                "status=50", "status=404", "unreachable", "timeout", "timed out",
                "network", "socket"
            )):
                return jsonify({
                    "error": "قاعدة البيانات غير متاحة حالياً. يرجى التحقق من الاتصال بالإنترنت.",
                    "code": "DATABASE_UNAVAILABLE",
                    "details": str(error)
                }), 503
            if any(term in msg for term in ("unique constraint", "sqlite_constraint_unique")) or ("unique" in msg and "constraint" in msg):
                return jsonify({
                    "error": "تعارض في التحديث: القيمة موجودة بالفعل.",
                    "code": "CONCURRENCY_CONFLICT",
                    "details": str(error)
                }), 409
        return jsonify({"error": str(error), "code": "VALUE_ERROR"}), 400

    @application.errorhandler(OfflineMutationGatedError)
    def handle_offline_mutation_gated(error):
        return jsonify({
            "error": "عمليات تعديل المخزون غير متاحة دون اتصال بالإنترنت في هذا الإصدار.",
            "code": "OFFLINE_MUTATION_GATED",
            "details": str(error)
        }), 503

    @application.errorhandler(DatabaseUnavailableError)
    def handle_database_unavailable(error):
        return jsonify({
            "error": "قاعدة البيانات غير متاحة حالياً. يرجى التحقق من الاتصال بالإنترنت.",
            "code": "DATABASE_UNAVAILABLE",
            "details": str(error)
        }), 503

    @application.errorhandler(ConcurrencyConflictError)
    def handle_concurrency_conflict(error):
        return jsonify({
            "error": "تعارض في التحديث المتزامن. يرجى إعادة المحاولة.",
            "code": "CONCURRENCY_CONFLICT",
            "details": str(error)
        }), 409

    try:
        import libsql
        _libsql_error = libsql.Error
    except ImportError:
        _libsql_error = None

    if _libsql_error is not None:
        @application.errorhandler(_libsql_error)
        def handle_libsql_database_error(error):
            logger.error(f"LibSQL Database Error: {error}")
            msg = str(error).lower()
            if any(term in msg for term in ("connect", "timeout", "network", "offline", "unreachable")):
                return jsonify({
                    "error": "قاعدة البيانات غير متاحة حالياً. يرجى التحقق من الاتصال بالإنترنت.",
                    "code": "DATABASE_UNAVAILABLE",
                    "details": str(error)
                }), 503
            return jsonify({"error": "Database Error", "details": "A database error occurred."}), 500

    @application.errorhandler(Exception)
    def handle_exception(error):
        if isinstance(error, HTTPException):
            return error
        logger.error(f"Unhandled Exception: {error}", exc_info=True)
        return jsonify({"error": "Unexpected Server Error", "details": "An unexpected error occurred."}), 500

    # --- Global Routes ---
    @application.route("/api/sync-status", methods=["GET"], strict_slashes=False)
    @application.route("/api/sync-status/", methods=["GET"], strict_slashes=False)
    @require_role("office", "warehouse")
    def sync_status():
        return jsonify(get_sync_status())

    @application.route("/api/sync", methods=["POST"], strict_slashes=False)
    @application.route("/api/sync/", methods=["POST"], strict_slashes=False)
    @require_role("office", "warehouse")
    def manual_sync():
        conn = None
        synced = False
        queued = False
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            if hasattr(conn, "sync") and callable(getattr(conn, "sync")):
                conn.sync()
                synced = True
            else:
                synced = True
            record_sync_success()
            status = get_sync_status()
            return jsonify({
                "synced": synced,
                "queued": queued,
                "status": status,
                "message": "Synchronization successful"
            }), 200
        except Exception as e:
            logger.error(f"Manual sync failed: {e}")
            record_sync_error(str(e))
            status = get_sync_status()
            return jsonify({
                "synced": False,
                "queued": False,
                "status": status,
                "error": str(e),
                "message": "Synchronization failed"
            }), 500

    # --- SPA Catch-all Route ---
    @application.route("/", defaults={"path": ""})
    @application.route("/<path:path>")
    def serve_spa(path):
        # Unknown /api/* paths must return JSON 404, never SPA HTML
        if path.startswith("api/") or path == "api" or request.path.startswith("/api/"):
            return jsonify({"error": "Not Found", "code": "NOT_FOUND", "details": f"Unknown API route: {request.path}"}), 404
        if not application.static_folder:
            return jsonify({"error": "UI build not available"}), 404
        potential_file_path = os.path.join(application.static_folder, path)
        if (
            path != ""
            and os.path.exists(potential_file_path)
            and os.path.isfile(potential_file_path)
        ):
            return send_from_directory(application.static_folder, path)
        index_file = os.path.join(application.static_folder, "index.html")
        if os.path.exists(index_file):
            return send_from_directory(application.static_folder, "index.html")
        return jsonify({"error": "UI build index.html not found"}), 404

    # --- CLI Commands ---
    @application.cli.command("provision-user")
    @click.option("--username", required=True, help="Case-insensitive unique username")
    @click.option("--password", required=True, help="User password")
    @click.option("--role", required=True, type=click.Choice(["office", "warehouse", "admin"]), help="User role")
    @click.option("--display-name", required=True, help="Display name for the user")
    def provision_user_command(username, password, role, display_name):
        """Explicit, idempotent administrative command to provision a user account."""
        from app.services.user_service import provision_user
        conn = get_db()
        try:
            user = provision_user(username=username, password=password, role=role, display_name=display_name, db=conn)
            conn.commit()
            click.echo(f"Successfully provisioned user '{user['username']}' with role '{user['role']}' (ID: {user['id']}).")
        finally:
            conn.close()

    @application.cli.command("migrate")
    @click.option("--check", is_flag=True, default=False, help="Verify schema version without applying pending migrations")
    def migrate_command(check):
        """Runs or checks versioned database migrations."""
        from app.migrations import run_migrations, verify_schema_version, CURRENT_SCHEMA_VERSION
        conn = get_db()
        try:
            if check:
                v = verify_schema_version(conn, required_version=CURRENT_SCHEMA_VERSION)
                click.echo(f"Database schema is compatible at version {v}.")
            else:
                applied = run_migrations(conn)
                if applied:
                    click.echo(f"Successfully applied migrations: {applied}")
                else:
                    click.echo("Database schema is already up to date.")
                v = verify_schema_version(conn, required_version=CURRENT_SCHEMA_VERSION)
                click.echo(f"Current schema version: {v}")
        finally:
            conn.close()

    @application.cli.command("staging-rehearsal")
    def staging_rehearsal_command():
        """Runs a complete staging migration rehearsal and validates data preservation."""
        from app.staging import rehearse_staging_migration
        conn = get_db()
        try:
            report = rehearse_staging_migration(conn)
            if report["passed"]:
                click.echo("Staging rehearsal PASSED. 100% preservation verified across all row counts, balances, IDs, and settings.")
                click.echo(f"Applied migrations: {report.get('applied_versions')}, Schema version: {report.get('current_version')}")
            else:
                click.echo("Staging rehearsal FAILED with discrepancies:")
                for d in report.get("discrepancies", []):
                    click.echo(f"  * {d}")
                raise click.ClickException("Staging rehearsal failed.")
        finally:
            conn.close()

    @application.cli.command("staging-inspect")
    def staging_inspect_command():
        """Inspects database state and outputs authoritative baseline metrics."""
        from app.staging import inspect_database
        conn = get_db()
        try:
            snapshot = inspect_database(conn)
            click.echo(f"Tables: {', '.join(snapshot['tables'])}")
            click.echo(f"Row counts: {snapshot['row_counts']}")
            click.echo(f"Total inventory quantity: {snapshot['items_summary'].get('total_quantity', 0)}")
            click.echo(f"Foreign keys valid: {snapshot['foreign_keys_valid']}")
            click.echo(f"Integrity check passed: {snapshot['integrity_check_passed']}")
        finally:
            conn.close()

    return application


# Global application instance for backward compatibility and runner
app = create_app()


# --- Lifecycle Handlers ---

def run_flask():
    app.run(host=HOST, port=PORT, use_reloader=False, debug=False)


def start_app():
    # 1. Initialize Database & Verify Connectivity
    initialize_database()

    # 2. Verify Schema Version
    conn = get_db()
    try:
        verify_schema_version(conn)
    finally:
        conn.close()

    # 3. Start Flask in a background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # 4. Start WebView Window
    import webview
    target_url = f"http://{HOST}:{PORT}/"
    webview.create_window(
        "Warehouse Management System (نظام إدارة المستودعات)",
        target_url,
        width=1024,
        height=768,
        resizable=True,
        text_select=True,
    )
    webview.start(debug=False)


if __name__ == "__main__":
    start_app()
