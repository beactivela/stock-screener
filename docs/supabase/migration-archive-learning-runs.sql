-- Archive legacy learning runs to keep active dashboard expectancy-only.
-- Apply this before calling:
--   POST /api/learning/run-history/archive-legacy

BEGIN;

CREATE TABLE IF NOT EXISTS learning_runs_archive AS
SELECT *
FROM learning_runs
WHERE false;

ALTER TABLE learning_runs_archive
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_learning_runs_archive_agent
  ON learning_runs_archive(agent_type);

CREATE INDEX IF NOT EXISTS idx_learning_runs_archive_objective
  ON learning_runs_archive(objective);

CREATE INDEX IF NOT EXISTS idx_learning_runs_archive_archived_at
  ON learning_runs_archive(archived_at DESC);

COMMIT;
