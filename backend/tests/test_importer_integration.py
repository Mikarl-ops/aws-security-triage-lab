"""Keep migrations, role checks, and the fixture CLI aligned with the importer."""

import json

import pytest
from flask_migrate import check, downgrade, upgrade
from sqlalchemy import func, inspect, select

from conftest import BACKEND_DIR, SEED_FILE
from tracker.extensions import db
from tracker.importers.access_analyzer import FixtureAccessAnalyzerPageSource
from tracker.importers.access_analyzer_store import import_access_analyzer_fixture
from tracker.models import AuditEvent, Finding, FindingNote, User


def test_migrations_match_the_model(app):
    check(directory=str(BACKEND_DIR / "migrations"))


def test_provider_migration_can_downgrade_and_upgrade(app):
    migrations = str(BACKEND_DIR / "migrations")
    seeded = app.test_cli_runner().invoke(args=["seed-demo"])
    assert seeded.exit_code == 0, seeded.output
    original_ids = set(db.session.scalars(select(Finding.id)))
    assert original_ids
    db.session.remove()
    downgrade(directory=migrations, revision="7f3a9b2c1d64")
    assert "provider_status" not in {
        column["name"] for column in inspect(db.engine).get_columns("findings")
    }
    upgrade(directory=migrations)
    assert "provider_status" in {
        column["name"] for column in inspect(db.engine).get_columns("findings")
    }
    assert set(db.session.scalars(select(Finding.id))) == original_ids


def test_viewer_can_read_imported_fields_but_cannot_change_analyst_state(app, database_session):
    source = FixtureAccessAnalyzerPageSource.from_file(SEED_FILE)
    import_access_analyzer_fixture(database_session, source, analyzer_arn=source.analyzer_arn)
    finding = database_session.scalar(select(Finding))
    password = "synthetic-test-password-only"
    database_session.add(
        User(
            username="synthetic-viewer",
            role="viewer",
            password_hash=app.extensions["password_hasher"].hash(password),
        )
    )
    database_session.commit()
    client = app.test_client()
    csrf = client.get("/api/v1/auth/csrf").json["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "synthetic-viewer", "password": password},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200
    csrf = client.get("/api/v1/auth/csrf").json["csrf_token"]
    detail = client.get(f"/api/v1/findings/{finding.id}")
    assert detail.status_code == 200
    assert detail.json["provider"]["status"] == finding.provider_status
    assert detail.json["status"] == "new"
    assert (
        client.patch(
            f"/api/v1/findings/{finding.id}",
            json={"status": "investigating", "expected_version": finding.version},
            headers={"X-CSRFToken": csrf},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/findings/{finding.id}/notes",
            json={"body": "Synthetic forbidden viewer note."},
            headers={"X-CSRFToken": csrf},
        ).status_code
        == 403
    )
    database_session.refresh(finding)
    assert finding.status == "new"
    assert database_session.scalar(select(func.count()).select_from(FindingNote)) == 0
    assert database_session.scalar(select(func.count()).select_from(AuditEvent)) == 0


def test_confirmed_fixture_cli_import_is_idempotent_on_postgresql(app):
    if db.engine.dialect.name != "postgresql":
        pytest.skip(
            "The write CLI intentionally rejects SQLite; PostgreSQL CI exercises this path."
        )
    runner = app.test_cli_runner()
    args = ["access-analyzer-import-fixture", "--confirm-synthetic"]
    first = runner.invoke(args=args)
    assert first.exit_code == 0, first.output
    assert json.loads(first.output)["created_records"] == 3
    repeated = runner.invoke(args=args)
    assert repeated.exit_code == 0, repeated.output
    assert json.loads(repeated.output)["writes_performed"] == 0
