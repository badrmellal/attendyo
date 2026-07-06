# ===========================================================================
# LIWAN API — FastAPI backend.
# Slim CPU-only image. No GPU, no cloud dependencies. Runs on any x86/ARM box.
#
# Build context is the REPO ROOT (see docker-compose.yml) so the image can
# bundle db/schema.sql + db/migrations/ for self-healing startup migrations:
#   docker build -f services/api/Dockerfile .
# ===========================================================================
FROM python:3.12-slim

# System deps: libpq for psycopg2 runtime, build tools dropped (binary wheels).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first for layer caching.
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Application code.
COPY services/api/app /app/app

# Database schema + idempotent migrations, baked into the image so the API can
# self-heal the schema on startup even when the Postgres init script never ran.
COPY db /app/db

# Demo/admin scripts, so `docker compose exec liwan-api python scripts/seed_demo.py`
# works out of the box with no extra install step.
COPY scripts /app/scripts

# Media lives on a volume.
RUN mkdir -p /data/media

EXPOSE 8088

# Honest healthcheck against the API's own /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8088/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
