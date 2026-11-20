"""Retry a logical note submission without creating a second note or analyst event."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from tracker.extensions import db
from tracker.models import AuditEvent, Finding, FindingNote


@pytest.fixture
def note_client(app, database_session, authenticated_client):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    client, headers = authenticated_client()
    finding_ids = list(database_session.scalars(select(Finding.id).order_by(Finding.id)))
    return client, headers, finding_ids[0], finding_ids[1]


def records(client, finding_id):
    path = f"/api/v1/findings/{finding_id}"
    return {
        "finding": client.get(path).json,
        "notes": client.get(path + "/notes").json,
        "history": client.get(path + "/history").json,
        "provider_history": client.get(path + "/provider-history").json,
    }


def test_unchanged_retry_returns_the_original_note_once(note_client):
    client, headers, finding_id, _ = note_client
    before = records(client, finding_id)
    key = str(uuid4())
    payload = {"body": "Synthetic retry-safe note.", "client_request_id": key}
    path = f"/api/v1/findings/{finding_id}/notes"
    first = client.post(path, json=payload, headers=headers)
    retry = client.post(
        path,
        json={
            **payload,
            "body": "  Synthetic retry-safe note.  ",
            "client_request_id": key.upper(),
        },
        headers=headers,
    )
    assert first.status_code == retry.status_code == 201
    assert first.json == retry.json
    assert set(first.json) == {"id", "author", "body", "created_at"}
    after = records(client, finding_id)
    assert after["notes"]["total"] == before["notes"]["total"] + 1
    assert after["history"]["total"] == before["history"]["total"] + 1
    assert after["finding"] == before["finding"]
    assert after["provider_history"] == before["provider_history"]
    assert "client_request_id" not in after["notes"]["items"][0]
    conflict = client.post(
        path, json={**payload, "body": "Synthetic different text."}, headers=headers
    )
    assert conflict.status_code == 409
    assert key not in conflict.text
    assert records(client, finding_id) == after


def test_retry_keys_are_scoped_to_the_author_and_finding(note_client, authenticated_client):
    client, headers, finding_id, other_id = note_client
    colleague, colleague_headers = authenticated_client(username="synthetic-colleague")
    payload = {"body": "Synthetic independently authored note.", "client_request_id": str(uuid4())}
    first = client.post(f"/api/v1/findings/{finding_id}/notes", json=payload, headers=headers)
    other_author = colleague.post(
        f"/api/v1/findings/{finding_id}/notes", json=payload, headers=colleague_headers
    )
    other_finding = client.post(f"/api/v1/findings/{other_id}/notes", json=payload, headers=headers)
    assert first.status_code == other_author.status_code == other_finding.status_code == 201
    assert len({first.json["id"], other_author.json["id"], other_finding.json["id"]}) == 3
    assert first.json["author"] == "synthetic-reviewer"
    assert other_author.json["author"] == "synthetic-colleague"


@pytest.mark.parametrize("key", [None, False, 1, {}, "", "invalid", "0" * 32, "x" * 36])
def test_note_rejects_malformed_retry_keys_without_writes(note_client, key):
    client, headers, finding_id, _ = note_client
    before = records(client, finding_id)
    response = client.post(
        f"/api/v1/findings/{finding_id}/notes",
        headers=headers,
        json={"body": "Synthetic invalid-key note.", "client_request_id": key},
    )
    assert response.status_code == 422
    assert response.json["errors"] == [{"field": "client_request_id", "code": "invalid_value"}]
    assert records(client, finding_id) == before


def test_legacy_unkeyed_requests_and_new_keys_can_append_identical_notes(note_client):
    client, headers, finding_id, _ = note_client
    path = f"/api/v1/findings/{finding_id}/notes"
    body = {"body": "Synthetic intentional repeated text."}
    responses = [client.post(path, json=body, headers=headers) for _ in range(2)]
    responses += [
        client.post(path, json={**body, "client_request_id": str(uuid4())}, headers=headers)
        for _ in range(2)
    ]
    assert all(response.status_code == 201 for response in responses)
    assert len({response.json["id"] for response in responses}) == 4
    assert client.get(path).json["total"] == 4
    assert client.get(f"/api/v1/findings/{finding_id}/history").json["total"] == 4


def test_failed_note_transaction_does_not_consume_the_retry_key(note_client):
    client, headers, finding_id, _ = note_client
    path = f"/api/v1/findings/{finding_id}/notes"
    payload = {"body": "Synthetic note after a rollback.", "client_request_id": str(uuid4())}

    def fail_audit(*_args):
        raise RuntimeError("synthetic-sensitive-transaction-detail")

    event.listen(AuditEvent, "before_insert", fail_audit)
    try:
        failed = client.post(path, json=payload, headers=headers)
    finally:
        event.remove(AuditEvent, "before_insert", fail_audit)
    assert failed.status_code == 500
    assert "synthetic-sensitive" not in failed.text
    assert client.get(path).json["total"] == 0
    assert client.get(f"/api/v1/findings/{finding_id}/history").json["total"] == 0
    retried = client.post(path, json=payload, headers=headers)
    assert retried.status_code == 201
    assert client.post(path, json=payload, headers=headers).json == retried.json
    assert client.get(path).json["total"] == 1
    assert client.get(f"/api/v1/findings/{finding_id}/history").json["total"] == 1


def test_keyed_note_replay_still_requires_authentication_role_and_csrf(
    app, note_client, authenticated_client
):
    client, headers, finding_id, _ = note_client
    path = f"/api/v1/findings/{finding_id}/notes"
    payload = {"body": "Synthetic protected note.", "client_request_id": str(uuid4())}
    assert client.post(path, json=payload, headers=headers).status_code == 201
    viewer, viewer_headers = authenticated_client(role="viewer", username="synthetic-viewer")
    assert viewer.post(path, json=payload, headers=viewer_headers).status_code == 403
    assert app.test_client().post(path, json=payload, headers=headers).status_code in {401, 403}
    assert client.post(path, json=payload).status_code == 403
    assert client.get(path).json["total"] == 1


def test_simultaneous_postgresql_retries_commit_one_note_and_one_event(app, note_client):
    if db.engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL CI exercises simultaneous retries with separate connections.")
    first, first_headers, finding_id, _ = note_client
    second = app.test_client()
    token = second.get("/api/v1/auth/csrf").json["csrf_token"]
    assert (
        second.post(
            "/api/v1/auth/login",
            headers={"X-CSRFToken": token},
            json={"username": "synthetic-reviewer", "password": "synthetic-test-password-only"},
        ).status_code
        == 200
    )
    second_headers = {"X-CSRFToken": second.get("/api/v1/auth/csrf").json["csrf_token"]}
    key = uuid4()
    gate = Barrier(2, timeout=10)

    def overlap_inserts(_mapper, _connection, target):
        if target.client_request_id == key:
            gate.wait()

    path = f"/api/v1/findings/{finding_id}/notes"
    payload = {"body": "Synthetic simultaneous retry.", "client_request_id": str(key)}
    event.listen(FindingNote, "before_insert", overlap_inserts)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(client.post, path, json=payload, headers=headers)
                for client, headers in [(first, first_headers), (second, second_headers)]
            ]
            responses = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(FindingNote, "before_insert", overlap_inserts)
    assert [response.status_code for response in responses] == [201, 201]
    assert responses[0].json == responses[1].json
    assert first.get(path).json["total"] == 1
    assert first.get(f"/api/v1/findings/{finding_id}/history").json["total"] == 1
