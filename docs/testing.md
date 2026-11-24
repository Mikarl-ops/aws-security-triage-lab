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
| Provider reads | Fixed analyzer, pagination forwarding, bounded page and batch sizes, repeated tokens, invalid synthetic resume offsets, sanitized provider errors |
| Normalization | Required fields, timezone-aware input, analyzer-scoped keys, regional/global/unknown resource placement |
| Preview | Aggregate output, duplicate and malformed-record counts, no database setup, no raw identifiers in the report |
| Persistence | Repeat imports perform zero writes; newest duplicate snapshots win across pages; older replays are counted and skipped; provider changes preserve analyst decisions, notes, and audit history |
| Transactions | Truncation writes nothing; a failure after flushing rolls back both changed and new findings |
| Schema | Full migrations, model drift detection, complete provider-field constraints, downgrade/upgrade with existing synthetic rows |
| Permissions | Authenticated viewers can read imported fields and receive a denial for status changes or notes with a valid CSRF token |
| Fixture command | Explicit confirmation, development/local target guards, successful repeat imports on PostgreSQL |
| Provider history | Initial and refreshed before/after values; no history for unchanged/stale records; rollback with findings; unique finding versions; authenticated paging and value minimization |
| Analyst conflicts | An intervening provider or colleague update rejects an old version with 409; refetch and explicit retry record one status event; rejected writes preserve both histories and existing notes |
| Analyst record pages | More than 25 notes and events remain reachable exactly once across pages; timestamp ties use deterministic UUID ordering; totals, empty out-of-range pages, finding isolation, authentication, roles, and invalid queries |
| Note retries | Original response on replay; one note and audit event; author/finding scopes; conflicting text and invalid UUIDs; unkeyed compatibility; rollback and a simultaneous PostgreSQL insert race |
| Provider filters | Active/Archived/Resolved/null cohorts; independent analyst status; combined source/priority/date criteria; full aggregates beyond page one; legacy data, malformed/repeated values, authentication, and roles |

SQLite drops timezone markers when loading timestamps. The importer compares timestamp values as UTC instants so a database round trip does not turn an unchanged fixture into an update. PostgreSQL exercises the same invariant using its native timestamp handling.

Freshness scenarios replay the baseline fixture after a newer provider update and check that provider fields, analyst status, resolution reason, row version, and application update time remain intact. Other cases verify update-time precedence, analysis-time tie-breaking, and latest-duplicate selection in either page order. The [importer notes](importer.md#provider-freshness-rule) define the local ordering policy.

Provider-filter cases use more than 25 recent matching records plus an older match to verify complete analytics and the difference between queue totals and the 30-day chart/map window. The committed baseline/update scenarios also verify that a provider refresh moves a finding into Archived results while leaving its analyst status New and preserving other archived findings in that result set.

## Run frontend checks locally

Use the Node version recorded in `.nvmrc`. From `frontend/`, run:

```text
npm ci
npm run lint:config
npm run lint
npm test
npm run build
```

The dashboard tests cover independent provider and analyst status, the public-access flag, UTC provider timestamps, the absence of provider data, and provider context after an analyst update. Provider history cases cover before/after values, older/newer pages, empty results, retries, expired sessions, and safe text rendering. Other tests cover priority filters sent through the existing API contract, authentication and viewer controls, and analytics loading/error recovery. API responses are mocked, so these tests need no running backend. Server permission checks remain covered by the backend suite.

Provider selector cases check the same criteria reach the queue and both analytics APIs, visible counts follow the selected cohort, and provider values remain distinct from analyst status. They also exercise no-provider/empty results, clearing filters from both controls, and selecting a provider state after navigating to queue page 2. API-client cases verify `ARCHIVED` and `none` query serialization with same-origin credentials.

Review recovery cases cover rejected status/note saves without a stuck queue, provider-version conflicts with retained resolution and note drafts, disabled saves during or after a failed detail refresh, valid transitions after a status refresh, text entered while a save is pending, and late success/failure responses after closing or reopening a review. Successful old requests still refresh the queue without reloading another finding's drawer. The [manual walkthrough](review-workflow.md) uses the same committed synthetic scenarios.

Manual refresh cases verify new provider context, notes, activity, and history while retaining both drafts and current dashboard filters. They cover provider history recovery at an unchanged version, one history reload when a newer detail version arrives, returning a page-two queue to page 1 without closing its review, viewer controls, failed/expired reads, delayed responses after switching findings, and disabling refresh while a write is pending. Lost-note-response cases exercise both refresh controls and require the original submission key to survive. A reviewed status save after refresh must use the new version.

Analyst record cases verify newest-page discovery with bounded reads, full totals, older/newer navigation, independent lists, empty results, initial/newest/older-page read recovery, session recovery, and ignoring delayed responses after switching findings. An integrated mocked-API scenario starts with 25 notes and events, saves a 26th note and a status change, and checks the new records appear on page 2 while the other form's draft survives. Another case verifies that a failed notes read does not block finding details, activity, or editing.

The backend conflict cases use real authenticated requests and CSRF validation, with a fresh application context per request so authentication and CSRF caches do not leak between the migration fixture's requests. They test an ordered interleaving of reads and writes on SQLite and PostgreSQL; they do not simulate simultaneous database transactions or browser interaction with a running API.

The note retry suite separately tests concurrent PostgreSQL transactions. Two authenticated sessions wait at an insert barrier, submit the same scoped key, and must receive the same note with one audit event. SQLite skips that case; both databases check uniqueness, rollback after an audit failure, legacy append behavior, and upgrade/downgrade preservation. A schema downgrade removes retry keys while retaining notes, which the migration tests check explicitly.

Frontend retry cases simulate a note committing before its response is lost, reload details while retaining the draft, and verify an explicit retry sends the original key and leaves one mocked note/event. Other cases require new keys after edited text, reopening, or an acknowledged intentional repeat. The API client checks optional key serialization and fresh CSRF tokens. These mocked tests do not simulate an actual browser network interruption.

The confirmed fixture command's PostgreSQL test imports the committed baseline, repeats it, applies `--scenario provider-update`, and replays the stale baseline. Other command tests reject arbitrary scenario names and database connection query overrides before connecting.

## GitHub checks

[Backend checks](../.github/workflows/backend-checks.yml) runs for pull requests and pushes to `main`. Its two jobs run the suite on SQLite and a disposable PostgreSQL 18.6 service. The SQLite job also runs Ruff. Both jobs install the committed Python dependency lock and use actions pinned to exact commits from the official [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-python](https://github.com/actions/setup-python/releases/tag/v7.1.0) releases.

The backend workflow has read-only repository permission, stores no checkout credentials, and uses public dummy credentials only for its temporary database service. AWS metadata lookup is disabled.

[Frontend checks](../.github/workflows/frontend-checks.yml) runs lint-configuration checks, ESLint, Vitest, and the production build on pull requests and pushes to `main`. It installs the committed npm lock using the Node version in `.nvmrc` and pins the official [setup-node release](https://github.com/actions/setup-node/releases/tag/v7.1.0) to an exact commit. It has read-only repository permission and stores no checkout credentials.

These checks establish synthetic application behavior; live AWS verification remains pending under the [data-handling boundary](data-handling.md).
