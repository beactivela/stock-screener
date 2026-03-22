#!/usr/bin/env bash
# Run ON THE VPS from the repository root (same directory as docker-compose.yml).
# One-time setup before first run:
#   1. git clone <your-repo-url> /opt/stock-screener && cd /opt/stock-screener
#   2. cp .env.example .env && edit .env with real secrets
#   3. ./scripts/vps-deploy.sh
#
# Later deploys (after you git push from your laptop):
#   ./scripts/vps-deploy.sh
#
# Flags:
#   --no-git     Skip git pull (only rebuild/restart containers)
#   --skip-pull  Same as --no-git

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DO_GIT_PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-git|--skip-pull) DO_GIT_PULL=0 ;;
    -h|--help)
      echo "Usage: $0 [--no-git]"
      exit 0
      ;;
  esac
done

if [[ ! -f docker-compose.yml ]]; then
  echo "error: docker-compose.yml not found. Run this script from a clone of stock-screener (repo root)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "error: missing .env. Copy .env.example to .env and set your secrets." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found. Install Docker Engine on this server first." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' not available. Install the Docker Compose V2 plugin." >&2
  exit 1
fi

if [[ "$DO_GIT_PULL" -eq 1 ]]; then
  if [[ -d .git ]]; then
    echo "==> git pull"
    git pull --ff-only
  else
    echo "warning: not a git clone; skipping git pull (use --no-git to silence)" >&2
  fi
fi

echo "==> docker compose up -d --build"
docker compose up -d --build

echo "==> container status"
docker compose ps

if command -v curl >/dev/null 2>&1; then
  echo "==> health check (localhost:3001)"
  if curl -sf -o /dev/null --max-time 10 "http://127.0.0.1:3001/"; then
    echo "OK: app responded on http://127.0.0.1:3001/"
  else
    echo "warning: no HTTP response on 127.0.0.1:3001 — check logs: docker compose logs -f" >&2
  fi
fi

echo "Done. Logs: docker compose logs -f"
