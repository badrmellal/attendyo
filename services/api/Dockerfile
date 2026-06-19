# ===========================================================================
# LIWAN API — FastAPI backend.
# Slim CPU-only image. No GPU, no cloud dependencies. Runs on any x86/ARM box.
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
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Application code.
COPY app /app/app

# Schema + seed script are mounted/copied from the repo root at runtime when
# available; the schema is also auto-applied on startup if reachable on disk.
# Media lives on a volume.
RUN mkdir -p /data/media

EXPOSE 8088

# Honest healthcheck against the API's own /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8088/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
