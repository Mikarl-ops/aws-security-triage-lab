"""Check provider limits and minimization without AWS credentials or a database."""

import json
from dataclasses import asdict

import pytest

from conftest import FIXTURE_DIR
from tracker.importers.access_analyzer import (
    AccessAnalyzerPage,
    AwsAccessAnalyzerPageSource,
    FindingValidationError,
    FixtureAccessAnalyzerPageSource,
    ImportSourceError,
    PaginationError,
    normalize_access_analyzer_finding,
    read_findings_bounded,
    run_access_analyzer_preview,
)


class ScriptedClient:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.requests = []

    def list_findings(self, **kwargs):
        self.requests.append(kwargs)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


def test_adapter_forwards_only_configured_analyzer_and_pagination(analyzer_arn):
    client = ScriptedClient(
        {"findings": [], "nextToken": "synthetic-next-page"},
        {"findings": []},
    )
    result = read_findings_bounded(AwsAccessAnalyzerPageSource(client, analyzer_arn), page_size=2)
    assert result.pages_read == 2
    assert result.findings == ()
    assert result.truncated is False
    assert client.requests == [
        {"analyzerArn": analyzer_arn, "maxResults": 2},
        {"analyzerArn": analyzer_arn, "maxResults": 2, "nextToken": "synthetic-next-page"},
    ]


def test_provider_error_does_not_disclose_payload(analyzer_arn):
    source = AwsAccessAnalyzerPageSource(
        ScriptedClient(RuntimeError("synthetic-sensitive-provider-response")), analyzer_arn
    )
    with pytest.raises(ImportSourceError) as error:
        read_findings_bounded(source)
    assert "synthetic-sensitive" not in str(error.value)
    assert error.value.__suppress_context__ is True


@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"findings": {}},
        {"findings": [], "nextToken": 12},
        {"findings": [], "nextToken": ""},
        {"findings": [], "nextToken": "x" * 2049},
    ],
)
def test_adapter_rejects_malformed_pages(analyzer_arn, response):
    with pytest.raises(ImportSourceError):
        read_findings_bounded(AwsAccessAnalyzerPageSource(ScriptedClient(response), analyzer_arn))


def test_repeated_token_stops_pagination(analyzer_arn):
    client = ScriptedClient(
        {"findings": [], "nextToken": "synthetic-loop"},
        {"findings": [], "nextToken": "synthetic-loop"},
    )
    with pytest.raises(PaginationError, match="repeated"):
        read_findings_bounded(AwsAccessAnalyzerPageSource(client, analyzer_arn))
    assert len(client.requests) == 2


@pytest.mark.parametrize(
    "token",
    [
        "fixture-offset:-1",
        "fixture-offset:0",
        "fixture-offset:3",
        "fixture-offset:999",
        "fixture-offset: 1",
        "fixture-offset:+1",
        "fixture-offset:01",
        "unexpected",
        12,
    ],
)
def test_fixture_rejects_invalid_resume_offsets(synthetic_payload, analyzer_arn, token):
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, synthetic_payload["findings"])
    with pytest.raises(PaginationError, match="invalid pagination token"):
        source.fetch_page(next_token=token, page_size=2)


def test_fixture_resumes_at_the_next_unread_record(synthetic_payload, analyzer_arn):
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, synthetic_payload["findings"])
    first = source.fetch_page(next_token=None, page_size=2)
    last = source.fetch_page(next_token=first.next_token, page_size=2)
    assert first.next_token == "fixture-offset:2"
    assert last.findings == (synthetic_payload["findings"][2],)
    assert last.next_token is None


@pytest.mark.parametrize("limits", [{"max_findings": 1}, {"max_pages": 1}])
def test_truncation_is_reported_for_each_limit(synthetic_payload, analyzer_arn, limits):
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, synthetic_payload["findings"])
    result = read_findings_bounded(source, page_size=2, **limits)
    assert result.truncated is True
    assert result.pages_read == 1


def test_terminal_page_clipped_inside_batch_is_still_truncated(synthetic_payload, analyzer_arn):
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, synthetic_payload["findings"])
    result = read_findings_bounded(source, page_size=3, max_findings=2)
    assert len(result.findings) == 2
    assert result.truncated is True


@pytest.mark.parametrize(
    "limits",
    [
        {"page_size": 0},
        {"page_size": 101},
        {"page_size": True},
        {"max_findings": 0},
        {"max_findings": 1001},
        {"max_pages": 26},
    ],
)
def test_invalid_limits_fail_before_fetching(limits):
    class NeverRead:
        def fetch_page(self, **kwargs):
            pytest.fail("Invalid bounds must be rejected before reading any page.")

    with pytest.raises(ValueError):
        read_findings_bounded(NeverRead(), **limits)


def test_page_source_cannot_exceed_requested_size():
    class OversizedSource:
        def fetch_page(self, **kwargs):
            return AccessAnalyzerPage(({}, {}), None)

    with pytest.raises(ImportSourceError, match="page size"):
        read_findings_bounded(OversizedSource(), page_size=1)


def test_preview_counts_duplicates_and_invalid_records_without_raw_data():
    source = FixtureAccessAnalyzerPageSource.from_file(FIXTURE_DIR / "access-analyzer-mixed.json")
    preview = run_access_analyzer_preview(source, analyzer_arn=source.analyzer_arn, page_size=1)
    assert (preview.records_read, preview.valid_records) == (4, 1)
    assert (preview.invalid_records, preview.duplicate_records) == (2, 1)
    assert preview.by_local_priority == {"high": 1}
    assert preview.writes_performed == 0
    report = json.dumps(asdict(preview))
    assert "synthetic-access-analyzer" not in report
    assert "arn:" not in report
    assert "000000000000" not in report


def test_normalization_keeps_location_distinct_from_analyzer_region(
    synthetic_payload, analyzer_arn
):
    candidates = [
        normalize_access_analyzer_finding(analyzer_arn, record)
        for record in synthetic_payload["findings"]
    ]
    assert [(item.resource_location_scope, item.resource_region) for item in candidates] == [
        ("unknown", None),
        ("global", None),
        ("region", "us-west-2"),
    ]
    assert all(item.observed_at == item.analyzed_at for item in candidates)


def test_key_is_stable_and_scoped_to_analyzer(synthetic_payload, analyzer_arn):
    record = synthetic_payload["findings"][0]
    first = normalize_access_analyzer_finding(analyzer_arn, record)
    repeated = normalize_access_analyzer_finding(analyzer_arn, dict(record, status="ARCHIVED"))
    other = normalize_access_analyzer_finding(analyzer_arn + "-other", record)
    assert len(first.provider_key) == 64
    assert first.provider_key == repeated.provider_key
    assert first.provider_key != other.provider_key
    assert "synthetic" not in first.provider_key


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", ""),
        ("resourceType", "invalid"),
        ("status", "new"),
        ("isPublic", "true"),
        ("createdAt", "2026-10-30T08:00:00"),
        ("updatedAt", None),
    ],
)
def test_invalid_provider_fields_are_rejected(synthetic_payload, analyzer_arn, field, value):
    record = dict(synthetic_payload["findings"][0], **{field: value})
    with pytest.raises(FindingValidationError):
        normalize_access_analyzer_finding(analyzer_arn, record)
