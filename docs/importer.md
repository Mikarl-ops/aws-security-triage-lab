# IAM Access Analyzer importer

## Current behavior

`flask --app tracker:create_app access-analyzer-preview` reads only `database/seed/access-analyzer-findings.json`. It paginates the synthetic fixture, normalizes an allowlist, and prints aggregate counts. The command makes no AWS calls, performs no database reads or writes, and reports `writes_performed: 0`.

`flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic` writes only that committed synthetic fixture to PostgreSQL. It runs only when `APP_ENV=development` and the database host is loopback or the local Compose `db` service. It never creates an AWS client. Apply migrations first. If configured limits would truncate the fixture, the command aborts without writing; malformed and duplicate records are skipped and counted.

The page adapter accepts an injected boto3-compatible Access Analyzer client, but the application and preview command do not create that client or resolve AWS credentials. No live-read mode is enabled or authorized.

## AWS operation and limits

The planned source is IAM Access Analyzer external-access findings. AWS documents `ListFindings` as the paginated operation for external-access analyzers; each page can provide a `nextToken`. The adapter requests pages with one configured analyzer ARN and never uses a mutating API. See the [ListFindings API](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_ListFindings.html) and [FindingSummary fields](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_FindingSummary.html).

The reader caps page size at 100, findings per run at 1,000, and pages per run at 25. Repeated or invalid pagination tokens stop the preview with a sanitized error. The synthetic command defaults to a page size of two so the fixture exercises more than one page.

## Fields and minimization

The preview processes only the following fields from each finding:

- `id`, used with the analyzer ARN to calculate a stable SHA-256 provider key. Neither raw value is included in the report.
- `resourceType`, `status`, and `isPublic`, used for aggregate counts and local prioritization.
- `createdAt`, `updatedAt`, and `analyzedAt`, parsed as timezone-aware timestamps. If `analyzedAt` is absent, `updatedAt` supplies the preview observation time.
- `resource`, inspected in memory only to derive a Region from an ARN. It is never returned or persisted.

Other provider fields, including resource-owner account, principal, action, conditions, and evidence details, are ignored. Invalid records contribute only to an `invalid_records` count. `valid_records` counts unique, valid findings; duplicate provider keys are reported separately. The report contains no finding identifiers or raw payloads.

## Resource location and local priority

IAM roles and users are classified as global. Other resources are classified as regional only when their resource ARN contains a Region-shaped code; resources without enough information, including global-form resource ARNs that omit a Region, remain unknown. The analyzer's Region is not substituted for a resource Region, and source-IP geography is not used.

The preview labels public findings as local priority `high` and non-public external findings as `medium`. This is an application triage rule, not a provider severity. The synthetic fixture importer stores this application-assigned value in the dashboard's `severity` field; it does not claim that Access Analyzer supplied a severity.

## Persistence behavior

The fixture importer stores a SHA-256 key scoped to the analyzer in `source_event_id`. A row contains the provider status, public-access flag and timestamps; resource type; derived location, observation time, and local priority; and generated summary text. It does not store the analyzer ARN, raw finding ID, raw resource ARN, principal, action, conditions, or complete provider payload.

On repeat imports, the key and database uniqueness constraint prevent duplicate findings. Changed provider-derived fields update in place and increment the finding version. Analyst triage status, resolution reason, `updated_by`, notes, and audit events remain untouched. The application `updated_at` remains an application timestamp; provider timestamps are returned separately in the finding detail's `provider` object.

## Next implementation boundary

Before any live read, explicitly approve the account and Region, analyzer, exact fields, role, database access list, retention period, and purge date. A future command may then construct a read-only AWS client through the normal temporary-credential provider chain. No live-read command is available today.
