-- Options open-interest cache for the StockDetail right rail.
-- Server code reads this first, then refreshes from Yahoo Finance on miss/stale rows.

CREATE TABLE IF NOT EXISTS public.options_open_interest_cache (
  ticker TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  expiration_date DATE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_options_open_interest_cache_fetched_at
  ON public.options_open_interest_cache (fetched_at DESC);

ALTER TABLE public.options_open_interest_cache ENABLE ROW LEVEL SECURITY;
