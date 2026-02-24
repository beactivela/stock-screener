-- Migration: Add missing columns to trade_context_snapshots and historical_trades
-- Run this in Supabase SQL Editor if you're upgrading from an older schema

-- Add source column to trade_context_snapshots if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'source'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;
END $$;

-- Add exit-related columns to trade_context_snapshots if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'exit_date'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN exit_date DATE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'exit_price'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN exit_price NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'exit_type'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN exit_type TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'return_pct'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN return_pct NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'holding_days'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN holding_days INT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'max_gain'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN max_gain NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'max_drawdown'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN max_drawdown NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trade_context_snapshots' AND column_name = 'entry_date'
  ) THEN
    ALTER TABLE trade_context_snapshots ADD COLUMN entry_date DATE;
  END IF;
END $$;

-- Create historical_trades table if it doesn't exist
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
  opus45_confidence NUMERIC,
  opus45_grade TEXT,
  signal_type TEXT,
  pattern TEXT,
  pattern_confidence NUMERIC,
  contractions INT,
  source TEXT DEFAULT 'historical_scan',
  scan_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_historical_trades_ticker ON historical_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_historical_trades_entry ON historical_trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_historical_trades_return ON historical_trades(return_pct);
CREATE INDEX IF NOT EXISTS idx_historical_trades_pattern ON historical_trades(pattern);

-- Create optimized_weights table if it doesn't exist
CREATE TABLE IF NOT EXISTS optimized_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  weights JSONB NOT NULL,
  analysis_date TIMESTAMPTZ DEFAULT NOW(),
  signals_analyzed INT,
  baseline_win_rate NUMERIC,
  top_factors JSONB,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optimized_weights_active ON optimized_weights(is_active);

-- View for active weights
CREATE OR REPLACE VIEW v_active_weights AS
SELECT * FROM optimized_weights WHERE is_active = true ORDER BY created_at DESC LIMIT 1;

SELECT 'Migration complete! All columns and tables have been added.' as status;
