/**
 * Scan results data access: Supabase when configured, else data/scan-results.json
 * Shape: { scannedAt, from, to, totalTickers, vcpBullishCount, results }
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

/** @returns {Promise<{ scannedAt: string|null, from?: string, to?: string, totalTickers: number, vcpBullishCount: number, results: object[] }>} */
export async function loadScanResults() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase
    .from('scan_runs')
    .select('*')
    .order('scanned_at', { ascending: false })
    .limit(1)
    .single();
  if (runErr || !run) {
    return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
  }
  const { data: results, error: resErr } = await supabase
    .from('scan_results')
    .select('data')
    .eq('scan_run_id', run.id)
    .order('enhanced_score', { ascending: false, nullsFirst: false });
  if (resErr) throw new Error(resErr.message);
  const rows = (results || []).map((r) => r.data);
  const vcpBullishCount = rows.filter((r) => r?.vcpBullish).length;
  return {
    scannedAt: run.scanned_at,
    from: run.date_from,
    to: run.date_to,
    totalTickers: rows.length,
    vcpBullishCount,
    results: rows,
  };
}

/** @param {{ scannedAt: string, from: string, to: string, totalTickers: number, vcpBullishCount: number, results: object[] }} payload */
export async function saveScanResults(payload) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase
      .from('scan_runs')
      .insert({
        scanned_at: payload.scannedAt,
        date_from: payload.from ?? null,
        date_to: payload.to ?? null,
        total_tickers: payload.results?.length ?? 0,
        vcp_bullish_count: payload.vcpBullishCount ?? 0,
      })
      .select('id')
      .single();
  if (runErr) throw new Error(runErr.message);
  const rows = (payload.results || []).map((r) => ({
      scan_run_id: run.id,
      ticker: r.ticker,
      vcp_bullish: r.vcpBullish ?? null,
      contractions: r.contractions ?? null,
      last_close: r.lastClose ?? null,
      relative_strength: r.relativeStrength ?? null,
      score: r.score ?? null,
      enhanced_score: r.enhancedScore ?? r.score ?? null,
      industry_name: r.industryName ?? null,
      industry_rank: r.industryRank ?? null,
      data: r,
  }));
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('scan_results').insert(batch);
    if (error) throw new Error(error.message);
  }
}
