-- =============================================================================
-- Self-Learning Trading System Schema
-- Extends base schema with failure analysis, pattern recognition, and learning
-- Run in Supabase SQL Editor AFTER schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. HISTORICAL TRADES (Auto-generated from Opus4.5 signals)
-- System-generated trades from scanning past 5 years (60 months) of data
-- NO manual entry required - populated by historical signal scanner
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historical_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker TEXT NOT NULL,
  entry_date DATE NOT NULL,
  entry_price NUMERIC NOT NULL,
  exit_date DATE,
  exit_price NUMERIC,
  return_pct NUMERIC,
  holding_days INT,
  max_gain NUMERIC,
  max_drawdown NUMERIC,
  exit_type TEXT,
  
  -- Signal quality at entry
  opus45_confidence NUMERIC,
  opus45_grade TEXT,
  signal_type TEXT,
  
  -- Pattern details
  pattern TEXT,
  pattern_confidence NUMERIC,
  contractions INT,
  
  -- Source tracking
  source TEXT DEFAULT 'historical_scan',
  scan_date TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate entries
  UNIQUE(ticker, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_historical_trades_ticker ON historical_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_historical_trades_entry ON historical_trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_historical_trades_return ON historical_trades(return_pct);
CREATE INDEX IF NOT EXISTS idx_historical_trades_pattern ON historical_trades(pattern);

-- -----------------------------------------------------------------------------
-- 1. TRADE CONTEXT SNAPSHOTS
-- Full entry context at trade initiation for post-mortem analysis
-- Supports BOTH manual trades (trade_id FK) and historical scans (trade_id as TEXT)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_context_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id TEXT NOT NULL,  -- UUID for real trades, 'hist_TICKER_DATE' for historical
  ticker TEXT NOT NULL,
  snapshot_date DATE,
  entry_date DATE,  -- Alternative to snapshot_date for historical data
  
  -- Price & MA Data (snapshot at entry)
  entry_price NUMERIC NOT NULL,
  sma_10 NUMERIC,
  sma_20 NUMERIC,
  sma_50 NUMERIC,
  sma_150 NUMERIC,
  sma_200 NUMERIC,
  
  -- MA Alignment (all must be true for proper Stage 2)
  ma_alignment_valid BOOLEAN,  -- 50 > 150 > 200
  price_above_all_mas BOOLEAN,
  ma_200_rising BOOLEAN,
  ma_10_slope_14d NUMERIC,     -- % slope over 14 days
  ma_10_slope_5d NUMERIC,      -- % slope over 5 days
  
  -- VCP Pattern Quality
  vcp_valid BOOLEAN,
  contractions INT,
  pullback_pcts JSONB,         -- Array of pullback depths
  base_depth_pct NUMERIC,      -- Deepest pullback from high
  base_duration_days INT,      -- Days in consolidation
  volume_dry_up BOOLEAN,
  pattern_type TEXT,           -- VCP, Cup-with-Handle, Flat Base, etc.
  pattern_confidence NUMERIC,
  
  -- Breakout Quality (NEW)
  breakout_volume_ratio NUMERIC,  -- Breakout day volume / 50-day avg
  breakout_confirmed BOOLEAN,     -- Volume > 40% above avg
  pivot_price NUMERIC,            -- Pivot/breakout price level
  entry_vs_pivot_pct NUMERIC,     -- How far above/below pivot we entered
  
  -- 52-Week Stats
  high_52w NUMERIC,
  low_52w NUMERIC,
  pct_from_high NUMERIC,
  pct_above_low NUMERIC,
  
  -- Relative Strength
  relative_strength NUMERIC,
  rs_vs_spy_6m NUMERIC,
  rs_ranking_percentile NUMERIC,  -- IBD-style 0-99 rank
  
  -- Market Condition at Entry (NEW)
  market_regime TEXT,            -- BULL, BEAR, UNCERTAIN
  spy_distribution_days INT,     -- Last 25 days
  qqq_distribution_days INT,
  market_in_correction BOOLEAN,  -- True if 5+ distribution days
  spy_above_50ma BOOLEAN,
  spy_above_200ma BOOLEAN,
  
  -- Industry Context
  industry_name TEXT,
  industry_rank INT,
  sector_name TEXT,
  
  -- Fundamentals
  eps_growth_qtr NUMERIC,
  eps_growth_annual NUMERIC,
  institutional_ownership NUMERIC,
  profit_margin NUMERIC,
  
  -- Opus4.5 Signal Data
  opus45_confidence NUMERIC,
  opus45_grade TEXT,
  enhanced_score NUMERIC,
  
  -- Additional Context
  entry_reason TEXT,           -- Why this trade was taken
  conviction_level INT,        -- 1-5 scale
  
  -- Trade Outcome (for historical scans)
  exit_date DATE,
  exit_price NUMERIC,
  exit_type TEXT,              -- STOP_LOSS, BELOW_10MA, MAX_HOLD
  return_pct NUMERIC,
  holding_days INT,
  max_gain NUMERIC,
  max_drawdown NUMERIC,
  
  -- Data source
  source TEXT DEFAULT 'manual',  -- manual, historical_scan
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- For historical scans, trade_id is a TEXT key, not FK
  UNIQUE(trade_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_context_trade ON trade_context_snapshots(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_context_ticker ON trade_context_snapshots(ticker);
CREATE INDEX IF NOT EXISTS idx_trade_context_date ON trade_context_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_trade_context_source ON trade_context_snapshots(source);
CREATE INDEX IF NOT EXISTS idx_trade_context_return ON trade_context_snapshots(return_pct);

-- -----------------------------------------------------------------------------
-- 2. FAILURE CLASSIFICATIONS
-- Structured classification of why trades failed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS failure_classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  context_snapshot_id UUID REFERENCES trade_context_snapshots(id),
  
  -- Primary failure category (mutually exclusive)
  primary_category TEXT NOT NULL CHECK (primary_category IN (
    'MARKET_CONDITION',    -- General market was weak/bearish
    'FALSE_BREAKOUT',      -- Broke out but volume didn't confirm / closed back in base
    'WEAK_BASE',           -- Base too deep (>35%) or too short (<5 weeks)
    'LOW_RS',              -- RS < 80 at entry (should have been stronger)
    'OVERHEAD_SUPPLY',     -- Too much resistance above entry
    'EARLY_ENTRY',         -- Entered before proper pivot/VCP completion
    'EARNINGS_GAP',        -- Gap down on earnings
    'SECTOR_ROTATION',     -- Sector fell out of favor
    'STOP_LOSS_TOO_TIGHT', -- Normal volatility stopped us out
    'UNKNOWN'              -- Needs manual review
  )),
  
  -- Secondary contributing factors (can have multiple)
  secondary_factors JSONB,  -- Array of additional factors
  
  -- Confidence in classification (0-100)
  classification_confidence NUMERIC,
  
  -- Supporting evidence
  evidence JSONB,  -- Data points that support this classification
  
  -- Human override (if manually reclassified)
  manually_reviewed BOOLEAN DEFAULT FALSE,
  manual_category TEXT,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  
  -- Analysis timestamps
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  algorithm_version TEXT DEFAULT 'v1.0'
);

CREATE INDEX IF NOT EXISTS idx_failure_class_trade ON failure_classifications(trade_id);
CREATE INDEX IF NOT EXISTS idx_failure_class_category ON failure_classifications(primary_category);

-- -----------------------------------------------------------------------------
-- 3. MARKET CONDITION TRACKING
-- Daily market regime and distribution day tracking
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL UNIQUE,
  
  -- SPY Stats
  spy_close NUMERIC,
  spy_sma_50 NUMERIC,
  spy_sma_200 NUMERIC,
  spy_above_50ma BOOLEAN,
  spy_above_200ma BOOLEAN,
  spy_daily_change_pct NUMERIC,
  spy_volume BIGINT,
  spy_avg_volume_50d BIGINT,
  spy_is_distribution_day BOOLEAN,  -- Down > 0.2% on higher volume
  
  -- QQQ Stats
  qqq_close NUMERIC,
  qqq_sma_50 NUMERIC,
  qqq_sma_200 NUMERIC,
  qqq_above_50ma BOOLEAN,
  qqq_above_200ma BOOLEAN,
  qqq_daily_change_pct NUMERIC,
  qqq_volume BIGINT,
  qqq_avg_volume_50d BIGINT,
  qqq_is_distribution_day BOOLEAN,
  
  -- Distribution Day Count (rolling 25 days)
  spy_distribution_count_25d INT,
  qqq_distribution_count_25d INT,
  
  -- Market Regime (derived)
  market_regime TEXT CHECK (market_regime IN ('BULL', 'BEAR', 'UNCERTAIN', 'CORRECTION')),
  regime_confidence NUMERIC,  -- 0-100
  
  -- Follow-through day tracking
  is_follow_through_day BOOLEAN,  -- 4th+ day of rally, up 1%+ on volume
  days_since_correction INT,
  
  -- Additional indicators
  vix_close NUMERIC,
  advance_decline_ratio NUMERIC,
  new_highs_count INT,
  new_lows_count INT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_conditions_date ON market_conditions(date DESC);
CREATE INDEX IF NOT EXISTS idx_market_conditions_regime ON market_conditions(market_regime);

-- -----------------------------------------------------------------------------
-- 4. PATTERN ANALYSIS RESULTS
-- Learning patterns from trade outcomes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pattern_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_date DATE NOT NULL,
  analysis_type TEXT NOT NULL,  -- 'periodic' (every 10 trades) or 'weekly'
  
  -- Trade counts at time of analysis
  total_trades_analyzed INT,
  winning_trades INT,
  losing_trades INT,
  win_rate NUMERIC,
  
  -- Failure category distribution
  failure_category_counts JSONB,  -- { "MARKET_CONDITION": 3, "FALSE_BREAKOUT": 2, ... }
  
  -- Correlations discovered
  win_correlations JSONB,   -- Factors that correlate with wins
  loss_correlations JSONB,  -- Factors that correlate with losses
  
  -- Most predictive factors (ranked)
  top_win_predictors JSONB,   -- [{ factor, correlation, confidence }, ...]
  top_loss_predictors JSONB,
  
  -- Optimal entry conditions (learned)
  optimal_rs_range JSONB,           -- { min, max, ideal }
  optimal_contractions JSONB,       -- { min, max, ideal }
  optimal_pullback_depth JSONB,     -- { min, max, ideal }
  optimal_base_duration JSONB,      -- { min, max, ideal }
  optimal_industry_rank JSONB,      -- { max_acceptable }
  
  -- Market condition insights
  market_condition_impact JSONB,  -- { regime: win_rate, ... }
  
  -- Suggested weight adjustments
  suggested_weight_changes JSONB,
  
  -- Insights summary (human-readable)
  insights_summary TEXT,
  
  -- Confidence in analysis
  sample_size INT,
  statistical_confidence NUMERIC,  -- 0-100 based on sample size
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_analysis_date ON pattern_analysis(analysis_date DESC);

-- -----------------------------------------------------------------------------
-- 5. WEEKLY LEARNING REPORTS
-- "What I Learned" weekly summaries
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_learning_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  
  -- Trade activity
  trades_opened INT,
  trades_closed INT,
  
  -- Performance
  gross_return_pct NUMERIC,
  best_trade_ticker TEXT,
  best_trade_return NUMERIC,
  worst_trade_ticker TEXT,
  worst_trade_return NUMERIC,
  win_rate NUMERIC,
  
  -- Failures analyzed
  new_failures_analyzed INT,
  failure_breakdown JSONB,  -- { category: count }
  
  -- Key learnings (prioritized list)
  key_learnings JSONB,  -- [{ insight, evidence, action, priority }, ...]
  
  -- Pattern changes
  new_patterns_discovered JSONB,
  patterns_confirmed JSONB,
  patterns_invalidated JSONB,
  
  -- Weight adjustments made
  weight_adjustments JSONB,
  
  -- Market condition summary
  market_regime_this_week TEXT,
  distribution_days_this_week INT,
  
  -- Action items for next week
  action_items JSONB,  -- [{ action, reason, priority }, ...]
  
  -- Confidence metrics
  learning_quality_score NUMERIC,  -- 0-100 based on data quality
  
  report_generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_report_week ON weekly_learning_reports(week_start);

-- -----------------------------------------------------------------------------
-- 6. LEARNING WEIGHT HISTORY
-- Track all weight changes over time for analysis
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_weight_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  change_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_reason TEXT,  -- e.g., "Pattern analysis: FALSE_BREAKOUT rate high"
  
  -- Before/after snapshots
  weights_before JSONB,
  weights_after JSONB,
  
  -- Specific changes made
  changes JSONB,  -- [{ weight_key, old_value, new_value, reason }, ...]
  
  -- Analysis that triggered change
  triggered_by_analysis_id UUID REFERENCES pattern_analysis(id),
  
  -- Performance tracking
  trades_before_change INT,
  win_rate_before_change NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_history_date ON learning_weight_history(change_date DESC);

-- -----------------------------------------------------------------------------
-- 7. BREAKOUT TRACKING
-- Track breakout quality and follow-through
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS breakout_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker TEXT NOT NULL,
  breakout_date DATE NOT NULL,
  
  -- Breakout quality
  pivot_price NUMERIC NOT NULL,
  breakout_close NUMERIC NOT NULL,
  pct_above_pivot NUMERIC,
  
  -- Volume confirmation
  breakout_volume BIGINT,
  avg_volume_50d BIGINT,
  volume_ratio NUMERIC,  -- breakout_volume / avg_volume_50d
  volume_confirmed BOOLEAN,  -- volume_ratio >= 1.4
  
  -- Pattern at breakout
  pattern_type TEXT,
  pattern_confidence NUMERIC,
  base_depth_pct NUMERIC,
  base_duration_days INT,
  
  -- Follow-through tracking (updated daily)
  day_1_close NUMERIC,
  day_1_held BOOLEAN,
  day_2_close NUMERIC,
  day_2_held BOOLEAN,
  day_3_close NUMERIC,
  day_3_held BOOLEAN,
  day_5_close NUMERIC,
  day_5_held BOOLEAN,
  
  -- Outcome
  breakout_succeeded BOOLEAN,  -- Still above pivot after 5 days
  max_gain_5d_pct NUMERIC,
  max_drawdown_5d_pct NUMERIC,
  
  -- Classification
  failed_reason TEXT,  -- If breakout failed: volume, market, etc.
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(ticker, breakout_date)
);

CREATE INDEX IF NOT EXISTS idx_breakout_ticker ON breakout_tracking(ticker);
CREATE INDEX IF NOT EXISTS idx_breakout_date ON breakout_tracking(breakout_date DESC);
CREATE INDEX IF NOT EXISTS idx_breakout_confirmed ON breakout_tracking(volume_confirmed);

-- -----------------------------------------------------------------------------
-- 8. HISTORICAL WIN RATES BY SETUP
-- Cache win rates for similar setups for confidence scoring
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setup_win_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Setup characteristics (bucketed for matching)
  rs_bucket TEXT,           -- '70-80', '80-90', '90+'
  contractions_bucket TEXT, -- '2', '3', '4+'
  pullback_bucket TEXT,     -- '0-2%', '2-5%', '5-8%', '8%+'
  industry_bucket TEXT,     -- 'top20', 'top40', 'top80', 'bottom'
  market_regime TEXT,       -- 'BULL', 'BEAR', 'UNCERTAIN'
  
  -- Historical performance
  total_trades INT,
  winning_trades INT,
  win_rate NUMERIC,
  avg_return NUMERIC,
  avg_holding_days NUMERIC,
  
  -- Confidence in data
  sample_sufficient BOOLEAN,  -- total_trades >= 10
  last_updated TIMESTAMPTZ,
  
  -- Composite key
  UNIQUE(rs_bucket, contractions_bucket, pullback_bucket, industry_bucket, market_regime)
);

