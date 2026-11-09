"""Run migrations and synthetic seed data before the local Flask development server."""

import os
import subprocess
import sys

FLASK = [sys.executable, "-m", "flask", "--app", "tracker:create_app"]
# The development container listens internally; Compose publishes only to host loopback.
DEV_HOST = "0.0.0.0"  # nosec B104

for command in (FLASK + ["db", "upgrade"], FLASK + ["seed-demo"]):
    subprocess.run(command, check=True)

os.execv(sys.executable, FLASK + ["run", "--no-reload", "--host", DEV_HOST, "--port", "5000"])
