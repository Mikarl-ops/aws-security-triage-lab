"""Public process and database health routes."""

from flask import Blueprint, current_app, jsonify
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db

bp = Blueprint("health", __name__, url_prefix="/api/v1/health")


@bp.get("/live")
def liveness():
    return jsonify(status="ok")


@bp.get("/ready")
def readiness():
    try:
        db.session.execute(text("SELECT 1"))
        existing = set(inspect(db.engine).get_table_names())
        required = current_app.config["REQUIRED_DATABASE_TABLES"]
        if not required.issubset(existing):
            return jsonify(status="unavailable"), 503
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify(status="unavailable"), 503
    return jsonify(status="ready")
