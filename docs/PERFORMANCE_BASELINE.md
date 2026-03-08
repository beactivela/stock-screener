# Performance Baseline

This document captures the concrete hotspots identified before the performance refactor so future changes can be judged against the same baseline.

## Scan Pipeline

- `server/scan.js`
  - `runScan()` and `runScanStream()` process one ticker at a time.
  - `SCAN_DELAY_MS` adds intentional idle time between tickers.
  - `buildSignalSnapshots()` runs extra `checkVCP()` work for every scanned ticker.

## Persistence And Supabase CRUD

- `server/index.js`
  - `/api/scan` and `/api/cron/scan` write raw scan batches first, then write the same rows again after enrichment.
- `server/db/scanResults.js`
  - `saveScanResultsBatch()` inserts intermediate rows.
  - `updateScanResultsBatch()` updates rows one ticker at a time.
- `docs/supabase/schema.sql`
  - `scan_results` has single-column indexes, but the main access paths are by `scan_run_id + ticker` and `scan_run_id + enhanced_score`.

## Latest Scan Read Path

- `server/index.js`
  - `loadScanData()` rebuilds the latest scan payload every request.
  - `/api/scan-results` also merges Opus cache work into the response path.

## Page Loading

- `src/pages/Dashboard.tsx`
  - The page fetches `scan-results`, `fundamentals`, and `industry-trend` separately.
  - The dashboard table sorts the full dataset during render.
  - Chart mode renders one `TickerChart` per visible row.
- `src/pages/Agents.tsx`
  - The page fetches manifest and heartbeat fresh on mount.
- `src/components/Layout.tsx`
  - `MinerviniChat` is mounted globally, so its bundle cost affects every route.
- `src/components/MarketIndexRegimeCards.tsx`
  - The dashboard loads three index charts immediately.

## Cache Gaps

- Browser fetches in dashboard and agents rely heavily on `cache: 'no-store'`.
- The server has good cache coverage for bars and TradingView industry data, but not for the fully built latest scan payload.
