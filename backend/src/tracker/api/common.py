"""Shared API parsing and RFC 9457 problem response helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from math import ceil
from uuid import uuid4

from flask import Response, g, jsonify, request
from werkzeug.exceptions import BadRequest


def problem(
    status: int,
    title: str,
    detail: str,
    *,
    errors: list[dict[str, str]] | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    request_id = getattr(g, "request_id", str(uuid4()))
    payload: dict[str, object] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": request.path,
        "request_id": request_id,
    }
    if errors:
        payload["errors"] = errors[:20]
    response = jsonify(payload)
    response.status_code = status
    response.mimetype = "application/problem+json"
    response.headers["X-Request-ID"] = request_id
    for name, value in (headers or {}).items():
        response.headers[name] = value
    return response


def json_object() -> tuple[dict | None, Response | None]:
    if request.mimetype != "application/json":
        return None, problem(415, "Unsupported media type", "Use application/json.")
    try:
        payload = request.get_json(silent=False)
    except BadRequest:
        return None, problem(400, "Malformed JSON", "The request body must contain valid JSON.")
    if not isinstance(payload, dict):
        return None, problem(422, "Validation failed", "The JSON body must be an object.")
    return payload, None


def parse_page_args() -> tuple[int | None, int | None, Response | None]:
    allowed = {"page", "page_size"}
    if set(request.args) - allowed:
        return (
            None,
            None,
            problem(400, "Invalid query", "One or more query parameters are unsupported."),
        )
    try:
        page = int(request.args.get("page", "1"))
        page_size = int(request.args.get("page_size", "25"))
    except ValueError:
        return None, None, problem(400, "Invalid query", "page and page_size must be integers.")
    if page < 1 or not 1 <= page_size <= 100:
        return (
            None,
            None,
            problem(400, "Invalid query", "page must be positive and page_size must be 1 to 100."),
        )
    return page, page_size, None


def pagination(page: int, page_size: int, total: int) -> dict[str, int]:
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, ceil(total / page_size)),
    }


def parse_rfc3339(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
