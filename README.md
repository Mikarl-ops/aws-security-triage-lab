# AWS Security Triage Lab

A local-first project for exploring how AWS security findings can enter an analyst's investigation queue, retain their history, and be reviewed safely.

## Current state

- The repository has a responsive React and TypeScript dashboard baseline.
- The dashboard currently uses synthetic findings and the API contract from the separate [Cloud Security Findings Tracker](https://github.com/Mikarl-ops/cloud-security-findings-tracker).
- This repository does not yet contain its own Flask API, PostgreSQL schema, or AWS importer.
- No live AWS reads, AWS resource creation, or deployment have been performed or authorized.
- The GitHub repository is public. Treat every pushed file, commit, and screenshot as visible to anyone.

## Project direction

The first application slice is server-backed analytics: findings by resource type and findings over time. Aggregates must cover all matching findings, not just the current table page. A Region map can follow once resource location is modeled as regional, global, or unknown. Source-IP geography is a separate concept and must not be presented as resource location.

The first AWS source under consideration is IAM Access Analyzer external-access findings. The planned importer is read-only, bounded, idempotent, and uses a field allowlist. It will support a dry run and preserve analyst-owned status, notes, and audit history when provider data changes. A documented local priority rule will be used where triage needs one; provider severity is not assumed.

See the evolving project documents:

- [Project plan](docs/project-plan.md)
- [Architecture](docs/architecture.md)
- [Data handling and authorization](docs/data-handling.md)

## Preview the dashboard

Start the separate tracker's local API and database with its synthetic seed and a local analyst account. From `frontend/`, use the Node version in `.nvmrc` and run:

```text
npm ci
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Open <http://127.0.0.1:5180> and sign in. Vite proxies API calls to `http://127.0.0.1:5000` by default. Set `VITE_API_PROXY_TARGET` before starting Vite if the local API uses a different port.

Theme colors, fonts, surfaces, and responsive breakpoints are in [styles.css](frontend/src/styles.css). The frontend scripts include linting, tests, and a production build; run them when implementation work calls for verification.

## Scope boundaries

The initial pilot is intended for one explicitly approved sandbox account and one AWS Region, with the application and database running locally. It does not include public hosting, AWS application infrastructure, or a paid logging pipeline. Current service terms and costs must be reviewed before selecting or enabling AWS services.

Use fabricated fixtures in source control and CI. Never commit real finding payloads, credentials, account or resource identifiers, principal details, or screenshots containing live data. Live access and retention require explicit authorization for the account, Region, fields, access list, and purge date.
