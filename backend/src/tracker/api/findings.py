"""Finding, note, and audit-history endpoints."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from flask import Blueprint, g, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import case, func, select

from ..extensions import db
from ..models import AuditEvent, Finding, FindingNote, User
from .common import iso_utc, json_object, pagination, parse_page_args, parse_rfc3339, problem

bp = Blueprint("findings", __name__, url_prefix="/api/v1")
STATUSES = ("new", "investigating", "resolved", "dismissed")
SEVERITIES = ("critical", "high", "medium", "low", "informational")
ALLOWED_METADATA = {"account_id", "resource_id", "resource_type", "event_name"}
SOURCE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
TRANSITIONS = {
    "new": {"investigating", "dismissed"},
    "investigating": {"resolved", "dismissed"},
    "resolved": {"investigating"},
    "dismissed": {"investigating"},
}


def _finding_json(finding: Finding, *, include_detail: bool = False) -> dict:
    result = {
        "id": str(finding.id),
        "title": finding.title,
        "source": finding.source,
        "severity": finding.severity,
        "status": finding.status,
        "observed_at": iso_utc(finding.observed_at),
        "updated_at": iso_utc(finding.updated_at),
        "version": finding.version,
    }
    if include_detail:
        result.update(
            {
                "description": finding.description,
                "source_event_id": finding.source_event_id,
                "evidence_summary": finding.evidence_summary,
                "resource_location": {
                    "scope": finding.resource_location_scope,
                    "region": finding.resource_region,
                },
                "metadata": {
                    key: value
                    for key, value in (
                        finding.metadata_json if isinstance(finding.metadata_json, dict) else {}
                    ).items()
                    if key in ALLOWED_METADATA and isinstance(value, (str, int, float, bool))
                },
                "resolution_reason": finding.resolution_reason,
                "created_at": iso_utc(finding.created_at),
            }
        )
    return result


def _parse_finding_id(value: str) -> UUID | None:
    try:
        return UUID(value)
    except (TypeError, ValueError):
        return None


def _field_error(field: str, code: str = "invalid_value"):
    return problem(
        422,
        "Validation failed",
        "One or more fields are invalid.",
        errors=[{"field": field, "code": code}],
    )


def _parse_list_filters():
    allowed = {"status", "severity", "source", "observed_from", "observed_to", "page", "page_size"}
    if set(request.args) - allowed:
        return (
            None,
            None,
            None,
            problem(400, "Invalid query", "One or more query parameters are unsupported."),
        )

    filters = []
    for field, allowed_values in (("status", STATUSES), ("severity", SEVERITIES)):
        value = request.args.get(field)
        if value is not None:
            if value not in allowed_values:
                return None, None, None, problem(400, "Invalid query", f"{field} is not supported.")
            filters.append(getattr(Finding, field) == value)

    source = request.args.get("source")
    if source is not None:
        if not SOURCE_PATTERN.fullmatch(source):
            return (
                None,
                None,
                None,
                problem(400, "Invalid query", "source is not a valid identifier."),
            )
        filters.append(Finding.source == source)

    lower = request.args.get("observed_from")
    upper = request.args.get("observed_to")
    if lower is not None:
        parsed = parse_rfc3339(lower)
        if parsed is None:
            return (
                None,
                None,
                None,
                problem(400, "Invalid query", "observed_from must be RFC 3339 with a timezone."),
            )
        filters.append(Finding.observed_at >= parsed)
    if upper is not None:
        parsed_upper = parse_rfc3339(upper)
        if parsed_upper is None:
            return (
                None,
                None,
                None,
                problem(400, "Invalid query", "observed_to must be RFC 3339 with a timezone."),
            )
        if lower is not None and parsed_upper < parse_rfc3339(lower):
            return (
                None,
                None,
                None,
                problem(400, "Invalid query", "observed_to must not precede observed_from."),
            )
        filters.append(Finding.observed_at <= parsed_upper)

    page_text = request.args.get("page", "1")
    size_text = request.args.get("page_size", "25")
    try:
        page, page_size = int(page_text), int(size_text)
    except ValueError:
        return (
            None,
            None,
            None,
            problem(400, "Invalid query", "page and page_size must be integers."),
        )
    if page < 1 or not 1 <= page_size <= 100:
        return (
            None,
            None,
            None,
            problem(400, "Invalid query", "page must be positive and page_size must be 1 to 100."),
        )
    return filters, page, page_size, None


def _parse_analytics_filters():
    allowed = {"status", "severity", "source"}
    if set(request.args) - allowed:
        return None, problem(400, "Invalid query", "One or more query parameters are unsupported.")

    filters = []
    for field, allowed_values in (("status", STATUSES), ("severity", SEVERITIES)):
        value = request.args.get(field)
        if value is not None:
            if value not in allowed_values:
                return None, problem(400, "Invalid query", f"{field} is not supported.")
            filters.append(getattr(Finding, field) == value)

    source = request.args.get("source")
    if source is not None:
        if not SOURCE_PATTERN.fullmatch(source):
            return None, problem(400, "Invalid query", "source is not a valid identifier.")
        filters.append(Finding.source == source)

    return filters, None


def _utc_day_expression():
    if db.session.get_bind().dialect.name == "postgresql":
        return func.date(func.timezone("UTC", Finding.observed_at))
    return func.date(Finding.observed_at)


def _page_response(filters, page: int, page_size: int):
    total = db.session.scalar(select(func.count()).select_from(Finding).where(*filters)) or 0
    offset = (page - 1) * page_size
    if offset >= total:
        return jsonify(items=[], **pagination(page, page_size, total))
    items = db.session.scalars(
        select(Finding)
        .where(*filters)
        .order_by(Finding.observed_at.desc(), Finding.id.desc())
        .offset(offset)
        .limit(page_size)
    ).all()
    return jsonify(
        items=[_finding_json(item) for item in items], **pagination(page, page_size, total)
    )


@bp.get("/findings/summary")
@login_required
def summary():
    if request.args:
        return problem(400, "Invalid query", "This endpoint does not accept query parameters.")
    status_rows = db.session.execute(
        select(Finding.status, func.count()).group_by(Finding.status)
    ).all()
    severity_rows = db.session.execute(
        select(Finding.severity, func.count()).group_by(Finding.severity)
    ).all()
    by_status = {key: 0 for key in STATUSES}
    by_severity = {key: 0 for key in SEVERITIES}
    by_status.update({key: count for key, count in status_rows})
    by_severity.update({key: count for key, count in severity_rows})
    return jsonify(total=sum(by_status.values()), by_status=by_status, by_severity=by_severity)


@bp.get("/findings/analytics")
@login_required
def analytics():
    filters, error = _parse_analytics_filters()
    if error:
        return error

    today = datetime.now(UTC).date()
    start_day = today - timedelta(days=29)
    start_at = datetime.combine(start_day, time.min, UTC)
    end_at = datetime.combine(today + timedelta(days=1), time.min, UTC)
    scoped_filters = [*filters, Finding.observed_at >= start_at, Finding.observed_at < end_at]

    raw_resource_type = Finding.metadata_json["resource_type"].as_string()
    trimmed_resource_type = func.trim(raw_resource_type)
    resource_type = case(
        (raw_resource_type.is_(None), "Unknown"),
        (func.length(trimmed_resource_type) == 0, "Unknown"),
        (func.length(trimmed_resource_type) > 128, "Unknown"),
        else_=trimmed_resource_type,
    )
    resource_rows = db.session.execute(
        select(resource_type.label("resource_type"), func.count().label("count"))
        .where(*scoped_filters)
        .group_by(resource_type)
        .order_by(func.count().desc(), resource_type.asc())
    ).all()
    day_expression = _utc_day_expression()
    day_rows = db.session.execute(
        select(day_expression.label("day"), func.count().label("count"))
        .where(*scoped_filters)
        .group_by(day_expression)
        .order_by(day_expression.asc())
    ).all()
    total = db.session.scalar(
        select(func.count()).select_from(Finding).where(*scoped_filters)
    ) or 0

    day_counts = {start_day + timedelta(days=offset): 0 for offset in range(30)}
    for day_value, count in day_rows:
        if isinstance(day_value, datetime):
            day_value = day_value.date()
        elif isinstance(day_value, str):
            day_value = date.fromisoformat(day_value)
        if isinstance(day_value, date) and day_value in day_counts:
            day_counts[day_value] = count

    return jsonify(
        window={"days": 30, "start": start_day.isoformat(), "end": today.isoformat(), "timezone": "UTC"},
        total=total,
        by_resource_type=[
            {"resource_type": label, "count": count} for label, count in resource_rows
        ],
        by_observed_day=[
            {"day": day.isoformat(), "count": count} for day, count in day_counts.items()
        ],
    )


@bp.get("/findings")
@login_required
def list_findings():
    filters, page, page_size, error = _parse_list_filters()
    if error:
        return error
    return _page_response(filters, page, page_size)


@bp.get("/findings/<finding_id>")
@login_required
def get_finding(finding_id: str):
    parsed_id = _parse_finding_id(finding_id)
    finding = db.session.get(Finding, parsed_id) if parsed_id else None
    if finding is None:
        return problem(404, "Not found", "The requested finding does not exist.")
    return jsonify(_finding_json(finding, include_detail=True))


@bp.patch("/findings/<finding_id>")
@login_required
def change_status(finding_id: str):
    if current_user.role != "analyst":
        return problem(403, "Forbidden", "This action requires the analyst role.")
    payload, error = json_object()
    if error:
        return error
    if set(payload) - {"status", "expected_version", "resolution_reason"}:
        return _field_error("body", "unsupported_field")
    new_status = payload.get("status")
    expected_version = payload.get("expected_version")
    reason = payload.get("resolution_reason")
    if new_status not in STATUSES:
        return _field_error("status")
    if (
        isinstance(expected_version, bool)
        or not isinstance(expected_version, int)
        or expected_version < 1
    ):
        return _field_error("expected_version")
    if new_status in {"resolved", "dismissed"}:
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
            return _field_error("resolution_reason")
        reason = reason.strip()
    elif reason is not None:
        return _field_error("resolution_reason", "not_allowed")

    parsed_id = _parse_finding_id(finding_id)
    finding = (
        db.session.execute(
            select(Finding).where(Finding.id == parsed_id).with_for_update()
        ).scalar_one_or_none()
        if parsed_id
        else None
    )
    if finding is None:
        return problem(404, "Not found", "The requested finding does not exist.")
    if finding.version != expected_version:
        return problem(409, "Conflict", "The finding changed; refresh it and retry.")
    if new_status not in TRANSITIONS[finding.status]:
        return problem(
            422, "Invalid status transition", "The requested status transition is not allowed."
        )

    previous_status = finding.status
    finding.status = new_status
    finding.resolution_reason = reason if new_status in {"resolved", "dismissed"} else None
    finding.updated_by = current_user.id
    finding.version += 1
    finding.updated_at = datetime.now(UTC)
    db.session.add(
        AuditEvent(
            finding_id=finding.id,
            actor_id=current_user.id,
            event_type="finding.status_changed",
            occurred_at=finding.updated_at,
            details={
                "from_status": previous_status,
                "to_status": new_status,
                "version": finding.version,
                "resolution_reason": finding.resolution_reason,
            },
            request_id=UUID(g.request_id),
        )
    )
    db.session.commit()
    return jsonify(_finding_json(finding, include_detail=True))


@bp.get("/findings/<finding_id>/notes")
@login_required
def list_notes(finding_id: str):
    parsed_id = _parse_finding_id(finding_id)
    if parsed_id is None or db.session.get(Finding, parsed_id) is None:
        return problem(404, "Not found", "The requested finding does not exist.")
    page, page_size, error = parse_page_args()
    if error:
        return error
    query = (
        select(FindingNote, User.username)
        .join(User, User.id == FindingNote.author_id)
        .where(FindingNote.finding_id == parsed_id)
    )
    total = db.session.scalar(
        select(func.count()).select_from(FindingNote).where(FindingNote.finding_id == parsed_id)
    )
    offset = (page - 1) * page_size
    if offset >= total:
        return jsonify(items=[], **pagination(page, page_size, total))
    rows = db.session.execute(
        query.order_by(FindingNote.created_at.asc(), FindingNote.id.asc())
        .offset(offset)
        .limit(page_size)
    ).all()
    return jsonify(
        items=[
            {
                "id": str(note.id),
                "author": username,
                "body": note.body,
                "created_at": iso_utc(note.created_at),
            }
            for note, username in rows
        ],
        **pagination(page, page_size, total),
    )


@bp.post("/findings/<finding_id>/notes")
@login_required
def add_note(finding_id: str):
    if current_user.role != "analyst":
        return problem(403, "Forbidden", "This action requires the analyst role.")
    payload, error = json_object()
    if error:
        return error
    if set(payload) != {"body"}:
        return _field_error("body")
    body = payload.get("body")
    if not isinstance(body, str) or not body.strip() or len(body) > 4000:
        return _field_error("body")
    parsed_id = _parse_finding_id(finding_id)
    finding = db.session.get(Finding, parsed_id) if parsed_id else None
    if finding is None:
        return problem(404, "Not found", "The requested finding does not exist.")

    note = FindingNote(finding_id=finding.id, author_id=current_user.id, body=body.strip())
    db.session.add(note)
    db.session.flush()
    event = AuditEvent(
        finding_id=finding.id,
        actor_id=current_user.id,
        event_type="finding.note_added",
        occurred_at=note.created_at,
        details={"note_id": str(note.id)},
        request_id=UUID(g.request_id),
    )
    db.session.add(event)
    db.session.commit()
    return (
        jsonify(
            id=str(note.id),
            author=current_user.username,
            body=note.body,
            created_at=iso_utc(note.created_at),
        ),
        201,
    )


@bp.get("/findings/<finding_id>/history")
@login_required
def list_history(finding_id: str):
    parsed_id = _parse_finding_id(finding_id)
    if parsed_id is None or db.session.get(Finding, parsed_id) is None:
        return problem(404, "Not found", "The requested finding does not exist.")
    page, page_size, error = parse_page_args()
    if error:
        return error
    query = (
        select(AuditEvent, User.username)
        .join(User, User.id == AuditEvent.actor_id)
        .where(AuditEvent.finding_id == parsed_id)
    )
    total = db.session.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.finding_id == parsed_id)
    )
    offset = (page - 1) * page_size
    if offset >= total:
        return jsonify(items=[], **pagination(page, page_size, total))
    rows = db.session.execute(
        query.order_by(AuditEvent.occurred_at.asc(), AuditEvent.id.asc())
        .offset(offset)
        .limit(page_size)
    ).all()
    return jsonify(
        items=[
            {
                "id": str(event.id),
                "actor": username,
                "event_type": event.event_type,
                "occurred_at": iso_utc(event.occurred_at),
                "details": event.details,
                "request_id": str(event.request_id) if event.request_id else None,
            }
            for event, username in rows
        ],
        **pagination(page, page_size, total),
    )
