#!/usr/bin/env bash
# Start virattt/ai-hedge-fund FastAPI (8000) + Vite (5175). Requires: Poetry on PATH, npm deps installed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${PATH}"
bash "${ROOT}/scripts/check-local-ports-free.sh" 8000 5175
cd "${ROOT}/ai-hedge-fund"
if [[ ! -f .env ]]; then
  echo "Run: npm run ai-hedge-fund:merge-env"
  exit 1
fi
echo "Backend: http://127.0.0.1:8000/docs"
echo "Frontend: http://127.0.0.1:5175"
poetry run uvicorn app.backend.main:app --reload --host 127.0.0.1 --port 8000 &
UV_PID=$!
cd app/frontend
npm run dev &
FE_PID=$!
trap 'kill ${UV_PID} ${FE_PID} 2>/dev/null || true' EXIT INT TERM
wait
