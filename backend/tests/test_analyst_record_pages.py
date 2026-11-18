"""Keep bounded analyst record pages complete, deterministic, and finding-scoped."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from tracker.models import AuditEvent, Finding, FindingNote, User


@pytest.fixture
def record_pages(app, database_session, authenticated_client):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    client, _ = authenticated_client(role="viewer")
    user = database_session.scalar(select(User).where(User.username == "synthetic-reviewer"))
    findings = list(database_session.scalars(select(Finding).order_by(Finding.id)))
    finding, other = findings[:2]
    # Equal timestamps exercise the UUID tie-breaker, independent of insertion order.
    timestamp = datetime(2026, 11, 18, 1, tzinfo=UTC)
    note_ids, event_ids = [], []
    for number in range(28, 0, -1):
        note_id, event_id = UUID(int=number), UUID(int=100 + number)
        note_ids.insert(0, str(note_id))
        event_ids.insert(0, str(event_id))
        database_session.add(
            FindingNote(
                id=note_id,
                finding_id=finding.id,
                author_id=user.id,
                body=f"Synthetic paged note {number}.",
                created_at=timestamp,
            )
        )
        database_session.add(
            AuditEvent(
                id=event_id,
                finding_id=finding.id,
                actor_id=user.id,
                event_type="finding.note_added",
                occurred_at=timestamp,
                details={"note_id": str(note_id)},
            )
        )
    database_session.add(
        FindingNote(
            finding_id=other.id,
            author_id=user.id,
            body="Synthetic record belonging to another finding.",
            created_at=timestamp,
        )
    )
    database_session.add(
        AuditEvent(
            finding_id=other.id,
            actor_id=user.id,
            event_type="finding.note_added",
            occurred_at=timestamp,
            details={"note_id": "synthetic-other-note"},
        )
    )
    database_session.commit()
    return client, finding.id, {"notes": note_ids, "history": event_ids}


@pytest.mark.parametrize("kind", ["notes", "history"])
def test_analyst_pages_include_every_record_once_with_stable_ties(
    database_session, record_pages, kind
):
    client, finding_id, expected = record_pages
    path = f"/api/v1/findings/{finding_id}/{kind}"
    # seed-demo may have earlier records; keep those and verify the new tail without hiding them.
    model = FindingNote if kind == "notes" else AuditEvent
    total = database_session.scalar(
        select(func.count()).select_from(model).where(model.finding_id == finding_id)
    )
    first = client.get(path).json
    second = client.get(path + "?page=2&page_size=25").json
    assert (first["total"], first["page_size"], first["pages"]) == (total, 25, 2)
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(ids) == len(set(ids)) == total
    assert ids[-28:] == expected[kind]
    assert client.get(path).json == first
    empty = client.get(path + "?page=3").json
    assert (empty["items"], empty["total"], empty["pages"]) == ([], total, 2)
    assert client.get(f"/api/v1/findings/{finding_id}").json["version"] == 1
    assert (
        database_session.scalar(
            select(func.count()).select_from(model).where(model.finding_id == finding_id)
        )
        == total
    )


@pytest.mark.parametrize("kind", ["notes", "history"])
@pytest.mark.parametrize("query", ["page=0", "page=abc", "page_size=101", "page_size=0", "extra=1"])
def test_analyst_pages_reject_invalid_queries(record_pages, kind, query):
    client, finding_id, _ = record_pages
    assert client.get(f"/api/v1/findings/{finding_id}/{kind}?{query}").status_code == 400


@pytest.mark.parametrize("kind", ["notes", "history"])
@pytest.mark.parametrize("role", ["viewer", "analyst"])
def test_analyst_pages_require_login_and_allow_both_roles(app, authenticated_client, kind, role):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    finding = app.extensions["sqlalchemy"].session.scalar(select(Finding))
    path = f"/api/v1/findings/{finding.id}/{kind}"
    assert app.test_client().get(path).status_code == 401
    client, _ = authenticated_client(role=role)
    assert client.get(path).status_code == 200
    assert client.get(f"/api/v1/findings/{uuid4()}/{kind}").status_code == 404
