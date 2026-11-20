"""Preserve existing notes and enforce the scope of optional retry keys."""

from uuid import UUID, uuid4

import pytest
from flask_migrate import downgrade, upgrade
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from conftest import BACKEND_DIR
from tracker.extensions import db
from tracker.models import Finding, FindingNote


@pytest.fixture
def legacy_note(app, database_session, authenticated_client):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    client, headers = authenticated_client()
    finding_id = database_session.scalar(select(Finding.id))
    response = client.post(
        f"/api/v1/findings/{finding_id}/notes",
        json={"body": "Synthetic existing note."},
        headers=headers,
    )
    assert response.status_code == 201
    return database_session.get(FindingNote, UUID(response.json["id"]))


def test_retry_key_constraint_and_legacy_notes(database_session, legacy_note):
    finding_id, author_id = legacy_note.finding_id, legacy_note.author_id
    key = uuid4()
    database_session.add(
        FindingNote(
            finding_id=finding_id,
            author_id=author_id,
            body="Synthetic keyed note.",
            client_request_id=key,
        )
    )
    database_session.commit()
    database_session.add(
        FindingNote(
            finding_id=finding_id,
            author_id=author_id,
            body="Synthetic duplicate key.",
            client_request_id=key,
        )
    )
    with pytest.raises(IntegrityError):
        database_session.commit()
    database_session.rollback()
    # Unkeyed callers can intentionally append identical notes independently.
    database_session.add_all(
        [
            FindingNote(finding_id=finding_id, author_id=author_id, body="Synthetic legacy note."),
            FindingNote(finding_id=finding_id, author_id=author_id, body="Synthetic legacy note."),
        ]
    )
    database_session.commit()
    notes = list(database_session.scalars(select(FindingNote)))
    assert sum(note.client_request_id == key for note in notes) == 1
    assert sum(note.body == "Synthetic legacy note." for note in notes) == 2


def test_note_retry_migration_preserves_notes_in_both_directions(
    app, database_session, legacy_note
):
    original = legacy_note
    database_session.add(
        FindingNote(
            finding_id=original.finding_id,
            author_id=original.author_id,
            body="Synthetic note surviving downgrade and upgrade.",
            client_request_id=uuid4(),
        )
    )
    database_session.commit()
    original_notes = list(
        database_session.execute(select(FindingNote.id, FindingNote.body).order_by(FindingNote.id))
    )
    db.session.remove()
    migrations = str(BACKEND_DIR / "migrations")
    downgrade(directory=migrations, revision="e915cb74f602")
    assert "client_request_id" not in {
        column["name"] for column in inspect(db.engine).get_columns("finding_notes")
    }
    assert (
        list(db.session.execute(select(FindingNote.id, FindingNote.body).order_by(FindingNote.id)))
        == original_notes
    )
    db.session.remove()
    upgrade(directory=migrations)
    assert (
        list(db.session.execute(select(FindingNote.id, FindingNote.body).order_by(FindingNote.id)))
        == original_notes
    )
    assert all(note.client_request_id is None for note in db.session.scalars(select(FindingNote)))
