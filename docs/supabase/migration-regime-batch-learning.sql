-- Adds regime-tagged learning runs + durable batch checkpoint storage.

BEGIN;

ALTER TABLE learning_runs
  ADD COLUMN IF NOT EXISTS regime_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_learning_runs_regime_tag
  ON learning_runs(regime_tag);

CREATE TABLE IF NOT EXISTS learning_batch_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  options_json JSONB,
  checkpoints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_result_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_learning_batch_runs_status
  ON learning_batch_runs(status);

CREATE INDEX IF NOT EXISTS idx_learning_batch_runs_updated_at
  ON learning_batch_runs(updated_at DESC);

COMMIT;
