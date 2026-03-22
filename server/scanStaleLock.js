/**
 * In-memory scan lock (activeScan.running) can stick true on Vercel when the
 * serverless invocation hits maxDuration or is hard-stopped before cleanup runs.
 * Clearing after a wall-clock threshold lets POST /api/scan succeed again.
 *
 * Set SCAN_STALE_LOCK_MS in Vercel env if you raise functions maxDuration (use maxDuration in ms + ~15s buffer).
 *
 * Uses VERCEL_ENV (production | preview), not VERCEL=1, so `vercel dev` and local Node are unaffected.
 */

/**
 * @param {{ running: boolean; progress?: { startedAt?: string | null; completedAt?: string | null } }} activeScan
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} true if a stale lock was cleared
 */
export function maybeClearStaleActiveScan(activeScan, env = process.env) {
  if (!activeScan?.running) return false;
  const started = activeScan.progress?.startedAt;
  if (!started || typeof started !== 'string') return false;
  const startMs = Date.parse(started);
  if (Number.isNaN(startMs)) return false;
  const ageMs = Date.now() - startMs;

  const onVercelDeployed =
    env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';

  let maxMs;
  if (env.SCAN_STALE_LOCK_MS != null && String(env.SCAN_STALE_LOCK_MS).trim() !== '') {
    maxMs = Number(env.SCAN_STALE_LOCK_MS);
  } else if (onVercelDeployed) {
    maxMs = 45_000;
  } else {
    maxMs = 0;
  }

  if (!Number.isFinite(maxMs) || maxMs <= 0 || ageMs < maxMs) return false;

  activeScan.running = false;
  if (activeScan.progress && activeScan.progress.completedAt == null) {
    activeScan.progress.completedAt = new Date().toISOString();
  }
  return true;
}
