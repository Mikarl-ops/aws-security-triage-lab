"""Persist normalized Access Analyzer candidates without replacing analyst decisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Finding
from .access_analyzer import (
    AccessAnalyzerCandidate,
    AccessAnalyzerPageSource,
    collect_access_analyzer_candidates,
)

SOURCE_NAME = "aws-access-analyzer"


class ImportPersistenceError(RuntimeError):
    """The normalized candidate batch could not be committed safely."""


@dataclass(frozen=True)
class AccessAnalyzerImportResult:
    pages_read: int
    records_read: int
    created_records: int
    updated_records: int
    unchanged_records: int
    invalid_records: int
    duplicate_records: int
    truncated: bool
    writes_performed: int


def _finding_fields(candidate: AccessAnalyzerCandidate) -> dict[str, Any]:
    public_summary = (
        "The provider marks this finding as public."
        if candidate.is_public
        else "The provider reports external access and marks this finding as not public."
    )
    return {
        "title": f"External access: {candidate.resource_type}",
        "description": (
            "IAM Access Analyzer reported external access for a resource of this type."
        ),
        "evidence_summary": public_summary,
        "metadata_json": {"resource_type": candidate.resource_type},
        "severity": candidate.local_priority,
        "resource_location_scope": candidate.resource_location_scope,
        "resource_region": candidate.resource_region,
        "observed_at": candidate.observed_at,
        "provider_status": candidate.provider_status,
        "provider_is_public": candidate.is_public,
        "provider_created_at": candidate.created_at,
        "provider_updated_at": candidate.updated_at,
        "provider_analyzed_at": candidate.analyzed_at,
    }


def import_access_analyzer_fixture(
    session: Session,
    source: AccessAnalyzerPageSource,
    *,
    analyzer_arn: str,
    page_size: int = 100,
    max_findings: int = 500,
    max_pages: int = 20,
) -> AccessAnalyzerImportResult:
    batch = collect_access_analyzer_candidates(
        source,
        analyzer_arn=analyzer_arn,
        page_size=page_size,
        max_findings=max_findings,
        max_pages=max_pages,
    )
    if batch.truncated:
        raise ImportPersistenceError(
            "The fixture exceeded the configured import limit; no findings were written."
        )

    created_records = 0
    updated_records = 0
    unchanged_records = 0
    try:
        for candidate in batch.candidates:
            existing = session.execute(
                select(Finding)
                .where(
                    Finding.source == SOURCE_NAME,
                    Finding.source_event_id == candidate.provider_key,
                )
                .with_for_update()
            ).scalar_one_or_none()
            fields = _finding_fields(candidate)
            if existing is None:
                session.add(
                    Finding(
                        source=SOURCE_NAME,
                        source_event_id=candidate.provider_key,
                        **fields,
                    )
                )
                created_records += 1
                continue

            changed = False
            for field, value in fields.items():
                if getattr(existing, field) != value:
                    setattr(existing, field, value)
                    changed = True
            if changed:
                existing.version += 1
                updated_records += 1
            else:
                unchanged_records += 1

        session.commit()
    except Exception:
        session.rollback()
        raise ImportPersistenceError(
            "The synthetic Access Analyzer import could not be committed."
        ) from None

    return AccessAnalyzerImportResult(
        pages_read=batch.pages_read,
        records_read=batch.records_read,
        created_records=created_records,
        updated_records=updated_records,
        unchanged_records=unchanged_records,
        invalid_records=batch.invalid_records,
        duplicate_records=batch.duplicate_records,
        truncated=batch.truncated,
        writes_performed=created_records + updated_records,
    )
