"""Fabricated provider examples shared by the importer regression checks."""

import json
import os
import secrets
from pathlib import Path
from uuid import uuid4

import pytest
from flask_migrate import upgrade
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from tracker import create_app
from tracker.extensions import db

BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SEED_FILE = BACKEND_DIR.parent / "database" / "seed" / "access-analyzer-findings.json"


@pytest.fixture
def synthetic_payload():
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


@pytest.fixture
def analyzer_arn(synthetic_payload):
    return synthetic_payload["analyzer_arn"]


@pytest.fixture
def app(tmp_path):
    """Migrate a new SQLite file or a random schema in an explicit local test database."""
    test_url = os.environ.get("TEST_DATABASE_URL")
    schema = None
    engine_options = {"hide_parameters": True}
    if test_url:
        try:
            url = make_url(test_url)
        except Exception:
            raise pytest.UsageError(
                "TEST_DATABASE_URL must be a local PostgreSQL test URL."
            ) from None
        if (
            url.drivername != "postgresql+psycopg"
            or url.host not in {"localhost", "127.0.0.1", "::1"}
            or not url.database
            or not url.database.endswith("_test")
            or url.query
        ):
            raise pytest.UsageError(
                "TEST_DATABASE_URL must use local PostgreSQL, a database ending in _test, "
                "and no query parameters."
            )
        schema = "test_" + uuid4().hex
        engine_options["connect_args"] = {"options": f"-csearch_path={schema}"}
    else:
        test_url = "sqlite:///" + (tmp_path / "importer.sqlite").as_posix()

    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": secrets.token_hex(32),
            "APP_ENV": "development",
            "SQLALCHEMY_DATABASE_URI": test_url,
            "SQLALCHEMY_ENGINE_OPTIONS": engine_options,
            "SESSION_COOKIE_SECURE": False,
        }
    )
    with application.app_context():
        engine = db.engine
        schema_created = False
        schema_engine = None
        try:
            if schema:
                # Create it before the application's first connection so current_schema is valid.
                schema_engine = create_engine(test_url, hide_parameters=True)
                with schema_engine.begin() as connection:
                    connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
                schema_created = True
            upgrade(directory=str(BACKEND_DIR / "migrations"))
            yield application
        finally:
            db.session.remove()
            engine.dispose()
            if schema_created:
                # This name is generated above, never supplied by the environment or a test record.
                with schema_engine.begin() as connection:
                    connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
            if schema_engine:
                schema_engine.dispose()


@pytest.fixture
def database_session(app):
    return db.session()
