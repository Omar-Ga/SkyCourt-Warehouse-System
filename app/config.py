import os
import sys
import logging
logger = logging.getLogger(__name__)

# --- HARDCODED CREDENTIALS ---
# These are baked into the app for seamless company-wide connection.
TURSO_DATABASE_URL = "https://warehouse-db-islo.aws-eu-west-1.turso.io"
TURSO_AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjYzMzg3MDcsImlkIjoiMzYwMmQxMGItMDYwMi00ZDc5LTkwYWEtNjVlZTkxNDhiZmI5IiwicmlkIjoiNWNjOTFkZjEtZWNkMC00YTZkLWI3MzktNjY4ZTU3MzBmN2Q3In0.h4VvTCUQV1e0PuuOyztdZkCORhphmiMJVDwJaF7lThRQ6KAHttAkmo_0MMjmhdsHH9D0bABNy4LLj-n8FK-MCw"
# -----------------------------

# Configure SSL for Frozen App (Fix for "Invalid Peer Certificate")
if getattr(sys, 'frozen', False):
    cert_path = os.path.join(sys._MEIPASS, 'cacert.pem')
    os.environ['SSL_CERT_FILE'] = cert_path
    os.environ['REQUESTS_CA_BUNDLE'] = cert_path

# Try to import libsql
try:
    import libsql
    LIBSQL_AVAILABLE = True
except ImportError:
    LIBSQL_AVAILABLE = False
    logger.warning(" 'libsql' package not found. Cloud sync disabled.")

# Path to the database file
if getattr(sys, 'frozen', False):
    # Use a persistent user directory for data storage
    if sys.platform == 'win32':
        data_dir = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'WarehouseApp')
    else:
        data_dir = os.path.join(os.path.expanduser('~'), '.local', 'share', 'WarehouseApp')
        
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)
        
    DATABASE_NAME = os.path.join(data_dir, 'warehouse.db')
    
    # Schema still lives in the bundle
    bundle_root = sys._MEIPASS
    SCHEMA_PATH = os.path.join(bundle_root, 'database', 'schema.sql')
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Walk up from app/ to project root (Warehouse-Pr)
    DATABASE_NAME = os.path.abspath(os.path.join(script_dir, '..', 'database', 'warehouse.db'))
    SCHEMA_PATH = os.path.abspath(os.path.join(script_dir, '..', 'database', 'schema.sql'))
