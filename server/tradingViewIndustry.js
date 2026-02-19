/**
 * Industry returns from TradingView Scanner API only (no Yahoo).
 * Used by GET /api/industry-trend, scan.js, Opus45, and VCP enhanced score.
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * 1. In-memory cache with TTL (2 hours default) - serves instant responses
 * 2. Early exit when all needed industries are found
 * 3. Parallel page fetching (concurrency = 5) - ~5-8x faster than sequential
 * 4. Background refresh when cache is stale (serves stale data while revalidating)
 */

import { loadIndustryCache, saveIndustryCache } from './db/industry.js';

const TRADINGVIEW_SCANNER_URL = 'https://scanner.tradingview.com/america/scan';
const TV_SCAN_PAGE_SIZE = 250;
const TV_SCAN_MAX_PAGES = 40; // 250*40 = 10k symbols max
const TV_SCAN_CONCURRENCY = 5; // Fetch 5 pages in parallel (balance speed vs rate limits)

// In-memory cache: { returnsMap, tickerToTvIndustry, fetchedAt }
let memoryCache = null;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours - industry returns don't change intraday
const CACHE_STALE_MS = 1 * 60 * 60 * 1000; // 1 hour - after this, serve stale + refresh in background

// Background refresh state
let isBackgroundRefreshing = false;

