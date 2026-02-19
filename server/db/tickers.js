/**
 * Tickers data access: Supabase when configured, else data/tickers.txt
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

/** @returns {Promise<string[]>} */
export async function loadTickers() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data, error } = await supabase.from('tickers').select('ticker');
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.ticker);
}

/** @param {string[]} list */
export async function saveTickers(list) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const rows = list.map((t) => ({ ticker: t }));
  const { error } = await supabase.from('tickers').upsert(rows, { onConflict: 'ticker' });
  if (error) throw new Error(error.message);
}
