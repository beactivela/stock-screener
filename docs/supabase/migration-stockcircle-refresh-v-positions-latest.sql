-- PostgreSQL expands SELECT * in views at CREATE time. After adding pct_of_portfolio
-- (migration-stockcircle-pct-of-portfolio.sql), the view must be recreated so queries
-- can select/order by pct_of_portfolio.
CREATE OR REPLACE VIEW public.v_stockcircle_positions_latest
WITH (security_invoker = true) AS
SELECT p.*
FROM public.stockcircle_positions p
WHERE p.sync_run_id = public.stockcircle_latest_completed_run_id();
