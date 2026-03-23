# Implementation notes & plans

**Data sources (TradingView + Yahoo only; no Massive):** Ticker list and industry performance from **TradingView** Scanner API. OHLC bars from **Yahoo** via server-side `yahoo-finance2` v3. Charts: Lightweight Charts (Yahoo data) + TradingView embedded widget. Company name/fundamentals: Yahoo.

## Yahoo Finance contract

- **Node client:** `yahoo-finance2` v3, instantiated with `new YahooFinance(...)` in `server/yahoo.js`.
- **Bars endpoint:** `GET /api/bars/:ticker?days=180&interval=1d`
- **History metadata endpoint:** `GET /api/history-metadata/:ticker?days=180&interval=1d`
- **Supported intervals:** `1d`, `1wk`, `1mo`

### History metadata response

The metadata endpoint returns a normalized shape so UI and server consumers do not need to parse raw Yahoo chart metadata:

- `ticker`, `symbol`
- `period1`, `period2`, `interval`
- `exchangeName`, `fullExchangeName`, `instrumentType`, `currency`
- `timezone`, `timezoneShortName`, `gmtoffset`
- `dataGranularity`, `validRanges`
- `firstTradeDateMs`, `regularMarketTimeMs`

If Yahoo returns no chart metadata or the symbol is invalid, the API responds with `502` and a human-readable `error` message.

### Supabase & database

- **[supabase/README.md](./supabase/README.md)** — Schema quick start, env vars, **RLS hardening** (`migration-rls-and-api-hardening.sql`), Supabase Cron / Edge Function for scans.
- **[VERCEL.md](./VERCEL.md)** — Required `SUPABASE_*` env vars for serverless.
- **[DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md)** — Docker VPS; same **`SUPABASE_SERVICE_KEY`** requirement.

- **PLAN.md** — VCP criteria, data sources, task breakdown
- **BACKGROUND_SCAN_IMPLEMENTATION.md** — Background scan and progress polling
- **IMPROVEMENT_PLAN.md** — Future work (e.g. wiring `server/enhancedVcpScore.js`)
- **BACKTEST_*.md**, **SIGNAL_*.md**, **BLUE_ARROW_*.md** — Backtest and signal logic notes
- **EXECUTIVE_SUMMARY.md**, **IMPLEMENTATION_COMPLETE.md**, **QUICK_START_IMPROVEMENTS.md**, **VISUAL_IMPROVEMENTS.md**, **PATTERN_DETECTION.md** — Historical implementation docs

Main project docs stay in repo root: [README.md](../README.md), [ARCHITECTURE.md](../ARCHITECTURE.md).
