#!/usr/bin/env bash
# Trigger POST /api/cron/run-scan (same as /api/cron/scan). Use from VPS host cron or a sidecar.
#
# Required env:
#   CRON_SECRET   — must match the app container's CRON_SECRET
# Optional:
#   CRON_BASE_URL — default http://127.0.0.1:8080 (set to your HOST_PORT mapping)
#
# Example root crontab (23:00 UTC daily):
#   0 23 * * * . /opt/stock-screener/.cron-env && /opt/stock-screener/scripts/trigger-scheduled-scan.sh >> /var/log/stock-screener-cron.log 2>&1
#
set -euo pipefail
CRON_BASE_URL="${CRON_BASE_URL:-http://127.0.0.1:8080}"
CRON_BASE_URL="${CRON_BASE_URL%/}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "trigger-scheduled-scan: CRON_SECRET is not set" >&2
  exit 1
fi

exec curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${CRON_BASE_URL}/api/cron/run-scan"
