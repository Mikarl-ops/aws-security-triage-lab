FROM python:3.12-alpine3.24

RUN apk upgrade --no-cache

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.lock /app/backend/requirements.lock
RUN python -m pip install --no-cache-dir -r /app/backend/requirements.lock

COPY backend/pyproject.toml backend/README.md /app/backend/
COPY backend/src /app/backend/src
COPY backend/migrations /app/backend/migrations
COPY backend/start_dev.py /app/backend/start_dev.py
COPY database/seed/findings.json /app/database/seed/findings.json

WORKDIR /app/backend
RUN python -m pip install --no-cache-dir --no-deps --no-build-isolation -e .

USER 10001:10001

EXPOSE 5000
CMD ["python", "start_dev.py"]
