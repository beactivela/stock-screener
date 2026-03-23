-- =============================================================================
-- Stock Screener Supabase Schema
-- Migrates flat JSON files to relational tables. Run in Supabase SQL Editor.
-- =============================================================================

-- Enable UUID extension (Supabase has it by default, but explicit for portability)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. TICKERS (from data/tickers.txt)
-- Source of truth for scan universe
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickers (
  ticker TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. FUNDAMENTALS (from data/fundamentals.json)
-- Keyed by ticker; each row = one ticker's cached fundamentals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fundamentals (
  ticker TEXT PRIMARY KEY,
  pct_held_by_inst NUMERIC,
  qtr_earnings_yoy NUMERIC,
  profit_margin NUMERIC,
  operating_margin NUMERIC,
  industry TEXT,
  sector TEXT,
  company_name TEXT,
  fetched_at TIMESTAMPTZ,
  raw JSONB,  -- for any extra fields from Yahoo
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_industry ON fundamentals(industry);
CREATE INDEX IF NOT EXISTS idx_fundamentals_sector ON fundamentals(sector);

-- -----------------------------------------------------------------------------
-- 3. SCAN RUNS + SCAN RESULTS (from data/scan-results.json)
-- One scan run; many result rows per ticker
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scan_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scanned_at TIMESTAMPTZ NOT NULL,
  date_from DATE,
  date_to DATE,
  total_tickers INT DEFAULT 0,
  vcp_bullish_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_run_id UUID REFERENCES scan_runs(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  -- Core fields for filtering/sorting
  vcp_bullish BOOLEAN,
  contractions INT,
  last_close NUMERIC,
  relative_strength NUMERIC,
  score INT,
  enhanced_score INT,
  industry_name TEXT,
  industry_rank INT,
  -- Full row as JSONB for compatibility (pattern, pullbacks, etc.)
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_results_scan_run ON scan_results(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_ticker ON scan_results(ticker);
CREATE INDEX IF NOT EXISTS idx_scan_results_enhanced_score ON scan_results(enhanced_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_results_scan_run_ticker_unique ON scan_results(scan_run_id, ticker);
CREATE INDEX IF NOT EXISTS idx_scan_results_scan_run_score ON scan_results(scan_run_id, enhanced_score DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_scanned_at ON scan_runs(scanned_at DESC);

-- Latest scan is the most recent scan_run; app typically queries latest
-- Optional: add a materialized view or function to get "current" scan

-- -----------------------------------------------------------------------------
-- 4. BARS CACHE (from data/bars/{TICKER}_{interval}.json)
-- OHLCV time series per ticker+interval
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bars_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker TEXT NOT NULL,
  interval TEXT NOT NULL DEFAULT '1d',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  results JSONB NOT NULL,  -- [{t, o, h, l, c, v}, ...]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, interval)
);

CREATE INDEX IF NOT EXISTS idx_bars_cache_ticker_interval ON bars_cache(ticker, interval);
CREATE INDEX IF NOT EXISTS idx_bars_cache_fetched_at ON bars_cache(fetched_at);

-- -----------------------------------------------------------------------------
-- 5. OPUS45 SIGNALS (from data/opus45-signals.json)
-- Cached signal output; single row per "run", signals in JSONB
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opus45_signals_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  computed_at TIMESTAMPTZ NOT NULL,
  signals JSONB NOT NULL,
  stats JSONB,
  total INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opus45_computed_at ON opus45_signals_cache(computed_at DESC);

-- -----------------------------------------------------------------------------
-- 6. TRADES (from data/trades.json)
-- Trade journal; already well-structured
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY,
  ticker TEXT NOT NULL,
  company_name TEXT,
  entry_date DATE,
  entry_price NUMERIC NOT NULL,
  entry_metrics JSONB,
  conviction INT,
  notes TEXT,
  exit_date DATE,
  exit_price NUMERIC,
  exit_type TEXT,
  exit_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  return_pct NUMERIC,
  holding_days INT,
  stop_loss_price NUMERIC,
  target_price NUMERIC,
  last_checked_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. TRADE STATS (denormalized from trades.json stats)
-- Optional: can be computed from trades table; stored for quick read
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  total_trades INT DEFAULT 0,
  open_trades INT DEFAULT 0,
  closed_trades INT DEFAULT 0,
  win_rate NUMERIC,
  avg_return NUMERIC,
  avg_win NUMERIC,
  avg_loss NUMERIC,
  stats_json JSONB,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. INDUSTRY CACHES (from industrials.json, all-industries.json, sectors.json)
-- Single-row keyed caches; use key to distinguish
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS industry_cache (
  key TEXT PRIMARY KEY,  -- 'industrials' | 'all-industries' | 'sectors'
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. INDUSTRY YAHOO RETURNS (from industry-yahoo-returns.json)
-- Keyed by industry name: { industry_name: { return1Y, return3M, returnYTD } }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS industry_yahoo_returns (
  industry_name TEXT PRIMARY KEY,
  return_1y NUMERIC,
  return_3m NUMERIC,
  return_ytd NUMERIC,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. BACKTEST SNAPSHOTS (from data/backtests/scan-{date}.json)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_date DATE NOT NULL UNIQUE,
  scan_time TIMESTAMPTZ,
  ticker_count INT DEFAULT 0,
  tickers JSONB NOT NULL,  -- array of {ticker, score, enhancedScore, price, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_scan_date ON backtest_snapshots(scan_date DESC);

-- -----------------------------------------------------------------------------
-- 11. BACKTEST RESULTS (output of runBacktest - forward returns)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_date DATE NOT NULL,
  holding_days INT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scan_date, holding_days)
);

-- -----------------------------------------------------------------------------
-- 12. REGIME DATA (from data/regime/spy_5y.json, qqq_5y.json)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regime_bars (
  ticker TEXT PRIMARY KEY,
  date_from DATE,
  date_to DATE,
  fetched_at TIMESTAMPTZ,
  results JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 13. REGIME MODELS / CURRENT / BACKTEST (from model_*.json, current_*.json, backtest_*.json)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regime_models (
  ticker TEXT PRIMARY KEY,
  model_json JSONB NOT NULL,
  trained_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regime_current (
  ticker TEXT PRIMARY KEY,
  state_labels JSONB,
  predictions JSONB,
  current_state INT,
  state_to_label JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regime_backtest (
  ticker TEXT PRIMARY KEY,
  backtest_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 14. OPUS45 LEARNING (from data/opus45-learning/optimized-weights.json)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opus45_weights (
  id TEXT PRIMARY KEY DEFAULT 'default',
  weights JSONB NOT NULL,
  last_optimized TIMESTAMPTZ,
  based_on_trades INT,
  overall_win_rate NUMERIC,
  improvements JSONB,
  version INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. ADAPTIVE STRATEGY (from data/adaptive-strategy/learned-params.json)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adaptive_strategy_params (
  id TEXT PRIMARY KEY DEFAULT 'default',
  params JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- RLS: run migration-rls-and-api-hardening.sql on existing projects (enables RLS on
-- all public tables; no policies for anon — use SUPABASE_SERVICE_KEY on the server).
-- -----------------------------------------------------------------------------

-- Latest scan run (join to scan_results for full data)
CREATE OR REPLACE VIEW v_latest_scan_run
WITH (security_invoker = true) AS
SELECT * FROM scan_runs ORDER BY scanned_at DESC LIMIT 1;
