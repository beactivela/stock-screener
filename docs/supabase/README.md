# Supabase Migration

This directory contains schema and instructions for migrating flat JSON storage to Supabase.

## Quick start

1. **Supabase project** (e.g. `ksnneoomyrvmzukwxmqg`) at [supabase.com](https://supabase.com).

2. **Run the schema** — either:

   **Option A: npm script (recommended)**
   - Add to `.env`: `SUPABASE_DB_PASSWORD=your_database_password`  
     (Use this if your password has special chars like @ # : — the script encodes it correctly.)
   - Or full URI: `DATABASE_URL=postgresql://postgres:PASSWORD@db.ksnneoomyrvmzukwxmqg.supabase.co:5432/postgres`
   - Run: `npm run migrate:supabase`

   **Option B: SQL Editor**
   - Open project → SQL Editor → New query
   - Paste contents of `schema.sql` → Run

3. **Add env vars** to `.env`:
   ```
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_KEY=your_service_role_key
   ```
   Get these from Project Settings → API. Use **service_role** for full server-side access (bypasses RLS).

4. **Test connection**:
   ```bash
   node -e "
   import('./server/supabase.js').then(m => {
     const sb = m.getSupabase();
     console.log('Supabase configured:', !!sb);
     if (sb) sb.from('tickers').select('count').then(r => console.log('Test:', r));
   });
   ```

## Schema overview

| Table | Source JSON | Purpose |
|-------|-------------|---------|
| `tickers` | tickers.txt | Scan universe (one row per ticker) |
| `fundamentals` | fundamentals.json | Cached Yahoo fundamentals per ticker |
| `scan_runs` + `scan_results` | scan-results.json | Scan metadata + per-ticker results |
| `bars_cache` | bars/{TICKER}_1d.json | OHLCV time series per ticker |
| `opus45_signals_cache` | opus45-signals.json | Cached Opus4.5 signal output |
| `trades` | trades.json | Trade journal |
| `trade_stats` | trades.json stats | Denormalized trade stats |
| `industry_cache` | industrials.json, all-industries.json, sectors.json | Industry caches (keyed) |
| `industry_yahoo_returns` | industry-yahoo-returns.json | Returns by industry name |
| `backtest_snapshots` | backtests/scan-{date}.json | Historical scan snapshots |
| `backtest_results` | runBacktest output | Forward return backtest results |
| `regime_bars` | regime/spy_5y.json, qqq_5y.json | Regime bar data |
| `regime_models`, `regime_current`, `regime_backtest` | regime/model_*.json, etc. | HMM regime state |
| `opus45_weights` | opus45-learning/optimized-weights.json | Learned signal weights |
| `adaptive_strategy_params` | adaptive-strategy/learned-params.json | Strategy params |

## Next steps

- Implement data-access layer in `server/db/` that reads/writes Supabase when configured, falls back to files otherwise
- Add migration script to bulk-import existing JSON into Supabase
- Wire API routes to use DB when `isSupabaseConfigured()` is true
