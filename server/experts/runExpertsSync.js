/**
 * One-shot sync: FMP Congress (+ institutional probe) + StockCircle + WhaleWisdom → Supabase.
 * Used by POST /api/cron/experts-sync and scripts/run-experts-sync.js
 */
import { runUnifiedExpertsSync } from './runUnifiedExpertsSync.js';

/**
 * @param {Parameters<typeof runUnifiedExpertsSync>[0]} [opts]
 */
export async function runExpertsSync(opts = {}) {
  return runUnifiedExpertsSync(opts);
}
