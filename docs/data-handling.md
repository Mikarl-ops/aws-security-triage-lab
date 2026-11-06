# Data handling and authorization

The GitHub repository is public. Treat all pushed source, commit history, issues, and attachments as visible to anyone, even when a file is later removed from the current tree.

## Source-control rules

- Use fabricated findings and identifiers in fixtures, tests, screenshots, examples, and CI.
- Never commit AWS credentials, tokens, environment files, real finding payloads, principal or resource identifiers, account IDs, or screenshots containing live data.
- Keep local database files and runtime logs out of Git.
- Review a diff for secrets and real identifiers before any public push.
- Do not paste live provider responses into issues, pull requests, or portfolio material.

## AWS access boundary

No live AWS reads, resource provisioning, public application deployment, or AWS account changes are currently authorized. The intended importer is read-only and uses temporary credentials; it must not store credentials or send provider payloads to a public service.

Before a live read, obtain explicit agreement on:

1. The AWS account and Region.
2. The analyzer and exact provider fields to read and retain.
3. The read-only role and who may use it.
4. The people who can access the pilot database.
5. Retention duration, purge date, and deletion procedure.
6. Current service terms and any expected usage charges.

Record the approval and scope in the project notes before running the importer. An empty result is valid and must not be replaced with fabricated “real” findings.

## Local application access

Reuse the session-based analyst and viewer roles from the reference tracker after reviewing the code against this pilot's threat model. Enforce permissions on the server. Viewers are read-only; analyst changes must be version-checked and recorded in the same transaction as the audit event.

Keep raw evidence minimized. Store only approved summaries needed for triage, and keep provider provenance and analyst decisions distinguishable.
