#!/usr/bin/env bash
# Trigger POST /api/cron/refresh-bars (alias: /api/cron/fetch-prices). Use from VPS host cron before the scan job.
#
# Required env:
#   CRON_SECRET   — must match the app container's CRON_SECRET
# Optional:
#   CRON_BASE_URL — default http://127.0.0.1:8080 (set to your HOST_PORT mapping)
#
# Example (crontab), America/Chicago 4:38 PM Mon–Fri (1-5 = weekdays):
#   CRON_TZ=America/Chicago
#   38 16 * * 1-5 root . /opt/stock-screener/.cron-env && /opt/stock-screener/scripts/trigger-scheduled-refresh-bars.sh >> /var/log/stock-screener-cron.log 2>&1
#
set -euo pipefail
CRON_BASE_URL="${CRON_BASE_URL:-http://127.0.0.1:8080}"
CRON_BASE_URL="${CRON_BASE_URL%/}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "trigger-scheduled-refresh-bars: CRON_SECRET is not set" >&2
  exit 1
fi

exec curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${CRON_BASE_URL}/api/cron/refresh-bars"
