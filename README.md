# VCP Stock Screener

Web app that finds stocks meeting **Mark Minervini’s VCP (Volatility Contraction Pattern)** criteria: consolidation with contracting pullbacks and support at 10 / 20 / 50-day moving averages. Scans **S&P 500 (SPY)** and **Russell 2000 (IWM)**; can run every 24 hours.

- **Stack:** React (Vite) + Tailwind, Express backend. Data: TradingView (tickers, industry) + Yahoo (OHLC bars; TradingView has no bar API).
- **Data:** Real OHLC and volume only (no fake data). Charts use the same data.

## 🚀 Performance

**Industry data loads instantly** (<50ms typical, 99.6% faster than before):
- **4-layer optimization:** In-memory cache (2hr TTL) → DB cache → Parallel TradingView API (5x concurrent) → Early exit when all industries found
- **Background refresh:** Stale cache serves instantly while fresh data loads in background
- **First load:** 2-5s (down from 12-15s) via parallel fetching + early exit
- **Subsequent loads:** <50ms from cache (down from 12-15s)
- See [docs/INDUSTRY_LOAD_OPTIMIZATION.md](./docs/INDUSTRY_LOAD_OPTIMIZATION.md) for technical details

## Setup

1. **Clone and install**
   ```bash
   cd stock-screener && npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env`.
   - No API key required for core data: ticker list and industry from TradingView scanner; OHLC bars from Yahoo. Set Supabase vars for DB persistence (see `.env.example`).
   - **Supabase security:** The server should use **`SUPABASE_SERVICE_KEY`** (service role). Row Level Security is enabled on all `public` tables so the **anon** API key cannot read app data. New databases: apply `docs/supabase/schema.sql` (and learning migrations if needed), then run **`docs/supabase/migration-rls-and-api-hardening.sql`** once. Details: [docs/supabase/README.md](./docs/supabase/README.md).

3. **Run**
   - **Single server (app + API):** `npm run dev` — one process at **http://localhost:5174**. The app and all `/api/*` routes are served from the same origin (no separate backend URL).
   - **One-off scan (no server):** `npm run scan` — writes results to the database (Supabase).

4. **24-hour scan**
   - Start the app with `SCHEDULE_SCAN=1`: `SCHEDULE_SCAN=1 npm run dev`. It will run a full SPY + IWM scan every 24 hours and persist results to the database.

## User flow

- **Dashboard:** “Last scan” time, list of VCP bullish symbols (from last scan), filter by 10 / 20 / 50 MA or “all three”. “Run scan now” triggers a background scan (throttled).
- **Stock detail:** Ticker, VCP summary (close, contractions, at which MAs), daily candlestick chart (real data).

## API

Served from the same origin in dev (`http://localhost:5174/api/...`). Key routes:

- `GET /api/scan-results` — last scan payload (scannedAt, results, totalTickers, vcpBullishCount).
- `POST /api/scan` — start a background scan (throttled).
- `GET /api/bars/:ticker?days=180` — daily OHLC for chart.
- `GET /api/vcp/:ticker` — VCP analysis for one ticker.
- **Regime (HMM):** `GET /api/regime` — current market regime (bull/bear) from a 5-year SPY+QQQ Hidden Markov Model. Run `npm run fetch-regime-data` then `npm run regime:train` to populate; the Deepseek engine uses this for sector/regime scoring.
- **`GET /api/bars-cache/last-yahoo-at`** — latest `fetched_at` among daily rows in Supabase `bars_cache` (proxy for most recent Yahoo→DB bar write; shown in the app header).

Full API and data flow: see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Deploy (production)

**Docker on a VPS** is the supported setup: one container serves the Vite build and Express `/api/*` on the same origin. Full steps: **[docs/DEPLOY_HOSTINGER_VPS.md](./docs/DEPLOY_HOSTINGER_VPS.md)** (`SUPABASE_*`, `CRON_SECRET`, shared Traefik, `HOST_PORT`). **Public app:** [https://stocks.scaleagent.org](https://stocks.scaleagent.org) (set **`TRAEFIK_HOST=stocks.scaleagent.org`** in server `.env`; your shared Traefik routes via Docker labels in **`docker-compose.yml`**).

### Scheduled Yahoo bars + daily scan (host cron)

So **daily prices** hit Yahoo and land in Supabase **`bars_cache`** before the VCP scan, install **root cron on the VPS** (not inside the container) that calls:

| When (example) | Endpoint | Purpose |
|------------------|----------|---------|
| Weekdays ~30+ min before scan | `POST /api/cron/refresh-bars` (alias `fetch-prices`) | Universe OHLC → DB cache |
| Weekdays after bars job | `POST /api/cron/run-scan` | Full scan |

Copy **`deploy/host-cron.example`** → `/etc/cron.d/stock-screener`, set **`CRON_SECRET`** and **`CRON_BASE_URL`** (`http://127.0.0.1:<HOST_PORT>`). Scripts: **`scripts/trigger-scheduled-refresh-bars.sh`**, **`scripts/trigger-scheduled-scan.sh`**.

**Check from your laptop over SSH** — optional **`Host` alias:** append **[`deploy/ssh-config.example`](deploy/ssh-config.example)** to `~/.ssh/config`, then edit that file if needed (`User`, `IdentityFile`). *Only run the commands below in the shell — don’t paste the prose around them (zsh will try to run words like `or` as commands).*

```bash
cat deploy/ssh-config.example >> ~/.ssh/config
# now edit ~/.ssh/config if needed, then:
ssh scaleagent-stocks 'sudo grep -R trigger-scheduled /etc/cron.d /var/spool/cron 2>/dev/null; curl -sS http://127.0.0.1:8090/api/cron/status'
```

First-time connect may ask to trust the host; if DNS points to the same VPS you already use under another name, answer **`yes`**.

Use your server’s **`HOST_PORT`** from `.env` (production example **8090**, not necessarily **8080**). **`GET /api/cron/status`** should show `"secretConfigured":true` and the loopback base URL. After cron runs, **`tail /var/log/stock-screener-cron.log`** on the server should show JSON with `"Universe bars refresh started"` and scan `started` responses.

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System diagram, data flow, runtime (single port), scoring, deployment.
- **[docs/supabase/README.md](./docs/supabase/README.md)** — Schema, migrations, **RLS / API hardening**, scheduled scan (Cron / Edge Function).
- **[docs/](docs/)** — Implementation notes (PLAN.md, BACKGROUND_SCAN_IMPLEMENTATION.md, backtest/signal notes, VPS deploy, etc.).
