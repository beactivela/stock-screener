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
   - **Backend (API + optional 24h scan):** `npm run server` — serves `http://localhost:3001`.
   - **Frontend:** `npm run dev` — Vite dev server with proxy to backend at `http://localhost:5173`.
   - **One-off scan (no server):** `npm run scan` — writes results to `data/scan-results.json`.

4. **24-hour scan**
   - Start the server with `SCHEDULE_SCAN=1`: `SCHEDULE_SCAN=1 npm run server`. It will run a full SPY + IWM scan every 24 hours and update `data/scan-results.json`.

## User flow

- **Dashboard:** “Last scan” time, list of VCP bullish symbols (from last scan), filter by 10 / 20 / 50 MA or “all three”. “Run scan now” triggers a background scan (throttled).
- **Stock detail:** Ticker, VCP summary (close, contractions, at which MAs), daily candlestick chart (real data).

## API (backend)

- `GET /api/scan-results` — last scan payload (scannedAt, results, totalTickers, vcpBullishCount).
- `POST /api/scan` — start a background scan (throttled).
- `GET /api/bars/:ticker?days=180` — daily OHLC for chart.
- `GET /api/vcp/:ticker` — VCP analysis for one ticker.

## Plan

See [PLAN.md](./PLAN.md) for VCP criteria, data sources, and task breakdown.
