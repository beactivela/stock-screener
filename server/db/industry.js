/**
 * Industry cache + industry-yahoo-returns data access
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

/**
 * @param {'industrials'|'all-industries'|'sectors'} key
 * @returns {Promise<object|null>}
 */
export async function loadIndustryCache(key) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data, error } = await supabase.from('industry_cache').select('*').eq('key', key).single();
  if (error || !data) return null;
  return data.data;
}

/**
 * @param {'industrials'|'all-industries'|'sectors'} key
 * @param {object} data
 */
export async function saveIndustryCache(key, data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const fetchedAt = data?.fetchedAt ?? null;
  const { error } = await supabase
    .from('industry_cache')
    .upsert({ key, data, fetched_at: fetchedAt, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/** @returns {Promise<Record<string, object>>} */
export async function loadIndustryYahooReturns() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data, error } = await supabase.from('industry_yahoo_returns').select('*');
  if (error) throw new Error(error.message);
  const out = {};
  for (const r of data || []) {
    out[r.industry_name] = {
      return1Y: r.return_1y,
      return3M: r.return_3m,
      returnYTD: r.return_ytd,
      ...(r.data || {}),
    };
  }
  return out;
}

/** @param {Record<string, object>} data */
export async function saveIndustryYahooReturns(data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const rows = Object.entries(data).map(([industry_name, v]) => ({
    industry_name,
    return_1y: v?.return1Y ?? v?.return_1y ?? null,
    return_3m: v?.return3M ?? v?.return_3m ?? null,
    return_ytd: v?.returnYTD ?? v?.return_ytd ?? null,
    data: v ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('industry_yahoo_returns').upsert(rows, { onConflict: 'industry_name' });
  if (error) throw new Error(error.message);
}
