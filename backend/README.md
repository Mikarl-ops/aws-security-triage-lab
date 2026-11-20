# Backend

The Flask API uses PostgreSQL, Alembic migrations, Argon2id password hashes, server-side sessions, CSRF tokens, and analyst/viewer authorization. It accepts only synthetic findings. The Compose setup is local-only; deployment and AWS are out of scope.

## Local setup

From the repository root, copy `.env.example` to `.env`, then replace `POSTGRES_PASSWORD` and `SECRET_KEY` with distinct random local-only values. Use a hex password so it can be embedded safely in the PostgreSQL URL. Flask's CLI loads `.env` through the pinned `python-dotenv` dependency.

Start PostgreSQL with `docker compose up -d db`. In this directory, create and activate a Python 3.12 virtual environment, then install the pinned dependencies and package:

```text
python -m pip install -r requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
python -m flask --app tracker:create_app db upgrade
python -m flask --app tracker:create_app seed-demo
python -m flask --app tracker:create_app create-user analyst --role analyst
python -m flask --app tracker:create_app run --host 127.0.0.1
```

The account command prompts for a password and stores only its Argon2id hash. `GET /api/v1/auth/csrf` provides the token required in `X-CSRFToken` for login and other state-changing requests. The session cookie is HttpOnly, host-only, and SameSite=Lax; set `SESSION_COOKIE_SECURE=true` when running over HTTPS.

The Compose API container runs migrations and `seed-demo` at startup. Create a login with `docker compose exec api flask --app tracker:create_app create-user analyst --role analyst`. Sample records are fabricated and can be loaded repeatedly without deleting existing records; see [seed-data conventions](../database/seed/README.md).

Preview the Access Analyzer import shape using only the committed synthetic fixture:

```text
flask --app tracker:create_app access-analyzer-preview
```

This command reports aggregate counts, performs no database writes, and makes no AWS calls. See the [importer notes](../docs/importer.md) for the current adapter boundary and field handling.

After applying migrations, import the same fixture into the local development database with an explicit confirmation:

```text
flask --app tracker:create_app db upgrade
flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic
```

The import command accepts only the committed fixture, refuses non-development or non-local database targets, and never accesses AWS. Repeating it updates provider-owned fields in place while preserving analyst status, resolution reasons, notes, and audit history.

The import report counts skipped older snapshots in `stale_records`; these records leave the current data and row version intact. Duplicate keys across pages retain the newest provider snapshot. The [freshness rule](../docs/importer.md#provider-freshness-rule) uses provider update time first, then policy analysis time.

## Demonstrate synthetic provider history

Apply migrations before starting the updated API. The new `provider_events` table stores allowlisted before/after values alongside finding changes. Run these commands from this directory:

```text
flask --app tracker:create_app db upgrade
flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic
flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic --scenario provider-update
```

The update scenario changes the S3 finding's provider status, public-access flag, and local priority, and introduces a synthetic queue finding. In the dashboard, open the S3 finding to view Provider history and Analyst activity separately. On a fresh database the S3 history includes its first import and refresh. Existing findings start recording new changes after the migration; no historical events are invented.

Repeat the baseline command after the update to see the older S3 snapshot counted as stale. Repeated or stale records create no new history. The report's `writes_performed` counts finding rows; provider event rows are committed in the same transaction. The fixture command accepts named committed scenarios and refuses connection query overrides.

This repository currently uses synthetic findings only. Live AWS reads, deployment, and cloud resource creation are outside the implemented scope.

## Update an existing database for note retries

Apply the current migration before running the updated API against an existing local development database:

```text
flask --app tracker:create_app db upgrade
```

The note retry migration adds nullable `client_request_id` values and a unique constraint scoped to finding and author. Existing notes retain their IDs, text, authors, and timestamps. Keyed retries return the original note without another audit event; older callers that send only `body` continue to append notes independently. See the [API contract](../docs/api-contract.md#post-findingsfinding_idnotes) for replay and conflict responses.

Downgrading this migration preserves note records but removes their retry keys. Upgrading again leaves those old keys unset, so it cannot recover the previous replay protection. Normal forward upgrades retain the keys with their notes.

## Automated checks

With the dependencies installed, run from this directory:

```text
python -m ruff check src tests
python -m pytest
```

The default suite uses temporary SQLite databases and never uses the application's `DATABASE_URL`. GitHub also runs it against a disposable PostgreSQL service, including the confirmed fixture import command. See [test setup and coverage](../docs/testing.md) for local PostgreSQL instructions and the covered scenarios.
