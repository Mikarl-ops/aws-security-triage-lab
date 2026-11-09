"""Fail-closed settings for the reviewed ALB -> frontend -> loopback API path."""

from __future__ import annotations

import re
from pathlib import Path

from flask import Flask, request
from sqlalchemy.engine import make_url
from werkzeug.middleware.proxy_fix import ProxyFix

from .api.common import problem

HOSTNAME = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
)
HEALTH_PATHS = {"/api/v1/health/live", "/api/v1/health/ready"}


def validate_production(app: Flask) -> None:
    if app.config["APP_ENV"] != "production":
        return
    host = app.config.get("APP_HOST")
    if not isinstance(host, str) or len(host) > 253 or not HOSTNAME.fullmatch(host):
        raise RuntimeError("Set APP_HOST to the reviewed lowercase hostname without a port.")
    if host == "127.0.0.1":
        raise RuntimeError("APP_HOST must not use the reserved loopback health hostname.")

    try:
        url = make_url(app.config["SQLALCHEMY_DATABASE_URI"])
    except Exception:
        raise RuntimeError("Production DATABASE_URL must be a valid PostgreSQL URL.") from None
    ca_path = url.query.get("sslrootcert")
    if (
        url.drivername != "postgresql+psycopg"
        or url.query.get("sslmode") != "verify-full"
        or not isinstance(ca_path, str)
        or not Path(ca_path).is_absolute()
        or not Path(ca_path).is_file()
    ):
        raise RuntimeError(
            "Production DATABASE_URL requires postgresql+psycopg, sslmode=verify-full, "
            "and an existing absolute sslrootcert path."
        )
    app.config["TRUSTED_HOSTS"] = [host, "127.0.0.1"]


def protect_production_proxy(app: Flask) -> None:
    if app.config["APP_ENV"] != "production":
        return
    # ALB appends the client IP; the frontend appends the ALB IP and sets HTTPS explicitly.
    # Gunicorn binds loopback. Host, port, and prefix forwarding are deliberately not trusted.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=2, x_proto=1, x_host=0, x_port=0, x_prefix=0)

    @app.before_request
    def require_reviewed_proxy_path():
        original = request.environ.get("werkzeug.proxy_fix.orig", {})
        peer = original.get("REMOTE_ADDR", request.remote_addr)
        if peer not in {"127.0.0.1", "::1"}:
            return problem(403, "Forbidden", "The API requires its local reverse proxy.")
        if request.path in HEALTH_PATHS:
            return None
        if request.host.split(":", 1)[0] != app.config["APP_HOST"] or not request.is_secure:
            return problem(400, "Bad request", "Use the reviewed HTTPS application origin.")
        if not request.headers.get("X-Forwarded-For") or len(
            request.headers["X-Forwarded-For"].split(",")
        ) < 2:
            return problem(400, "Bad request", "The reviewed proxy chain is required.")
        return None
