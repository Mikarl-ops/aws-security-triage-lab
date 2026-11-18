# Project plan

This is the working plan for the AWS Security Triage Lab. Update it when scope, sequence, or acceptance criteria change.

## Goal

Build a local analyst queue that can ingest a small, approved set of AWS security findings, retain their provider provenance, and support safe analyst review. The project should demonstrate how provider updates interact with analyst decisions and audit history.

## Pilot boundary

The current development milestone remains entirely synthetic. Live pilot work is deferred until an explicit scope is agreed.

- One approved sandbox AWS account and one Region.
- Local React, Flask, and PostgreSQL components.
- Read-only provider access through temporary credentials.
- IAM Access Analyzer external-access findings as the first planned source.
- Synthetic data for development, automated checks, and public examples.
- No live read until the account, Region, fields, access list, retention period, and purge date are explicitly approved.

Current AWS service terms and costs must be verified before choosing or enabling a service. CloudTrail Event history may later provide management-event context. GuardDuty is a later option only if suitable findings already exist and its metered use is approved.

## Delivery sequence

### 1. Analytics contracts and dashboard

- [x] Add aggregate API responses for counts by resource type and findings over time.
- [x] Calculate aggregates over the complete filtered result set, independent of table pagination.
- [x] Define timestamp semantics, time buckets, filter behavior, empty states, and treatment of unknown resource types.
- [x] Render responsive charts for resource types and daily observations in the dashboard.
- [x] Show provider status, public-access flag, and provider timestamps separately from analyst triage status.
- [x] Label local triage priority and explain the Access Analyzer rule in finding details.
- [x] Run dashboard lint, behavior tests, and production builds in CI.

Synthetic Access Analyzer imports use a documented application priority: public findings receive `high` and non-public external findings receive `medium` in the stored `severity` field. The UI calls this Triage priority and labels analyst status explicitly. Provider context is read-only and displayed in its own section; Access Analyzer severity is not inferred.

### 2. Region data model and map

- [x] Model resource location explicitly as an AWS Region, global, or unknown.
- [x] Keep source-IP geography separate from resource location.
- [x] Add a Region map after the data model can express those distinctions reliably.

The map plots approximate positions for supported Region codes. Other codes remain visible in the count list without a plotted marker. Global and unknown findings have separate counts and are never assigned map coordinates.

### 3. Read-only importer foundation

- [x] Implement an injected provider adapter for a configured analyzer, with bounded pagination and a maximum batch size.
- [x] Normalize an allowlist of provider fields for a synthetic dry run; keep raw provider payloads out of ordinary logs and public artifacts.
- [x] Build and persist a stable provider key scoped to its analyzer for idempotent imports.
- [x] Include synthetic dry-run aggregate counts and bounded handling for malformed records and pagination errors.
- [x] Make repeated synthetic fixture imports idempotent and preserve analyst-owned fields.
- [x] Reject invalid synthetic resume offsets and retain the newest duplicate snapshot across pages.
- [x] Skip older provider snapshots during re-import and report aggregate stale-record counts.
- [ ] Enable a real AWS client only after the account, Region, exact fields, access list, retention period, and purge date are explicitly approved.
- [x] On provider updates, update provider-owned fields without overwriting analyst status, notes, resolution reasons, or audit events.
- [x] Add fabricated fixtures and automated checks for duplicate, provider-update, and failed-transaction scenarios.
- [x] Run migrations, ownership checks, and fixture-command checks against a disposable PostgreSQL service in CI.

### 4. Synthetic provider history

- [x] Record allowlisted provider changes in the same transaction as finding imports.
- [x] Keep provider change records separate from analyst activity and preserve existing records on replay.
- [x] Expose authenticated, read-only history pages and display before/after values in the drawer.
- [x] Provide committed baseline and update scenarios for a reproducible local demonstration.
- [x] Cover history minimization, pagination, access, retry, stale/no-op imports, and rollback in automated checks.

### 5. Synthetic review recovery

- [x] Keep the queue usable after rejected status and note saves.
- [x] Retain open review drafts when details refresh after a version conflict.
- [x] Require a successful detail refresh and an explicit reviewed retry before another save.
- [x] Keep delayed save results and errors associated with the review where they started.
- [x] Preserve newer text typed while an earlier save is pending.
- [x] Verify provider and colleague updates reject stale analyst versions without changing either history.
- [x] Document a reproducible synthetic conflict demonstration and the lifetime of unsaved drafts.

Drafts remain in memory for the open finding only. They are not browser storage or a durable draft feature. See the [review workflow](review-workflow.md) for recovery behavior and limitations.

### 6. Complete analyst record browsing

- [x] Expose notes and analyst activity beyond the first 25 records in the dashboard.
- [x] Open the newest page using bounded API reads and display total counts separately from page contents.
- [x] Page notes and activity independently, without replacing unsaved review drafts.
- [x] Return to the newest records after successful saves and finding refreshes.
- [x] Handle list failures and expired sessions without presenting unavailable records as an empty history.
- [x] Verify deterministic ordering, finding isolation, page bounds, roles, retries, and delayed responses with synthetic examples.

The API keeps chronological ordering within each page. The dashboard initially discovers the last page and provides older/newer navigation. Counts reflect the latest response; pages are not a frozen snapshot across requests.

### 7. Controlled live pilot — deferred

Before the first AWS read, record explicit approval for the account and Region, permitted fields, temporary read-only role, database access list, retention window, and purge date. Compare an approved finding with the AWS console without copying identifiers or payloads into public materials. An empty analyzer is a valid result.

## Pilot acceptance

- [x] A bounded dry run reports aggregate counts and writes no findings.
- [x] Importing the same fixture twice creates no duplicates or unnecessary updates.
- [x] Replaying an older provider snapshot leaves newer provider data and row versions intact.
- [x] A provider update changes only provider-owned and application-derived data.
- [x] Analyst status, notes, resolution decisions, and audit history survive re-import.
- [x] Provider changes retain a paged history that survives alongside analyst activity.
- [x] A stale analyst save leaves current provider and analyst data intact; an explicit retry uses the refreshed version.
- [x] Unsaved review text survives in-place refreshes, and earlier requests cannot replace a later review.
- [x] Analysts can reach notes and activity beyond the first page, with full totals and retained drafts.
- [x] A viewer can read findings but receives a server-side denial when attempting to modify them.
- [x] Public examples and CI use synthetic data only.
- Live verification remains marked pending until an approved read actually occurs.

These checked items are covered by the synthetic [application regression suites](testing.md). They do not represent live AWS verification.
