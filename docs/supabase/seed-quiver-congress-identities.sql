-- Optional seed: map FMP-style names to Quiver bioguides (run after migration-quiver-congress.sql).
-- fmp_name_key format: lowercase last|first (see server/quiver/fmpNameKey.js).

INSERT INTO public.congress_politician_identity (bioguide_id, full_name, fmp_name_key, source)
VALUES
  ('P000197', 'Nancy Pelosi', 'pelosi|nancy', 'manual'),
  ('C001098', 'Ted Cruz', 'cruz|ted', 'manual')
ON CONFLICT (bioguide_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  fmp_name_key = EXCLUDED.fmp_name_key,
  updated_at = now();
