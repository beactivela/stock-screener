-- =============================================================================
-- AI Portfolio ledger hardening (entry/exit lifecycle + backfill)
-- =============================================================================

ALTER TABLE public.ai_portfolio_trades
  ADD COLUMN IF NOT EXISTS position_id TEXT,
  ADD COLUMN IF NOT EXISTS entry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_trades_manager_entry
  ON public.ai_portfolio_trades (manager_id, entry_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_portfolio_trades_position
  ON public.ai_portfolio_trades (position_id)
  WHERE position_id IS NOT NULL;

-- Best-effort historical backfill from each completed run's `state_json.managers[*].recentTrades`.
-- This keeps existing rows and only inserts ledger rows that are not already present.
WITH run_states AS (
  SELECT
    r.id AS run_id,
    r.run_date,
    manager.key AS manager_id,
    trade.value AS trade
  FROM public.ai_portfolio_runs r
  CROSS JOIN LATERAL jsonb_each(COALESCE(r.state_json -> 'managers', '{}'::jsonb)) AS manager
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(manager.value -> 'recentTrades', '[]'::jsonb)) AS trade
  WHERE r.status = 'completed'
),
normalized AS (
  SELECT
    run_id,
    manager_id,
    NULLIF(trade ->> 'positionId', '') AS position_id,
    NULLIF(trade ->> 'ticker', '') AS ticker,
    NULLIF(trade ->> 'strategy', '') AS strategy,
    COALESCE(NULLIF(trade ->> 'instrumentType', ''), 'stock') AS instrument_type,
    CASE
      WHEN LOWER(COALESCE(trade ->> 'side', '')) <> '' THEN LOWER(trade ->> 'side')
      WHEN LOWER(COALESCE(trade ->> 'status', '')) = 'closed' THEN 'sell'
      WHEN LOWER(COALESCE(trade ->> 'status', '')) = 'filled' THEN 'buy'
      ELSE 'skip'
    END AS side,
    NULLIF(trade ->> 'quantity', '')::NUMERIC AS quantity,
    NULLIF(trade ->> 'markUsd', '')::NUMERIC AS fill_price_usd,
    NULLIF(trade ->> 'notionalUsd', '')::NUMERIC AS notional_usd,
    NULLIF(trade ->> 'realizedPnlUsd', '')::NUMERIC AS realized_pnl_usd,
    CASE
      WHEN LOWER(COALESCE(trade ->> 'side', '')) = 'reject' THEN 'rejected'
      WHEN LOWER(COALESCE(trade ->> 'side', '')) = 'skip' THEN 'skipped'
      WHEN LOWER(COALESCE(trade ->> 'status', '')) = 'filled' THEN 'filled'
      WHEN LOWER(COALESCE(trade ->> 'status', '')) = 'closed' THEN 'filled'
      ELSE 'skipped'
    END AS status,
    CASE
      WHEN COALESCE(trade ->> 'entryAt', trade ->> 'openedAt', trade ->> 'at') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (COALESCE(trade ->> 'entryAt', trade ->> 'openedAt', trade ->> 'at') || 'T00:00:00Z')::TIMESTAMPTZ
      ELSE NULLIF(COALESCE(trade ->> 'entryAt', trade ->> 'openedAt', trade ->> 'at'), '')::TIMESTAMPTZ
    END AS entry_at,
    CASE
      WHEN COALESCE(trade ->> 'exitAt', '') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN ((trade ->> 'exitAt') || 'T00:00:00Z')::TIMESTAMPTZ
      ELSE NULLIF(trade ->> 'exitAt', '')::TIMESTAMPTZ
    END AS exit_at
  FROM run_states
)
INSERT INTO public.ai_portfolio_trades (
  manager_id,
  run_id,
  position_id,
  ticker,
  strategy,
  instrument_type,
  side,
  quantity,
  fill_price_usd,
  notional_usd,
  realized_pnl_usd,
  status,
  entry_at,
  exit_at,
  notes
)
SELECT
  n.manager_id,
  n.run_id,
  n.position_id,
  n.ticker,
  n.strategy,
  n.instrument_type,
  n.side,
  n.quantity,
  n.fill_price_usd,
  n.notional_usd,
  n.realized_pnl_usd,
  n.status,
  n.entry_at,
  n.exit_at,
  'backfill_from_state_json'
FROM normalized n
WHERE n.ticker IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.ai_portfolio_trades t
    WHERE t.run_id = n.run_id
      AND t.manager_id = n.manager_id
      AND COALESCE(t.position_id, '') = COALESCE(n.position_id, '')
      AND COALESCE(t.ticker, '') = COALESCE(n.ticker, '')
      AND COALESCE(t.strategy, '') = COALESCE(n.strategy, '')
      AND COALESCE(t.side, '') = COALESCE(n.side, '')
      AND COALESCE(t.entry_at::TEXT, '') = COALESCE(n.entry_at::TEXT, '')
      AND COALESCE(t.exit_at::TEXT, '') = COALESCE(n.exit_at::TEXT, '')
  );
