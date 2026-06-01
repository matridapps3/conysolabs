# Conyso Bench — combined single-container build for Railway.
#
# Runs the Python sidecar and the Node server in one container so that:
#   - Both processes share /data (a single Railway volume).
#   - You only pay for one Railway service.
#   - Internal calls server → sidecar stay on 127.0.0.1 (no public hop).
#
# For local dev or self-hosting, prefer the two-service `docker-compose.yml`.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_VERSION=20

# System deps:
#   - build-essential + python3-dev: for better-sqlite3 (node) and any wheel builds
#   - libpango*: matplotlib font rendering
#   - curl, ca-certificates, gnupg: nodesource install
#   - tini: clean PID 1 / signal forwarding for our multi-process start.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      gnupg \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      python3-dev \
      tini \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Sidecar (Python) ----
COPY sidecar/ ./sidecar/
RUN pip install --no-cache-dir -e ./sidecar

# ---- Server (Node) ----
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/

# ---- Entrypoint ----
COPY start.sh ./
RUN chmod +x start.sh

# Both processes write here. On Railway, attach a volume at /data.
ENV DATA_DIR=/data \
    SIDECAR_URL=http://127.0.0.1:8000 \
    PORT=3000
RUN mkdir -p /data

EXPOSE 3000

# tini forwards SIGTERM cleanly so Railway can stop the container fast.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start.sh"]
