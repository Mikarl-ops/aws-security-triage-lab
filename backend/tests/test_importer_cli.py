"""The preview must work without initializing the database extension."""

import json

import pytest
from flask import Flask

from tracker.cli import register_commands


@pytest.fixture
def command_app():
    app = Flask(__name__)
    register_commands(app)
    return app


def test_preview_needs_no_database(command_app):
    result = command_app.test_cli_runner().invoke(args=["access-analyzer-preview"])
    assert result.exit_code == 0, result.output
    report = json.loads(result.output)
    assert report["writes_performed"] == 0
    assert report["records_read"] == 3
    assert report["pages_read"] == 2
    assert report["by_location_scope"] == {"global": 1, "region": 1, "unknown": 1}


def test_fixture_import_requires_explicit_confirmation(command_app):
    result = command_app.test_cli_runner().invoke(args=["access-analyzer-import-fixture"])
    assert result.exit_code != 0
    assert "--confirm-synthetic" in result.output


@pytest.mark.parametrize(
    "environment,uri",
    [
        ("production", "postgresql+psycopg://localhost/triage_lab_test"),
        ("development", "postgresql+psycopg://synthetic-remote.invalid/triage_lab_test"),
        ("development", "sqlite:///:memory:"),
    ],
)
def test_fixture_import_rejects_unsupported_targets_before_connection(
    command_app, environment, uri
):
    command_app.config.update(APP_ENV=environment, SQLALCHEMY_DATABASE_URI=uri)
    result = command_app.test_cli_runner().invoke(
        args=["access-analyzer-import-fixture", "--confirm-synthetic"]
    )
    assert result.exit_code != 0
    assert "Error: The synthetic fixture import" in result.output
    assert not isinstance(result.exception, RuntimeError)