/** Normalize industry name for matching (Yahoo vs TradingView may differ by "&" vs "and", case). */
function normalizeIndustryName(name) {
  return (name || '')
    .trim()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Fetch a single page from TradingView scanner.
 * @param {number} page - Page number (0-indexed)
 * @param {string[]} columns - Column names to fetch
 * @returns {Promise<Array>} - Rows for this page
 */
async function fetchTradingViewPage(page, columns) {
  const start = page * TV_SCAN_PAGE_SIZE;
  const body = {
    filter: [
      { left: 'type', operation: 'equal', right: 'stock' },
      { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
    ],
    // Sort by market cap desc so large/mid-caps (our scan targets) appear in the
    // first pages. Without sort, TV returns ~3,750 stocks in arbitrary order and many
    // scan result tickers are missing from the ticker→industry map.
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    options: { lang: 'en' },
    symbols: { query: { types: [] }, tickers: [] },
    columns,
    range: [start, start + TV_SCAN_PAGE_SIZE],
  };
  const scanRes = await fetch(TRADINGVIEW_SCANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!scanRes.ok) throw new Error(`TradingView scanner HTTP ${scanRes.status}`);
  const scanJson = await scanRes.json();
  return scanJson.data || [];
}

/**
 * Fetch industry performance (3M, 6M, 1Y, YTD) from TradingView scanner with optimizations.
 * @param {Object} options - Fetch options
 * @param {Set<string>|null} options.requiredIndustries - If provided, stop early when all are found
 * @param {boolean} options.useCache - Whether to use cache (default true)
 * @returns {Promise<{returnsMap: Map, tickerToTvIndustry: Map, fromCache: boolean, fetchedAt: string}>}
 */
async function fetchTradingViewIndustryReturns(options = {}) {
  const { requiredIndustries = null, useCache = true } = options;

  // 1. CHECK IN-MEMORY CACHE (instant response if fresh)
  if (useCache && memoryCache) {
    const age = Date.now() - memoryCache.fetchedAt;
    if (age < CACHE_TTL_MS) {
      // Fresh cache - return immediately
      return { 
        ...memoryCache, 
        fromCache: true,
        cacheAge: Math.round(age / 1000 / 60) // minutes
      };
    }
    if (age < CACHE_STALE_MS * 2) {
      // Stale but not expired - serve stale + refresh in background
      if (!isBackgroundRefreshing) {
        isBackgroundRefreshing = true;
        console.log('TradingView cache stale, refreshing in background...');
        // Fire and forget - don't await
        fetchTradingViewIndustryReturns({ useCache: false })
          .then(() => console.log('TradingView background refresh complete'))
          .catch((e) => console.error('TradingView background refresh failed:', e.message))
          .finally(() => { isBackgroundRefreshing = false; });
      }
      return { 
        ...memoryCache, 
        fromCache: true, 
        stale: true,
        cacheAge: Math.round(age / 1000 / 60) // minutes
      };
    }
  }

  // 2. CHECK DATABASE CACHE (fast if recent)
  if (useCache) {
    try {
      const dbCache = await loadIndustryCache('tradingview-returns');
      if (dbCache?.returnsMap && dbCache?.fetchedAt) {
        const age = Date.now() - new Date(dbCache.fetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
          // Hydrate memory cache from DB
          memoryCache = {
            returnsMap: new Map(Object.entries(dbCache.returnsMap)),
            tickerToTvIndustry: new Map(Object.entries(dbCache.tickerToTvIndustry || {})),
            fetchedAt: new Date(dbCache.fetchedAt).getTime(),
          };
          return { 
            ...memoryCache, 
            fromCache: true,
            source: 'db',
            cacheAge: Math.round(age / 1000 / 60)
          };
        }
      }
    } catch (e) {
      console.warn('TradingView DB cache read failed:', e.message);
    }
  }

  // 3. FETCH FRESH FROM API (with parallel requests + early exit)
  const columns = [
    'name', 'sector', 'industry', 'close', 'market_cap_basic',
    'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.YTD', 'Perf.Y',
  ];
  
  const allRows = [];
  const foundIndustries = new Set(); // Track which normalized industries we've seen
  let shouldStop = false;

  // Helper to process rows and check if we should stop early
  const processRows = (data) => {
    const toNum = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
    for (const row of data) {
      const values = row.d;
      if (!values || values.length < 5) continue;
      const industry = values[2];
      if (!industry || (typeof industry === 'string' && industry.trim() === '')) continue;
      
      const industryTrimmed = industry.trim();
      foundIndustries.add(normalizeIndustryName(industryTrimmed));
      
      allRows.push({
        symbol: row.s ?? null,
        industry: industryTrimmed,
        perf3M: toNum(values[6]),
        perf6M: toNum(values[7]),
        perfYTD: toNum(values[8]),
        perf1Y: toNum(values[9]),
      });
    }
    
    // EARLY EXIT: If we have all required industries, stop fetching
    if (requiredIndustries && requiredIndustries.size > 0) {
      const hasAll = [...requiredIndustries].every((ind) => foundIndustries.has(ind));
      if (hasAll) {
        shouldStop = true;
        console.log(`TradingView: Found all ${requiredIndustries.size} required industries, stopping early`);
      }
    }
  };

  // PARALLEL PAGE FETCHING: Fetch TV_SCAN_CONCURRENCY pages at a time
  for (let batchStart = 0; batchStart < TV_SCAN_MAX_PAGES && !shouldStop; batchStart += TV_SCAN_CONCURRENCY) {
    const batchEnd = Math.min(batchStart + TV_SCAN_CONCURRENCY, TV_SCAN_MAX_PAGES);
    const pagePromises = [];
    
    for (let page = batchStart; page < batchEnd; page++) {
      pagePromises.push(fetchTradingViewPage(page, columns));
    }
    
    const results = await Promise.all(pagePromises);
    
    for (const data of results) {
      if (shouldStop) break;
      processRows(data);
      // If this page is short, we've reached the end
      if (data.length < TV_SCAN_PAGE_SIZE) {
        shouldStop = true;
      }
    }
  }

  // 4. AGGREGATE BY INDUSTRY
  const byIndustry = new Map();
  for (const row of allRows) {
    const key = normalizeIndustryName(row.industry);
    if (!byIndustry.has(key)) {
      byIndustry.set(key, { sum3M: 0, n3M: 0, sum6M: 0, n6M: 0, sum1Y: 0, n1Y: 0, sumYTD: 0, nYTD: 0 });
    }
    const rec = byIndustry.get(key);
    if (row.perf3M != null) { rec.sum3M += row.perf3M; rec.n3M++; }
    if (row.perf6M != null) { rec.sum6M += row.perf6M; rec.n6M++; }
    if (row.perf1Y != null) { rec.sum1Y += row.perf1Y; rec.n1Y++; }
    if (row.perfYTD != null) { rec.sumYTD += row.perfYTD; rec.nYTD++; }
  }
  
  const returnsMap = new Map();
  for (const [normName, rec] of byIndustry.entries()) {
    returnsMap.set(normName, {
      perf3M: rec.n3M > 0 ? Math.round(rec.sum3M / rec.n3M * 100) / 100 : null,
      perf6M: rec.n6M > 0 ? Math.round(rec.sum6M / rec.n6M * 100) / 100 : null,
      perf1Y: rec.n1Y > 0 ? Math.round(rec.sum1Y / rec.n1Y * 100) / 100 : null,
      perfYTD: rec.nYTD > 0 ? Math.round(rec.sumYTD / rec.nYTD * 100) / 100 : null,
    });
  }

  // Map each ticker symbol (e.g. "AAPL") → raw TradingView industry name.
  const tickerToTvIndustry = new Map();
  for (const row of allRows) {
    if (row.symbol && row.industry) {
      const ticker = row.symbol.split(':').pop();
      tickerToTvIndustry.set(ticker, row.industry);
    }
  }

  const fetchedAt = Date.now();
  const result = { returnsMap, tickerToTvIndustry, fetchedAt, fromCache: false };

  // 5. UPDATE CACHES (memory + DB)
  memoryCache = result;
  
  // Save to DB asynchronously (don't block response)
  const cachePayload = {
    returnsMap: Object.fromEntries(returnsMap),
    tickerToTvIndustry: Object.fromEntries(tickerToTvIndustry),
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
  saveIndustryCache('tradingview-returns', cachePayload)
    .catch((e) => console.error('TradingView DB cache save failed:', e.message));

  console.log(`TradingView: Fetched ${allRows.length} rows, ${returnsMap.size} industries`);
  return result;
}

/**
 * Build industry returns map keyed by exact industry name for rankIndustries / enhanced score.
 * @param {Map<string, { perf3M, perf6M, perf1Y, perfYTD }>} tvMap - the returnsMap from fetchTradingViewIndustryReturns()
 * @param {string[]} industryNames - e.g. from fundamentals
 * @returns {Record<string, { return1Y?: number, return6Mo?: number, return3Mo?: number, returnYTD?: number }>}
 */
function buildIndustryReturnsFromTVMap(tvMap, industryNames) {
  const out = {};
  for (const name of industryNames || []) {
    if (!name || typeof name !== 'string') continue;
    const tv = tvMap.get(normalizeIndustryName(name));
    if (!tv) continue;
    out[name] = {
      return1Y: tv.perf1Y ?? undefined,
      return6Mo: tv.perf6M ?? undefined,
      return3Mo: tv.perf3M ?? undefined,
      returnYTD: tv.perfYTD ?? undefined,
    };
  }
  return out;
}

/**
 * Get set of normalized industry names from fundamentals for early exit optimization.
 * @param {Object} fundamentals - Map of ticker → { industry, ... }
 * @returns {Set<string>} - Set of normalized industry names
 */
function getRequiredIndustries(fundamentals) {
  const industries = new Set();
  for (const fund of Object.values(fundamentals || {})) {
    if (fund?.industry && typeof fund.industry === 'string') {
      industries.add(normalizeIndustryName(fund.industry));
    }
  }
  return industries;
}

export { normalizeIndustryName, fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, getRequiredIndustries };
