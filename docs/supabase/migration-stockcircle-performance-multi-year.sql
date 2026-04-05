-- Multi-year performance from StockCircle /portfolio/:slug/performance (sync scraper).
ALTER TABLE public.stockcircle_investors
  ADD COLUMN IF NOT EXISTS performance_3y_pct NUMERIC;

ALTER TABLE public.stockcircle_investors
  ADD COLUMN IF NOT EXISTS performance_5y_pct NUMERIC;

ALTER TABLE public.stockcircle_investors
  ADD COLUMN IF NOT EXISTS performance_10y_pct NUMERIC;

COMMENT ON COLUMN public.stockcircle_investors.performance_3y_pct IS 'Cumulative % from StockCircle performance page (3Y)';
COMMENT ON COLUMN public.stockcircle_investors.performance_5y_pct IS 'Cumulative % from StockCircle performance page (5Y)';
COMMENT ON COLUMN public.stockcircle_investors.performance_10y_pct IS 'Cumulative % from StockCircle performance page (10Y)';
