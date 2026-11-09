"""Flask application factory for the AWS Security Triage Lab API."""

from __future__ import annotations

import os
import secrets
from datetime import timedelta
from uuid import uuid4

from argon2 import PasswordHasher
from flask import Flask, current_app, g, request
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException

from . import models  # noqa: F401 - register models with SQLAlchemy metadata
from .api.auth import bp as auth_bp
from .api.auth import init_login_manager
from .api.common import problem
from .api.findings import bp as findings_bp
from .api.health import bp as health_bp
from .extensions import csrf, db, migrate
from .production import protect_production_proxy, validate_production
from .session_store import DatabaseSessionInterface


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL"),
        APP_ENV=os.environ.get("APP_ENV", "development"),
        APP_HOST=os.environ.get("APP_HOST"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "hide_parameters": True},
        MAX_CONTENT_LENGTH=16 * 1024,
        WTF_CSRF_ENABLED=True,
        WTF_CSRF_CHECK_DEFAULT=True,
        WTF_CSRF_HEADERS=["X-CSRFToken"],
        WTF_CSRF_TIME_LIMIT=8 * 60 * 60,
        SESSION_COOKIE_NAME="csft_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=_env_bool("SESSION_COOKIE_SECURE", False),
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/",
        SESSION_COOKIE_DOMAIN=None,
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
        SESSION_ABSOLUTE_LIFETIME=timedelta(hours=8),
        SESSION_REFRESH_EACH_REQUEST=True,
        AUTH_RATE_LIMIT_FAILURES=10,
        AUTH_RATE_LIMIT_WINDOW_SECONDS=900,
        REQUIRED_DATABASE_TABLES={
            "users",
            "findings",
            "finding_notes",
            "audit_events",
            "server_sessions",
            "auth_throttle_buckets",
        },
    )
    if test_config:
        app.config.update(test_config)

    secret_key = app.config.get("SECRET_KEY")
    if not isinstance(secret_key, str) or len(secret_key) < 32:
        raise RuntimeError(
            "Set SECRET_KEY to a randomly generated value of at least 32 characters."
        )
    if not app.config.get("SQLALCHEMY_DATABASE_URI"):
        raise RuntimeError("Set DATABASE_URL to the local PostgreSQL connection string.")
    if app.config.get("APP_ENV") == "production" and not app.config["SESSION_COOKIE_SECURE"]:
        raise RuntimeError("SESSION_COOKIE_SECURE must be enabled in production.")
    validate_production(app)

    db.init_app(app)
    migrate.init_app(app, db, compare_type=True, render_as_batch=True)
    init_login_manager(app)
    app.session_interface = DatabaseSessionInterface(app, db)
    hasher_options = {"time_cost": 1, "memory_cost": 8192, "parallelism": 1} if app.testing else {}
    app.extensions["password_hasher"] = PasswordHasher(**hasher_options)
    app.extensions["dummy_password_hash"] = app.extensions["password_hasher"].hash(
        secrets.token_urlsafe(32)
    )

    @app.before_request
    def assign_request_id():
        g.request_id = str(uuid4())

    @app.after_request
    def add_request_id_header(response):
        response.headers.setdefault("X-Request-ID", getattr(g, "request_id", str(uuid4())))
        return response

    protect_production_proxy(app)
    csrf.init_app(app)

    @app.errorhandler(CSRFError)
    def handle_csrf_error(_error):
        return problem(403, "Forbidden", "A valid CSRF token is required.")

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        status = error.code or 500
        messages = {
            400: ("Bad request", "The request could not be understood."),
            404: ("Not found", "The requested resource does not exist."),
            405: ("Method not allowed", "The requested method is not supported for this resource."),
            413: ("Request too large", "The request body exceeds the 16 KiB limit."),
            415: ("Unsupported media type", "Use application/json."),
        }
        title, detail = messages.get(
            status, ("Request failed", "The request could not be completed.")
        )
        return problem(status, title, detail)

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        if isinstance(error, HTTPException):
            return handle_http_error(error)
        # Exception messages can contain driver details or submitted values.
        current_app.logger.error(
            "Unhandled API error request_id=%s endpoint=%s error_type=%s",
            getattr(g, "request_id", "unknown"),
            request.endpoint,
            type(error).__name__,
        )
        db.session.rollback()
        return problem(500, "Internal server error", "The request could not be completed.")

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(findings_bp)

    from .cli import register_commands

    register_commands(app)
    return app
