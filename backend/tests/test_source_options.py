"""Source choices cover the stored dataset rather than a filtered findings page."""

from datetime import UTC, datetime, timedelta

import pytest

from tracker.models import Finding


def add_finding(session, source, *, old=False):
    session.add(
        Finding(
            source=source,
            title="Synthetic source selection example",
            description="Fabricated finding for the source inventory.",
            evidence_summary="No provider payload is returned by the inventory.",
            status="new",
            severity="medium",
            observed_at=datetime.now(UTC) - timedelta(days=40 if old else 0),
        )
    )


def test_sources_include_later_pages_and_older_findings(database_session, authenticated_client):
    for _ in range(27):
        add_finding(database_session, "synthetic-z")
    add_finding(database_session, "synthetic-a", old=True)
    add_finding(database_session, "synthetic-b")
    database_session.commit()
    client, _ = authenticated_client()

    first_page = client.get("/api/v1/findings").json
    assert len(first_page["items"]) == 25
    assert "synthetic-a" not in {row["source"] for row in first_page["items"]}
    response = client.get("/api/v1/findings/sources")
    assert response.status_code == 200
    assert response.json == {"sources": ["synthetic-a", "synthetic-b", "synthetic-z"]}
    assert client.get("/api/v1/findings", query_string={"source": "synthetic-a"}).json[
        "total"
    ] == 1
    assert client.get("/api/v1/findings/analytics", query_string={"source": "synthetic-a"}).json[
        "total"
    ] == 0
    assert client.get("/api/v1/findings/sources").json == response.json


def test_sources_return_an_empty_list_for_an_empty_database(authenticated_client):
    client, _ = authenticated_client()
    assert client.get("/api/v1/findings/sources").json == {"sources": []}


def test_sources_exclude_legacy_values_that_cannot_be_used_as_filters(
    database_session, authenticated_client
):
    for source in ("Uppercase", "has spaces", "", "all", "synthetic_valid", "s" * 64):
        add_finding(database_session, source)
    database_session.commit()
    client, _ = authenticated_client()
    assert client.get("/api/v1/findings/sources").json == {
        "sources": ["all", "s" * 64, "synthetic_valid"]
    }
    assert client.get("/api/v1/findings", query_string={"source": "all"}).json["total"] == 1


@pytest.mark.parametrize(
    "query", [{"page": 1}, {"page_size": 25}, {"source": "synthetic"}, {"location_scope": "region"}]
)
def test_source_inventory_rejects_query_parameters(authenticated_client, query):
    client, _ = authenticated_client()
    assert client.get("/api/v1/findings/sources", query_string=query).status_code == 400


@pytest.mark.parametrize("role", ["analyst", "viewer"])
def test_source_inventory_requires_authentication_and_allows_both_roles(
    app, authenticated_client, role
):
    assert app.test_client().get("/api/v1/findings/sources").status_code == 401
    client, _ = authenticated_client(role=role)
    assert client.get("/api/v1/findings/sources").status_code == 200
