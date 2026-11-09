# Project plan

This is the working plan for the AWS Security Triage Lab. Update it when scope, sequence, or acceptance criteria change.

## Goal

Build a local analyst queue that can ingest a small, approved set of AWS security findings, retain their provider provenance, and support safe analyst review. The project should demonstrate how provider updates interact with analyst decisions and audit history.

## Pilot boundary

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
- Keep provider status separate from analyst triage status.
- Define a documented local priority rule if the UI needs severity-like prioritization; do not invent provider severity.

The first implementation uses the existing synthetic severity field for the dashboard. Before importing Access Analyzer records, define and label any local priority mapping separately from provider-owned fields.

### 2. Region data model and map

- Model resource location explicitly as an AWS Region, global, or unknown.
- Keep source-IP geolocation separate from resource location.
- Add a Region map after the data model can express those distinctions reliably.

### 3. Read-only importer foundation

- Implement a provider adapter with a single configured analyzer, bounded pagination, and a maximum batch size.
- Allowlist fields before persistence; keep raw provider payloads out of ordinary logs and public artifacts.
- Build a stable provider key scoped to its analyzer and make repeated imports idempotent.
- Include dry-run aggregate counts and clear handling for empty pages, malformed records, and access errors.
- On provider updates, update provider-owned fields without overwriting analyst status, notes, resolution reasons, or audit events.
- Use fabricated fixtures for pagination, deduplication, update, and failure scenarios.

### 4. Controlled live pilot

Before the first AWS read, record explicit approval for the account and Region, permitted fields, temporary read-only role, database access list, retention window, and purge date. Compare an approved finding with the AWS console without copying identifiers or payloads into public materials. An empty analyzer is a valid result.

## Pilot acceptance

- A bounded dry run reports aggregate counts and writes no findings.
- Importing the same fixture twice creates no duplicates.
- A provider update changes only provider-owned data.
- Analyst status, notes, resolution decisions, and audit history survive re-import.
- A viewer can read findings but receives a server-side denial when attempting to modify them.
- Public examples and CI use synthetic data only.
- Live verification remains marked pending until an approved read actually occurs.
