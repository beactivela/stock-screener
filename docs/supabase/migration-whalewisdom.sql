-- =============================================================================
-- WhaleWisdom filer holdings (synced from public filer pages; see server/whalewisdom/)
-- SSR payload includes top holdings per filer; full portfolio may require WhaleWisdom API.
-- Run via Supabase SQL Editor or npm run migrate:supabase
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.whalewisdom_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  filers_matched INT DEFAULT 0,
  filers_fetched INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.whalewisdom_filers (
  slug TEXT PRIMARY KEY,
  display_name TEXT,
  manager_name TEXT,
  ww_filer_id BIGINT,
  whalewisdom_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whalewisdom_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_run_id UUID NOT NULL REFERENCES public.whalewisdom_sync_runs(id) ON DELETE CASCADE,
  filer_slug TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  action_type TEXT NOT NULL DEFAULT 'held' CHECK (
    action_type IN ('new_holding', 'increased', 'decreased', 'sold', 'unknown', 'held')
  ),
  action_pct NUMERIC,
  quarter_label TEXT,
  shares_held NUMERIC,
  shares_raw TEXT,
  position_value_usd NUMERIC,
  pct_of_portfolio NUMERIC,
  security_type TEXT,
  raw_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whalewisdom_positions_run_filer
  ON public.whalewisdom_positions (sync_run_id, filer_slug);
CREATE INDEX IF NOT EXISTS idx_whalewisdom_positions_ticker
  ON public.whalewisdom_positions (ticker);
CREATE INDEX IF NOT EXISTS idx_whalewisdom_sync_runs_status_finished
  ON public.whalewisdom_sync_runs (status, finished_at DESC);

CREATE OR REPLACE FUNCTION public.whalewisdom_latest_completed_run_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM public.whalewisdom_sync_runs
  WHERE status = 'completed'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE VIEW public.v_whalewisdom_positions_latest
WITH (security_invoker = true) AS
SELECT p.*
FROM public.whalewisdom_positions p
WHERE p.sync_run_id = public.whalewisdom_latest_completed_run_id();

CREATE OR REPLACE VIEW public.v_whalewisdom_ticker_overlap
WITH (security_invoker = true) AS
SELECT
  ticker,
  COUNT(DISTINCT filer_slug) AS filer_count
FROM public.v_whalewisdom_positions_latest
GROUP BY ticker;

ALTER TABLE public.whalewisdom_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whalewisdom_filers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whalewisdom_positions ENABLE ROW LEVEL SECURITY;
