import os
import sys

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
    print("Warning: 'libsql' package not found. Cloud sync disabled.")

# Path to the database file
if getattr(sys, 'frozen', False):
    # When frozen, sys._MEIPASS is a temporary folder.
    # We want the database to persist in the same directory as the executable.
    bundle_root = sys._MEIPASS
    exe_dir = os.path.dirname(sys.executable)
    
    # Database stays outside in the exe directory to persist data
    DATABASE_NAME = os.path.join(exe_dir, 'database', 'warehouse.db')
    # Schema is read-only, so it can stay in the bundle
    SCHEMA_PATH = os.path.join(bundle_root, 'database', 'schema.sql')
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Root is one level up from app/config.py
    root_dir = os.path.abspath(os.path.join(script_dir, '..'))
    DATABASE_NAME = os.path.join(root_dir, 'database', 'warehouse.db')
    SCHEMA_PATH = os.path.join(root_dir, 'database', 'schema.sql')
