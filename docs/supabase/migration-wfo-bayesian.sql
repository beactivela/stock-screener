-- =============================================================================
-- Migration: Walk-Forward Optimization + Bayesian Learning
-- Run in Supabase SQL Editor
--
-- Safe to run multiple times (all CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- Creates historical_trades if it doesn't exist, then adds new columns.
-- =============================================================================

-- ─── 1. Create historical_trades if missing ───────────────────────────────────
-- (Already in learning-schema.sql, but included here so this migration is
--  self-contained and safe to run even if learning-schema.sql was never run.)

CREATE TABLE IF NOT EXISTS historical_trades (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker                  TEXT NOT NULL,
  entry_date              DATE NOT NULL,
  entry_price             NUMERIC NOT NULL,
  exit_date               DATE,
  exit_price              NUMERIC,
  return_pct              NUMERIC,
  holding_days            INT,
  max_gain                NUMERIC,
  max_drawdown            NUMERIC,
  exit_type               TEXT,
  opus45_confidence       NUMERIC,
  opus45_grade            TEXT,
  signal_type             TEXT,
  pattern                 TEXT,
  pattern_confidence      NUMERIC,
  contractions            INT,
  source                  TEXT DEFAULT 'historical_scan',
  scan_date               TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_historical_trades_ticker  ON historical_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_historical_trades_entry   ON historical_trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_historical_trades_return  ON historical_trades(return_pct);
CREATE INDEX IF NOT EXISTS idx_historical_trades_pattern ON historical_trades(pattern);

-- ─── 2. Add new WFO columns to historical_trades ─────────────────────────────

ALTER TABLE historical_trades
  ADD COLUMN IF NOT EXISTS context                JSONB,
  ADD COLUMN IF NOT EXISTS scan_type              TEXT    DEFAULT 'deep_historical',
  ADD COLUMN IF NOT EXISTS lookback_months        INT     DEFAULT 60,
  ADD COLUMN IF NOT EXISTS exit_strategy_version  INT     DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_historical_trades_scan_type
  ON historical_trades(scan_type);

CREATE INDEX IF NOT EXISTS idx_historical_trades_lookback
  ON historical_trades(lookback_months);

-- ─── 3. Create learning_runs if missing ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_runs (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_number                INT,
  system_name               TEXT DEFAULT 'Opus Signal',
  agent_type                TEXT NOT NULL DEFAULT 'default',
  started_at                TIMESTAMPTZ DEFAULT NOW(),
  completed_at              TIMESTAMPTZ,
  iterations_run            INT,
  signals_evaluated         INT,
  objective                 TEXT DEFAULT 'avgReturn',
  control_weights           JSONB NOT NULL,
  control_source            TEXT,
  control_avg_return        NUMERIC,
  control_expectancy        NUMERIC,
  control_win_rate          NUMERIC,
  control_avg_win           NUMERIC,
  control_avg_loss          NUMERIC,
  control_profit_factor     NUMERIC,
  control_signal_count      INT,
  variant_weights           JSONB NOT NULL,
  variant_avg_return        NUMERIC,
  variant_expectancy        NUMERIC,
  variant_win_rate          NUMERIC,
  variant_avg_win           NUMERIC,
  variant_avg_loss          NUMERIC,
  variant_profit_factor     NUMERIC,
  variant_signal_count      INT,
  delta_avg_return          NUMERIC,
  delta_expectancy          NUMERIC,
  delta_win_rate            NUMERIC,
  factor_changes            JSONB,
  top_factors               JSONB,
  promoted                  BOOLEAN DEFAULT false,
  promotion_reason          TEXT,
  min_improvement_threshold NUMERIC DEFAULT 0.25,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_runs_promoted  ON learning_runs(promoted);
CREATE INDEX IF NOT EXISTS idx_learning_runs_created   ON learning_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_runs_system    ON learning_runs(system_name);
CREATE INDEX IF NOT EXISTS idx_learning_runs_agent     ON learning_runs(agent_type);

-- ─── 4. Add WFO + Bayesian columns to learning_runs ──────────────────────────

ALTER TABLE learning_runs
  ADD COLUMN IF NOT EXISTS strategy_name      TEXT,
  ADD COLUMN IF NOT EXISTS bayes_factor       NUMERIC,
  ADD COLUMN IF NOT EXISTS blend_factor       NUMERIC,
  ADD COLUMN IF NOT EXISTS bayes_evidence     TEXT,
  ADD COLUMN IF NOT EXISTS wfo_train_signals  INT,
  ADD COLUMN IF NOT EXISTS wfo_test_signals   INT,
  ADD COLUMN IF NOT EXISTS wfo_train_start    DATE,
  ADD COLUMN IF NOT EXISTS wfo_train_end      DATE,
  ADD COLUMN IF NOT EXISTS wfo_test_start     DATE,
  ADD COLUMN IF NOT EXISTS wfo_test_end       DATE;

CREATE INDEX IF NOT EXISTS idx_learning_runs_strategy
  ON learning_runs(strategy_name);

CREATE INDEX IF NOT EXISTS idx_learning_runs_bayes
  ON learning_runs(bayes_factor DESC NULLS LAST);

-- ─── 5. Create optimized_weights if missing ──────────────────────────────────
-- Stores the active weight set per agent that gets loaded as "control" next run.

CREATE TABLE IF NOT EXISTS optimized_weights (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type       TEXT NOT NULL DEFAULT 'default',
  weights          JSONB NOT NULL,
  adjustments      JSONB,
  signals_analyzed INT,
  baseline_win_rate     NUMERIC,
  baseline_avg_return   NUMERIC,
  baseline_expectancy   NUMERIC,
  avg_win          NUMERIC,
  avg_loss         NUMERIC,
  profit_factor    NUMERIC,
  top_factors      JSONB,
  generated_at     TIMESTAMPTZ,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optimized_weights_agent_active
  ON optimized_weights(agent_type, is_active);

-- ─── 6. Views ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_wfo_run_history
WITH (security_invoker = true) AS
SELECT
  run_number,
  agent_type,
  strategy_name,
  wfo_train_signals,
  wfo_test_signals,
  wfo_test_start,
  wfo_test_end,
  control_avg_return,
  variant_avg_return,
  delta_avg_return,
  bayes_factor,
  bayes_evidence,
  blend_factor,
  promoted,
  promotion_reason,
  created_at
FROM learning_runs
WHERE strategy_name IS NOT NULL
ORDER BY created_at DESC;

-- Strategy leaderboard: which hypothesis wins most often per agent
CREATE OR REPLACE VIEW v_strategy_leaderboard
WITH (security_invoker = true) AS
SELECT
  agent_type,
  strategy_name,
  COUNT(*)                                          AS runs,
  ROUND(AVG(delta_avg_return)::NUMERIC, 3)          AS avg_test_delta,
  ROUND(AVG(bayes_factor)::NUMERIC, 1)              AS avg_bayes_factor,
  ROUND(AVG(blend_factor)::NUMERIC, 3)              AS avg_blend,
  SUM(CASE WHEN promoted THEN 1 ELSE 0 END)         AS promotions,
  MAX(created_at)                                   AS last_run
FROM learning_runs
WHERE strategy_name IS NOT NULL
GROUP BY agent_type, strategy_name
ORDER BY agent_type, avg_test_delta DESC;
