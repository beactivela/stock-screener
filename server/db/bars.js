/**
 * Bars cache data access: Supabase when configured, else data/bars/{TICKER}_{interval}.json
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

const barsMemoryCache = new Map();

/**
 * @param {string} ticker
 * @param {string} from
 * @param {string} to
 * @param {string} interval
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>|null>}
 */
export async function getBars(ticker, from, to, interval = '1d') {
  const key = `${ticker}:${interval}:${from}:${to}`;
  const mem = barsMemoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.data;

  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('bars_cache')
    .select('*')
    .eq('ticker', ticker)
    .eq('interval', interval)
    .single();
  if (error || !data) return null;
  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  const results = data.results || [];
  if (results.length === 0) return null;
  const rawFrom = data.date_from;
  const rawTo = data.date_to;
  if (rawFrom === from && rawTo === to) {
    barsMemoryCache.set(key, { data: results, at: Date.now() - age });
    return results;
  }
  if (rawFrom <= to && rawTo >= from) {
    const filtered = results.filter((b) => {
      const d = new Date(b.t).toISOString().slice(0, 10);
      return d >= from && d <= to;
    });
    if (filtered.length > 0) {
      barsMemoryCache.set(key, { data: filtered, at: Date.now() - age });
      return filtered;
    }
  }
  return null;
}

/**
 * @param {string} ticker
 * @param {string} from
 * @param {string} to
 * @param {object[]} results
 * @param {string} interval
 */
export async function saveBars(ticker, from, to, results, interval = '1d') {
  const fetchedAt = new Date().toISOString();
  barsMemoryCache.set(`${ticker}:${interval}:${from}:${to}`, { data: results, at: Date.now() });

  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { error } = await supabase.from('bars_cache').upsert(
    { ticker, interval, date_from: from, date_to: to, fetched_at: fetchedAt, results },
    { onConflict: 'ticker,interval' }
  );
  if (error) throw new Error(error.message);
}
