/**
 * Fundamentals data access: Supabase when configured, else data/fundamentals.json
 * Returns object keyed by ticker: { AAPL: { pctHeldByInst, industry, ... } }
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

function rowToEntry(r) {
  if (!r) return null;
  return {
    pctHeldByInst: r.pct_held_by_inst ?? null,
    qtrEarningsYoY: r.qtr_earnings_yoy ?? null,
    profitMargin: r.profit_margin ?? null,
    operatingMargin: r.operating_margin ?? null,
    industry: r.industry ?? null,
    sector: r.sector ?? null,
    companyName: r.company_name ?? null,
    fetchedAt: r.fetched_at ?? null,
    ...(r.raw || {}),
  };
}

/** @returns {Promise<Record<string, object>>} */
export async function loadFundamentals() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  const supabase = getSupabase();
  const { data, error } = await supabase.from('fundamentals').select('*');
  if (error) throw new Error(error.message);
  const out = {};
  for (const r of data || []) {
    out[r.ticker] = rowToEntry(r);
  }
  return out;
}

/** @param {Record<string, object>} data */
export async function saveFundamentals(data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const rows = Object.entries(data).map(([ticker, v]) => ({
    ticker,
    pct_held_by_inst: v?.pctHeldByInst ?? null,
    qtr_earnings_yoy: v?.qtrEarningsYoY ?? null,
    profit_margin: v?.profitMargin ?? null,
    operating_margin: v?.operatingMargin ?? null,
    industry: v?.industry ?? null,
    sector: v?.sector ?? null,
    company_name: v?.companyName ?? null,
    fetched_at: v?.fetchedAt ?? null,
    raw: v ?? null,
  }));
  const { error } = await supabase.from('fundamentals').upsert(rows, { onConflict: 'ticker' });
  if (error) throw new Error(error.message);
}
