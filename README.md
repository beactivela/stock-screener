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

3. **Run**
   - **Single server (app + API):** `npm run dev` — one process at **http://localhost:5173**. The app and all `/api/*` routes are served from the same origin (no separate backend URL).
   - **One-off scan (no server):** `npm run scan` — writes results to the database (Supabase).

4. **24-hour scan**
   - Start the app with `SCHEDULE_SCAN=1`: `SCHEDULE_SCAN=1 npm run dev`. It will run a full SPY + IWM scan every 24 hours and persist results to the database.

## User flow

- **Dashboard:** “Last scan” time, list of VCP bullish symbols (from last scan), filter by 10 / 20 / 50 MA or “all three”. “Run scan now” triggers a background scan (throttled).
- **Stock detail:** Ticker, VCP summary (close, contractions, at which MAs), daily candlestick chart (real data).

## API

Served from the same origin in dev (`http://localhost:5173/api/...`). Key routes:

- `GET /api/scan-results` — last scan payload (scannedAt, results, totalTickers, vcpBullishCount).
- `POST /api/scan` — start a background scan (throttled).
- `GET /api/bars/:ticker?days=180` — daily OHLC for chart.
- `GET /api/vcp/:ticker` — VCP analysis for one ticker.
- **Regime (HMM):** `GET /api/regime` — current market regime (bull/bear) from a 5-year SPY+QQQ Hidden Markov Model. Run `npm run fetch-regime-data` then `npm run regime:train` to populate; the Deepseek engine uses this for sector/regime scoring.

Full API and data flow: see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Deploy to Vercel

The app is compatible with Vercel: frontend and API run as serverless.

1. **Connect the repo** to Vercel; use default build (`npm run build`) and output `dist`.
2. **Data:** All data (scan results, fundamentals, industry data, bars cache) is stored in the database (Supabase). Configure `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Vercel so the deployed app reads/writes the same DB. No file-based `data/` needed.
3. **Limits on Vercel:** Serverless can call Supabase; scans and cache writes persist in the DB. For heavy scan jobs, consider pointing **VITE_API_URL** to an external API (e.g. Railway, Render) that runs `npm run server` if you need long-running processes.

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System diagram, data flow, runtime (single port), scoring, deployment.
- **[docs/](docs/)** — Implementation notes (PLAN.md, BACKGROUND_SCAN_IMPLEMENTATION.md, backtest/signal notes, etc.).
