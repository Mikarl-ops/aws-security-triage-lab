# Synthetic seed data

`findings.json` contains fabricated records for local development and demonstrations. The identities, resources, event IDs, observations, and evidence are illustrative; they are not copied from cloud accounts or real security telemetry.

After applying the database migrations, run `flask --app tracker:create_app seed-demo` from the backend directory. The command validates the records, inserts any source/event pairs that are not already present, and leaves existing records untouched. It is safe to run again. To use another fixture file, pass `--file PATH` or set `DEMO_SEED_FILE`.

Keep sample metadata limited to the documented allowlisted fields: `region`, `account_id`, `resource_id`, `resource_type`, and `event_name`. Do not add credentials, personal data, raw network payloads, production identifiers, or real telemetry.
