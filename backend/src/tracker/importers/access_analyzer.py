"""Bounded, read-only access to IAM Access Analyzer external-access findings."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

MAX_PAGE_SIZE = 100
MAX_FINDINGS_PER_RUN = 1000
MAX_PAGES_PER_RUN = 25
ANALYZER_ARN_PATTERN = re.compile(
    r"^arn:[^:]+:access-analyzer:[^:]+:\d{12}:analyzer/.{1,255}$"
)


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
            raise ImportSourceError("IAM Access Analyzer could not return a findings page.") from None
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
            raise ImportSourceError("The synthetic Access Analyzer fixture could not be read.") from None
        if not isinstance(payload, dict) or set(payload) != {"analyzer_arn", "findings"}:
            raise ImportSourceError("The synthetic Access Analyzer fixture has an invalid shape.")
        if not isinstance(payload["findings"], list):
            raise ImportSourceError("The synthetic Access Analyzer fixture has an invalid findings list.")
        try:
            return cls(payload["analyzer_arn"], payload["findings"])
        except ValueError as error:
            raise ImportSourceError("The synthetic Access Analyzer fixture has invalid configuration.") from error

    def fetch_page(self, *, next_token: str | None, page_size: int) -> AccessAnalyzerPage:
        start = 0
        if next_token is not None:
            if not next_token.startswith("fixture-offset:"):
                raise PaginationError("The synthetic fixture received an invalid pagination token.")
            try:
                start = int(next_token.removeprefix("fixture-offset:"))
            except ValueError:
                raise PaginationError("The synthetic fixture received an invalid pagination token.") from None
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
