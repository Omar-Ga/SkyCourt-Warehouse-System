import os
import sys
import logging

logger = logging.getLogger(__name__)

# --- HARDCODED CREDENTIALS ---
# These are baked into the app for seamless company-wide connection.
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "https://warehouse-db-islo.aws-eu-west-1.turso.io")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjYzMzg3MDcsImlkIjoiMzYwMmQxMGItMDYwMi00ZDc5LTkwYWEtNjVlZTkxNDhiZmI5IiwicmlkIjoiNWNjOTFkZjEtZWNkMC00YTZkLWI3MzktNjY4ZTU3MzBmN2Q3In0.h4VvTCUQV1e0PuuOyztdZkCORhphmiMJVDwJaF7lThRQ6KAHttAkmo_0MMjmhdsHH9D0bABNy4LLj-n8FK-MCw")
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
    logger.warning(" 'libsql' package not found. Cloud connection disabled.")

# Schema path (kept for reference, schema already exists on Turso)
if getattr(sys, 'frozen', False):
    bundle_root = sys._MEIPASS
    SCHEMA_PATH = os.path.join(bundle_root, 'database', 'schema.sql')
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    SCHEMA_PATH = os.path.abspath(os.path.join(script_dir, '..', 'database', 'schema.sql'))

# --- COMPANY IDENTITY & CURRENCY CONFIGURATION ---
COMPANY_NAME = os.environ.get("COMPANY_NAME", "شركة سكاي كورت للتجارة والتوزيع")
COMPANY_ADDRESS = os.environ.get("COMPANY_ADDRESS", "القاهرة، جمهورية مصر العربية")
COMPANY_PHONE = os.environ.get("COMPANY_PHONE", "+20 1068194494")
COMPANY_EMAIL = os.environ.get("COMPANY_EMAIL", "oomarolayan.gamal@gmail.com")
COMPANY_LOGO_URL = os.environ.get("COMPANY_LOGO_URL", "")

DEFAULT_CURRENCY = os.environ.get("DEFAULT_CURRENCY", "EGP")
DEFAULT_CURRENCY_SCALE = int(os.environ.get("DEFAULT_CURRENCY_SCALE", "2"))
