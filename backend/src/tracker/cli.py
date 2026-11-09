"""Local administrative commands. No user credentials are stored in source files."""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

import click
from argon2 import PasswordHasher
from sqlalchemy import select

from .extensions import db
from .models import Finding, User

USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
SOURCE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
SEED_FIELDS = {
    "source",
    "source_event_id",
    "title",
    "description",
    "evidence_summary",
    "metadata",
    "severity",
    "status",
    "observed_at",
    "resolution_reason",
}
SEED_METADATA_FIELDS = {"region", "account_id", "resource_id", "resource_type", "event_name"}
SEVERITIES = {"critical", "high", "medium", "low", "informational"}
STATUSES = {"new", "investigating", "resolved", "dismissed"}


def _seed_file() -> Path:
    configured_path = os.environ.get("DEMO_SEED_FILE")
    if configured_path:
        return Path(configured_path)
    return Path(__file__).resolve().parents[3] / "database" / "seed" / "findings.json"


def _validated_seed_records(path: Path) -> list[dict]:
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise click.ClickException(f"Could not read synthetic seed data: {error}") from error
    if not isinstance(records, list) or not records:
        raise click.ClickException("Synthetic seed data must be a non-empty JSON array.")

    validated = []
    seen_keys = set()
    for index, record in enumerate(records, start=1):
        prefix = f"Seed record {index}"
        if not isinstance(record, dict) or set(record) != SEED_FIELDS:
            raise click.ClickException(f"{prefix} must contain exactly the documented fields.")
        for field, limit in (
            ("source_event_id", 255),
            ("title", 200),
            ("description", 4000),
            ("evidence_summary", 4000),
        ):
            value = record[field]
            if not isinstance(value, str) or not value.strip() or len(value) > limit:
                raise click.ClickException(f"{prefix} has an invalid {field}.")
        if not record["source_event_id"].startswith("synthetic-"):
            raise click.ClickException(f"{prefix} must use a synthetic source event ID.")
        source = record["source"]
        if not isinstance(source, str) or not SOURCE_PATTERN.fullmatch(source):
            raise click.ClickException(f"{prefix} has an invalid source identifier.")
        key = (source, record["source_event_id"])
        if key in seen_keys:
            raise click.ClickException(f"{prefix} duplicates a source event identifier.")
        seen_keys.add(key)
        severity = record["severity"]
        status = record["status"]
        if (
            not isinstance(severity, str)
            or severity not in SEVERITIES
            or not isinstance(status, str)
            or status not in STATUSES
        ):
            raise click.ClickException(f"{prefix} has an unsupported severity or status.")
        try:
            observed_at = datetime.fromisoformat(record["observed_at"].replace("Z", "+00:00"))
        except (AttributeError, TypeError, ValueError) as error:
            raise click.ClickException(f"{prefix} observed_at must be RFC 3339.") from error
        if observed_at.tzinfo is None or observed_at.utcoffset() is None:
            raise click.ClickException(f"{prefix} observed_at must include a timezone.")
        metadata = record["metadata"]
        if not isinstance(metadata, dict) or set(metadata) - SEED_METADATA_FIELDS:
            raise click.ClickException(f"{prefix} metadata contains unsupported fields.")
        if any(not isinstance(value, (str, int, float, bool)) for value in metadata.values()):
            raise click.ClickException(f"{prefix} metadata values must be scalar.")
        reason = record["resolution_reason"]
        if record["status"] in {"resolved", "dismissed"}:
            if not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
                raise click.ClickException(f"{prefix} needs a resolution reason.")
        elif reason is not None:
            raise click.ClickException(f"{prefix} cannot have a resolution reason in this status.")
        validated.append(
            {
                **record,
                "observed_at": observed_at.astimezone(UTC),
                "metadata_json": metadata,
            }
        )
    return validated


def register_commands(app) -> None:
    @app.cli.command("seed-demo")
    @click.option(
        "--file",
        "seed_file",
        type=click.Path(path_type=Path, exists=False, dir_okay=False),
        default=None,
        help="Path to the synthetic demo findings JSON file.",
    )
    def seed_demo(seed_file: Path | None) -> None:
        """Add the documented synthetic demo findings without deleting records."""
        path = seed_file or _seed_file()
        records = _validated_seed_records(path)
        added = 0
        skipped = 0
        try:
            for record in records:
                existing = db.session.scalar(
                    select(Finding.id).where(
                        Finding.source == record["source"],
                        Finding.source_event_id == record["source_event_id"],
                    )
                )
                if existing is not None:
                    skipped += 1
                    continue
                db.session.add(
                    Finding(
                        **{
                            key: value
                            for key, value in record.items()
                            if key in SEED_FIELDS - {"metadata"}
                        },
                        metadata_json=record["metadata_json"],
                    )
                )
                added += 1
            db.session.commit()
        except Exception as error:
            db.session.rollback()
            raise click.ClickException("Synthetic findings could not be seeded.") from error
        click.echo(f"Synthetic findings: {added} added, {skipped} already present.")

    @app.cli.command("create-user")
    @click.argument("username")
    @click.option(
        "--role", type=click.Choice(["analyst", "viewer"]), default="analyst", show_default=True
    )
    def create_user(username: str, role: str) -> None:
        """Create a local analyst or read-only viewer account interactively."""
        normalized_username = username.strip().lower()
        if not USERNAME_PATTERN.fullmatch(normalized_username):
            raise click.ClickException(
                "Username must be 3 to 64 lowercase letters, digits, dots, underscores, or hyphens."
            )
        existing = db.session.scalar(select(User.id).where(User.username == normalized_username))
        if existing is not None:
            raise click.ClickException("That username already exists.")

        password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        if len(password) < 12 or len(password) > 128:
            raise click.ClickException("Password must be 12 to 128 characters.")
        user = User(
            username=normalized_username,
            password_hash=PasswordHasher().hash(password),
            role=role,
            is_active=True,
        )
        db.session.add(user)
        try:
            db.session.commit()
        except Exception as error:
            db.session.rollback()
            raise click.ClickException("The user could not be created.") from error
        click.echo(f"Created {role} account: {normalized_username}")
