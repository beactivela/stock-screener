#!/usr/bin/env bash
# Show whether canonical dev ports are listening (diagnostic; always exits 0).
set -euo pipefail

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof not found — cannot list listeners."
  exit 0
fi

echo "Local dev port map (stock-screener)"
echo "──────────────────────────────────"
for port in 5174 3001; do
  if lsof -Pi ":${port}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    pids=$(lsof -Pi ":${port}" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')
    echo "  :${port}  LISTEN  PID ${pids}"
  else
    echo "  :${port}  free"
  fi
done
echo ""
echo "5174 screener · 3001 API-only (npm run dev:server)"
echo "Docker: Uptime Kuma host port defaults to 3002 (see KUMA_PORT) to avoid clashing with 3001."