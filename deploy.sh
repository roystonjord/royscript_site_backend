#!/usr/bin/env bash
# Manual deploy / first-run via Docker Compose. Requires a populated .env here.
set -euo pipefail

APP_PORT=3000

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in."
  exit 1
fi

echo "==> Building and starting via docker compose..."
docker compose up -d --build

echo "==> Waiting for health..."
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/health" >/dev/null; then
    echo "==> Up and healthy at http://127.0.0.1:$APP_PORT"
    exit 0
  fi
  sleep 2
done

echo "==> Health check failed. Recent logs:"
docker compose logs --tail 50
exit 1
