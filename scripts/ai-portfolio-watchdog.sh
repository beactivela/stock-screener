#!/usr/bin/env bash
# Monitors AI Portfolio runs via GET /api/ai-portfolio/scheduler (lastRunAt updates on each
# successful POST /api/ai-portfolio/simulate/daily, including host-cron triggers).
#
# Env (optional):
#   AI_PORTFOLIO_BASE_URL  default http://127.0.0.1:8090
#   AI_PORTFOLIO_WATCHDOG_WEBHOOK  if set, POST JSON alerts (Slack {"text":...} or Discord webhooks {"content":...})
#
# Cron example (Central Time weekdays, every hour at :20):
#   CRON_TZ=America/Chicago
#   20 * * * 1-5 /usr/local/bin/ai-portfolio-watchdog.sh >> /var/log/ai-portfolio-watchdog.log 2>&1

set -euo pipefail

BASE_URL="${AI_PORTFOLIO_BASE_URL:-http://127.0.0.1:8090}"
LOG_TAG="[ai-portfolio-watchdog]"
WEBHOOK="${AI_PORTFOLIO_WATCHDOG_WEBHOOK:-}"

webhook_payload() {
  local body="$1"
  local esc
  esc="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${body//\"/\\\"}")"
  if [[ "$WEBHOOK" == *"discord.com/api/webhooks"* ]] || [[ "$WEBHOOK" == *"discordapp.com/api/webhooks"* ]]; then
    printf '{"content":%s}' "$esc"
  else
    printf '{"text":%s}' "$esc"
  fi
}

# Weekday in Chicago: 1=Mon .. 7=Sun (GNU date)
dow="$(TZ=America/Chicago date +%u)"
if [[ "$dow" -gt 5 ]]; then
  echo "$(date -u +%FT%TZ) $LOG_TAG skip weekend"
  exit 0
fi

# Only check after first checkpoint window (9:00 CT) + grace
hour="$(TZ=America/Chicago date +%H)"
minute="$(TZ=America/Chicago date +%M)"
hour_n="${hour#0}"
minute_n="${minute#0}"
hour_n="${hour_n:-0}"
minute_n="${minute_n:-0}"
if [[ "$hour_n" -lt 9 ]] || { [[ "$hour_n" -eq 9 ]] && [[ "$minute_n" -lt 15 ]]; }; then
  echo "$(date -u +%FT%TZ) $LOG_TAG skip before 09:15 CT"
  exit 0
fi

today_chi="$(TZ=America/Chicago date +%F)"

if ! health="$(curl -fsS -m 15 "${BASE_URL}/api/health" 2>/dev/null)"; then
  msg="$LOG_TAG ALERT: health check failed for ${BASE_URL}/api/health"
  echo "$(date -u +%FT%TZ) $msg"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "$(webhook_payload "$msg")" "$WEBHOOK" || true
  fi
  exit 1
fi

if ! echo "$health" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  msg="$LOG_TAG ALERT: health JSON missing ok:true"
  echo "$(date -u +%FT%TZ) $msg"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "$(webhook_payload "$msg")" "$WEBHOOK" || true
  fi
  exit 1
fi

sched_json="$(curl -fsS -m 20 "${BASE_URL}/api/ai-portfolio/scheduler" 2>/dev/null)" || sched_json=''

last_run=""
if command -v python3 >/dev/null 2>&1; then
  last_run="$(echo "$sched_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('lastRunAt') or '')" 2>/dev/null || true)"
fi
if [[ -z "$last_run" ]]; then
  last_run="$(echo "$sched_json" | sed -n 's/.*"lastRunAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

if [[ -z "$last_run" || "$last_run" == "null" ]]; then
  msg="$LOG_TAG ALERT: no lastRunAt yet (expect a run after 09:15 CT on weekdays). scheduler=${sched_json:0:200}"
  echo "$(date -u +%FT%TZ) $msg"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "$(webhook_payload "AI Portfolio watchdog: no lastRunAt after 09:15 CT (${BASE_URL}).")" "$WEBHOOK" || true
  fi
  exit 1
fi

# Date of last run in America/Chicago
last_day_chi="$(TZ=America/Chicago date -d "$last_run" +%F 2>/dev/null)" || last_day_chi=""

if [[ -z "$last_day_chi" ]]; then
  msg="$LOG_TAG ALERT: could not parse lastRunAt=$last_run"
  echo "$(date -u +%FT%TZ) $msg"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "$(webhook_payload "AI Portfolio watchdog: could not parse lastRunAt.")" "$WEBHOOK" || true
  fi
  exit 1
fi

# Lexicographic YYYY-MM-DD compare works for calendar ordering
if [[ "$last_day_chi" < "$today_chi" ]]; then
  msg="$LOG_TAG ALERT: stale lastRunAt (Chicago): last=${last_day_chi} today=${today_chi} raw=${last_run}"
  echo "$(date -u +%FT%TZ) $msg"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "$(webhook_payload "AI Portfolio watchdog: no run today CT. lastRunAt date ${last_day_chi}, today ${today_chi}.")" "$WEBHOOK" || true
  fi
  exit 1
fi

echo "$(date -u +%FT%TZ) $LOG_TAG ok lastRunAt=${last_run} (Chicago date ${last_day_chi})"
exit 0
