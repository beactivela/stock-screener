-- IBD (Investor's Business Daily) ratings from personal list export.
-- Run once in Supabase SQL Editor (or your migration runner) after reviewing.

ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS ibd_composite_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS ibd_eps_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS ibd_rs_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS ibd_smr_rating TEXT,
  ADD COLUMN IF NOT EXISTS ibd_acc_dis_rating TEXT,
  ADD COLUMN IF NOT EXISTS ibd_group_rel_str_rating TEXT,
  ADD COLUMN IF NOT EXISTS ibd_imported_at TIMESTAMPTZ;

COMMENT ON COLUMN fundamentals.ibd_composite_rating IS 'IBD Composite Rating 1-99';
COMMENT ON COLUMN fundamentals.ibd_eps_rating IS 'IBD EPS Rating 1-99';
COMMENT ON COLUMN fundamentals.ibd_rs_rating IS 'IBD Relative Strength Rating 1-99';
