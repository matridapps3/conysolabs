#!/usr/bin/env bash
# Conyso Bench — combined-container entrypoint.
#
# Starts uvicorn (sidecar) in the background, waits for it to be healthy,
# then starts the Node server. If either process dies, this script exits so
# Railway (or any supervisor) restarts the whole container.

set -eo pipefail

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${SIDECAR_PID:-}" ]] && kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  [[ -n "${SERVER_PID:-}"  ]] && kill -TERM "$SERVER_PID"  2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[bench] starting sidecar on 127.0.0.1:8000"
( cd /app/sidecar && exec uvicorn app:app --host 127.0.0.1 --port 8000 ) &
SIDECAR_PID=$!

echo "[bench] waiting for sidecar healthcheck"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
    echo "[bench] sidecar ready after ${i}s"
    break
  fi
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "[bench] sidecar exited before becoming healthy" >&2
    exit 1
  fi
  sleep 1
done

echo "[bench] starting server on 0.0.0.0:${PORT}"
( cd /app/server && exec node index.js ) &
SERVER_PID=$!

# Exit as soon as either process exits.
wait -n "$SIDECAR_PID" "$SERVER_PID"
EXIT_CODE=$?
echo "[bench] a child exited with code ${EXIT_CODE}; shutting down"
exit "$EXIT_CODE"
