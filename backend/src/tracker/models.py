"""Relational schema for users, findings, investigation, and server sessions."""

from datetime import UTC, datetime
from uuid import uuid4

from flask_login import UserMixin
from sqlalchemy import (
    JSON,
    CheckConstraint,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB

from .extensions import db

JSON_OBJECT = JSON().with_variant(JSONB(), "postgresql")


def utc_now() -> datetime:
    return datetime.now(UTC)


class User(UserMixin, db.Model):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('analyst', 'viewer')", name="valid_role"),)

    id = db.Column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    username = db.Column(String(64), nullable=False, unique=True)
    password_hash = db.Column(String(255), nullable=False)
    role = db.Column(String(16), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default="true")
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=db.func.now()
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=db.func.now(),
    )

    notes = db.relationship("FindingNote", back_populates="author")
    audit_events = db.relationship("AuditEvent", back_populates="actor")

    def get_id(self) -> str:
        return str(self.id)


class Finding(db.Model):
    __tablename__ = "findings"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('critical', 'high', 'medium', 'low', 'informational')",
            name="valid_severity",
        ),
        CheckConstraint(
            "status IN ('new', 'investigating', 'resolved', 'dismissed')", name="valid_status"
        ),
        CheckConstraint("version > 0", name="positive_version"),
        UniqueConstraint("source", "source_event_id", name="uq_findings_source_event"),
        Index(
            "ix_findings_status_severity_observed_id",
            "status",
            "severity",
            "observed_at",
            "id",
        ),
    )

    id = db.Column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source = db.Column(String(64), nullable=False)
    source_event_id = db.Column(String(255), nullable=True)
    title = db.Column(String(200), nullable=False)
    description = db.Column(String(4000), nullable=False)
    evidence_summary = db.Column(String(4000), nullable=False)
    metadata_json = db.Column(
        "metadata", JSON_OBJECT, nullable=False, default=dict, server_default="{}"
    )
    severity = db.Column(String(16), nullable=False)
    status = db.Column(String(16), nullable=False, default="new", server_default="new")
    observed_at = db.Column(db.DateTime(timezone=True), nullable=False)
    resolution_reason = db.Column(String(1000), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=db.func.now()
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=db.func.now(),
    )
    updated_by = db.Column(
        Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    version = db.Column(db.Integer, nullable=False, default=1, server_default="1")

    notes = db.relationship(
        "FindingNote", back_populates="finding", order_by="FindingNote.created_at"
    )
    audit_events = db.relationship(
        "AuditEvent", back_populates="finding", order_by="AuditEvent.occurred_at"
    )


class FindingNote(db.Model):
    __tablename__ = "finding_notes"

    id = db.Column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    finding_id = db.Column(
        Uuid(as_uuid=True),
        db.ForeignKey("findings.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    author_id = db.Column(
        Uuid(as_uuid=True),
        db.ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    body = db.Column(String(4000), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=db.func.now()
    )

    finding = db.relationship("Finding", back_populates="notes")
    author = db.relationship("User", back_populates="notes")


class AuditEvent(db.Model):
    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('finding.status_changed', 'finding.note_added')",
            name="valid_event_type",
        ),
        Index("ix_audit_events_finding_occurred", "finding_id", "occurred_at", "id"),
    )

    id = db.Column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    finding_id = db.Column(
        Uuid(as_uuid=True), db.ForeignKey("findings.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id = db.Column(
        Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    event_type = db.Column(String(64), nullable=False)
    occurred_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=db.func.now()
    )
    details = db.Column(JSON_OBJECT, nullable=False, default=dict, server_default="{}")
    request_id = db.Column(Uuid(as_uuid=True), nullable=True)

    finding = db.relationship("Finding", back_populates="audit_events")
    actor = db.relationship("User", back_populates="audit_events")


class ServerSession(db.Model):
    """Flask-Session payloads keyed by a one-way hash of the browser session ID."""

    __tablename__ = "server_sessions"

    sid_hash = db.Column(String(64), primary_key=True)
    data = db.Column(LargeBinary, nullable=False)
    expiry = db.Column(db.DateTime(timezone=True), nullable=False, index=True)


class AuthThrottleBucket(db.Model):
    """Short-lived login failure counters; the key contains no raw username or IP."""

    __tablename__ = "auth_throttle_buckets"
    __table_args__ = (CheckConstraint("failures >= 0", name="nonnegative_failures"),)

    key_hash = db.Column(String(64), primary_key=True)
    window_started_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    failures = db.Column(db.Integer, nullable=False, default=0)
