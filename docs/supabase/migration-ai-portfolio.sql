-- =============================================================================
-- AI Portfolio: live paper manager portfolios
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_portfolio_managers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  starting_capital_usd NUMERIC NOT NULL DEFAULT 50000,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_portfolio_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  state_json JSONB
);

CREATE TABLE IF NOT EXISTS public.ai_portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id TEXT NOT NULL REFERENCES public.ai_portfolio_managers(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.ai_portfolio_runs(id) ON DELETE SET NULL,
  underlying_symbol TEXT NOT NULL,
  ticker TEXT NOT NULL,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('stock', 'option')),
  strategy TEXT NOT NULL,
  contract_symbol TEXT,
  quantity NUMERIC NOT NULL,
  avg_cost_usd NUMERIC NOT NULL,
  mark_usd NUMERIC,
  exposure_usd NUMERIC NOT NULL DEFAULT 0,
  max_loss_usd NUMERIC NOT NULL DEFAULT 0,
  reserved_usd NUMERIC NOT NULL DEFAULT 0,
  source TEXT,
  mark_as_of TIMESTAMPTZ,
  has_greeks BOOLEAN NOT NULL DEFAULT FALSE,
  pricing_mode TEXT NOT NULL DEFAULT 'live',
  data_freshness TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_portfolio_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id TEXT NOT NULL REFERENCES public.ai_portfolio_managers(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.ai_portfolio_runs(id) ON DELETE SET NULL,
  ticker TEXT,
  strategy TEXT,
  instrument_type TEXT,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'credit', 'debit', 'skip', 'reject')),
  quantity NUMERIC,
  fill_price_usd NUMERIC,
  notional_usd NUMERIC,
  realized_pnl_usd NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('filled', 'rejected', 'skipped')),
  violations_json JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_portfolio_equity_daily (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  manager_id TEXT NOT NULL REFERENCES public.ai_portfolio_managers(id) ON DELETE CASCADE,
  equity_usd NUMERIC NOT NULL,
  cash_usd NUMERIC NOT NULL,
  deployed_usd NUMERIC NOT NULL,
  realized_pnl_usd NUMERIC NOT NULL,
  unrealized_pnl_usd NUMERIC NOT NULL,
  running_pnl_usd NUMERIC NOT NULL,
  spy_return_pct NUMERIC,
  outperformance_pct NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_runs_status_finished
  ON public.ai_portfolio_runs (status, finished_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_positions_manager_status
  ON public.ai_portfolio_positions (manager_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_trades_manager_created
  ON public.ai_portfolio_trades (manager_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_equity_daily_date_manager
  ON public.ai_portfolio_equity_daily (date DESC, manager_id);

ALTER TABLE public.ai_portfolio_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_portfolio_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_portfolio_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_portfolio_equity_daily ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_portfolio_managers (id, display_name, model_name)
VALUES
  ('claude', 'Claude', 'anthropic/claude-3.7-sonnet'),
  ('gpt', 'GPT', 'openai/gpt-4.1'),
  ('gemini', 'Gemini', 'google/gemini-2.5-pro'),
  ('deepseek', 'DeepSeek', 'deepseek/deepseek-r1')
ON CONFLICT (id) DO NOTHING;

