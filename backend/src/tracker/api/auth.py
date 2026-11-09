"""Session authentication, CSRF bootstrap, and role checks."""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import UTC, datetime, timedelta
from math import ceil
from uuid import UUID

from argon2.exceptions import VerificationError, VerifyMismatchError
from flask import Blueprint, current_app, jsonify, request, session
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from flask_wtf.csrf import generate_csrf
from sqlalchemy import delete, select

from ..extensions import db
from ..models import AuthThrottleBucket, User
from .common import json_object, problem

bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")
login_manager = LoginManager()
_USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")


def init_login_manager(app) -> None:
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str) -> User | None:
        try:
            parsed_id = UUID(user_id)
        except (TypeError, ValueError):
            session.clear()
            return None
        user = db.session.get(User, parsed_id)
        if user is None or not user.is_active:
            session.clear()
            return None
        return user

    @login_manager.unauthorized_handler
    def unauthorized():
        return problem(401, "Authentication required", "Sign in to access this resource.")


def _normalize_username(value: object) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def _throttle_key(username: str) -> str:
    secret = current_app.config["SECRET_KEY"].encode("utf-8")
    client = request.remote_addr or "unknown"
    message = f"{username}\0{client}".encode()
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def _verify_password(stored_hash: str, password: str) -> bool:
    hasher = current_app.extensions["password_hasher"]
    try:
        return hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def _limited_response(bucket: AuthThrottleBucket, now: datetime):
    window = current_app.config["AUTH_RATE_LIMIT_WINDOW_SECONDS"]
    started = bucket.window_started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    retry_after = max(1, ceil((started + timedelta(seconds=window) - now).total_seconds()))
    db.session.commit()
    return problem(
        429,
        "Too many login attempts",
        "Try again after the indicated delay.",
        headers={"Retry-After": str(retry_after)},
    )


@bp.get("/csrf")
def csrf_token():
    response = jsonify(csrf_token=generate_csrf())
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.post("/login")
def login():
    payload, error = json_object()
    if error:
        return error
    if set(payload) != {"username", "password"}:
        return problem(422, "Validation failed", "username and password are required.")

    username = _normalize_username(payload["username"])
    password = payload["password"]
    if (
        not _USERNAME_PATTERN.fullmatch(username)
        or not isinstance(password, str)
        or not password
        or len(password) > 128
    ):
        return problem(401, "Authentication failed", "Invalid username or password.")

    now = datetime.now(UTC)
    window = timedelta(seconds=current_app.config["AUTH_RATE_LIMIT_WINDOW_SECONDS"])
    db.session.execute(
        delete(AuthThrottleBucket).where(
            AuthThrottleBucket.window_started_at < now - timedelta(days=1)
        )
    )
    key_hash = _throttle_key(username)
    bucket = db.session.execute(
        select(AuthThrottleBucket).where(AuthThrottleBucket.key_hash == key_hash).with_for_update()
    ).scalar_one_or_none()
    if bucket is not None:
        started = bucket.window_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        if (
            now - started < window
            and bucket.failures >= current_app.config["AUTH_RATE_LIMIT_FAILURES"]
        ):
            return _limited_response(bucket, now)
        if now - started >= window:
            bucket.window_started_at = now
            bucket.failures = 0

    user = db.session.execute(select(User).where(User.username == username)).scalar_one_or_none()
    stored_hash = user.password_hash if user else current_app.extensions["dummy_password_hash"]
    verified = _verify_password(stored_hash, password)
    if user is None or not user.is_active or not verified:
        if bucket is None:
            bucket = AuthThrottleBucket(key_hash=key_hash, window_started_at=now, failures=0)
            db.session.add(bucket)
        bucket.failures += 1
        db.session.commit()
        return problem(401, "Authentication failed", "Invalid username or password.")

    hasher = current_app.extensions["password_hasher"]
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hasher.hash(password)
    if bucket is not None:
        db.session.delete(bucket)

    # Delete the pre-authentication identifier before establishing authenticated state.
    current_app.session_interface.regenerate(session)
    session.clear()
    session.permanent = True
    absolute_expiry = datetime.now(UTC) + current_app.config["SESSION_ABSOLUTE_LIFETIME"]
    session["_absolute_expires_at"] = absolute_expiry.isoformat()
    login_user(user, remember=False, fresh=True)
    db.session.commit()
    return jsonify(user={"id": str(user.id), "username": user.username, "role": user.role})


@bp.get("/session")
@login_required
def current_session():
    return jsonify(
        user={
            "id": str(current_user.id),
            "username": current_user.username,
            "role": current_user.role,
        }
    )


@bp.post("/logout")
@login_required
def logout():
    logout_user()
    session.clear()
    session.modified = True
    return "", 204
