# AWS Security Triage Lab

A fresh implementation repository for the AWS Security Triage Lab. It starts from the tested responsive dashboard baseline and has its own Git history. The current app is frontend-only and uses synthetic findings; no importer or live AWS connection is included.

## Preview the dashboard

Start the [original tracker's local API and database](https://github.com/Mikarl-ops/cloud-security-findings-tracker#start-the-local-application) with its synthetic seed and a local analyst account. The preview uses the same API contract. From `frontend/`, use the Node version in `.nvmrc` and run the following commands.

```text
npm ci
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Open <http://127.0.0.1:5180> and sign in. Vite proxies API calls to `http://127.0.0.1:5000` by default. Set `VITE_API_PROXY_TARGET` in the environment before starting Vite if your local API runs on a different port.

Theme colors, fonts, surfaces, and responsive breakpoints are in [styles.css](frontend/src/styles.css). The stylesheet uses CSS custom properties and local fonts. From `frontend/`, run `npm run lint`, `npm run lint:config`, `npm test`, and `npm run build` to verify changes.

## AWS services for the pilot

| Service | Role in the lab | Cost boundary |
|---|---|---|
| IAM Access Analyzer, external access | First source of AWS-generated findings. Shows when supported resource policies allow access from outside the account's zone of trust. Use an existing external analyzer if available. | External access findings are offered at no charge. Internal and unused access analyzers have separate charges. [AWS pricing](https://aws.amazon.com/iam/access-analyzer/pricing/) |
| AWS CloudTrail Event history | Second adapter for selected management events, such as a recorded policy change. Keep these as evidence with their own provenance. | AWS offers the past 90 days of management events per Region at no charge. This path uses Event history and `LookupEvents`. Trails and storage have separate billing rules. [Event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html) · [Pricing](https://aws.amazon.com/cloudtrail/pricing/) |
| AWS CloudShell | Optional way for the account operator to confirm a finding or look up an event with the AWS CLI. | AWS charges no additional fee for CloudShell. Resources used by commands and data transfer can still incur charges. [CloudShell pricing](https://aws.amazon.com/cloudshell/pricing/) |
| Amazon GuardDuty | Later adapter if genuine detections are already available in the sandbox. | AWS offers eligible 30-day trials. Ongoing usage is metered. [GuardDuty pricing](https://aws.amazon.com/guardduty/pricing/) |

The proposed first pilot keeps React, Flask, and PostgreSQL on a local machine. It needs no AWS application hosting or paid logging pipeline. New-account Free Tier credits have eligibility and expiration rules and are outside this baseline. [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/)

## Architecture decision

Reuse the React dashboard, Flask session and role checks, PostgreSQL finding model, notes, and transactional audit history from the [Cloud Security Findings Tracker](https://github.com/Mikarl-ops/cloud-security-findings-tracker). Start this repository with its own history, fixtures, and release process. Review the original code against the pilot's threat model before bringing it over. A clean-sheet rewrite would require rebuilding the analyst workflow before testing the new data path.

```text
AWS Access Analyzer in one approved account and Region
    -> local Python importer with temporary read-only AWS access
    -> field allowlist, dry-run validation, and idempotent import
    -> local PostgreSQL -> Flask -> React analyst and viewer workflows
```

The existing [CloudTrail Response Lab](https://github.com/Mikarl-ops/aws-cloudtrail-response-lab) covers failed console sign-in detection and an optional EventBridge, Lambda, and SNS path. This project focuses on the investigation queue and how a provider's findings are retained, updated, and reviewed. CloudTrail events can later provide context for a case.

## First deliverable

1. Define the read-only importer against a single external analyzer ARN and a bounded batch. Test pagination, empty results, malformed records, and AWS access errors with fabricated fixtures. Use `ListFindingsV2` for summaries and request individual details only when a field is explicitly approved. [ListFindingsV2](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_ListFindingsV2.html)
2. Define the field allowlist. Start with source, a stable provider finding key scoped to the analyzer, resource type, provider status, and timestamps. Keep provider status separate from analyst status. If the triage team needs a priority, use a documented local rule. External-access finding summaries have no provider severity field.
3. Implement a dry run that reports aggregate counts. Prove that a repeated batch creates zero duplicates and a later provider update preserves local status, notes, and audit history. Demonstrate that a viewer can read the record and receives a server-side denial when attempting to edit it.
4. Before the live read, agree on the authorized account and Region, approved fields, who can access the dedicated pilot database, and when the data will be purged. Compare an approved real finding with the AWS console. An empty analyzer is a valid result and leaves live finding verification pending.

Keep real event bodies, credentials, principal and resource identifiers, and live screenshots out of Git, CI, and portfolio material. Use fabricated fixtures for automated checks. The pilot records triage decisions locally and grants the importer read permissions in AWS.
