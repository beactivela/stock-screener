# VCP Stock Screener

Web app that finds stocks meeting **Mark Minervini’s VCP (Volatility Contraction Pattern)** criteria: consolidation with contracting pullbacks and support at 10 / 20 / 50-day moving averages. Scans **S&P 500 (SPY)** and **Russell 2000 (IWM)**; can run every 24 hours.

- **Stack:** React (Vite) + Tailwind, Express backend, Massive API for real stock data.
- **Data:** Real OHLC and volume only (no fake data). Charts use the same data.

## Setup

1. **Clone and install**
   ```bash
   cd stock-screener && npm install
   ```

2. **API key**
   - Copy `.env.example` to `.env`.
   - Set `MASSIVE_API_KEY` to your [Massive](https://massive.com) API key (the one you used for the dividends endpoint works for aggregates and ETF constituents too).

3. **Run**
   - **Single server (app + API):** `npm run dev` — one process at **http://localhost:5173**. The app and all `/api/*` routes are served from the same origin (no separate backend URL).
   - **One-off scan (no server):** `npm run scan` — writes results to `data/scan-results.json`.

4. **24-hour scan**
   - Start the app with `SCHEDULE_SCAN=1`: `SCHEDULE_SCAN=1 npm run dev`. It will run a full SPY + IWM scan every 24 hours and update `data/scan-results.json`.

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
2. **Data:** The `data/` folder is gitignored, so the deployed app starts with no scan/fundamentals/industry data. Options:
   - **Demo:** Commit a snapshot of `data/` (e.g. `scan-results.json`, `fundamentals.json`, `industry-yahoo-returns.json`) so the deployed app has read-only data.
   - **Full API elsewhere:** Deploy only the frontend and set **VITE_API_URL** in Vercel to your own API (e.g. Railway, Render) that runs `npm run server` and has persistent `data/`.
3. **Limits on Vercel:** Writes (POST `/api/scan`, POST `/api/fundamentals/fetch`, etc.) do not persist—serverless has a read-only filesystem. Use the app in read-only mode with committed data, or point **VITE_API_URL** to an external API for scans and fetches.

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System diagram, data flow, runtime (single port), scoring, deployment.
- **[docs/](docs/)** — Implementation notes (PLAN.md, BACKGROUND_SCAN_IMPLEMENTATION.md, backtest/signal notes, etc.).
