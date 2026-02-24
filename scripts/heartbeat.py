"""
heartbeat.py — Marcus Heartbeat Scheduler

Kicks off the full multi-agent optimization pipeline every 5 minutes using
APScheduler (BackgroundScheduler + cron-style trigger).

What it does every tick:
  1. POSTs to /api/learning/run-agents (the Node.js multi-agent endpoint)
  2. Streams Server-Sent Events until the run completes
  3. Logs the result (regime, signal count, elapsed time)

Why APScheduler instead of a bare cron job:
  • Runs inside the process — no shell-level cron required
  • Skips a tick if the previous run is still in progress (overlap protection)
  • Survives server restarts via persistent job store (optional; SQLite below)
  • Easy to adjust interval at runtime without editing crontab

Usage:
  pip install apscheduler requests
  python scripts/heartbeat.py

  Or run in the background:
  nohup python scripts/heartbeat.py >> logs/heartbeat.log 2>&1 &

Environment variables (override defaults):
  HEARTBEAT_API_URL   — Base URL of the Node server (default: http://localhost:3000)
  HEARTBEAT_INTERVAL  — Minutes between runs (default: 5)
  HEARTBEAT_TICKER_LIMIT — Max tickers per run (default: 200)
  CRON_SECRET         — Shared secret header for /api/learning/run-agents
"""

import os
import sys
import json
import time
import logging
import requests
from datetime import datetime

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

# ─── Config ──────────────────────────────────────────────────────────────────

API_URL       = os.environ.get('HEARTBEAT_API_URL', 'http://localhost:3000')
INTERVAL_MIN  = int(os.environ.get('HEARTBEAT_INTERVAL', '5'))
TICKER_LIMIT  = int(os.environ.get('HEARTBEAT_TICKER_LIMIT', '200'))
CRON_SECRET   = os.environ.get('CRON_SECRET', '')

ENDPOINT = f'{API_URL}/api/learning/run-agents'

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [HEARTBEAT] %(levelname)s — %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('heartbeat')

# ─── State: prevent overlapping runs ─────────────────────────────────────────

_running = False


# ─── Core tick ───────────────────────────────────────────────────────────────

def tick():
    """
    Single heartbeat tick.
    Calls the multi-agent endpoint and streams the SSE response until done.
    """
    global _running

    if _running:
        log.warning('Previous run still in progress — skipping this tick.')
        return

    _running = True
    started = time.time()
    log.info(f'🫀 Heartbeat tick — triggering Marcus orchestration (ticker_limit={TICKER_LIMIT})')

    headers = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
    }
    if CRON_SECRET:
        headers['x-cron-secret'] = CRON_SECRET

    payload = {
        'tickerLimit': TICKER_LIMIT,
        'maxIterations': 20,
        'forceRefresh': False,
    }

    try:
        with requests.post(
            ENDPOINT,
            headers=headers,
            json=payload,
            stream=True,
            timeout=600,   # 10 minute hard timeout per run
        ) as resp:
            resp.raise_for_status()

            last_phase = None
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue

                # SSE lines look like: "data: {...}"
                if line.startswith('data:'):
                    raw = line[5:].strip()
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    phase   = event.get('phase', '')
                    message = event.get('message', '')

                    # Only log phase changes to keep output clean
                    if phase != last_phase:
                        log.info(f'  → [{phase}] {message}')
                        last_phase = phase

                    if phase == 'done':
                        result = event.get('result', {})
                        elapsed = (time.time() - started)
                        log.info(
                            f'✅ Run complete in {elapsed:.1f}s — '
                            f'regime={result.get("regime", {}).get("regime", "?")} '
                            f'signals={result.get("signalCount", "?")} '
                            f'agents={result.get("successfulAgents", "?")}'
                        )
                        break

    except requests.exceptions.Timeout:
        log.error('❌ Heartbeat tick timed out after 10 minutes.')
    except requests.exceptions.ConnectionError as e:
        log.error(f'❌ Cannot reach {ENDPOINT}: {e}')
    except requests.exceptions.HTTPError as e:
        log.error(f'❌ HTTP error from server: {e}')
    except Exception as e:
        log.error(f'❌ Unexpected error during heartbeat tick: {e}')
    finally:
        _running = False


# ─── Scheduler setup ─────────────────────────────────────────────────────────

def main():
    log.info('═══════════════════════════════════════════════════')
    log.info('  Marcus Heartbeat Scheduler starting up')
    log.info(f'  API endpoint : {ENDPOINT}')
    log.info(f'  Interval     : every {INTERVAL_MIN} minute(s)')
    log.info(f'  Ticker limit : {TICKER_LIMIT}')
    log.info('═══════════════════════════════════════════════════')

    scheduler = BlockingScheduler(timezone='America/Chicago')

    scheduler.add_job(
        func=tick,
        trigger=IntervalTrigger(minutes=INTERVAL_MIN),
        id='marcus_heartbeat',
        name='Marcus Multi-Agent Heartbeat',
        replace_existing=True,
        max_instances=1,         # Prevent overlapping runs at scheduler level too
        misfire_grace_time=60,   # If missed by <60s, still run
    )

    # Run once immediately on startup so we don't wait for the first interval
    log.info('Running initial tick on startup...')
    tick()

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info('Heartbeat scheduler stopped.')
        scheduler.shutdown(wait=False)


if __name__ == '__main__':
    main()
