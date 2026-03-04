import flask
import webview
from flask import g, jsonify, send_from_directory
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
from app.models.db_utils import get_sync_status, initialize_database
from app.routes.category_routes import bp as category_bp
from app.routes.destination_routes import bp as destination_bp
from app.routes.items_routes import items_bp
from app.routes.log_routes import bp as log_bp
from app.routes.provider_routes import bp as provider_bp

# Import API route blueprints
from app.routes.units_routes import bp as units_bp

# --- Configuration ---
PORT = 5070
HOST = "127.0.0.1"

# Determine the path to the UI build directory
if getattr(sys, "frozen", False):
    # Running as PyInstaller bundle
    UI_BUILD_DIR = os.path.join(sys._MEIPASS, "dist")
else:
    # Running from source
    script_dir = os.path.dirname(os.path.abspath(__file__))
    UI_BUILD_DIR = os.path.abspath(os.path.join(script_dir, "..", "UI", "dist"))

if not os.path.exists(UI_BUILD_DIR):
    logger.critical(f"UI Build Directory not found at {UI_BUILD_DIR}")
    sys.exit(1)

# --- Flask App Setup ---
app = flask.Flask(__name__, static_folder=UI_BUILD_DIR, static_url_path="/")

# Register Blueprints
app.register_blueprint(units_bp)
app.register_blueprint(items_bp)
app.register_blueprint(log_bp)

app.register_blueprint(category_bp)
app.register_blueprint(destination_bp)
app.register_blueprint(provider_bp)


# --- Global Error Handlers ---
@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad Request", "details": str(error.description)}), 400

@app.errorhandler(404)
def not_found(error):
    from flask import request
    # If the request is not for an API, serve the SPA index.html
    if not request.path.startswith('/api/'):
        return send_from_directory(app.static_folder, "index.html")
    return jsonify({"error": "Not Found", "details": str(error.description)}), 404

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({"error": "Internal Server Error", "details": "An unexpected error occurred."}), 500

@app.errorhandler(sqlite3.Error)
def handle_database_error(error):
    logger.error(f"Database Error: {error}")
    return jsonify({"error": "Database Error", "details": str(error)}), 500

@app.errorhandler(ValueError)
def handle_value_error(error):
    return jsonify({"error": str(error)}), 400

@app.errorhandler(Exception)
def handle_exception(error):
    if isinstance(error, HTTPException):
        return error 
    logger.error(f"Unhandled Exception: {error}", exc_info=True)
    return jsonify({"error": "Unexpected Server Error", "details": str(error)}), 500

# --- Global Routes ---
@app.route("/api/sync-status")
def sync_status():
    return jsonify(get_sync_status())


@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# --- SPA Catch-all Route ---
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    potential_file_path = os.path.join(app.static_folder, path)
    if (
        path != ""
        and os.path.exists(potential_file_path)
        and os.path.isfile(potential_file_path)
    ):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


# --- Lifecycle Handlers ---



def run_flask():
    app.run(host=HOST, port=PORT, use_reloader=False, debug=False)


def start_app():
    # 1. Initialize Database
    initialize_database()

    # 2. Start Flask in a background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # 3. Start the WebView Window
    target_url = f"http://{HOST}:{PORT}/"

    window = webview.create_window(
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
