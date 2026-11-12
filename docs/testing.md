# Automated checks

The backend and dashboard suites use fabricated findings. Backend tests use disposable databases; frontend tests mock the API. Both suites exercise application behavior without AWS access.

## Run backend checks locally

After installing the backend's pinned dependencies and package, run these commands from `backend/`:

```text
python -m ruff check src tests
python -m pytest
```

By default, database tests apply the complete Alembic migration chain to a new SQLite file under pytest's temporary directory. The fixture import command intentionally rejects SQLite targets, so its successful-write scenario is skipped in this mode. Its confirmation and target-refusal cases still run.

For PostgreSQL, create a separate local test database whose name ends in `_test`, then set `TEST_DATABASE_URL` to its `postgresql+psycopg` connection URL and run the same commands. The test role needs permission to create schemas. Only loopback hosts are accepted, and URL query parameters are refused. Each database test creates a random `test_` schema, applies migrations there, and removes that schema afterward.

The test harness never uses the application's `DATABASE_URL`. It supplies its own Flask settings and test secret, and does not load an application environment file. No real findings, identifiers, credentials, or provider responses belong in fixtures or test output.

## Backend coverage

| Area | Regression checks |
|---|---|
| Provider reads | Fixed analyzer, pagination forwarding, bounded page and batch sizes, repeated tokens, sanitized provider errors |
| Normalization | Required fields, timezone-aware input, analyzer-scoped keys, regional/global/unknown resource placement |
| Preview | Aggregate output, duplicate and malformed-record counts, no database setup, no raw identifiers in the report |
| Persistence | Repeat imports perform zero writes; provider changes preserve analyst decisions, notes, and audit history |
| Transactions | Truncation writes nothing; a failure after flushing rolls back both changed and new findings |
| Schema | Full migrations, model drift detection, complete provider-field constraints, downgrade/upgrade with existing synthetic rows |
| Permissions | Authenticated viewers can read imported fields and receive a denial for status changes or notes with a valid CSRF token |
| Fixture command | Explicit confirmation, development/local target guards, successful repeat imports on PostgreSQL |

SQLite drops timezone markers when loading timestamps. The importer compares timestamp values as UTC instants so a database round trip does not turn an unchanged fixture into an update. PostgreSQL exercises the same invariant using its native timestamp handling.

## Run frontend checks locally

Use the Node version recorded in `.nvmrc`. From `frontend/`, run:

```text
npm ci
npm run lint:config
npm run lint
npm test
npm run build
```

The dashboard tests cover independent provider and analyst status, the public-access flag, UTC provider timestamps, the absence of provider data, and provider context after an analyst update. They also cover priority filters sent through the existing API contract, authentication and viewer controls, safe text rendering, and analytics loading/error recovery. API responses are mocked, so these tests need no running backend. Server permission checks remain covered by the backend suite.

## GitHub checks

[Backend checks](../.github/workflows/backend-checks.yml) runs for pull requests and pushes to `main`. Its two jobs run the suite on SQLite and a disposable PostgreSQL 18.6 service. The SQLite job also runs Ruff. Both jobs install the committed Python dependency lock and use actions pinned to exact commits from the official [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-python](https://github.com/actions/setup-python/releases/tag/v7.1.0) releases.

The backend workflow has read-only repository permission, stores no checkout credentials, and uses public dummy credentials only for its temporary database service. AWS metadata lookup is disabled.

[Frontend checks](../.github/workflows/frontend-checks.yml) runs lint-configuration checks, ESLint, Vitest, and the production build on pull requests and pushes to `main`. It installs the committed npm lock using the Node version in `.nvmrc` and pins the official [setup-node release](https://github.com/actions/setup-node/releases/tag/v7.1.0) to an exact commit. It has read-only repository permission and stores no checkout credentials.

These checks establish synthetic application behavior; live AWS verification remains pending under the [data-handling boundary](data-handling.md).
