"""Fabricated provider examples shared by the importer regression checks."""

import json
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SEED_FILE = BACKEND_DIR.parent / "database" / "seed" / "access-analyzer-findings.json"


@pytest.fixture
def synthetic_payload():
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


@pytest.fixture
def analyzer_arn(synthetic_payload):
    return synthetic_payload["analyzer_arn"]
