-- Options CSP backtesting persistence

CREATE TABLE IF NOT EXISTS public.options_backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  strategy TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.options_backtest_setups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.options_backtest_runs(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  delta_target NUMERIC NOT NULL,
  entry_dte INTEGER NOT NULL,
  profit_target_pct NUMERIC NOT NULL,
  close_dte INTEGER NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  equity_curve_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rank_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.options_backtest_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_id UUID NOT NULL REFERENCES public.options_backtest_setups(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  entry_date DATE NOT NULL,
  exit_date DATE NOT NULL,
  strike NUMERIC NOT NULL,
  entry_dte INTEGER NOT NULL,
  exit_dte INTEGER NOT NULL,
  target_delta NUMERIC NOT NULL,
  premium_open NUMERIC NOT NULL,
  premium_close NUMERIC NOT NULL,
  collateral_usd NUMERIC NOT NULL,
  exit_reason TEXT NOT NULL,
  assigned BOOLEAN NOT NULL DEFAULT false,
  pnl_usd NUMERIC NOT NULL,
  return_pct NUMERIC NOT NULL,
  annualized_roy_pct NUMERIC,
  days_held INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_options_backtest_runs_created_at
  ON public.options_backtest_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_options_backtest_runs_ticker_strategy
  ON public.options_backtest_runs (ticker, strategy);

CREATE INDEX IF NOT EXISTS idx_options_backtest_setups_run_id
  ON public.options_backtest_setups (run_id, rank_order);

CREATE INDEX IF NOT EXISTS idx_options_backtest_trades_setup_id
  ON public.options_backtest_trades (setup_id, entry_date);

ALTER TABLE public.options_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options_backtest_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options_backtest_trades ENABLE ROW LEVEL SECURITY;
