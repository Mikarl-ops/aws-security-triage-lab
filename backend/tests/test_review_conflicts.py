"""Exercise stale analyst drafts against intervening synthetic provider and analyst writes."""

import pytest
from sqlalchemy import select

from conftest import PROVIDER_UPDATE_FILE, SEED_FILE
from tracker.importers.access_analyzer import (
    FixtureAccessAnalyzerPageSource,
    normalize_access_analyzer_finding,
)
from tracker.importers.access_analyzer_store import import_access_analyzer_fixture
from tracker.models import Finding


@pytest.mark.parametrize("intervening_writer", ["provider", "analyst"])
def test_stale_review_requires_refetch_without_changing_either_history(
    app, database_session, synthetic_payload, analyzer_arn, intervening_writer, authenticated_client
):
    baseline = FixtureAccessAnalyzerPageSource.from_file(SEED_FILE)
    import_access_analyzer_fixture(database_session, baseline, analyzer_arn=analyzer_arn)
    key = normalize_access_analyzer_finding(
        analyzer_arn, synthetic_payload["findings"][0]
    ).provider_key
    finding_id = database_session.scalar(select(Finding.id).where(Finding.source_event_id == key))
    path = f"/api/v1/findings/{finding_id}"
    client, headers = authenticated_client()
    note = {"body": "Synthetic note recorded before the provider or analyst change."}
    assert client.post(path + "/notes", json=note, headers=headers).status_code == 201
    opened = client.get(path).json
    assert (opened["version"], opened["status"]) == (1, "new")

    if intervening_writer == "provider":
        update = FixtureAccessAnalyzerPageSource.from_file(PROVIDER_UPDATE_FILE)
        import_access_analyzer_fixture(database_session, update, analyzer_arn=analyzer_arn)
    else:
        colleague, colleague_headers = authenticated_client(username="synthetic-colleague")
        assert (
            colleague.patch(
                path,
                json={"status": "investigating", "expected_version": opened["version"]},
                headers=colleague_headers,
            ).status_code
            == 200
        )

    before_history = client.get(path + "/history").json
    before_provider_history = client.get(path + "/provider-history").json
    before_notes = client.get(path + "/notes").json
    draft = {
        "status": "dismissed",
        "expected_version": opened["version"],
        "resolution_reason": "Synthetic reviewed decision kept for an explicit retry.",
    }
    rejected = client.patch(path, json=draft, headers=headers)
    assert rejected.status_code == 409
    refreshed = client.get(path).json
    assert refreshed["version"] == 2
    assert refreshed["resolution_reason"] is None
    assert client.get(path + "/history").json == before_history
    assert client.get(path + "/provider-history").json == before_provider_history
    assert client.get(path + "/notes").json == before_notes
    if intervening_writer == "provider":
        assert refreshed["status"] == "new"
        assert refreshed["provider"]["status"] == "ARCHIVED"
        assert refreshed["provider"]["is_public"] is False
        assert refreshed["severity"] == "medium"
        assert before_provider_history["total"] == 2
    else:
        assert refreshed["status"] == "investigating"
        assert refreshed["provider"] == opened["provider"]
        assert before_provider_history["total"] == 1

    draft["expected_version"] = refreshed["version"]
    assert client.patch(path, json=draft).status_code == 403
    accepted = client.patch(path, json=draft, headers=headers)
    assert accepted.status_code == 200
    assert (accepted.json["version"], accepted.json["status"]) == (3, "dismissed")
    assert accepted.json["resolution_reason"] == draft["resolution_reason"]
    assert accepted.json["provider"] == refreshed["provider"]
    assert client.get(path + "/provider-history").json == before_provider_history
    assert client.get(path + "/notes").json == before_notes
    history = client.get(path + "/history").json
    assert history["total"] == before_history["total"] + 1
    previous_ids = {event["id"] for event in before_history["items"]}
    added = [event for event in history["items"] if event["id"] not in previous_ids]
    assert len(added) == 1
    event = added[0]
    assert event["actor"] == "synthetic-reviewer"
    assert event["event_type"] == "finding.status_changed"
    assert event["details"] == {
        "from_status": refreshed["status"],
        "to_status": "dismissed",
        "version": 3,
        "resolution_reason": draft["resolution_reason"],
    }

    assert client.patch(path, json=draft, headers=headers).status_code == 409
    assert client.get(path).json == accepted.json
    assert client.get(path + "/history").json == history
    assert client.get(path + "/provider-history").json == before_provider_history
