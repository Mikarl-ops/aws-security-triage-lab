"""Migration-managed SQLAlchemy session storage for Flask-Session."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from flask import Flask, Request
from flask_session.base import ServerSideSession, ServerSideSessionInterface
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import delete

from .models import ServerSession


class StrictJSONSerializer:
    """Serialize the small session payload without Flask-Session's pickle fallback."""

    def __init__(self, app: Flask) -> None:
        self.app = app

    def encode(self, value: ServerSideSession) -> bytes:
        return json.dumps(dict(value), separators=(",", ":"), ensure_ascii=True).encode("utf-8")

    def decode(self, value: bytes) -> dict:
        decoded = json.loads(value.decode("utf-8"))
        if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
            raise ValueError("Session payload must be a JSON object with string keys.")
        return decoded


class DatabaseSessionInterface(ServerSideSessionInterface):
    """Persist sessions through the application's migrations and SQLAlchemy session."""

    ttl = False

    def __init__(self, app: Flask, client: SQLAlchemy) -> None:
        self.client = client
        self.sql_session_model = ServerSession
        super().__init__(
            app,
            key_prefix="csft:",
            use_signer=False,
            permanent=True,
            sid_length=32,
            serialization_format="json",
            cleanup_n_requests=None,
        )
        self.serializer = StrictJSONSerializer(app)

    def open_session(self, app: Flask, request: Request) -> ServerSideSession:
        # Liveness and readiness must remain available when PostgreSQL is unavailable.
        if request.path in {"/api/v1/health/live", "/api/v1/health/ready"}:
            return self.session_class(sid=self._generate_sid(self.sid_length), permanent=True)
        return super().open_session(app, request)

    @staticmethod
    def _hash_store_id(store_id: str) -> str:
        return hashlib.sha256(store_id.encode("utf-8")).hexdigest()

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def _retrieve_session_data(self, store_id: str) -> dict | None:
        record = self.client.session.get(ServerSession, self._hash_store_id(store_id))
        if record is None:
            return None
        if self._as_utc(record.expiry) <= datetime.now(UTC):
            self.client.session.delete(record)
            self.client.session.commit()
            return None
        try:
            return self.serializer.decode(record.data)
        except (UnicodeDecodeError, ValueError, TypeError):
            # A corrupt or unsupported payload cannot authenticate a request.
            self.client.session.delete(record)
            self.client.session.commit()
            return None

    def _delete_session(self, store_id: str) -> None:
        self.client.session.execute(
            delete(ServerSession).where(ServerSession.sid_hash == self._hash_store_id(store_id))
        )
        self.client.session.commit()

    def _upsert_session(
        self, session_lifetime: timedelta, session: ServerSideSession, store_id: str
    ) -> None:
        sid_hash = self._hash_store_id(store_id)
        record = self.client.session.get(ServerSession, sid_hash)
        if record is None:
            record = ServerSession(sid_hash=sid_hash, data=b"", expiry=datetime.now(UTC))
            self.client.session.add(record)
        now = datetime.now(UTC)
        expires_at = now + session_lifetime
        absolute_expiry = session.get("_absolute_expires_at")
        if absolute_expiry is None:
            absolute_expiry = (now + self.app.config["SESSION_ABSOLUTE_LIFETIME"]).isoformat()
            session["_absolute_expires_at"] = absolute_expiry
        if absolute_expiry is not None:
            try:
                absolute = datetime.fromisoformat(absolute_expiry)
                if absolute.tzinfo is None:
                    absolute = absolute.replace(tzinfo=UTC)
                expires_at = min(expires_at, absolute.astimezone(UTC))
            except (TypeError, ValueError):
                expires_at = now
        record.data = self.serializer.encode(session)
        record.expiry = expires_at
        self.client.session.commit()

    def _delete_expired_sessions(self) -> None:
        self.client.session.execute(
            delete(ServerSession).where(ServerSession.expiry <= datetime.now(UTC))
        )
        self.client.session.commit()
