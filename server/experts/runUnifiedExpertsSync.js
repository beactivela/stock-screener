/**
 * Unified experts gateway: FMP (Congress + institutional probe) + StockCircle + WhaleWisdom.
 * Hedge-fund / guru-style overlap still comes from StockCircle + WhaleWisdom unless FMP 13F is available on your plan.
 */
import { getSupabase } from '../supabase.js';
import { runStockcircleSync } from '../stockcircle/sync.js';
import { runWhalewisdomSync } from '../whalewisdom/sync.js';
import { runFmpCongressSync, runFmpInstitutionalOwnershipProbe } from '../fmp/runFmpCongressSync.js';

/**
 * @param {{
 *   stockcircle?: Parameters<typeof runStockcircleSync>[0],
 *   whalewisdom?: Parameters<typeof runWhalewisdomSync>[0],
 * }} [opts]
 */
export async function runUnifiedExpertsSync(opts = {}) {
  const scOpts = opts.stockcircle ?? {};
  const wwOpts = opts.whalewisdom ?? {};

  const fmpCongress = await runFmpCongressSync();
  const fmpInstitutional = await runFmpInstitutionalOwnershipProbe();

  const supabase = getSupabase();
  if (supabase && fmpCongress.runId) {
    try {
      await supabase
        .from('fmp_sync_runs')
        .update({
          fmp_institutional_probe: JSON.stringify(fmpInstitutional),
        })
        .eq('id', fmpCongress.runId);
    } catch (e) {
      console.warn('[experts-sync] could not store institutional probe:', e?.message || e);
    }
  }

  const stockcircle = await runStockcircleSync(scOpts);
  const whalewisdom = await runWhalewisdomSync(wwOpts);

  const allowFmpFail = process.env.EXPERTS_ALLOW_FMP_CONGRESS_FAIL === '1';
  const fmpOk =
    fmpCongress.skipped === true ||
    fmpCongress.ok === true ||
    allowFmpFail;

  const ok = Boolean(stockcircle.ok && whalewisdom.ok && fmpOk);

  return {
    ok,
    fmpCongress,
    fmpInstitutional,
    stockcircle,
    whalewisdom,
  };
}
