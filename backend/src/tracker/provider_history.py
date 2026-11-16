"""Minimized provider change values shared by imports and history responses."""

from datetime import UTC, datetime
from typing import Any

from .models import Finding

PROVIDER_CHANGE_FIELDS = frozenset(
    {
        "provider_status",
        "is_public",
        "priority",
        "resource_type",
        "resource_location_scope",
        "resource_region",
        "provider_created_at",
        "provider_updated_at",
        "provider_analyzed_at",
    }
)


def _timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def provider_state(finding: Finding) -> dict[str, Any]:
    metadata = finding.metadata_json if isinstance(finding.metadata_json, dict) else {}
    return {
        "provider_status": finding.provider_status,
        "is_public": finding.provider_is_public,
        "priority": finding.severity,
        "resource_type": metadata.get("resource_type"),
        "resource_location_scope": finding.resource_location_scope,
        "resource_region": finding.resource_region,
        "provider_created_at": _timestamp(finding.provider_created_at),
        "provider_updated_at": _timestamp(finding.provider_updated_at),
        "provider_analyzed_at": _timestamp(finding.provider_analyzed_at),
    }


def provider_changes(before: dict | None, after: dict) -> dict:
    previous = before or {}
    return {
        field: {"before": previous.get(field), "after": value}
        for field, value in after.items()
        if field in PROVIDER_CHANGE_FIELDS and previous.get(field) != value
    }


def public_provider_changes(changes: Any) -> dict:
    if not isinstance(changes, dict):
        return {}
    return {
        field: pair
        for field, pair in changes.items()
        if field in PROVIDER_CHANGE_FIELDS
        and isinstance(pair, dict)
        and set(pair) == {"before", "after"}
        and all(
            value is None or isinstance(value, bool) or isinstance(value, str) and len(value) <= 128
            for value in pair.values()
        )
    }
