# ===========================================================================
# LIWAN Bridge — headless camera worker.
# Pulls frames from fixed RTSP/USB cameras and posts them to the Liwan API
# recognition endpoint. CPU-only, on-prem, no cloud dependencies.
# ===========================================================================
FROM python:3.12-slim

# OpenCV (even the headless wheel) needs a few shared libs at runtime for
# video decode (FFmpeg/RTSP) and basic image ops. Keep the layer minimal.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Prefer TCP transport for RTSP — far more reliable than UDP over a building LAN
# and avoids torn frames behind NAT. Cameras can still override via their source.
ENV OPENCV_FFMPEG_CAPTURE_OPTIONS="rtsp_transport;tcp" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first so the layer caches across code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

# Run as a non-root user — this is sold to banks and governments.
RUN useradd --create-home --uid 10001 bridge \
    && chown -R bridge:bridge /app
USER bridge

# No exposed ports: the bridge is an outbound-only worker.
ENTRYPOINT ["python", "-m", "src.bridge"]
