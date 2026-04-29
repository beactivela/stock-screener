-- Backfill RLS for options backtesting tables on existing projects.
-- These tables live in public and should not be exposed through PostgREST to anon/authenticated roles.

ALTER TABLE IF EXISTS public.options_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.options_backtest_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.options_backtest_trades ENABLE ROW LEVEL SECURITY;
