"""
Authentication routes for SkyCourt Warehouse System.
Provides CSRF bootstrap, login, me, and logout endpoints.
"""
import logging
from flask import Blueprint, request, jsonify, session

from app.models import user_model
from app.services.user_service import verify_password
from app.auth import (
    generate_csrf_token,
    validate_csrf_token,
    check_allowed_origin,
    login_rate_limiter
)
from app.validation import validate_dict, validate_required_fields, ValidationError

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth_bp", __name__, url_prefix="/api/auth")


@auth_bp.route("/csrf", methods=["GET"], strict_slashes=False)
def get_csrf_token():
    """
    Returns a session-bound pre-login or active CSRF token.
    Ensures session cookie is established.
    """
    if "csrf_token" not in session:
        session["csrf_token"] = generate_csrf_token()
    return jsonify({"csrf_token": session["csrf_token"]}), 200


@auth_bp.route("/login", methods=["POST"], strict_slashes=False)
def login():
    """
    Authenticates a user via username and password.
    Validates CSRF token and allowed origin, rate limits repeated failures,
    rotates session state, and returns public user profile and fresh CSRF token.
    """
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

    data = request.get_json(silent=True)
    try:
        validate_dict(data)
        validate_required_fields(data, ["username", "password"])
    except ValidationError as e:
        return jsonify(e.to_dict()), 400

    username = str(data["username"]).strip()
    password = str(data["password"])
    ip = request.remote_addr or "127.0.0.1"
    ip_key = f"ip:{ip}"
    user_key = f"user:{username.lower()}"

    # Rate limit check for repeated failed login attempts
    if login_rate_limiter.is_rate_limited(ip_key) or login_rate_limiter.is_rate_limited(user_key) or login_rate_limiter.is_rate_limited(ip):
        logger.warning("Rate limit exceeded for login attempts from IP '%s', username '%s'", ip, username)
        return jsonify({
            "error": "عدد محاولات تسجيل الدخول غير صحيحة تجاوز الحد المسموح به. يرجى المحاولة لاحقاً.",
            "code": "RATE_LIMITED"
        }), 429

    # Look up user
    user = user_model.get_user_by_username(username)
    if not user or not user["is_active"] or not verify_password(user["password_hash"], password):
        login_rate_limiter.record_failure(ip_key)
        login_rate_limiter.record_failure(ip)
        login_rate_limiter.record_failure(user_key)
        logger.warning("Failed login attempt for username '%s' from IP '%s'", username, ip)
        return jsonify({
            "error": "اسم المستخدم أو كلمة المرور غير صحيحة.",
            "code": "INVALID_CREDENTIALS"
        }), 401

    # Login successful: reset rate limiter for this user
    login_rate_limiter.reset(user_key)

    # Clear prior session state to prevent session fixation, rotate CSRF
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["session_version"] = user["session_version"]
    fresh_csrf = generate_csrf_token()
    session["csrf_token"] = fresh_csrf

    logger.info("User '%s' (ID: %d, Role: '%s') logged in successfully.", user["username"], user["id"], user["role"])
    return jsonify({
        "user": user_model.to_public_user(user),
        "csrf_token": fresh_csrf
    }), 200


@auth_bp.route("/me", methods=["GET"], strict_slashes=False)
def get_current_user():
    """
    Returns the authenticated public user profile.
    Returns 401 if unauthenticated, session expired, deactivated, or version mismatched.
    """
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
            "error": "انتهت صلاحية الجلسة أو تم تعطيل الحساب.",
            "code": "SESSION_INVALID"
        }), 401

    return jsonify({"user": user_model.to_public_user(user)}), 200


@auth_bp.route("/logout", methods=["POST"], strict_slashes=False)
def logout():
    """
    Clears session state and returns 204 No Content.
    """
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

    session.clear()
    return "", 204
