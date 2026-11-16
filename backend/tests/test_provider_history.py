"""Authenticated, bounded, read-only access to minimized provider change history."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from conftest import FIXTURE_DIR, SEED_FILE
from tracker.importers.access_analyzer import (
    FixtureAccessAnalyzerPageSource,
    normalize_access_analyzer_finding,
)
from tracker.importers.access_analyzer_store import import_access_analyzer_fixture
from tracker.models import Finding, ProviderEvent, User


@pytest.fixture
def history_finding(database_session, synthetic_payload, analyzer_arn):
    for path in (SEED_FILE, FIXTURE_DIR / "access-analyzer-provider-update.json"):
        source = FixtureAccessAnalyzerPageSource.from_file(path)
        import_access_analyzer_fixture(database_session, source, analyzer_arn=source.analyzer_arn)
    key = normalize_access_analyzer_finding(
        analyzer_arn, synthetic_payload["findings"][0]
    ).provider_key
    return database_session.scalar(select(Finding).where(Finding.source_event_id == key))


def signed_in_client(app, session, role="viewer"):
    password = "synthetic-history-password-only"
    session.add(
        User(
            username=f"synthetic-{role}",
            role=role,
            password_hash=app.extensions["password_hasher"].hash(password),
        )
    )
    session.commit()
    client = app.test_client()
    token = client.get("/api/v1/auth/csrf").json["csrf_token"]
    result = client.post(
        "/api/v1/auth/login",
        json={"username": f"synthetic-{role}", "password": password},
        headers={"X-CSRFToken": token},
    )
    assert result.status_code == 200
    return client


@pytest.mark.parametrize("role", ["viewer", "analyst"])
def test_provider_history_is_paged_newest_first(app, database_session, history_finding, role):
    client = signed_in_client(app, database_session, role)
    path = f"/api/v1/findings/{history_finding.id}/provider-history"
    first = client.get(path + "?page_size=1").json
    second = client.get(path + "?page_size=1&page=2").json
    assert (first["total"], first["pages"], first["page_size"]) == (2, 2, 1)
    assert first["items"][0]["event_type"] == "provider.updated"
    assert first["items"][0]["finding_version"] == 2
    assert first["items"][0]["changes"]["provider_status"] == {
        "before": "ACTIVE",
        "after": "ARCHIVED",
    }
    assert first["items"][0]["changes"]["is_public"] == {"before": True, "after": False}
    assert first["items"][0]["occurred_at"].endswith("Z")
    assert second["items"][0]["event_type"] == "provider.imported"
    assert second["items"][0]["finding_version"] == 1
    assert client.get(path + "?page=3&page_size=1").json["items"] == []


def test_provider_history_requires_authentication(app, history_finding):
    assert (
        app.test_client().get(f"/api/v1/findings/{history_finding.id}/provider-history").status_code
        == 401
    )


@pytest.mark.parametrize("query", ["page=0", "page_size=101", "page=abc", "unexpected=1"])
def test_provider_history_rejects_invalid_queries(app, database_session, history_finding, query):
    client = signed_in_client(app, database_session)
    response = client.get(f"/api/v1/findings/{history_finding.id}/provider-history?{query}")
    assert response.status_code == 400


def test_provider_history_does_not_include_other_findings(app, database_session, history_finding):
    other = database_session.scalar(select(Finding).where(Finding.id != history_finding.id))
    client = signed_in_client(app, database_session)
    result = client.get(f"/api/v1/findings/{other.id}/provider-history").json
    assert result["total"] == 1
    assert result["items"][0]["event_type"] == "provider.imported"
    assert result["items"][0]["id"] not in {
        str(event.id) for event in history_finding.provider_events
    }
    assert client.get(f"/api/v1/findings/{uuid4()}/provider-history").status_code == 404


def test_provider_history_filters_unapproved_or_nested_values(
    app, database_session, history_finding
):
    event = history_finding.provider_events[-1]
    event.changes = {
        "provider_status": {"before": "ACTIVE", "after": "ARCHIVED"},
        "principal": {"before": None, "after": "synthetic-sensitive-principal"},
        "is_public": {"before": False, "after": {"raw": "synthetic-sensitive-payload"}},
        "resource_type": {"before": None, "after": "x" * 129},
    }
    database_session.commit()
    client = signed_in_client(app, database_session)
    response = client.get(f"/api/v1/findings/{history_finding.id}/provider-history")
    assert response.json["items"][0]["changes"] == {
        "provider_status": {"before": "ACTIVE", "after": "ARCHIVED"}
    }
    assert "synthetic-sensitive" not in response.text


def test_provider_history_has_no_write_route(app, database_session, history_finding):
    client = signed_in_client(app, database_session)
    count = database_session.scalar(select(func.count()).select_from(ProviderEvent))
    token = client.get("/api/v1/auth/csrf").json["csrf_token"]
    for method in ("POST", "PATCH", "DELETE"):
        response = client.open(
            f"/api/v1/findings/{history_finding.id}/provider-history",
            method=method,
            json={},
            headers={"X-CSRFToken": token},
        )
        assert response.status_code == 405
    assert database_session.scalar(select(func.count()).select_from(ProviderEvent)) == count


def test_legacy_synthetic_findings_start_with_empty_provider_history(app, database_session):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    finding = database_session.scalar(select(Finding))
    client = signed_in_client(app, database_session)
    result = client.get(f"/api/v1/findings/{finding.id}/provider-history").json
    assert (result["items"], result["total"], result["page"]) == ([], 0, 1)
