# Backend

The Flask API uses PostgreSQL, Alembic migrations, Argon2id password hashes, server-side sessions, CSRF tokens, and analyst/viewer authorization. It accepts only synthetic findings. The Compose setup is local-only; deployment and AWS are out of scope.

## Local setup

From the repository root, copy `.env.example` to `.env`, then replace `POSTGRES_PASSWORD` and `SECRET_KEY` with distinct random local-only values. Use a hex password so it can be embedded safely in the PostgreSQL URL. Flask's CLI loads `.env` through the pinned `python-dotenv` dependency.

Start PostgreSQL with `docker compose up -d db`. In this directory, create and activate a Python 3.12 virtual environment, then install the pinned dependencies and package:

```text
python -m pip install -r requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
python -m flask --app tracker:create_app db upgrade
python -m flask --app tracker:create_app seed-demo
python -m flask --app tracker:create_app create-user analyst --role analyst
python -m flask --app tracker:create_app run --host 127.0.0.1
```

The account command prompts for a password and stores only its Argon2id hash. `GET /api/v1/auth/csrf` provides the token required in `X-CSRFToken` for login and other state-changing requests. The session cookie is HttpOnly, host-only, and SameSite=Lax; set `SESSION_COOKIE_SECURE=true` when running over HTTPS.

The Compose API container runs migrations and `seed-demo` at startup. Create a login with `docker compose exec api flask --app tracker:create_app create-user analyst --role analyst`. Sample records are fabricated and can be loaded repeatedly without deleting existing records; see [seed-data conventions](../database/seed/README.md).

Preview the Access Analyzer import shape using only the committed synthetic fixture:

```text
flask --app tracker:create_app access-analyzer-preview
```

This command reports aggregate counts, performs no database writes, and makes no AWS calls. See the [importer notes](../docs/importer.md) for the current adapter boundary and field handling.

This repository currently uses synthetic findings only. Live AWS reads, deployment, and cloud resource creation are outside the implemented scope.
