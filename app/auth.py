"""
Authentication and Authorization module for SkyCourt Warehouse System.
Provides persistent secret key generation, rate limiting, session-bound CSRF,
origin checks, and role enforcement decorators.
"""
import functools
import hmac
import logging
import os
import secrets
import threading
import time
from typing import Optional
from urllib.parse import urlparse

from flask import current_app, g, jsonify, request, session

from app.models import user_model

logger = logging.getLogger(__name__)

# Default allowed origins for local desktop / Vite development proxy
DEFAULT_ALLOWED_HOSTS = {
    '127.0.0.1:5070',
    'localhost:5070',
    '127.0.0.1:5173',
    'localhost:5173',
    '127.0.0.1',
    'localhost'
}


def get_or_create_secret_key(app_config: Optional[dict] = None) -> str:
    """
    Returns a cryptographically random persistent signing secret outside source/bundled assets.
    Order of precedence:
    1. Explicit SECRET_KEY in app config (if non-default)
    2. Environment variable SKYCOURT_SECRET_KEY or SECRET_KEY
    3. Persistent key file stored under user's config directory (~/.config/skycourt/secret.key)
    """
    if app_config and app_config.get("SECRET_KEY") and app_config.get("SECRET_KEY") != "default-secret-key":
        return app_config["SECRET_KEY"]

    env_key = os.environ.get("SKYCOURT_SECRET_KEY") or os.environ.get("SECRET_KEY")
    if env_key:
        return env_key

    config_dir = os.path.expanduser("~/.config/skycourt")
    key_file = os.path.join(config_dir, "secret.key")

    try:
        if os.path.exists(key_file):
            with open(key_file, "r", encoding="utf-8") as f:
                key = f.read().strip()
                if key:
                    return key
        
        # Create directory with restricted 0700 permissions
        os.makedirs(config_dir, mode=0o700, exist_ok=True)
        new_key = secrets.token_hex(32)
        
        # Write file with restricted 0600 permissions
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        mode = 0o600
        fd = os.open(key_file, flags, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(new_key)
        
        return new_key
    except Exception as e:
        logger.warning(f"Could not persist secret key to {key_file}: {e}. Generating ephemeral key.")
        return secrets.token_hex(32)


class LoginRateLimiter:
    """Thread-safe sliding window rate limiter for login attempts."""

    def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._attempts = {}

    def is_rate_limited(self, key: str) -> bool:
        with self._lock:
            now = time.time()
            timestamps = self._attempts.get(key, [])
            valid = [t for t in timestamps if now - t < self.window_seconds]
            self._attempts[key] = valid
            return len(valid) >= self.max_attempts

    def record_failure(self, key: str):
        with self._lock:
            now = time.time()
            timestamps = self._attempts.get(key, [])
            valid = [t for t in timestamps if now - t < self.window_seconds]
            valid.append(now)
            self._attempts[key] = valid

    def reset(self, key: str):
        with self._lock:
            self._attempts.pop(key, None)

    def clear(self):
        with self._lock:
            self._attempts.clear()


# Global limiter instance
login_rate_limiter = LoginRateLimiter(max_attempts=5, window_seconds=300)


def generate_csrf_token() -> str:
    """Generates a cryptographically random URL-safe CSRF token."""
    return secrets.token_urlsafe(32)


def check_allowed_origin(req=None) -> bool:
    """
    Validates request Origin or Referer header against permitted local hosts.
    State-changing requests from disallowed origins are rejected.
    """
    if req is None:
        req = request

    if req.method in ('GET', 'HEAD', 'OPTIONS'):
        return True

    # If ORIGIN_CHECK_ENABLED is explicitly disabled (e.g. testing)
    origin_check = current_app.config.get("ORIGIN_CHECK_ENABLED")
    if origin_check is False:
        return True
    if origin_check is None and current_app.config.get("TESTING", False):
        return True

    header_val = req.headers.get("Origin") or req.headers.get("Referer")
    if not header_val:
        # Loopback desktop webview or direct CLI calls may omit Origin
        return True

    try:
        parsed = urlparse(header_val)
        host = parsed.netloc or parsed.path
        allowed = set(DEFAULT_ALLOWED_HOSTS)
        configured_origins = current_app.config.get("ALLOWED_ORIGINS", [])
        for o in configured_origins:
            p = urlparse(o)
            allowed.add(p.netloc or o)

        return host in allowed
    except Exception as e:
        logger.warning(f"Error parsing origin header '{header_val}': {e}")
        return False


def validate_csrf_token(req=None) -> bool:
    """
    Validates that state-changing requests carry a valid CSRF token bound to the current session.
    """
    if req is None:
        req = request

    if req.method in ('GET', 'HEAD', 'OPTIONS'):
        return True

    # If CSRF is disabled in test config
    csrf_enabled = current_app.config.get("CSRF_ENABLED")
    if csrf_enabled is False:
        return True
    if csrf_enabled is None and current_app.config.get("TESTING", False):
        return True

    expected_token = session.get("csrf_token")
    if not expected_token:
        return False

    received_token = req.headers.get("X-CSRF-Token")
    if not received_token and req.form:
        received_token = req.form.get("csrf_token")

    if not received_token:
        return False

    return hmac.compare_digest(expected_token, received_token)


def require_role(*allowed_roles: str):
    """
    Decorator ensuring the authenticated user has one of the allowed roles,
    or the 'admin' role (which possesses the union of all permissions).
    """
    def decorator(f):
        @functools.wraps(f)
        def decorated_function(*args, **kwargs):
            user_id = session.get("user_id")
            session_version = session.get("session_version")

            if not user_id or session_version is None:
                return jsonify({
                    "error": "غير مصرح به. يرجى تسجيل الدخول.",
                    "code": "UNAUTHENTICATED"
                }), 401

            user = user_model.get_user_by_id(user_id)
            if not user or not user["is_active"] or user["session_version"] != session_version:
                session.clear()
                return jsonify({
                    "error": "انتهت صلاحية الجلسة أو تم تعطيل الحساب. يرجى تسجيل الدخول مجدداً.",
                    "code": "SESSION_INVALID"
                }), 401

            g.current_user = user

            user_role = user["role"]
            if user_role == "admin" or user_role in allowed_roles:
                return f(*args, **kwargs)

            return jsonify({
                "error": "غير مصرح لك بالقيام بهذه العملية.",
                "code": "FORBIDDEN"
            }), 403
        return decorated_function
    return decorator
