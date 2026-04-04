-- =============================================================================
-- StockCircle expert holdings (synced from public HTML; see server/stockcircle/)
-- Run via: Supabase MCP apply_migration, SQL Editor, or npm run migrate:supabase
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stockcircle_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  investors_matched INT DEFAULT 0,
  investors_fetched INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.stockcircle_investors (
  slug TEXT PRIMARY KEY,
  display_name TEXT,
  firm_name TEXT,
  performance_1y_pct NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stockcircle_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_run_id UUID NOT NULL REFERENCES public.stockcircle_sync_runs(id) ON DELETE CASCADE,
  investor_slug TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('new_holding', 'increased', 'decreased', 'sold', 'unknown')
  ),
  action_pct NUMERIC,
  quarter_label TEXT,
  shares_held NUMERIC,
  shares_raw TEXT,
  position_value_usd NUMERIC,
  raw_last_transaction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stockcircle_positions_run_investor
  ON public.stockcircle_positions (sync_run_id, investor_slug);
CREATE INDEX IF NOT EXISTS idx_stockcircle_positions_ticker
  ON public.stockcircle_positions (ticker);
CREATE INDEX IF NOT EXISTS idx_stockcircle_positions_run_action
  ON public.stockcircle_positions (sync_run_id, action_type);
CREATE INDEX IF NOT EXISTS idx_stockcircle_sync_runs_status_finished
  ON public.stockcircle_sync_runs (status, finished_at DESC);

-- Latest completed sync id (helper for views)
CREATE OR REPLACE FUNCTION public.stockcircle_latest_completed_run_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM public.stockcircle_sync_runs
  WHERE status = 'completed'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE VIEW public.v_stockcircle_positions_latest
WITH (security_invoker = true) AS
SELECT p.*
FROM public.stockcircle_positions p
WHERE p.sync_run_id = public.stockcircle_latest_completed_run_id();

CREATE OR REPLACE VIEW public.v_stockcircle_ticker_popularity
WITH (security_invoker = true) AS
SELECT
  ticker,
  COUNT(DISTINCT investor_slug) FILTER (
    WHERE action_type IN ('new_holding', 'increased')
  ) AS buying_firms,
  COUNT(DISTINCT investor_slug) FILTER (
    WHERE action_type IN ('sold', 'decreased')
  ) AS selling_firms
FROM public.v_stockcircle_positions_latest
GROUP BY ticker;

ALTER TABLE public.stockcircle_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockcircle_investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockcircle_positions ENABLE ROW LEVEL SECURITY;
