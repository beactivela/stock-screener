#!/usr/bin/env bash
# Fail if any listed TCP ports are already listening (local dev stack).
# Usage: bash scripts/check-local-ports-free.sh [PORT] [PORT] ...
# With no args, checks canonical dev stack: 5174 5175 8000
set -euo pipefail

port_label() {
  case "$1" in
    5174) echo "stock-screener — npm run dev / dev:all (Express + Vite)" ;;
    5175) echo "ai-hedge-fund — Vite UI (iframe embed)" ;;
    8000) echo "ai-hedge-fund — FastAPI (uvicorn)" ;;
    3001) echo "npm run dev:server — API-only Express" ;;
    8080) echo "Docker HOST_PORT — stock-screener legacy profile (see docker-compose)" ;;
    *) echo "port ${1}" ;;
  esac
}

port_hint() {
  case "$1" in
    5174)
      echo "Stop the other terminal running \`npm run dev\` / \`dev:all\`, or keep one screener and run only \`npm run ai-hedge-fund:dev\` for the hedge UI."
      ;;
    5175)
      echo "Stop the other ai-hedge-fund Vite (\`npm run ai-hedge-fund:dev\`) or a stale node process."
      ;;
    8000)
      echo "Stop uvicorn on 8000, or if the hedge API is already running, start only the UI: \`npm run ai-hedge-fund:vite\` (Vite on 5175)."
      ;;
    3001)
      echo "Stop \`npm run dev:server\`, or map Uptime Kuma to another host port (see KUMA_PORT in docker-compose)."
      ;;
    *)
      echo "Free this port or change your tool to use a different port."
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  set -- 5174 5175 8000
fi

if ! command -v lsof >/dev/null 2>&1; then
  exit 0
fi

bad=()
for port in "$@"; do
  if lsof -Pi ":${port}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    bad+=("${port}")
  fi
done

if ((${#bad[@]} == 0)); then
  exit 0
fi

echo ""
echo "Port conflict: these ports are already in use:"
for port in "${bad[@]}"; do
  pids=$(lsof -Pi ":${port}" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')
  echo "  :${port} — $(port_label "${port}")"
  echo "    PID(s): ${pids:-?}"
  echo "    → $(port_hint "${port}")"
done
echo ""
exit 1
