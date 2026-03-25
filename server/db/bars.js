/**
 * Bars cache data access: Supabase → Yahoo Finance fallback.
 *
 * Cache strategy:
 *   - Deep historical bars (5yr) are cached for DEEP_CACHE_TTL_MS (90 days).
 *     These are immutable history — no point re-fetching every day.
 *   - Regular bars (1yr screener use) are cached for CACHE_TTL_MS (24h by default).
 *
 * On cache miss, getBars fetches from Yahoo Finance and saves to Supabase automatically.
 * This means the historical signal scanner only hits Yahoo once per ticker per 90 days.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getBars as fetchFromYahoo, getBarsBatch as fetchBarsBatchFromYahoo } from '../yahoo.js';
import { MIN_DAILY_BARS_FOR_IBD_RS, longRangeExpectsIbdrs } from '../barHistoryLimits.js';

const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;
// 5-year historical bars are immutable — cache for 90 days
const DEEP_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// A "deep" date range is anything going back more than 18 months
const DEEP_RANGE_THRESHOLD_DAYS = 540;
const DEFAULT_BARS_BATCH_CONCURRENCY = Math.max(1, Number(process.env.BARS_BATCH_CONCURRENCY) || 8);

const barsMemoryCache = new Map();

async function runWithConcurrency(items, worker, opts = {}) {
  const safeConcurrency = Math.max(1, Number(opts.concurrency) || DEFAULT_BARS_BATCH_CONCURRENCY);
  const inFlight = new Set();
  let cursor = 0;
  const results = new Array(items.length);

  const launchNext = () => {
    while (cursor < items.length && inFlight.size < safeConcurrency) {
      const item = items[cursor];
      const itemIndex = cursor;
      cursor += 1;

      let taskPromise;
      taskPromise = (async () => {
        const result = await worker(item, itemIndex);
        results[itemIndex] = result;
        if (typeof opts.onResult === 'function') {
          await opts.onResult(result, itemIndex);
        }
      })().finally(() => {
        inFlight.delete(taskPromise);
      });

      inFlight.add(taskPromise);
    }
  };

  launchNext();
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    launchNext();
  }
  return results;
}

function isDeepRange(from, to) {
  const spanDays = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
  return spanDays >= DEEP_RANGE_THRESHOLD_DAYS;
}

/** YYYY-MM-DD for the day after dateStr. */
function nextDayStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for the day before dateStr. */
function prevDayStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Get the raw cached row for (ticker, interval) from Supabase, if any.
 * No TTL check — used to decide whether we can do an incremental (missing-range only) fetch.
 *
 * @returns {Promise<{ date_from: string, date_to: string, results: Array } | null>}
 */
async function getCachedBarsRow(ticker, interval) {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bars_cache')
      .select('date_from, date_to, results')
      .eq('ticker', ticker)
      .eq('interval', interval)
      .maybeSingle();
    if (error || !data || !data.results || data.results.length === 0) return null;
    return {
      date_from: data.date_from,
      date_to: data.date_to,
      results: data.results,
    };
  } catch (e) {
    return null;
  }
}

