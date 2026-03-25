/**
 * In-memory scan lock (activeScan.running) can stick true if a process dies mid-scan.
 * Optional recovery: set SCAN_STALE_LOCK_MS to a wall-clock age (ms) after which the lock is cleared
 * so POST /api/scan can run again. Omit the env var to never auto-clear (typical for long VPS scans).
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

  const raw = env.SCAN_STALE_LOCK_MS;
  if (raw == null || String(raw).trim() === '') return false;
  const maxMs = Number(raw);
  if (!Number.isFinite(maxMs) || maxMs <= 0 || ageMs < maxMs) return false;

  activeScan.running = false;
  if (activeScan.progress && activeScan.progress.completedAt == null) {
    activeScan.progress.completedAt = new Date().toISOString();
  }
  return true;
}
