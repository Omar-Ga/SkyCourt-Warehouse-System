import flask
from flask import g, send_from_directory, jsonify
import webview
import threading
import os
import sys

# Import model utilities
from app.models.db_utils import initialize_database, get_sync_status

# Import API route blueprints
from app.routes.units_routes import bp as units_bp
from app.routes.items_routes import items_bp
from app.routes.log_routes import bp as log_bp

from app.routes.category_routes import bp as category_bp
from app.routes.destination_routes import bp as destination_bp
from app.routes.provider_routes import bp as provider_bp

# --- Configuration ---
PORT = 5070
HOST = '127.0.0.1'

# Determine the path to the UI build directory
if getattr(sys, 'frozen', False):
    # Running as PyInstaller bundle
    UI_BUILD_DIR = os.path.join(sys._MEIPASS, 'dist')
else:
    # Running from source
    script_dir = os.path.dirname(os.path.abspath(__file__))
    UI_BUILD_DIR = os.path.abspath(os.path.join(script_dir, '..', 'UI', 'dist'))

if not os.path.exists(UI_BUILD_DIR):
    print(f"CRITICAL ERROR: UI Build Directory not found at {UI_BUILD_DIR}")
    sys.exit(1)

# --- Flask App Setup ---
app = flask.Flask(__name__, static_folder=UI_BUILD_DIR, static_url_path='/')

# Register Blueprints
app.register_blueprint(units_bp)
app.register_blueprint(items_bp)
app.register_blueprint(log_bp)

app.register_blueprint(category_bp)
app.register_blueprint(destination_bp)
app.register_blueprint(provider_bp)

# --- Global Routes ---
@app.route('/api/sync-status')
def sync_status():
    return jsonify(get_sync_status())

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# --- SPA Catch-all Route ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    potential_file_path = os.path.join(app.static_folder, path)
    if path != "" and os.path.exists(potential_file_path) and os.path.isfile(potential_file_path):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

# --- Lifecycle Handlers ---
def on_closing():
    """Triggered when the window is closing."""
    print("Window is closing...")

def run_flask():
    app.run(host=HOST, port=PORT, use_reloader=False, debug=False)

def start_app():
    # 1. Initialize Database
    print("Initializing database...")
    initialize_database()

    # 2. Start Flask in a background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # 3. Start the WebView Window
    target_url = f"http://{HOST}:{PORT}/"
    print(f"Loading UI from: {target_url}")

    window = webview.create_window(
        'Warehouse Management System (نظام إدارة المستودعات)',
        target_url,
        width=1024,
        height=768,
        resizable=True,
        text_select=True
    )
    window.events.closing += on_closing
    
    webview.start(debug=True)

if __name__ == '__main__':
    start_app()