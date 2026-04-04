/**
 * One-shot sync: StockCircle expert portfolios + WhaleWisdom filer snapshots → Supabase.
 * Used by POST /api/cron/experts-sync and scripts/run-experts-sync.js
 */
import { runStockcircleSync } from '../stockcircle/sync.js';
import { runWhalewisdomSync } from '../whalewisdom/sync.js';

/**
 * Runs WhaleWisdom after StockCircle finishes (same order as the individual CLIs).
 *
 * @param {{
 *   stockcircle?: Parameters<typeof runStockcircleSync>[0],
 *   whalewisdom?: Parameters<typeof runWhalewisdomSync>[0],
 * }} [opts]
 */
export async function runExpertsSync(opts = {}) {
  const scOpts = opts.stockcircle ?? {};
  const wwOpts = opts.whalewisdom ?? {};

  const stockcircle = await runStockcircleSync(scOpts);
  const whalewisdom = await runWhalewisdomSync(wwOpts);

  return {
    ok: Boolean(stockcircle.ok) && Boolean(whalewisdom.ok),
    stockcircle,
    whalewisdom,
  };
}
