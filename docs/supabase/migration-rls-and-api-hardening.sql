-- =============================================================================
-- RLS + API hardening (Supabase Database Linter)
-- Run once in SQL Editor or via: npm run migrate:supabase (if wired) / MCP apply_migration
--
-- Why: Tables in `public` are exposed to PostgREST. Without RLS, anyone with the
-- publishable (anon) key can read/write those tables. Your Node server should use
-- SUPABASE_SERVICE_KEY only - that role bypasses RLS and keeps full access.
--
-- After this migration:
-- - anon / authenticated JWT roles see no rows and cannot mutate data (no policies).
-- - service_role (your server) is unchanged.
-- - SECURITY INVOKER views evaluate RLS as the caller, not the view owner.
-- =============================================================================

-- Remove permissive policies that use USING (true) for ALL - they trigger linter WARN
-- and add no real protection (service_role already bypasses RLS).
DROP POLICY IF EXISTS "Service role full access on agent_configs" ON public.agent_configs;
DROP POLICY IF EXISTS "Service role full access on market_regimes" ON public.market_regimes;

-- Enable RLS on every ordinary table in public that does not already have it.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $$;

-- Recreate views as security invoker (Postgres 15+): underlying table RLS applies to anon.
DO $$
DECLARE
  v TEXT;
  views TEXT[] := ARRAY[
    'v_latest_scan_run',
    'v_latest_promoted_run',
    'v_learning_run_history',
    'v_setup_performance',
    'v_recent_failures',
    'v_active_weights',
    'v_wfo_run_history',
    'v_strategy_leaderboard'
  ];
BEGIN
  FOREACH v IN ARRAY views
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

-- Linter 0011: immutable search_path on SECURITY DEFINER-style functions
CREATE OR REPLACE FUNCTION public.update_market_conditions()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'Market conditions should be updated via Node.js backend';
END;
$$;

-- Supabase linter may show INFO "RLS enabled no policy" (lint 0008) for each table.
-- That is intentional here: anon/authenticated have no policies, so API access is denied;
-- only the service_role key (server) bypasses RLS.
