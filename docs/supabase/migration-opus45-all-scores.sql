-- Add full-universe Opus setup scores cache for Dashboard table rendering.
ALTER TABLE IF EXISTS public.opus45_signals_cache
ADD COLUMN IF NOT EXISTS all_scores jsonb;

