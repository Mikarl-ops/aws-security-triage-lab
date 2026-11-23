"""Keep provider-state cohorts independent from analyst status and shared by every view."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from conftest import PROVIDER_UPDATE_FILE, SEED_FILE
from tracker.importers.access_analyzer import FixtureAccessAnalyzerPageSource
from tracker.importers.access_analyzer_store import import_access_analyzer_fixture
from tracker.models import Finding

ENDPOINTS = ("/findings", "/findings/analytics", "/findings/region-analytics")


@pytest.fixture
def provider_cohort(database_session, authenticated_client):
    now = datetime.now(UTC)
    cohorts = {"ACTIVE": [], "ARCHIVED": [], "RESOLVED": [], "none": []}

    def add(
        provider_status,
        status="new",
        severity="high",
        scope="region",
        region="ap-southeast-1",
        old=False,
    ):
        finding = Finding(
            title="Synthetic provider-filter finding",
            description="Fabricated filter example.",
            evidence_summary="Synthetic fields only.",
            source="aws-access-analyzer" if provider_status else "synthetic",
            severity=severity,
            status=status,
            metadata_json={"resource_type": "synthetic-resource"},
            observed_at=now - timedelta(days=40) if old else now,
            resource_location_scope=scope,
            resource_region=region,
            resolution_reason="Synthetic analyst decision." if status == "resolved" else None,
            provider_status=provider_status,
            provider_is_public=True if provider_status else None,
            provider_created_at=now - timedelta(days=2) if provider_status else None,
            provider_updated_at=now - timedelta(days=1) if provider_status else None,
            provider_analyzed_at=now if provider_status else None,
        )
        database_session.add(finding)
        database_session.flush()
        cohorts[provider_status or "none"].append(str(finding.id))

    for _ in range(27):
        add("ACTIVE")
    add("ACTIVE", old=True)
    add("ARCHIVED", severity="medium", scope="global", region=None)
    add("ARCHIVED", status="resolved", severity="low", region="us-west-2")
    add("RESOLVED", status="investigating", severity="medium", scope="unknown", region=None)
    add(None, status="resolved", severity="low", scope="unknown", region=None)
    add(None, region="us-east-1")
    database_session.commit()
    client, _ = authenticated_client(role="viewer")
    return client, cohorts


@pytest.mark.parametrize(
    "provider_status,queue_total,analytics_total",
    [
        ("ACTIVE", 28, 27),
        ("ARCHIVED", 2, 2),
        ("RESOLVED", 1, 1),
        ("none", 2, 2),
    ],
)
def test_provider_cohort_is_shared_by_queue_charts_and_map(
    provider_cohort, provider_status, queue_total, analytics_total
):
    client, cohorts = provider_cohort
    query = {"provider_status": provider_status}
    first = client.get("/api/v1/findings", query_string=query).json
    second = client.get("/api/v1/findings", query_string={**query, "page": 2}).json
    assert first["total"] == queue_total
    assert {row["id"] for row in first["items"] + second["items"]} == set(cohorts[provider_status])
    charts = client.get("/api/v1/findings/analytics", query_string=query).json
    locations = client.get("/api/v1/findings/region-analytics", query_string=query).json
    assert charts["total"] == locations["total"] == analytics_total
    assert len(charts["by_observed_day"]) == 30
    assert sum(row["count"] for row in charts["by_observed_day"]) == analytics_total
    assert charts["by_resource_type"] == [
        {"resource_type": "synthetic-resource", "count": analytics_total}
    ]
    assert sum(locations["by_scope"].values()) == analytics_total
    assert sum(row["count"] for row in locations["by_region"]) == locations["by_scope"]["region"]
    if provider_status == "ARCHIVED":
        assert locations["by_scope"] == {"region": 1, "global": 1, "unknown": 0}
    # Omitting provider_status includes provider and legacy findings; overview remains global.
    assert client.get("/api/v1/findings").json["total"] == 33
    assert client.get("/api/v1/findings/summary").json["total"] == 33


def test_provider_status_combines_with_analyst_priority_source_and_dates(provider_cohort):
    client, cohorts = provider_cohort
    query = {
        "provider_status": "ARCHIVED",
        "status": "resolved",
        "severity": "low",
        "source": "aws-access-analyzer",
    }
    result = client.get("/api/v1/findings", query_string=query).json
    assert [row["id"] for row in result["items"]] == [cohorts["ARCHIVED"][1]]
    assert client.get("/api/v1/findings/analytics", query_string=query).json["total"] == 1
    locations = client.get("/api/v1/findings/region-analytics", query_string=query).json
    assert locations["by_region"] == [{"region": "us-west-2", "count": 1}]
    query["provider_status"] = "RESOLVED"
    assert client.get("/api/v1/findings", query_string=query).json["total"] == 0
    assert client.get("/api/v1/findings/analytics", query_string=query).json["total"] == 0
    assert client.get("/api/v1/findings/region-analytics", query_string=query).json["total"] == 0
    query = {
        "provider_status": "ACTIVE",
        "observed_to": (datetime.now(UTC) - timedelta(days=30)).isoformat(),
    }
    assert client.get("/api/v1/findings", query_string=query).json["total"] == 1


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("value", ["", "active", "unknown", "ACTIVE,ARCHIVED"])
def test_provider_filter_rejects_invalid_values(app, authenticated_client, endpoint, value):
    client, _ = authenticated_client()
    assert (
        client.get("/api/v1" + endpoint, query_string={"provider_status": value}).status_code == 400
    )


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_provider_filter_rejects_multiple_values(authenticated_client, endpoint):
    client, _ = authenticated_client()
    response = client.get(
        "/api/v1" + endpoint,
        query_string=[("provider_status", "ACTIVE"), ("provider_status", "ARCHIVED")],
    )
    assert response.status_code == 400


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("role", ["analyst", "viewer"])
def test_provider_filter_requires_authentication_and_allows_both_roles(
    app, authenticated_client, endpoint, role
):
    path = "/api/v1" + endpoint
    assert app.test_client().get(path, query_string={"provider_status": "none"}).status_code == 401
    client, _ = authenticated_client(role=role)
    assert client.get(path, query_string={"provider_status": "none"}).status_code == 200


def test_provider_refresh_moves_a_finding_between_cohorts_without_changing_analyst_status(
    database_session, authenticated_client
):
    baseline = FixtureAccessAnalyzerPageSource.from_file(SEED_FILE)
    import_access_analyzer_fixture(database_session, baseline, analyzer_arn=baseline.analyzer_arn)
    finding_id = database_session.scalar(
        select(Finding.id).where(
            Finding.metadata_json["resource_type"].as_string() == "AWS::S3::Bucket"
        )
    )
    client, _ = authenticated_client()
    active = client.get("/api/v1/findings?provider_status=ACTIVE&status=new").json
    assert str(finding_id) in {row["id"] for row in active["items"]}
    previous_archived = {
        row["id"]
        for row in client.get("/api/v1/findings?provider_status=ARCHIVED&status=new").json["items"]
    }
    update = FixtureAccessAnalyzerPageSource.from_file(PROVIDER_UPDATE_FILE)
    import_access_analyzer_fixture(database_session, update, analyzer_arn=update.analyzer_arn)
    archived = client.get("/api/v1/findings?provider_status=ARCHIVED&status=new").json
    assert {row["id"] for row in archived["items"]} == previous_archived | {str(finding_id)}
    assert str(finding_id) not in {
        row["id"]
        for row in client.get("/api/v1/findings?provider_status=ACTIVE&status=new").json["items"]
    }
    detail = client.get(f"/api/v1/findings/{finding_id}").json
    assert detail["status"] == "new"
    assert detail["provider"]["status"] == "ARCHIVED"
