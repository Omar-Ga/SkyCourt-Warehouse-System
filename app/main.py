import flask
from flask import g
from flask_cors import CORS
import webview
import threading
import os
import sys
from flask import send_from_directory
from datetime import datetime, timedelta
from pathlib import Path

# Import model utilities first to ensure DB can be initialized
from app.models.db_utils import initialize_database, create_timestamped_backup, get_sync_status

# Import API route blueprints
from app.routes.units_routes import bp as units_bp
from app.routes.items_routes import items_bp
from app.routes.log_routes import bp as log_bp
from app.routes.backup_routes import bp as backup_bp
from app.routes.category_routes import bp as category_bp
from app.routes.destination_routes import bp as destination_bp
from app.routes.provider_routes import bp as provider_bp


VITE_DEV_SERVER_URL = 'http://localhost:5173/'
PRODUCTION_FLASK_URL = 'http://127.0.0.1:5070/'

# --- Application Mode Configuration ---
# Set this to False for production builds
USE_VITE_DEV_SERVER = False
# --- SPA Configuration ---
if getattr(sys, 'frozen', False):
    UI_BUILD_DIR = os.path.join(sys._MEIPASS, 'dist')
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    UI_BUILD_DIR = os.path.abspath(os.path.join(script_dir, '..', 'UI', 'dist'))

if not USE_VITE_DEV_SERVER and not os.path.exists(UI_BUILD_DIR):
    print(f"CRITICAL ERROR: UI Build Directory not found at {UI_BUILD_DIR}")
    sys.exit(1)

app = flask.Flask(__name__, static_folder=UI_BUILD_DIR, static_url_path='/')

if USE_VITE_DEV_SERVER:
    CORS(app, resources={r"/api/*": {"origins": VITE_DEV_SERVER_URL.strip('/')}})


app.register_blueprint(units_bp)
app.register_blueprint(items_bp)
app.register_blueprint(log_bp)
app.register_blueprint(backup_bp)
app.register_blueprint(category_bp)
app.register_blueprint(destination_bp)
app.register_blueprint(provider_bp)

@app.route('/api/sync-status')
def sync_status():
    from flask import jsonify
    return jsonify(get_sync_status())

# --- Database Connection Management ---
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
    else:
        return send_from_directory(app.static_folder, 'index.html')

# --- Application Runner ---
def run_flask():
    app.run(host='127.0.0.1', port=5070, use_reloader=False, debug=False)

def on_closing():
    print("Window is closing, creating automatic backup...")
    success, message = create_timestamped_backup()
    if success:
        print(f"Automatic backup created successfully: {message}")
    else:
        print(f"Error creating automatic backup: {message}")

def start_webview():
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    target_url = VITE_DEV_SERVER_URL if USE_VITE_DEV_SERVER else PRODUCTION_FLASK_URL
    print(f"PyWebview will load URL: {target_url}")

    window = webview.create_window(
        'Warehouse Management System (نظام إدارة المستودعات)',
        target_url,
        width=1024,
        height=768,
        resizable=True,
        text_select=True
    )
    window.events.closing += on_closing
    
    
    webview.start(debug=False)

def backup_handler():
    app_data_dir = Path(os.getenv('APPDATA')) / 'WarehouseApp'
    activation_file = app_data_dir / 'backup_handler.dat'
    app_data_dir.mkdir(parents=True, exist_ok=True)

    if not activation_file.is_file():
        with open(activation_file, 'w') as f:
            f.write(datetime.now().isoformat())
        return

    with open(activation_file, 'r') as f:
        try:
            start_date = datetime.fromisoformat(f.read())
            if datetime.now() > start_date + timedelta(days=30):
                sys.exit(1)
        except (ValueError, TypeError):
            with open(activation_file, 'w') as f_reset:
                f_reset.write(datetime.now().isoformat())

def main():
    backup_handler()
    print("Starting Warehouse Management Program...")
    
    if not USE_VITE_DEV_SERVER:
        print(f"Expecting UI build files in: {UI_BUILD_DIR}")
        if not os.path.isfile(os.path.join(UI_BUILD_DIR, "index.html")):
            print(f"CRITICAL: UI build not found in '{UI_BUILD_DIR}'.")
            sys.exit(1)
        else:
            print(f"Found UI build files at '{UI_BUILD_DIR}'.")

    print("Initializing database before starting Flask...")
    initialize_database()

    start_webview()

if __name__ == '__main__':
    main() 