-- Add % of portfolio per position (from StockCircle portfolio table)
ALTER TABLE public.stockcircle_positions
  ADD COLUMN IF NOT EXISTS pct_of_portfolio NUMERIC;

COMMENT ON COLUMN public.stockcircle_positions.pct_of_portfolio IS 'Weight in investor portfolio (%) from StockCircle UI';

-- Required: Postgres freezes SELECT * at view creation; recreate so v_* exposes the new column.
CREATE OR REPLACE VIEW public.v_stockcircle_positions_latest
WITH (security_invoker = true) AS
SELECT p.*
FROM public.stockcircle_positions p
WHERE p.sync_run_id = public.stockcircle_latest_completed_run_id();