/** Merge bar arrays by timestamp, sort by t, dedupe by t. */
function mergeBars(arrays) {
  const byT = new Map();
  for (const arr of arrays) {
    for (const b of arr) {
      if (b && b.t != null) byT.set(b.t, b);
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Filter bars to [from, to] inclusive (by date string YYYY-MM-DD). */
function filterBarsToRange(bars, from, to) {
  return bars.filter((b) => {
    const d = new Date(b.t).toISOString().slice(0, 10);
    return d >= from && d <= to;
  });
}

/** Long scan windows need enough daily rows for IBD RS; short chart windows may be smaller. */
function barsSatisfyIbdrsForRequest(bars, from, to) {
  if (!Array.isArray(bars) || bars.length === 0) return false;
  if (!longRangeExpectsIbdrs(from, to)) return true;
  return bars.length >= MIN_DAILY_BARS_FOR_IBD_RS;
}

/** Drop bars with non-finite OHLCV so PostgREST / jsonb never sees NaN/Infinity (invalid JSON). */
function sanitizeResultsForDb(results) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const b of results) {
    if (!b || typeof b !== 'object') continue;
    const t = Number(b.t);
    const o = Number(b.o);
    const h = Number(b.h);
    const l = Number(b.l);
    const c = Number(b.c);
    const v = Number(b.v);
    if (![t, o, h, l, c, v].every(Number.isFinite)) continue;
    out.push({ t, o, h, l, c, v });
  }
  return out;
}

/** Smaller batches avoid huge request bodies and intermittent PostgREST timeouts on VPS cron. */
const BARS_CACHE_UPSERT_CHUNK = Math.max(5, Math.min(50, Number(process.env.BARS_UPSERT_CHUNK) || 25));

function buildBarsCacheRows(entries, fetchedAt = new Date().toISOString()) {
  return (entries || [])
    .filter((entry) => entry?.ticker && entry?.from && entry?.to && Array.isArray(entry?.results))
    .map((entry) => {
      const results = sanitizeResultsForDb(entry.results);
      if (results.length === 0) return null;
      return {
        ticker: String(entry.ticker).trim().toUpperCase(),
        interval: entry.interval ?? '1d',
        date_from: entry.from,
        date_to: entry.to,
        fetched_at: fetchedAt,
        results,
      };
    })
    .filter(Boolean);
}

/** Last row wins if the same ticker+interval appears twice in one batch. */
function dedupeBarsCacheRows(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.ticker}\t${row.interval}`, row);
  }
  return [...map.values()];
}

/**
 * Decide whether cached bars are fresh enough for a target end date.
 * Allows a small lag window to account for weekends/holidays.
 *
 * @param {Array} bars
 * @param {string} to - YYYY-MM-DD target end date
 * @param {Object} [opts]
 * @param {number} [opts.maxLagDays=3]
 * @returns {boolean}
 */
export function isBarsUpToDate(bars, to, opts = {}) {
  if (!Array.isArray(bars) || bars.length === 0 || !to) return false;
  const maxLagDays = Number.isFinite(opts.maxLagDays) ? opts.maxLagDays : 3;
  const lastBar = bars[bars.length - 1];
  const lastDateStr = new Date(lastBar.t).toISOString().slice(0, 10);
  const lastDate = new Date(lastDateStr + 'T12:00:00Z');
  const toDate = new Date(to + 'T12:00:00Z');
  const lagDays = Math.floor((toDate - lastDate) / (1000 * 60 * 60 * 24));
  return lagDays <= maxLagDays;
}

/**
 * Read bars from memory / Supabase cache only.
 * Does not fall through to Yahoo.
 *
 * @param {string} ticker
 * @param {string} from
 * @param {string} to
 * @param {string} interval
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>|null>}
 */
export async function getCachedBars(ticker, from, to, interval = '1d') {
  const key = `${ticker}:${interval}:${from}:${to}`;
  const cacheTtl = isDeepRange(from, to) ? DEEP_CACHE_TTL_MS : CACHE_TTL_MS;

  const mem = barsMemoryCache.get(key);
  if (mem && Date.now() - mem.at < cacheTtl) {
    if (!barsSatisfyIbdrsForRequest(mem.data, from, to)) {
      barsMemoryCache.delete(key);
    } else {
      return mem.data;
    }
  }

  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bars_cache')
      .select('*')
      .eq('ticker', ticker)
      .eq('interval', interval)
      .maybeSingle();

    if (error) {
      console.warn(`bars_cache read ${ticker} ${interval}: ${error.message}`);
    }

    if (!error && data) {
      const age = Date.now() - new Date(data.fetched_at).getTime();
      const storedIsDeep = isDeepRange(data.date_from, data.date_to);
      const ttl = storedIsDeep ? DEEP_CACHE_TTL_MS : CACHE_TTL_MS;

      if (age <= ttl) {
        const results = data.results || [];
        const rawFrom = data.date_from;
        const rawTo = data.date_to;

        if (rawFrom === from && rawTo === to && results.length > 0) {
          const fresh = isBarsUpToDate(results, to);
          if (fresh && barsSatisfyIbdrsForRequest(results, from, to)) {
            barsMemoryCache.set(key, { data: results, at: Date.now() - age });
            return results;
          }
        }

        if (rawFrom <= from && rawTo >= to && results.length > 0) {
          const filtered = results.filter((b) => {
            const d = new Date(b.t).toISOString().slice(0, 10);
            return d >= from && d <= to;
          });
          if (filtered.length > 0) {
            const fresh = isBarsUpToDate(filtered, to);
            if (fresh && barsSatisfyIbdrsForRequest(filtered, from, to)) {
              barsMemoryCache.set(key, { data: filtered, at: Date.now() - age });
              return filtered;
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn(`bars_cache lookup failed for ${ticker}: ${e.message}`);
  }

  try {
    const supabase = getSupabase();
    const dateCols = ['date', 'trade_date', 'd'];
    for (const dateCol of dateCols) {
      const { data: rows, error } = await supabase
        .from('bars')
        .select('*')
        .eq('ticker', ticker)
        .gte(dateCol, from)
        .lte(dateCol, to)
        .order(dateCol, { ascending: true });
      if (error || !rows || rows.length < MIN_DAILY_BARS_FOR_IBD_RS) continue;
      const o = rows[0].open != null ? 'open' : 'o';
      const h = rows[0].high != null ? 'high' : 'h';
      const l = rows[0].low != null ? 'low' : 'l';
      const c = rows[0].close != null ? 'close' : 'c';
      const v = rows[0].volume != null ? 'volume' : 'v';
      const results = rows.map((r) => {
        const d = r[dateCol] ?? r.date ?? r.trade_date ?? r.d;
        const t = typeof d === 'number' ? d : new Date(d).getTime();
        return { t, o: r[o], h: r[h], l: r[l], c: r[c], v: r[v] ?? 0 };
      });
      if (results.length > 0) {
        barsMemoryCache.set(key, { data: results, at: Date.now() });
        return results;
      }
      break;
    }
  } catch (e) {
    // "bars" table may not exist or have different schema
  }

  return null;
}

/**
 * Get bars with Supabase cache → Yahoo Finance fallback.
 * Automatically saves fetched bars to Supabase for future runs.
 *
 * @param {string} ticker
 * @param {string} from  - YYYY-MM-DD
 * @param {string} to    - YYYY-MM-DD
 * @param {string} interval
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>|null>}
 */
export async function getBars(ticker, from, to, interval = '1d') {
  const key = `${ticker}:${interval}:${from}:${to}`;
  const cached = await getCachedBars(ticker, from, to, interval);
  if (cached && cached.length > 0) return cached;

  // 3. Fetch from Yahoo: full range or incremental (only missing dates) when we have existing cache
  try {
    const existing = await getCachedBarsRow(ticker, interval);
    let merged = null;
    let newFrom = from;
    let newTo = to;

    if (existing && existing.date_from && existing.date_to) {
      const storedFrom = existing.date_from;
      const storedTo = existing.date_to;
      const needBackfill = to > storedTo;
      const needFrontfill = from < storedFrom;

      if (!needBackfill && !needFrontfill) {
        // Cached range already covers [from, to] — return slice and refresh TTL by re-saving
        const filtered = filterBarsToRange(existing.results, from, to);
        if (filtered.length > 0) {
          barsMemoryCache.set(key, { data: filtered, at: Date.now() });
          if (isSupabaseConfigured()) {
            saveBars(ticker, storedFrom, storedTo, existing.results, interval).catch(() => {});
          }
          return filtered;
        }
      }

      if (needBackfill || needFrontfill) {
        const toFetch = [];
        if (needBackfill) toFetch.push({ from: nextDayStr(storedTo), to });
        if (needFrontfill) toFetch.push({ from, to: prevDayStr(storedFrom) });

        const newChunks = [];
        for (const r of toFetch) {
          if (r.from > r.to) continue;
          const chunk = await fetchFromYahoo(ticker, r.from, r.to, interval);
          if (chunk && chunk.length > 0) newChunks.push(chunk);
        }

        if (newChunks.length > 0) {
          merged = mergeBars([existing.results, ...newChunks]);
          newFrom = merged.length > 0 ? new Date(Math.min(...merged.map((b) => b.t))).toISOString().slice(0, 10) : from;
          newTo = merged.length > 0 ? new Date(Math.max(...merged.map((b) => b.t))).toISOString().slice(0, 10) : to;
        }
      }
    }

    if (merged == null) {
      merged = await fetchFromYahoo(ticker, from, to, interval);
      if (merged) {
        newFrom = from;
        newTo = to;
      }
    }

    if (!merged || merged.length === 0) return null;

    const results = filterBarsToRange(merged, from, to);
    if (results.length === 0) return null;

    barsMemoryCache.set(key, { data: results, at: Date.now() });

    if (isSupabaseConfigured()) {
      saveBars(ticker, newFrom, newTo, merged, interval).catch((e) =>
        console.warn(`Failed to cache bars for ${ticker}: ${e.message}`)
      );
    }

    return results;
  } catch (e) {
    console.warn(`Yahoo fetch failed for ${ticker}: ${e.message}`);
    return null;
  }
}

export async function getBarsBatch(requests, opts = {}) {
  const normalizedRequests = Array.isArray(requests) ? requests : [];
  const results = new Array(normalizedRequests.length);
  const missing = [];

  await runWithConcurrency(normalizedRequests, async (request, index) => {
    const normalized = {
      ticker: String(request?.ticker || '').trim().toUpperCase(),
      from: request?.from,
      to: request?.to,
      interval: request?.interval ?? '1d',
    };
    const bars = await getCachedBars(normalized.ticker, normalized.from, normalized.to, normalized.interval);
    return { index, request: normalized, bars };
  }, {
    concurrency: opts.cacheConcurrency ?? opts.concurrency,
    onResult: ({ index, request, bars }) => {
      if (bars && bars.length > 0) {
        results[index] = {
          status: 'fulfilled',
          source: 'cache',
          ticker: request.ticker,
          from: request.from,
          to: request.to,
          interval: request.interval,
          bars,
        };
      } else {
        missing.push({ index, request });
      }
    },
  });

  if (missing.length > 0) {
    const fetched = await fetchBarsBatchFromYahoo(
      missing.map(({ request }) => request),
      { concurrency: opts.yahooConcurrency ?? opts.concurrency }
    );
    const toSave = [];

    for (let i = 0; i < fetched.length; i++) {
      const output = fetched[i];
      const pending = missing[i];
      if (!pending) continue;
      if (output?.status === 'fulfilled') {
        results[pending.index] = { ...output, source: 'yahoo' };
        if (output.bars?.length > 0) {
          toSave.push({
            ticker: output.ticker,
            from: output.from,
            to: output.to,
            interval: output.interval,
            results: output.bars,
          });
        }
      } else {
        results[pending.index] = { ...output, source: 'yahoo' };
      }
    }

    if (toSave.length > 0 && isSupabaseConfigured()) {
      try {
        await saveBarsBatch(toSave);
      } catch (e) {
        const tickers = [...new Set(toSave.map((e) => e.ticker))].slice(0, 12).join(',');
        console.error(
          `Failed to batch cache bars (${toSave.length} rows, sample tickers: ${tickers}): ${e.message}`,
        );
      }
    }
  }

  return results;
}

/**
 * @param {string} ticker
 * @param {string} from
 * @param {string} to
 * @param {object[]} results
 * @param {string} interval
 */
export async function saveBars(ticker, from, to, results, interval = '1d') {
  await saveBarsBatch([{ ticker, from, to, results, interval }]);
}

export async function saveBarsBatch(entries, opts = {}) {
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  let rows = buildBarsCacheRows(entries, fetchedAt);
  rows = dedupeBarsCacheRows(rows);

  for (const row of rows) {
    barsMemoryCache.set(`${row.ticker}:${row.interval}:${row.date_from}:${row.date_to}`, {
      data: row.results,
      at: Date.now(),
    });
  }

  if (rows.length === 0) return;
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  const supabase = getSupabase();

  for (let i = 0; i < rows.length; i += BARS_CACHE_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + BARS_CACHE_UPSERT_CHUNK);
    const { error } = await supabase.from('bars_cache').upsert(chunk, { onConflict: 'ticker,interval' });
    if (error) {
      const detail = [error.message, error.code, error.details, error.hint].filter(Boolean).join(' | ');
      console.error(
        `bars_cache upsert failed rows [${i}, ${i + chunk.length}): ${detail}`,
      );
      throw new Error(error.message || 'bars_cache upsert failed');
    }
  }
}

/** Minimum calendar-day span to consider "5 years" of OHLC (used for count display). */
const FIVE_YEAR_DAYS = 5 * 365;
/** Minimum span for historical signal scan (e.g. 250 trading days ~= 12 months). */
const MIN_SCAN_SPAN_DAYS = 250;

/**
 * Latest `fetched_at` among daily (`1d`) rows in `bars_cache` — proxy for most recent Yahoo→DB bar write
 * (scheduled refresh, scan, or on-demand chart loads). Not identical to “full universe refresh finished.”
 *
 * @returns {Promise<{ ok: boolean, lastFetchedAt: string | null, dailyTickerCount: number, error?: string }>}
 */
export async function getLatestDailyBarsFetchedAt() {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      lastFetchedAt: null,
      dailyTickerCount: 0,
      error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.',
    };
  }
  try {
    const supabase = getSupabase();
    const { count: dailyTickerCount, error: countErr } = await supabase
      .from('bars_cache')
      .select('*', { count: 'exact', head: true })
      .eq('interval', '1d');

    if (countErr) {
      return {
        ok: false,
        lastFetchedAt: null,
        dailyTickerCount: 0,
        error: countErr.message || 'Failed to read bars cache',
      };
    }

    const safeCount = typeof dailyTickerCount === 'number' ? dailyTickerCount : 0;
    if (safeCount === 0) {
      return {
        ok: false,
        lastFetchedAt: null,
        dailyTickerCount: 0,
        error: 'No daily bars in cache yet. Run a scan or POST /api/cron/refresh-bars.',
      };
    }

    const { data, error } = await supabase
      .from('bars_cache')
      .select('fetched_at')
      .eq('interval', '1d')
      .order('fetched_at', { ascending: false })
      .limit(1);

    if (error) {
      return {
        ok: false,
        lastFetchedAt: null,
        dailyTickerCount: safeCount,
        error: error.message || 'Failed to read latest fetch time',
      };
    }

    const row = data?.[0];
    const lastFetchedAt = row?.fetched_at ? String(row.fetched_at) : null;
    if (!lastFetchedAt) {
      return {
        ok: false,
        lastFetchedAt: null,
        dailyTickerCount: safeCount,
        error: 'Could not determine last Yahoo fetch time.',
      };
    }

    return { ok: true, lastFetchedAt, dailyTickerCount: safeCount };
  } catch (e) {
    return {
      ok: false,
      lastFetchedAt: null,
      dailyTickerCount: 0,
      error: e?.message || String(e),
    };
  }
}

/**
 * Count distinct tickers that have at least 5 years of OHLC data in bars_cache.
 * Used on the Agents page to show "N tickers with 5yr OHLC data".
 *
 * @returns {Promise<number>} Count of tickers with 5yr range cached (0 if Supabase not configured)
 */
export async function getTickerCountWith5YrBars() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bars_cache')
      .select('ticker, date_from, date_to')
      .eq('interval', '1d');

    if (error) {
      console.warn('bars_cache count failed:', error.message);
      return 0;
    }

    const rows = data || [];
    const tickersWith5Yr = new Set();
    for (const row of rows) {
      const from = row.date_from ? new Date(row.date_from) : null;
      const to = row.date_to ? new Date(row.date_to) : null;
      if (!from || !to) continue;
      const spanDays = (to - from) / (1000 * 60 * 60 * 24);
      if (spanDays >= FIVE_YEAR_DAYS) tickersWith5Yr.add(row.ticker);
    }
    return tickersWith5Yr.size;
  } catch (e) {
    console.warn('getTickerCountWith5YrBars:', e.message);
    return 0;
  }
}

/**
 * Return list of tickers that have enough bars in bars_cache for historical signal scanning.
 * Used when the tickers table is empty so "first run" can still build a signal pool from bars.
 * Tries bars_cache first; if empty, tries table "bars" (in case that's where OHLC is stored).
 *
 * @param {Object} [opts]
 * @param {number} [opts.minSpanDays=250] - Minimum date span (days) to include a ticker
 * @returns {Promise<string[]>} Ticker symbols (equity-style only, 1–5 chars)
 */
export async function getTickersFromBarsCache(opts = {}) {
  if (!isSupabaseConfigured()) return [];
  const minSpanDays = opts.minSpanDays ?? MIN_SCAN_SPAN_DAYS;
  const supabase = getSupabase();

  const fromTable = async (tableName, hasDateRange = true) => {
    try {
      let query = supabase.from(tableName).select(hasDateRange ? 'ticker, date_from, date_to' : 'ticker');
      if (tableName === 'bars_cache') query = query.eq('interval', '1d');
      const { data, error } = await query;
      if (error) return [];
      const list = [];
      for (const row of data || []) {
        if (hasDateRange && row.date_from != null && row.date_to != null) {
          const from = new Date(row.date_from);
          const to = new Date(row.date_to);
          const spanDays = (to - from) / (1000 * 60 * 60 * 24);
          if (spanDays >= minSpanDays && /^[A-Z]{1,5}$/.test(row.ticker)) list.push(row.ticker);
        } else if (!hasDateRange && /^[A-Z]{1,5}$/.test(row.ticker)) {
          list.push(row.ticker);
        }
      }
      return [...new Set(list)].sort();
    } catch (e) {
      return [];
    }
  };

  const fromBarsCache = await fromTable('bars_cache', true);
  if (fromBarsCache.length > 0) return fromBarsCache;

  // Fallback: table "bars" (e.g. flat schema with ticker per row or ticker+date range)
  try {
    const { data, error } = await supabase.from('bars').select('ticker');
    if (!error && data && data.length > 0) {
      const list = data.map(r => r.ticker).filter(t => /^[A-Z]{1,5}$/.test(t));
      const out = [...new Set(list)].sort();
      if (out.length > 0) {
        console.log(`getTickersFromBarsCache: bars_cache empty; using ${out.length} tickers from table "bars"`);
        return out;
      }
    }
  } catch (e) {
    // "bars" table may not exist
  }

  return [];
}

const __testing = {
  buildBarsCacheRows,
  runWithConcurrency,
  sanitizeResultsForDb,
  dedupeBarsCacheRows,
};

export { __testing };