CREATE INDEX IF NOT EXISTS idx_setup_win_rates_lookup ON setup_win_rates(
  rs_bucket, contractions_bucket, pullback_bucket, industry_bucket, market_regime
);

-- -----------------------------------------------------------------------------
-- Helper function: Update market conditions for today
-- Call this daily to keep market condition tracking current
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_market_conditions()
RETURNS void AS $$
BEGIN
  -- This function would be called by the Node.js backend
  -- The actual logic is in server/learning/distributionDays.js
  RAISE NOTICE 'Market conditions should be updated via Node.js backend';
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- View: Recent failures for learning
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recent_failures AS
SELECT 
  fc.id,
  fc.trade_id,
  fc.primary_category,
  fc.classification_confidence,
  t.ticker,
  t.entry_date,
  t.exit_date,
  t.return_pct,
  t.holding_days,
  tcs.relative_strength,
  tcs.contractions,
  tcs.market_regime,
  tcs.industry_rank
FROM failure_classifications fc
JOIN trades t ON fc.trade_id = t.id
LEFT JOIN trade_context_snapshots tcs ON fc.context_snapshot_id = tcs.id
WHERE t.status != 'open' AND t.return_pct < 0
ORDER BY t.exit_date DESC;

-- -----------------------------------------------------------------------------
-- View: Setup performance summary
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_setup_performance AS
SELECT 
  tcs.market_regime,
  CASE 
    WHEN tcs.relative_strength >= 90 THEN '90+'
    WHEN tcs.relative_strength >= 80 THEN '80-90'
    WHEN tcs.relative_strength >= 70 THEN '70-80'
    ELSE '<70'
  END as rs_bucket,
  CASE 
    WHEN tcs.contractions >= 4 THEN '4+'
    WHEN tcs.contractions >= 3 THEN '3'
    ELSE '2'
  END as contractions_bucket,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE t.return_pct > 0) as winning_trades,
  ROUND(COUNT(*) FILTER (WHERE t.return_pct > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as win_rate,
  ROUND(AVG(t.return_pct)::numeric, 2) as avg_return
FROM trade_context_snapshots tcs
JOIN trades t ON tcs.trade_id = t.id
WHERE t.status != 'open'
GROUP BY tcs.market_regime, rs_bucket, contractions_bucket
ORDER BY win_rate DESC;

-- -----------------------------------------------------------------------------
-- 10. OPTIMIZED WEIGHTS (Auto-tuned Opus4.5 weights)
-- Stores learned weight configurations from historical analysis
-- The system auto-updates these based on cross-stock pattern analysis
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS optimized_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Multi-agent support: each strategy agent stores its own weight set
  agent_type TEXT NOT NULL DEFAULT 'default',
  
  -- The actual weights (JSONB for flexibility)
  weights JSONB NOT NULL,
  
  -- Adjustments made from default
  adjustments JSONB,
  
  -- Analysis metadata
  signals_analyzed INT,
  baseline_win_rate NUMERIC,
  baseline_avg_return NUMERIC,
  baseline_expectancy NUMERIC,
  avg_win NUMERIC,
  avg_loss NUMERIC,
  profit_factor NUMERIC,
  top_factors JSONB,
  
  -- Status
  is_active BOOLEAN DEFAULT false,
  generated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optimized_weights_active ON optimized_weights(is_active);
CREATE INDEX IF NOT EXISTS idx_optimized_weights_created ON optimized_weights(created_at);
CREATE INDEX IF NOT EXISTS idx_optimized_weights_agent ON optimized_weights(agent_type);

-- View: Active optimized weights (default agent, backward compatible)
CREATE OR REPLACE VIEW v_active_weights AS
SELECT 
  id,
  agent_type,
  weights,
  adjustments,
  signals_analyzed,
  baseline_win_rate,
  baseline_avg_return,
  baseline_expectancy,
  avg_win,
  avg_loss,
  profit_factor,
  top_factors,
  generated_at
FROM optimized_weights
WHERE is_active = true AND agent_type = 'default'
ORDER BY created_at DESC
LIMIT 1;

-- -----------------------------------------------------------------------------
-- 11. LEARNING RUNS (A/B test history for Opus Signal optimization)
-- Each run compares control (current active weights) vs variant (new candidate).
-- Only promoted runs become the new active weight set.
-- Enables compounding: each run builds on the last promoted result.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Run metadata
  run_number INT,
  system_name TEXT DEFAULT 'Opus Signal',
  agent_type TEXT NOT NULL DEFAULT 'default',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  iterations_run INT,
  signals_evaluated INT,
  objective TEXT DEFAULT 'avgReturn',  -- avgReturn, expectancy, winRate
  
  -- Control (baseline) metrics and weights
  control_weights JSONB NOT NULL,
  control_source TEXT,          -- 'default' or 'optimized'
  control_avg_return NUMERIC,
  control_expectancy NUMERIC,
  control_win_rate NUMERIC,
  control_avg_win NUMERIC,
  control_avg_loss NUMERIC,
  control_profit_factor NUMERIC,
  control_signal_count INT,
  
  -- Variant (candidate) metrics and weights
  variant_weights JSONB NOT NULL,
  variant_avg_return NUMERIC,
  variant_expectancy NUMERIC,
  variant_win_rate NUMERIC,
  variant_avg_win NUMERIC,
  variant_avg_loss NUMERIC,
  variant_profit_factor NUMERIC,
  variant_signal_count INT,
  
  -- Delta (variant - control)
  delta_avg_return NUMERIC,
  delta_expectancy NUMERIC,
  delta_win_rate NUMERIC,
  
  -- What changed between control and variant
  factor_changes JSONB,  -- [{ weight, oldValue, newValue, factor, reason }]
  top_factors JSONB,
  
  -- Promotion decision
  promoted BOOLEAN DEFAULT false,
  promotion_reason TEXT,
  min_improvement_threshold NUMERIC DEFAULT 0.25,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_runs_promoted ON learning_runs(promoted);
CREATE INDEX IF NOT EXISTS idx_learning_runs_created ON learning_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_runs_system ON learning_runs(system_name);
CREATE INDEX IF NOT EXISTS idx_learning_runs_agent ON learning_runs(agent_type);

-- View: Latest promoted run (current active baseline for next A/B comparison)
CREATE OR REPLACE VIEW v_latest_promoted_run AS
SELECT *
FROM learning_runs
WHERE promoted = true
ORDER BY created_at DESC
LIMIT 1;

-- View: Recent A/B history (last 20 runs, all agents)
CREATE OR REPLACE VIEW v_learning_run_history AS
SELECT 
  id,
  run_number,
  agent_type,
  objective,
  control_avg_return,
  variant_avg_return,
  delta_avg_return,
  control_expectancy,
  variant_expectancy,
  delta_expectancy,
  control_win_rate,
  variant_win_rate,
  promoted,
  promotion_reason,
  iterations_run,
  signals_evaluated,
  completed_at
FROM learning_runs
ORDER BY created_at DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 12. AGENT CONFIGS (Per-agent thresholds and regime budget allocations)
-- Stores tunable configuration per strategy agent without code changes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  agent_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  
  -- Mandatory threshold overrides (merged over MANDATORY_THRESHOLDS defaults)
  mandatory_overrides JSONB DEFAULT '{}',
  
  -- Default weight overrides (merged over DEFAULT_WEIGHTS)
  weight_overrides JSONB DEFAULT '{}',
  
  -- Training data filter (which signals this agent trains on)
  training_filter JSONB DEFAULT '{}',
  
  -- Regime budget allocations: { "BULL": 0.6, "UNCERTAIN": 0.3, ... }
  regime_budgets JSONB DEFAULT '{"BULL": 0.25, "UNCERTAIN": 0.25, "CORRECTION": 0.25, "BEAR": 0}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_type ON agent_configs(agent_type);

-- Seed default agent configurations
INSERT INTO agent_configs (agent_type, display_name, mandatory_overrides, weight_overrides, training_filter, regime_budgets) VALUES
  ('momentum_scout', 'Momentum Scout', 
   '{"minRelativeStrength": 85, "min10MASlopePct14d": 7, "maxDistanceFromHigh": 10}',
   '{"slope10MAElite": 30, "slope10MAStrong": 25, "entryRSAbove90": 15}',
   '{"minSlope14d": 7, "minRS": 85}',
   '{"BULL": 0.60, "UNCERTAIN": 0.30, "CORRECTION": 0.10, "BEAR": 0}'),
  ('base_hunter', 'Base Hunter',
   '{"minContractions": 4, "minPatternConfidence": 60}',
   '{"vcpContractions3Plus": 12, "vcpContractions4Plus": 8, "vcpVolumeDryUp": 8, "vcpPatternConfidence": 8, "slope10MAElite": 15, "slope10MAStrong": 12}',
   '{"minContractions": 4, "requireVolumeDryUp": true}',
   '{"BULL": 0.10, "UNCERTAIN": 0.50, "CORRECTION": 0.70, "BEAR": 0}'),
  ('breakout_tracker', 'Breakout Tracker',
   '{"maxDistanceFromHigh": 5, "minRelativeStrength": 80}',
   '{"pctFromHighIdeal": 10, "pctFromHighGood": 5, "entryVolumeConfirm": 10}',
   '{"maxPctFromHigh": 5, "requireVolumeConfirmation": true}',
   '{"BULL": 0.30, "UNCERTAIN": 0.20, "CORRECTION": 0.20, "BEAR": 0}')
ON CONFLICT (agent_type) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 13. MARKET REGIMES LOG (Historical regime classifications)
-- Logs each regime classification so the system can review what regime was
-- active when each signal was generated.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_regimes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  regime TEXT NOT NULL,
  confidence NUMERIC,
  
  spy_close NUMERIC,
  spy_50ma NUMERIC,
  spy_200ma NUMERIC,
  qqq_close NUMERIC,
  qqq_50ma NUMERIC,
  
  spy_distribution_days INT,
  qqq_distribution_days INT,
  
  exposure_multiplier NUMERIC DEFAULT 1.0,
  agent_budgets JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_regimes_date ON market_regimes(classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_regimes_regime ON market_regimes(regime);
