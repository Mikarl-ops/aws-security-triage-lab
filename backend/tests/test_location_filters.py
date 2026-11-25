"""Resource placement filters use explicit stored scope, independent of event geography."""

from datetime import UTC, datetime, timedelta

import pytest

from tracker.models import Finding

ENDPOINTS = ("/findings", "/findings/analytics", "/findings/region-analytics")


@pytest.fixture
def location_cohort(database_session, authenticated_client):
    now = datetime.now(UTC)
    ids = {"ap-southeast-1": [], "us-west-2": [], "global": [], "unknown": []}

    def add(scope, region=None, old=False, provider_status=None):
        row = Finding(
            title="Synthetic location filter finding",
            description="Fabricated placement only.",
            evidence_summary="No source-IP geography is inferred.",
            source="synthetic",
            status="new",
            severity="medium",
            metadata_json={"region": "us-east-1", "resource_type": "synthetic-resource"},
            observed_at=now - timedelta(days=40) if old else now,
            resource_location_scope=scope,
            resource_region=region,
            provider_status=provider_status,
            provider_is_public=False if provider_status else None,
            provider_created_at=now if provider_status else None,
            provider_updated_at=now if provider_status else None,
            provider_analyzed_at=now if provider_status else None,
        )
        database_session.add(row)
        database_session.flush()
        ids[region or scope].append(str(row.id))

    for _ in range(27):
        add("region", "ap-southeast-1", provider_status="ARCHIVED")
    add("region", "ap-southeast-1", old=True)
    add("region", "us-west-2")
    add("global")
    add("unknown")
    database_session.commit()
    client, _ = authenticated_client(role="viewer")
    return client, ids


@pytest.mark.parametrize(
    "query,keys,queue_total,window_total",
    [
        ({"location_scope": "region"}, ["ap-southeast-1", "us-west-2"], 29, 28),
        ({"resource_region": "ap-southeast-1"}, ["ap-southeast-1"], 28, 27),
        ({"location_scope": "region", "resource_region": "us-west-2"}, ["us-west-2"], 1, 1),
        ({"location_scope": "global"}, ["global"], 1, 1),
        ({"location_scope": "unknown"}, ["unknown"], 1, 1),
    ],
)
def test_location_cohort_matches_queue_and_complete_analytics(
    location_cohort, query, keys, queue_total, window_total
):
    client, ids = location_cohort
    first = client.get("/api/v1/findings", query_string=query).json
    second = client.get("/api/v1/findings", query_string={**query, "page": 2}).json
    assert first["total"] == queue_total
    assert {row["id"] for row in first["items"] + second["items"]} == {
        item for key in keys for item in ids[key]
    }
    charts = client.get("/api/v1/findings/analytics", query_string=query).json
    regions = client.get("/api/v1/findings/region-analytics", query_string=query).json
    assert charts["total"] == regions["total"] == window_total
    assert sum(row["count"] for row in charts["by_observed_day"]) == window_total
    assert charts["by_resource_type"] == [
        {"resource_type": "synthetic-resource", "count": window_total}
    ]
    assert sum(regions["by_scope"].values()) == window_total
    assert sum(row["count"] for row in regions["by_region"]) == regions["by_scope"]["region"]
    if "global" in keys or "unknown" in keys:
        assert regions["by_region"] == []
    assert client.get("/api/v1/findings/summary").json["total"] == 31


def test_location_filters_combine_with_other_criteria_and_ignore_metadata_region(location_cohort):
    client, _ = location_cohort
    query = {
        "resource_region": "ap-southeast-1",
        "provider_status": "ARCHIVED",
        "status": "new",
        "severity": "medium",
        "source": "synthetic",
    }
    for endpoint in ENDPOINTS:
        assert client.get("/api/v1" + endpoint, query_string=query).json["total"] == 27
    # Every row contains metadata.region=us-east-1, but no resource is located there.
    for region in ("us-east-1", "xx-future-1"):
        for endpoint in ENDPOINTS:
            assert (
                client.get("/api/v1" + endpoint, query_string={"resource_region": region}).json[
                    "total"
                ]
                == 0
            )
    query = {
        "resource_region": "ap-southeast-1",
        "observed_to": (datetime.now(UTC) - timedelta(days=30)).isoformat(),
    }
    assert client.get("/api/v1/findings", query_string=query).json["total"] == 1


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize(
    "query",
    [
        {"location_scope": ""},
        {"location_scope": "all"},
        {"resource_region": ""},
        {"resource_region": "AP-SOUTHEAST-1"},
        {"resource_region": "x" * 33},
        {"resource_region": "ap-southeast"},
        {"location_scope": "global", "resource_region": "ap-southeast-1"},
        {"location_scope": "unknown", "resource_region": "ap-southeast-1"},
        [("location_scope", "region"), ("location_scope", "global")],
        [("resource_region", "ap-southeast-1"), ("resource_region", "us-west-2")],
    ],
)
def test_location_filters_reject_invalid_conflicting_or_repeated_values(
    authenticated_client, endpoint, query
):
    client, _ = authenticated_client()
    assert client.get("/api/v1" + endpoint, query_string=query).status_code == 400


@pytest.mark.parametrize("role", ["analyst", "viewer"])
def test_location_reads_require_sign_in_and_allow_both_roles(app, authenticated_client, role):
    for endpoint in ENDPOINTS:
        assert (
            app.test_client()
            .get("/api/v1" + endpoint, query_string={"location_scope": "unknown"})
            .status_code
            == 401
        )
    client, _ = authenticated_client(role=role)
    for endpoint in ENDPOINTS:
        assert (
            client.get("/api/v1" + endpoint, query_string={"location_scope": "unknown"}).status_code
            == 200
        )
