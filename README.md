# AWS Security Triage Lab

A local-first project for exploring how AWS security findings can enter an analyst's investigation queue, retain their history, and be reviewed safely.

## Current state

- The repository has a responsive React and TypeScript dashboard with findings charts and a Region map.
- The dashboard and this repository's Flask/PostgreSQL API use synthetic findings.
- The API includes session-based analyst/viewer roles, notes, audit history, and filtered analytics endpoints.
- Finding details show provider status, public access, and timestamps separately from analyst status. The dashboard labels application-assigned values as triage priority.
- The importer supports a bounded synthetic preview and a confirmed local fixture import; no live AWS connection is available.
- No live AWS reads, AWS resource creation, or deployment have been performed or authorized.
- The GitHub repository is public. Treat every pushed file, commit, and screenshot as visible to anyone.

## Project direction

The dashboard shows findings by resource type, findings over time, and resource locations classified as an AWS Region, global, or unknown. Analytics use the last 30 UTC calendar days and aggregate every matching finding, independent of table pagination. The map uses approximate positions for common Region codes; other codes remain in the count list. Source-IP geography is a separate concept and is not presented as resource location. See the [AWS Region reference](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html) for Region codes and geography.

The first AWS source under consideration is IAM Access Analyzer external-access findings. The planned live reader will use bounded, read-only access and a field allowlist. The current synthetic importer supports a preview and idempotent writes that preserve analyst status, notes, and audit history. Its local triage rule assigns High priority to reported public access and Medium to other external access; this rule is explained in finding details.

See the evolving project documents:

- [Project plan](docs/project-plan.md)
- [Architecture](docs/architecture.md)
- [API contract](docs/api-contract.md)
- [Importer notes](docs/importer.md)
- [Automated checks](docs/testing.md)
- [Data handling and authorization](docs/data-handling.md)

## Preview the dashboard

Copy `.env.example` to `.env`. Replace the local-only PostgreSQL password and Flask secret key with distinct random values; use a hex password so it is safe inside the database URL. From the repository root, start the local database, API, and frontend:

```text
docker compose up --build
```

Create a local analyst login in another terminal:

```text
docker compose exec api flask --app tracker:create_app create-user analyst --role analyst
```

Open <http://127.0.0.1:5173> and sign in. The Compose services bind to host loopback and load fabricated findings only. For a non-Compose setup, see [backend setup](backend/README.md).

Theme colors, fonts, surfaces, and responsive breakpoints are in [styles.css](frontend/src/styles.css). GitHub runs frontend lint, tests, and a production build, alongside the backend database checks. Local commands are in the [testing guide](docs/testing.md).

## Scope boundaries

The initial pilot is intended for one explicitly approved sandbox account and one AWS Region, with the application and database running locally. It does not include public hosting, AWS application infrastructure, or a paid logging pipeline. Current service terms and costs must be reviewed before selecting or enabling AWS services.

Use fabricated fixtures in source control and CI. Never commit real finding payloads, credentials, account or resource identifiers, principal details, or screenshots containing live data. Live access and retention require explicit authorization for the account, Region, fields, access list, and purge date.
