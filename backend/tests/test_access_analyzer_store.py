"""Exercise real transactions and database constraints using fabricated records."""

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from conftest import FIXTURE_DIR, SEED_FILE
from tracker.importers.access_analyzer import (
    FixtureAccessAnalyzerPageSource,
    normalize_access_analyzer_finding,
)
from tracker.importers.access_analyzer_store import (
    ImportPersistenceError,
    import_access_analyzer_fixture,
)
from tracker.models import AuditEvent, Finding, FindingNote, User


def import_file(session, path=SEED_FILE, **limits):
    source = FixtureAccessAnalyzerPageSource.from_file(path)
    return import_access_analyzer_fixture(
        session, source, analyzer_arn=source.analyzer_arn, page_size=2, **limits
    )


def test_repeat_import_is_a_no_op(database_session):
    first = import_file(database_session)
    assert first.created_records == 3
    rows = database_session.scalars(select(Finding)).all()
    original = {row.id: (row.version, row.updated_at) for row in rows}
    repeated = import_file(database_session)
    assert (repeated.created_records, repeated.updated_records, repeated.unchanged_records) == (
        0,
        0,
        3,
    )
    assert repeated.writes_performed == 0
    assert {row.id: (row.version, row.updated_at) for row in rows} == original


def test_replaying_an_older_fixture_preserves_the_newer_provider_snapshot(database_session):
    import_file(database_session)
    import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    finding = database_session.scalar(select(Finding).where(Finding.provider_status == "ARCHIVED"))
    finding.status = "resolved"
    finding.resolution_reason = "Synthetic analyst review retained during replay."
    finding.version += 1
    database_session.commit()
    before = {
        row.id: (
            row.provider_status,
            row.provider_is_public,
            row.provider_updated_at,
            row.provider_analyzed_at,
            row.severity,
            row.status,
            row.resolution_reason,
            row.version,
            row.updated_at,
        )
        for row in database_session.scalars(select(Finding))
    }
    replay = import_file(database_session)
    assert (replay.created_records, replay.updated_records, replay.unchanged_records) == (0, 0, 2)
    assert replay.stale_records == 1
    assert replay.writes_performed == 0
    assert {
        row.id: (
            row.provider_status,
            row.provider_is_public,
            row.provider_updated_at,
            row.provider_analyzed_at,
            row.severity,
            row.status,
            row.resolution_reason,
            row.version,
            row.updated_at,
        )
        for row in database_session.scalars(select(Finding))
    } == before


@pytest.mark.parametrize(
    "field,value",
    [("updatedAt", "2026-10-30T09:00:00Z"), ("analyzedAt", "2026-10-31T09:01:00Z")],
)
def test_older_provider_order_is_reported_without_a_write(
    database_session, provider_update_payload, analyzer_arn, field, value
):
    import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    older = dict(provider_update_payload["findings"][0], **{field: value}, status="ACTIVE")
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, [older])
    result = import_access_analyzer_fixture(database_session, source, analyzer_arn=analyzer_arn)
    assert result.stale_records == 1
    assert result.writes_performed == 0
    assert result.records_read == (
        result.created_records
        + result.updated_records
        + result.unchanged_records
        + result.stale_records
        + result.invalid_records
        + result.duplicate_records
    )


def test_provider_update_time_takes_precedence_over_analysis_time(
    database_session, provider_update_payload, analyzer_arn
):
    import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    newer_update = dict(
        provider_update_payload["findings"][0],
        status="RESOLVED",
        updatedAt="2026-11-01T09:00:00Z",
        analyzedAt="2026-10-30T09:05:00Z",
    )
    source = FixtureAccessAnalyzerPageSource(analyzer_arn, [newer_update])
    result = import_access_analyzer_fixture(database_session, source, analyzer_arn=analyzer_arn)
    assert result.updated_records == 1
    assert result.stale_records == 0


def test_provider_update_preserves_analyst_decisions_and_history(
    database_session, synthetic_payload, analyzer_arn
):
    import_file(database_session)
    key = normalize_access_analyzer_finding(
        analyzer_arn, synthetic_payload["findings"][0]
    ).provider_key
    finding = database_session.scalar(select(Finding).where(Finding.source_event_id == key))
    analyst = User(
        username="synthetic-analyst", password_hash="unused-in-this-test", role="analyst"
    )
    database_session.add(analyst)
    database_session.flush()
    finding.status = "resolved"
    finding.resolution_reason = "Synthetic review completed."
    finding.updated_by = analyst.id
    finding.version += 1
    note = FindingNote(finding_id=finding.id, author_id=analyst.id, body="Synthetic analyst note.")
    audit = AuditEvent(
        finding_id=finding.id,
        actor_id=analyst.id,
        event_type="finding.status_changed",
        details={"from_status": "investigating", "to_status": "resolved"},
    )
    database_session.add_all([note, audit])
    database_session.commit()
    original = (finding.id, finding.created_at, finding.version, note.id, audit.id, audit.details)

    result = import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    database_session.refresh(finding)
    assert (result.created_records, result.updated_records) == (1, 1)
    assert finding.provider_status == "ARCHIVED"
    assert finding.provider_is_public is False
    assert finding.severity == "medium"
    assert finding.status == "resolved"
    assert finding.resolution_reason == "Synthetic review completed."
    assert finding.updated_by == analyst.id
    assert (finding.id, finding.created_at, finding.version) == (
        original[0],
        original[1],
        original[2] + 1,
    )
    assert [(item.id, item.body) for item in finding.notes] == [(original[3], note.body)]
    assert [(item.id, item.details) for item in finding.audit_events] == [
        (original[4], original[5])
    ]
    repeated = import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    assert repeated.unchanged_records == 2
    assert repeated.writes_performed == 0


def test_invalid_and_duplicate_records_are_counted_without_duplicate_rows(database_session):
    result = import_file(database_session, FIXTURE_DIR / "access-analyzer-mixed.json")
    assert (result.created_records, result.duplicate_records, result.invalid_records) == (1, 1, 2)
    assert database_session.scalar(select(func.count()).select_from(Finding)) == 1


def test_database_rejects_incomplete_provider_fields(database_session):
    import_file(database_session)
    finding = database_session.scalar(select(Finding))
    original_status = finding.provider_status
    finding.provider_status = None
    with pytest.raises(IntegrityError):
        database_session.flush()
    database_session.rollback()
    database_session.refresh(finding)
    assert finding.provider_status == original_status


@pytest.mark.parametrize("limits", [{"max_findings": 1}, {"max_pages": 1}])
def test_truncated_batches_write_nothing(database_session, limits):
    with pytest.raises(ImportPersistenceError, match="no findings were written"):
        import_file(database_session, **limits)
    assert database_session.scalar(select(func.count()).select_from(Finding)) == 0


def test_failed_commit_rolls_back_updates_and_inserts(database_session):
    import_file(database_session)
    before = {
        row.id: (row.provider_status, row.provider_is_public, row.version)
        for row in database_session.scalars(select(Finding))
    }

    def fail_after_writes(session):
        session.flush()
        raise RuntimeError("synthetic-sensitive-database-error")

    event.listen(database_session, "before_commit", fail_after_writes)
    try:
        with pytest.raises(ImportPersistenceError) as error:
            import_file(database_session, FIXTURE_DIR / "access-analyzer-provider-update.json")
    finally:
        event.remove(database_session, "before_commit", fail_after_writes)
    assert "synthetic-sensitive" not in str(error.value)
    assert error.value.__suppress_context__ is True
    assert {
        row.id: (row.provider_status, row.provider_is_public, row.version)
        for row in database_session.scalars(select(Finding))
    } == before
