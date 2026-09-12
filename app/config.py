import os
import sys
import logging

try:
    from dotenv import load_dotenv
    if getattr(sys, 'frozen', False):
        _exe_dir = os.path.dirname(sys.executable)
        _exe_dotenv = os.path.join(_exe_dir, '.env')
        _bundle_dotenv = os.path.join(getattr(sys, '_MEIPASS', ''), '.env')
        _internal_dotenv = os.path.join(_exe_dir, '_internal', '.env')

        if os.path.exists(_exe_dotenv):
            load_dotenv(_exe_dotenv)
        elif os.path.exists(_bundle_dotenv):
            load_dotenv(_bundle_dotenv)
        elif os.path.exists(_internal_dotenv):
            load_dotenv(_internal_dotenv)
        else:
            load_dotenv()
    else:
        # Ensure .env from project root is loaded even if run from another cwd
        _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        _dotenv_path = os.path.join(_project_root, '.env')
        if os.path.exists(_dotenv_path):
            load_dotenv(_dotenv_path)
        else:
            load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)

# --- TURSO CREDENTIALS ---
# Read from environment (.env via load_dotenv)
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
# -------------------------

# Configure SSL for Frozen App (Fix for "Invalid Peer Certificate")
if getattr(sys, 'frozen', False):
    bundle_root = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    cert_path = os.path.join(bundle_root, 'cacert.pem')
    if not os.path.exists(cert_path):
        alt_cert = os.path.join(os.path.dirname(sys.executable), '_internal', 'cacert.pem')
        if os.path.exists(alt_cert):
            cert_path = alt_cert
    if os.path.exists(cert_path):
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
