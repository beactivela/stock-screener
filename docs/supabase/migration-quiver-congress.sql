-- Quiver Quant: politician identity (bioguide ↔ FMP name), sync runs, metrics, recent trades
-- Apply after migration-fmp-congress.sql

CREATE TABLE IF NOT EXISTS public.congress_politician_identity (
  bioguide_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  fmp_name_key TEXT NOT NULL UNIQUE,
  quiver_path_suffix TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'congress_gov', 'fuzzy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_congress_politician_identity_fmp_key
  ON public.congress_politician_identity (fmp_name_key);

CREATE TABLE IF NOT EXISTS public.quiver_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  politicians_attempted INT,
  politicians_ok INT,
  politicians_skipped INT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_quiver_sync_runs_status_finished
  ON public.quiver_sync_runs (status, finished_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.quiver_politician_metrics (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.quiver_sync_runs(id) ON DELETE CASCADE,
  bioguide_id TEXT NOT NULL REFERENCES public.congress_politician_identity(bioguide_id) ON DELETE CASCADE,
  perf_1y_pct DOUBLE PRECISION,
  perf_3y_pct DOUBLE PRECISION,
  perf_5y_pct DOUBLE PRECISION,
  perf_10y_pct DOUBLE PRECISION,
  strategy_start_date DATE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_quiver_metrics_run_bioguide
  ON public.quiver_politician_metrics (sync_run_id, bioguide_id);

CREATE TABLE IF NOT EXISTS public.quiver_politician_trades (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.quiver_sync_runs(id) ON DELETE CASCADE,
  bioguide_id TEXT NOT NULL REFERENCES public.congress_politician_identity(bioguide_id) ON DELETE CASCADE,
  transaction_date DATE,
  filed_date DATE,
  symbol TEXT,
  transaction_type TEXT,
  description TEXT,
  amount_range TEXT,
  chamber TEXT,
  excess_return_pct DOUBLE PRECISION,
  raw_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiver_trades_run_bioguide
  ON public.quiver_politician_trades (sync_run_id, bioguide_id);

CREATE INDEX IF NOT EXISTS idx_quiver_trades_txn_date
  ON public.quiver_politician_trades (transaction_date DESC NULLS LAST);

ALTER TABLE public.congress_politician_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiver_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiver_politician_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiver_politician_trades ENABLE ROW LEVEL SECURITY;
