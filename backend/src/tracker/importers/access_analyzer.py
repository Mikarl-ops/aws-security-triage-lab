"""Bounded, read-only access to IAM Access Analyzer external-access findings."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

MAX_PAGE_SIZE = 100
MAX_FINDINGS_PER_RUN = 1000
MAX_PAGES_PER_RUN = 25
ANALYZER_ARN_PATTERN = re.compile(r"^arn:[^:]+:access-analyzer:[^:]+:\d{12}:analyzer/.{1,255}$")


class ImportSourceError(RuntimeError):
    """A page source failed or returned an invalid response."""


class PaginationError(ImportSourceError):
    """A provider pagination token loop or limit error occurred."""


@dataclass(frozen=True)
class AccessAnalyzerPage:
    findings: tuple[Any, ...]
    next_token: str | None


@dataclass(frozen=True)
class BoundedFindingRead:
    findings: tuple[Any, ...]
    pages_read: int
    truncated: bool


@dataclass(frozen=True)
class AccessAnalyzerCandidate:
    provider_key: str
    resource_type: str
    provider_status: str
    is_public: bool
    created_at: datetime
    updated_at: datetime
    analyzed_at: datetime
    observed_at: datetime
    local_priority: str
    resource_location_scope: str
    resource_region: str | None

    @property
    def snapshot_order(self) -> tuple[datetime, datetime]:
        """The lab orders snapshots by provider update time, then policy analysis time."""
        return self.updated_at, self.analyzed_at


@dataclass(frozen=True)
class AccessAnalyzerPreview:
    pages_read: int
    records_read: int
    valid_records: int
    invalid_records: int
    duplicate_records: int
    truncated: bool
    writes_performed: int
    by_resource_type: dict[str, int]
    by_provider_status: dict[str, int]
    by_local_priority: dict[str, int]
    by_location_scope: dict[str, int]


@dataclass(frozen=True)
class AccessAnalyzerCandidateBatch:
    candidates: tuple[AccessAnalyzerCandidate, ...]
    pages_read: int
    records_read: int
    invalid_records: int
    duplicate_records: int
    truncated: bool


class FindingValidationError(ValueError):
    """A provider record failed the importer allowlist and shape checks."""


class AccessAnalyzerPageSource(Protocol):
    def fetch_page(self, *, next_token: str | None, page_size: int) -> AccessAnalyzerPage: ...


class AccessAnalyzerClient(Protocol):
    def list_findings(self, **kwargs: Any) -> dict[str, Any]: ...


def validate_analyzer_arn(value: str) -> str:
    if not isinstance(value, str) or not ANALYZER_ARN_PATTERN.fullmatch(value):
        raise ValueError("A valid IAM Access Analyzer ARN is required.")
    return value


class AwsAccessAnalyzerPageSource:
    """Adapter for an injected boto3 Access Analyzer client; it creates no client itself."""

    def __init__(self, client: AccessAnalyzerClient, analyzer_arn: str):
        self._client = client
        self.analyzer_arn = validate_analyzer_arn(analyzer_arn)

    def fetch_page(self, *, next_token: str | None, page_size: int) -> AccessAnalyzerPage:
        request: dict[str, Any] = {
            "analyzerArn": self.analyzer_arn,
            "maxResults": page_size,
        }
        if next_token is not None:
            request["nextToken"] = next_token
        try:
            response = self._client.list_findings(**request)
        except Exception:
            raise ImportSourceError(
                "IAM Access Analyzer could not return a findings page."
            ) from None
        if not isinstance(response, dict) or not isinstance(response.get("findings"), list):
            raise ImportSourceError("IAM Access Analyzer returned an invalid findings page.")
        returned_token = response.get("nextToken")
        if returned_token is not None and (
            not isinstance(returned_token, str) or not returned_token or len(returned_token) > 2048
        ):
            raise ImportSourceError("IAM Access Analyzer returned an invalid pagination token.")
        return AccessAnalyzerPage(tuple(response["findings"]), returned_token)


class FixtureAccessAnalyzerPageSource:
    """Paginates a committed synthetic AWS-shaped fixture without network or database access."""

    def __init__(self, analyzer_arn: str, findings: list[Any]):
        self.analyzer_arn = validate_analyzer_arn(analyzer_arn)
        self._findings = tuple(findings)

    @classmethod
    def from_file(cls, path: Path) -> FixtureAccessAnalyzerPageSource:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise ImportSourceError(
                "The synthetic Access Analyzer fixture could not be read."
            ) from None
        if not isinstance(payload, dict) or set(payload) != {"analyzer_arn", "findings"}:
            raise ImportSourceError("The synthetic Access Analyzer fixture has an invalid shape.")
        if not isinstance(payload["findings"], list):
            raise ImportSourceError(
                "The synthetic Access Analyzer fixture has an invalid findings list."
            )
        try:
            return cls(payload["analyzer_arn"], payload["findings"])
        except ValueError as error:
            raise ImportSourceError(
                "The synthetic Access Analyzer fixture has invalid configuration."
            ) from error

    def fetch_page(self, *, next_token: str | None, page_size: int) -> AccessAnalyzerPage:
        start = 0
        if next_token is not None:
            if (
                not isinstance(next_token, str)
                or len(next_token) > 2048
                or not re.fullmatch(r"fixture-offset:[1-9][0-9]*", next_token)
            ):
                raise PaginationError("The synthetic fixture received an invalid pagination token.")
            start = int(next_token.removeprefix("fixture-offset:"))
            if start >= len(self._findings):
                raise PaginationError("The synthetic fixture received an invalid pagination token.")
        end = min(start + page_size, len(self._findings))
        page = self._findings[start:end]
        next_page = f"fixture-offset:{end}" if end < len(self._findings) else None
        return AccessAnalyzerPage(page, next_page)


def read_findings_bounded(
    source: AccessAnalyzerPageSource,
    *,
    page_size: int = 100,
    max_findings: int = 500,
    max_pages: int = 20,
) -> BoundedFindingRead:
    if (
        isinstance(page_size, bool)
        or not isinstance(page_size, int)
        or not 1 <= page_size <= MAX_PAGE_SIZE
    ):
        raise ValueError(f"page_size must be between 1 and {MAX_PAGE_SIZE}.")
    if (
        isinstance(max_findings, bool)
        or not isinstance(max_findings, int)
        or not 1 <= max_findings <= MAX_FINDINGS_PER_RUN
    ):
        raise ValueError(f"max_findings must be between 1 and {MAX_FINDINGS_PER_RUN}.")
    if (
        isinstance(max_pages, bool)
        or not isinstance(max_pages, int)
        or not 1 <= max_pages <= MAX_PAGES_PER_RUN
    ):
        raise ValueError(f"max_pages must be between 1 and {MAX_PAGES_PER_RUN}.")

    findings: list[Any] = []
    seen_tokens: set[str] = set()
    next_token = None
    pages_read = 0
    for _ in range(max_pages):
        page = source.fetch_page(next_token=next_token, page_size=page_size)
        pages_read += 1
        if (
            not isinstance(page, AccessAnalyzerPage)
            or not isinstance(page.findings, (list, tuple))
            or len(page.findings) > page_size
        ):
            raise ImportSourceError("A findings page exceeded the configured page size.")
        remaining = max_findings - len(findings)
        findings.extend(page.findings[:remaining])
        next_token = page.next_token
        page_was_clipped = len(page.findings) > remaining
        if page_was_clipped:
            return BoundedFindingRead(tuple(findings), pages_read, True)
        if next_token is None:
            return BoundedFindingRead(tuple(findings), pages_read, False)
        if not isinstance(next_token, str) or not next_token or len(next_token) > 2048:
            raise ImportSourceError("The provider returned an invalid pagination token.")
        if next_token in seen_tokens:
            raise PaginationError("The provider repeated a pagination token.")
        seen_tokens.add(next_token)
        if len(findings) >= max_findings:
            return BoundedFindingRead(tuple(findings), pages_read, True)

    return BoundedFindingRead(tuple(findings), pages_read, next_token is not None)


RESOURCE_TYPE_PATTERN = re.compile(r"^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$")
REGION_CODE_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$")
PROVIDER_STATUSES = {"ACTIVE", "ARCHIVED", "RESOLVED"}
GLOBAL_RESOURCE_TYPES = {"AWS::IAM::Role", "AWS::IAM::User"}


def _provider_timestamp(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise FindingValidationError(f"The provider timestamp {field} is invalid.") from None
    else:
        raise FindingValidationError(f"The provider timestamp {field} is missing or invalid.")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise FindingValidationError(f"The provider timestamp {field} must include a timezone.")
    return parsed.astimezone(UTC)


def _resource_location(resource_type: str, resource_arn: Any) -> tuple[str, str | None]:
    if resource_type in GLOBAL_RESOURCE_TYPES:
        return "global", None
    if not isinstance(resource_arn, str) or not resource_arn.startswith("arn:"):
        return "unknown", None
    parts = resource_arn.split(":", 5)
    if len(parts) != 6:
        return "unknown", None
    region = parts[3]
    if not region or len(region) > 32 or not REGION_CODE_PATTERN.fullmatch(region):
        return "unknown", None
    return "region", region


def normalize_access_analyzer_finding(analyzer_arn: str, finding: Any) -> AccessAnalyzerCandidate:
    validate_analyzer_arn(analyzer_arn)
    if not isinstance(finding, dict):
        raise FindingValidationError("The provider finding is not an object.")

    finding_id = finding.get("id")
    resource_type = finding.get("resourceType")
    provider_status = finding.get("status")
    is_public = finding.get("isPublic")
    if not isinstance(finding_id, str) or not finding_id.strip() or len(finding_id) > 2048:
        raise FindingValidationError("The provider finding identifier is missing or invalid.")
    if (
        not isinstance(resource_type, str)
        or not RESOURCE_TYPE_PATTERN.fullmatch(resource_type)
        or len(resource_type) > 128
    ):
        raise FindingValidationError("The provider resource type is missing or invalid.")
    if not isinstance(provider_status, str) or provider_status not in PROVIDER_STATUSES:
        raise FindingValidationError("The provider finding status is missing or invalid.")
    if not isinstance(is_public, bool):
        raise FindingValidationError("The provider public-access value is missing or invalid.")

    created_at = _provider_timestamp(finding.get("createdAt"), "createdAt")
    updated_at = _provider_timestamp(finding.get("updatedAt"), "updatedAt")
    analyzed_at_value = finding.get("analyzedAt", finding.get("updatedAt"))
    analyzed_at = _provider_timestamp(analyzed_at_value, "analyzedAt")
    location_scope, resource_region = _resource_location(resource_type, finding.get("resource"))
    provider_key = hashlib.sha256(f"{analyzer_arn}\0{finding_id}".encode()).hexdigest()

    return AccessAnalyzerCandidate(
        provider_key=provider_key,
        resource_type=resource_type,
        provider_status=provider_status,
        is_public=is_public,
        created_at=created_at,
        updated_at=updated_at,
        analyzed_at=analyzed_at,
        observed_at=analyzed_at,
        local_priority="high" if is_public else "medium",
        resource_location_scope=location_scope,
        resource_region=resource_region,
    )


def run_access_analyzer_preview(
    source: AccessAnalyzerPageSource,
    *,
    analyzer_arn: str,
    page_size: int = 100,
    max_findings: int = 500,
    max_pages: int = 20,
) -> AccessAnalyzerPreview:
    batch = collect_access_analyzer_candidates(
        source,
        analyzer_arn=analyzer_arn,
        page_size=page_size,
        max_findings=max_findings,
        max_pages=max_pages,
    )
    resource_types: Counter[str] = Counter()
    provider_statuses: Counter[str] = Counter()
    priorities: Counter[str] = Counter()
    location_scopes: Counter[str] = Counter()

    for candidate in batch.candidates:
        resource_types[candidate.resource_type] += 1
        provider_statuses[candidate.provider_status] += 1
        priorities[candidate.local_priority] += 1
        location_scopes[candidate.resource_location_scope] += 1

    return AccessAnalyzerPreview(
        pages_read=batch.pages_read,
        records_read=batch.records_read,
        valid_records=len(batch.candidates),
        invalid_records=batch.invalid_records,
        duplicate_records=batch.duplicate_records,
        truncated=batch.truncated,
        writes_performed=0,
        by_resource_type=dict(sorted(resource_types.items())),
        by_provider_status=dict(sorted(provider_statuses.items())),
        by_local_priority=dict(sorted(priorities.items())),
        by_location_scope=dict(sorted(location_scopes.items())),
    )


def collect_access_analyzer_candidates(
    source: AccessAnalyzerPageSource,
    *,
    analyzer_arn: str,
    page_size: int = 100,
    max_findings: int = 500,
    max_pages: int = 20,
) -> AccessAnalyzerCandidateBatch:
    analyzer_arn = validate_analyzer_arn(analyzer_arn)
    bounded_read = read_findings_bounded(
        source,
        page_size=page_size,
        max_findings=max_findings,
        max_pages=max_pages,
    )
    candidates: dict[str, AccessAnalyzerCandidate] = {}
    invalid_records = 0
    duplicate_records = 0

    for raw_finding in bounded_read.findings:
        try:
            candidate = normalize_access_analyzer_finding(analyzer_arn, raw_finding)
        except FindingValidationError:
            invalid_records += 1
            continue
        previous = candidates.get(candidate.provider_key)
        if previous is not None:
            duplicate_records += 1
            if candidate.snapshot_order > previous.snapshot_order:
                candidates[candidate.provider_key] = candidate
            continue
        candidates[candidate.provider_key] = candidate

    return AccessAnalyzerCandidateBatch(
        candidates=tuple(candidates.values()),
        pages_read=bounded_read.pages_read,
        records_read=len(bounded_read.findings),
        invalid_records=invalid_records,
        duplicate_records=duplicate_records,
        truncated=bounded_read.truncated,
    )
