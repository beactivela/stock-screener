-- Add % of portfolio per position (from StockCircle portfolio table)
ALTER TABLE public.stockcircle_positions
  ADD COLUMN IF NOT EXISTS pct_of_portfolio NUMERIC;

COMMENT ON COLUMN public.stockcircle_positions.pct_of_portfolio IS 'Weight in investor portfolio (%) from StockCircle UI';
