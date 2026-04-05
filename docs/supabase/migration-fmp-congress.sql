-- FMP: latest Senate / House disclosure rows (stable senate-latest, house-latest)
-- Apply in Supabase SQL editor or via scripts/migrate-supabase.js

CREATE TABLE IF NOT EXISTS public.fmp_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  label TEXT,
  fmp_congress_senate_rows INT,
  fmp_congress_house_rows INT,
  fmp_institutional_probe TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_fmp_sync_runs_status_finished
  ON public.fmp_sync_runs (status, finished_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.fmp_congress_trades (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.fmp_sync_runs(id) ON DELETE CASCADE,
  chamber TEXT NOT NULL CHECK (chamber IN ('senate', 'house')),
  symbol TEXT,
  disclosure_date DATE,
  transaction_date DATE,
  first_name TEXT,
  last_name TEXT,
  office TEXT,
  district TEXT,
  owner TEXT,
  asset_description TEXT,
  asset_type TEXT,
  transaction_type TEXT,
  amount_range TEXT,
  comment TEXT,
  link TEXT,
  capital_gains_over_200 TEXT,
  raw_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_fmp_congress_sync_chamber
  ON public.fmp_congress_trades (sync_run_id, chamber);

CREATE INDEX IF NOT EXISTS idx_fmp_congress_symbol
  ON public.fmp_congress_trades (symbol);

ALTER TABLE public.fmp_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fmp_congress_trades ENABLE ROW LEVEL SECURITY;
