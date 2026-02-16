/**
 * Express server: serves API + optional static build. Caches API data to flat JSON files.
 * Loads .env from project root. Uses Yahoo Finance for bars (no API key). Massive only for populate-tickers.
 * Dev: npm run server (API only, port 3001). Production: npm run serve (build + serve app on PORT).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (parent of server/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { getBars, getFundamentals, getQuoteInfo } from './yahoo.js';
import { checkVCP } from './vcp.js';
import { computeEnhancedScore } from './enhancedScan.js';
import { fetchIndustrialsFromYahoo, fetchAllIndustriesFromYahoo, fetchSectorsFromYahoo, fetchIndustryReturns, fetchIndustry1YReturn, industryPageUrl } from './industrials.js';
import { listScanSnapshots, runBacktest, loadScanSnapshot } from './backtest.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');
const RESULTS_FILE = path.join(DATA_DIR, 'scan-results.json');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');
const INDUSTRIALS_CACHE_FILE = path.join(DATA_DIR, 'industrials.json');
const ALL_INDUSTRIES_CACHE_FILE = path.join(DATA_DIR, 'all-industries.json');
const SECTORS_CACHE_FILE = path.join(DATA_DIR, 'sectors.json');
const INDUSTRY_YAHOO_RETURNS_FILE = path.join(DATA_DIR, 'industry-yahoo-returns.json');

// Cache TTL: how long to use saved bar data before refetching (default 24h)
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

app.use(cors());
app.use(express.json());

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}
ensureDirs();

// In-memory cache for current process (avoids re-reading file on every request)
const barsMemoryCache = new Map();

/**
 * Get bars from file cache if present and not stale. File: data/bars/{TICKER}_{interval}.json
 * Format: { ticker, from, to, interval, fetchedAt, results }.
 */
function getBarsFromFile(ticker, from, to, interval = '1d') {
  const key = `${ticker}:${interval}:${from}:${to}`;
  const mem = barsMemoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.data;

  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}_${interval}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw.interval !== interval) return null;
    const age = Date.now() - new Date(raw.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    const results = raw.results || [];
    if (results.length === 0) return null;
    if (raw.from === from && raw.to === to) {
      barsMemoryCache.set(key, { data: results, at: Date.now() - age });
      return results;
    }
    if (raw.from <= to && raw.to >= from) {
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
  } catch {
    return null;
  }
}

/**
 * Save bars to data/bars/{TICKER}_{interval}.json and update in-memory cache.
 */
function saveBarsToFile(ticker, from, to, results, interval = '1d') {
  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}_${interval}.json`);
  const payload = { ticker, from, to, interval, fetchedAt: new Date().toISOString(), results };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  barsMemoryCache.set(`${ticker}:${interval}:${from}:${to}`, { data: results, at: Date.now() });
}

/** Load cached fundamentals. Returns full file content for GET /api/fundamentals display. */
function loadFundamentals() {
  if (!fs.existsSync(FUNDAMENTALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FUNDAMENTALS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Load only entries with extended fields (industry, profitMargin, operatingMargin, companyName). Used for cache-hit check. */
function loadFundamentalsFiltered() {
  const raw = loadFundamentals();
  const filtered = {};
  for (const [ticker, entry] of Object.entries(raw)) {
    const hasCompanyName = entry?.companyName && String(entry.companyName).trim();
    if (entry && 'industry' in entry && 'profitMargin' in entry && 'operatingMargin' in entry && hasCompanyName) {
      filtered[ticker] = entry;
    }
  }
  return filtered;
}

/** Save fundamentals to file. */
function saveFundamentals(data) {
  fs.writeFileSync(FUNDAMENTALS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Load Yahoo industry returns (1Y, 3M, YTD) keyed by industry name. */
function loadIndustryYahooReturns() {
  if (!fs.existsSync(INDUSTRY_YAHOO_RETURNS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDUSTRY_YAHOO_RETURNS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Save Yahoo industry returns to file. */
function saveIndustryYahooReturns(data) {
  fs.writeFileSync(INDUSTRY_YAHOO_RETURNS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- API ----------

// Cached fundamentals (% held by inst, qtr earnings YoY)
app.get('/api/fundamentals', (req, res) => {
  try {
    res.json(loadFundamentals());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single-ticker fundamentals (from cache; use POST /api/fundamentals/fetch to populate)
app.get('/api/fundamentals/:ticker', (req, res) => {
  try {
    const ticker = String(req.params.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
    const all = loadFundamentals();
    const f = all[ticker] || null;
    res.json(f ? { ticker, ...f } : { ticker, pctHeldByInst: null, qtrEarningsYoY: null, profitMargin: null, operatingMargin: null, industry: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch fundamentals from Yahoo for given tickers. Throttled, cached to data/fundamentals.json.
const FUNDAMENTALS_DELAY_MS = 200;
let lastFundamentalsFetch = 0;
app.post('/api/fundamentals/fetch', async (req, res) => {
  if (Date.now() - lastFundamentalsFetch < 5000) {
    return res.status(429).json({ error: 'Wait 5 seconds between fetch requests.' });
  }
  lastFundamentalsFetch = Date.now();

  const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : [];
  const forceRefresh = !!req.body?.force;
  if (tickers.length === 0) {
    return res.status(400).json({ error: 'Provide tickers array in body.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  // Always load full cache; forceRefresh only bypasses cache check for requested tickers (never wipes file)
  const fullCache = loadFundamentals();
  const filteredForCheck = loadFundamentalsFiltered();
  const CACHE_TTL_FUND = 24 * 60 * 60 * 1000; // 24h

  for (let i = 0; i < tickers.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, FUNDAMENTALS_DELAY_MS));
    const ticker = String(tickers[i]).toUpperCase();
    const existing = fullCache[ticker];
    const cachedEntry = filteredForCheck[ticker];
    const hasCompanyName = cachedEntry?.companyName && String(cachedEntry.companyName).trim();
    const hasExtendedFields = cachedEntry && 'industry' in cachedEntry && 'profitMargin' in cachedEntry && 'operatingMargin' in cachedEntry && hasCompanyName;
    const cacheValid = existing?.fetchedAt && Date.now() - new Date(existing.fetchedAt).getTime() < CACHE_TTL_FUND;
    if (!forceRefresh && cacheValid && hasExtendedFields) {
      send({ ticker, ...existing, cached: true, index: i + 1, total: tickers.length });
      continue;
    }
    try {
      // Fetch both in parallel; quote() is often more reliable for company name than quoteSummary price
      const [f, quoteResult] = await Promise.allSettled([getFundamentals(ticker), getQuoteInfo(ticker)]);
      const fund = f.status === 'fulfilled' ? f.value : null;
      const quoteInfo = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
      if (!fund) throw new Error(f.reason?.message ?? 'Fundamentals fetch failed');
      const industry = fund.industry ?? null;
      const sector = fund.sector ?? null;
      const companyName = (quoteInfo?.name && String(quoteInfo.name).trim()) || (fund.companyName && String(fund.companyName).trim()) || null;
      const entry = {
        pctHeldByInst: fund.pctHeldByInst ?? null,
        qtrEarningsYoY: fund.qtrEarningsYoY ?? null,
        profitMargin: fund.profitMargin ?? null,
        operatingMargin: fund.operatingMargin ?? null,
        industry,
        sector,
        ...(companyName && String(companyName).trim() ? { companyName: String(companyName).trim() } : {}),
        fetchedAt: new Date().toISOString(),
      };
      fullCache[ticker] = entry;
      send({ ticker, ...entry, index: i + 1, total: tickers.length });
    } catch (e) {
      send({ ticker, error: e.message, index: i + 1, total: tickers.length });
    }
  }
  saveFundamentals(fullCache);
  send({ done: true, total: tickers.length });
  res.end();
});

// Company name and exchange for ticker (for display + TradingView symbol)
app.get('/api/quote/:ticker', async (req, res) => {
  const { ticker } = req.params;
  if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
  try {
    const { name, exchange } = await getQuoteInfo(ticker);
    res.json({ ticker, name, exchange });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * Build ticker -> industry data map for CANSLIM enhanced scoring.
 * Uses fundamentals (industry per ticker), industry-trend logic (1Y/6M returns), and ranks industries by 1Y return.
 * getBarsFn(ticker) returns bars for that ticker (365d range).
 */
function buildIndustryDataForTickers(results, fundamentals, yahooReturns, getBarsFn) {
  const byIndustry = new Map();
  for (const r of results) {
    const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
    if (!byIndustry.has(ind)) byIndustry.set(ind, []);
    byIndustry.get(ind).push(r);
  }
  const industriesWithMetrics = [];
  for (const [industry, tickers] of byIndustry.entries()) {
    const with6Mo = tickers
      .map((r) => {
        const bars = getBarsFn(r.ticker);
        return bars ? computeChange6MoFrom1YBars(bars) : null;
      })
      .filter((v) => v != null);
    const with1Y = tickers
      .map((r) => {
        const bars = getBarsFn(r.ticker);
        return bars ? computePctChange(bars) : null;
      })
      .filter((v) => v != null);
    const industryAvg6Mo =
      with6Mo.length > 0 ? Math.round((with6Mo.reduce((s, v) => s + v, 0) / with6Mo.length) * 10) / 10 : null;
    const barBased1Y =
      with1Y.length > 0 ? Math.round((with1Y.reduce((s, v) => s + v, 0) / with1Y.length) * 10) / 10 : null;
    const industryAvg1Y = yahooReturns[industry]?.return1Y ?? barBased1Y;
    industriesWithMetrics.push({ industry, industryAvg1Y, industryAvg6Mo });
  }
  industriesWithMetrics.sort((a, b) => (b.industryAvg1Y ?? -999) - (a.industryAvg1Y ?? -999));
  const industryRank = new Map();
  industriesWithMetrics.forEach((ind, idx) => industryRank.set(ind.industry, idx + 1));
  const tickerToIndustryData = new Map();
  for (const [industry, tickers] of byIndustry.entries()) {
    const metrics = industriesWithMetrics.find((m) => m.industry === industry);
    const rank = industryRank.get(industry);
    const return1Y = metrics?.industryAvg1Y ?? null;
    const return6Mo = metrics?.industryAvg6Mo ?? null;
    for (const r of tickers) {
      tickerToIndustryData.set(r.ticker, { rank, return1Y, return6Mo });
    }
  }
  return tickerToIndustryData;
}

// Latest scan results (from file written by server/scan.js).
// Returns results as-is from file since scan already includes enhanced scores
app.get('/api/scan-results', (req, res) => {
  try {
    if (!fs.existsSync(RESULTS_FILE)) {
      return res.json({ scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 });
    }
    const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    // Return data as-is - scan already computed enhanced scores, RS, and industry ranks
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Background scan progress tracking
const activeScan = {
  id: null,
  running: false,
  progress: {
    index: 0,
    total: 0,
    vcpBullishCount: 0,
    startedAt: null,
    completedAt: null
  },
  results: []
};

// Generate unique scan ID
function generateScanId() {
  return `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get current scan progress
app.get('/api/scan/progress', (req, res) => {
  res.json({
    scanId: activeScan.id,
    running: activeScan.running,
    progress: activeScan.progress,
    hasResults: activeScan.results.length > 0
  });
});

// Trigger scan: streams each ticker result as SSE. Throttled queue (1 ticker at a time) avoids rate limits.
let lastScanStarted = 0;
const SCAN_COOLDOWN_MS = 10 * 1000; // 10s between scan starts (allow new scan if previous finished)

app.post('/api/scan', async (req, res) => {
  if (activeScan.running) {
    return res.status(429).json({ 
      error: 'Scan already in progress', 
      scanId: activeScan.id,
      progress: activeScan.progress 
    });
  }
  if (Date.now() - lastScanStarted < SCAN_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Scan already run recently. Wait a moment.' });
  }
  lastScanStarted = Date.now();
  
  // Initialize new scan
  activeScan.id = generateScanId();
  activeScan.running = true;
  activeScan.progress = {
    index: 0,
    total: 0,
    vcpBullishCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null
  };
  activeScan.results = [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable buffering
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };
  
  // Send initial scan ID
  send({ scanId: activeScan.id, started: true, startedAt: activeScan.progress.startedAt });

  try {
    const { runScanStream } = await import('./scan.js');
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 180); // Changed to 180 for RS calculation
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const results = [];
    let vcpBullishCount = 0;

    for await (const { result, index, total } of runScanStream()) {
      results.push(result);
      activeScan.results.push(result);
      if (result.vcpBullish) vcpBullishCount++;
      
      // Update global progress
      activeScan.progress.index = index;
      activeScan.progress.total = total;
      activeScan.progress.vcpBullishCount = vcpBullishCount;
      
      send({ result, index, total, vcpBullishCount, scanId: activeScan.id });
      
      // Write partial results every 25 tickers (survives refresh)
      if (results.length % 25 === 0 || results.length === total) {
        const sorted = [...results].sort((a, b) => {
          const aE = a.enhancedScore ?? a.score ?? 0;
          const bE = b.enhancedScore ?? b.score ?? 0;
          return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
        });
        fs.writeFileSync(
          RESULTS_FILE,
          JSON.stringify(
            { scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted },
            null,
            2
          )
        );
      }
    }

    const sorted = results.sort((a, b) => {
      const aE = a.enhancedScore ?? a.score ?? 0;
      const bE = b.enhancedScore ?? b.score ?? 0;
      return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
    });
    fs.writeFileSync(
      RESULTS_FILE,
      JSON.stringify(
        { scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: results.length, vcpBullishCount, results: sorted },
        null,
        2
      )
    );
    
    // Mark scan as complete
    activeScan.running = false;
    activeScan.progress.completedAt = new Date().toISOString();

    send({ done: true, total: results.length, vcpBullishCount, scanId: activeScan.id });
  } catch (e) {
    console.error('Scan failed:', e);
    activeScan.running = false;
    activeScan.progress.completedAt = new Date().toISOString();
    send({ error: e.message, scanId: activeScan.id });
  } finally {
    res.end();
  }
});

// OHLC bars for a ticker. Query: days (default 180), interval (1d|1wk|1mo, default 1d).
app.get('/api/bars/:ticker', async (req, res) => {
  const { ticker } = req.params;
  // Handle interval: may be string, array (duplicate params), or missing; ensure valid value
  let interval = req.query.interval;
  if (Array.isArray(interval)) interval = interval[0];
  const intervalStr = String(interval || '').toLowerCase();
  interval = ['1d', '1wk', '1mo'].includes(intervalStr) ? intervalStr : '1d';
  let days = Number(req.query.days) || 180;
  // Weekly/monthly need longer range for enough bars
  if (interval === '1wk') days = Math.max(days, 730); // min 2y for weekly
  if (interval === '1mo') days = Math.max(days, 1825); // min 5y for monthly
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  let bars = getBarsFromFile(ticker, fromStr, toStr, interval);
  if (!bars) {
    try {
      bars = await getBars(ticker, fromStr, toStr, interval);
      saveBarsToFile(ticker, fromStr, toStr, bars, interval);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  // lightweight-charts requires asc by time; Yahoo can return unsorted
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  res.json({ ticker, from: fromStr, to: toStr, interval, results: sorted });
});

// Industry summary with 3-month price trend. Groups scan-result tickers by industry, computes % change from bars.
function getBarsForTrend(ticker, fromStr, toStr) {
  let bars = getBarsFromFile(ticker, fromStr, toStr, '1d');
  if (bars && bars.length >= 2) return bars;
  // Fallback: scan cache uses ticker.json (no interval suffix)
  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const results = raw.results || [];
    if (results.length < 2) return null;
    const filtered = results.filter((b) => {
      const d = new Date(b.t).toISOString().slice(0, 10);
      return d >= fromStr && d <= toStr;
    });
    return filtered.length >= 2 ? filtered : null;
  } catch {
    return null;
  }
}

/** Fetch bars from Yahoo when file cache misses. Saves to file for future use. */
async function fetchBarsForTrend(ticker, fromStr, toStr) {
  let bars = getBarsForTrend(ticker, fromStr, toStr);
  if (bars && bars.length >= 2) return bars;
  try {
    bars = await getBars(ticker, fromStr, toStr, '1d');
    if (bars && bars.length >= 2) {
      saveBarsToFile(ticker, fromStr, toStr, bars, '1d');
      return bars;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Compute % change from bars (first to last close). Returns null if insufficient data. */
function computePctChange(bars) {
  if (!bars || bars.length < 2) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const first = sorted[0].c;
  const last = sorted[sorted.length - 1].c;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

/** Compute 3M % change from 365-day bars (uses last ~63 trading days). */
function computeChange3MoFrom1YBars(bars) {
  if (!bars || bars.length < 2) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const idx3mo = Math.max(0, sorted.length - 63); // ~3 months of trading days
  const first = sorted[idx3mo].c;
  const last = sorted[sorted.length - 1].c;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

/** Compute 6M % change from 365-day bars (uses last ~126 trading days). */
function computeChange6MoFrom1YBars(bars) {
  if (!bars || bars.length < 2) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const idx6mo = Math.max(0, sorted.length - 126); // ~6 months of trading days
  const first = sorted[idx6mo].c;
  const last = sorted[sorted.length - 1].c;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

/** Compute YTD % change from bars (first bar of year to last). */
function computeYtdFromBars(bars, year) {
  if (!bars || bars.length < 2) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const yearStart = new Date(year, 0, 1).getTime();
  const firstOfYear = sorted.find((b) => b.t >= yearStart);
  if (!firstOfYear) return null;
  const last = sorted[sorted.length - 1];
  if (firstOfYear.c <= 0) return null;
  return Math.round(((last.c - firstOfYear.c) / firstOfYear.c) * 1000) / 10;
}

/**
 * Compute 6M and 1Y returns for a Yahoo industry index symbol (e.g. ^YH31130020).
 * Uses Yahoo chart bars so values stay current without brittle HTML scraping.
 */
async function computeIndustrySymbolReturns(symbol, fromStr365, toStr) {
  if (!symbol || typeof symbol !== 'string') return { return6Mo: null, return1Y: null };
  try {
    let bars = getBarsFromFile(symbol, fromStr365, toStr, '1d');
    if (!bars || bars.length < 2) {
      bars = await getBars(symbol, fromStr365, toStr, '1d');
      if (bars && bars.length >= 2) {
        saveBarsToFile(symbol, fromStr365, toStr, bars, '1d');
      }
    }
    if (!bars || bars.length < 2) return { return6Mo: null, return1Y: null };
    return {
      return6Mo: computeChange6MoFrom1YBars(bars),
      return1Y: computePctChange(bars),
    };
  } catch {
    return { return6Mo: null, return1Y: null };
  }
}

const BARS_FETCH_DELAY_MS = 200;
let lastIndustryFetch = 0;
const INDUSTRY_FETCH_COOLDOWN_MS = 5000;

app.post('/api/industry-trend/fetch', async (req, res) => {
  if (Date.now() - lastIndustryFetch < INDUSTRY_FETCH_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Wait 5 seconds between fetch requests.' });
  }
  lastIndustryFetch = Date.now();

  if (!fs.existsSync(RESULTS_FILE)) {
    return res.status(400).json({ error: 'No scan results. Run a scan first.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable buffering so client gets live chunks
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  const to = new Date();
  const from90 = new Date(to);
  from90.setDate(from90.getDate() - 90);
  const from365 = new Date(to);
  from365.setDate(from365.getDate() - 365);
  const fromStr90 = from90.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const fromStr365 = from365.toISOString().slice(0, 10);

  const scanData = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const results = scanData.results || [];
  const fundamentals = loadFundamentals();

  // 1. Fetch fundamentals for ALL scan tickers (get industry + sector for every ticker)
  const needFundamentals = results.map((r) => r.ticker).filter(Boolean);
  let fundamentalsFetched = 0;
  let fundamentalsFailed = 0;
  const FUND_DELAY_MS = 200;
  for (let i = 0; i < needFundamentals.length; i++) {
    await new Promise((r) => setTimeout(r, i > 0 ? FUND_DELAY_MS : 0));
    const ticker = needFundamentals[i];
    try {
      const f = await getFundamentals(ticker);
      const entry = {
        pctHeldByInst: f.pctHeldByInst ?? null,
        qtrEarningsYoY: f.qtrEarningsYoY ?? null,
        profitMargin: f.profitMargin ?? null,
        operatingMargin: f.operatingMargin ?? null,
        industry: f.industry ?? null,
        sector: f.sector ?? null,
        fetchedAt: new Date().toISOString(),
      };
      fundamentals[ticker] = entry;
      fundamentalsFetched++;
      send({ phase: 'fundamentals', ticker, index: i + 1, total: needFundamentals.length });
    } catch (e) {
      fundamentalsFailed++;
      send({ phase: 'fundamentals', ticker, error: e.message });
    }
  }
  saveFundamentals(fundamentals);

  const industriesCount = new Set(
    Object.values(fundamentals).filter((e) => e && e.industry).map((e) => e.industry)
  ).size;

  // 2. Fetch 365-day bars for tickers missing data (used for both 3M and 1Y return)
  const needBars = results.filter((r) => !getBarsForTrend(r.ticker, fromStr365, toStr));
  let barsFetched = 0;
  let barsFailed = 0;
  for (let i = 0; i < needBars.length; i++) {
    await new Promise((r) => setTimeout(r, i > 0 ? BARS_FETCH_DELAY_MS : 0));
    const r = needBars[i];
    try {
      const bars = await fetchBarsForTrend(r.ticker, fromStr365, toStr);
      if (bars && bars.length >= 2) barsFetched++;
      else barsFailed++;
      send({ phase: 'bars', ticker: r.ticker, index: i + 1, total: needBars.length, hasBars: !!bars });
    } catch (e) {
      barsFailed++;
      send({ phase: 'bars', ticker: r.ticker, error: e.message });
    }
  }

  // Invalidate bars memory cache so GET /api/industry-trend reads fresh from file
  for (const r of needBars) {
    barsMemoryCache.delete(`${r.ticker}:1d:${fromStr365}:${toStr}`);
  }

  // 3. Fetch Yahoo Finance 1Y return for each industry (from industry sub-pages, e.g. aerospace-defense 50.60%)
  const byIndustryForYahoo = new Map();
  for (const r of results) {
    const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
    if (ind === 'Unknown') continue;
    if (!byIndustryForYahoo.has(ind)) {
      const sector = fundamentals[r.ticker]?.sector ?? null;
      byIndustryForYahoo.set(ind, sector);
    }
  }
  const yahooReturns = loadIndustryYahooReturns();
  const YAHOO_INDUSTRY_DELAY_MS = 500;
  const industryList = [...byIndustryForYahoo.entries()];
  let yahooFetched = 0;
  for (let i = 0; i < industryList.length; i++) {
    await new Promise((r) => setTimeout(r, YAHOO_INDUSTRY_DELAY_MS));
    const [industry, sector] = industryList[i];
    try {
      const return1Y = await fetchIndustry1YReturn(industry, sector);
      if (return1Y != null) {
        yahooReturns[industry] = { ...(yahooReturns[industry] || {}), return1Y, fetchedAt: new Date().toISOString() };
        yahooFetched++;
      }
      send({ phase: 'yahoo', industry, return1Y, index: i + 1, total: industryList.length });
    } catch (e) {
      send({ phase: 'yahoo', industry, error: e.message });
    }
  }
  saveIndustryYahooReturns(yahooReturns);

  send({
    done: true,
    fundamentalsFetched,
    fundamentalsFailed,
    fundamentalsTotal: needFundamentals.length,
    barsFetched,
    barsFailed,
    barsTotal: needBars.length,
    yahooFetched,
    industriesCount,
  });
  res.end();
});

// ---------- Industrials sector (Yahoo Finance) ----------
// Filter out companies/ETFs from cached industries (safety for old cache)
function filterIndustriesOnly(industries) {
  if (!Array.isArray(industries)) return [];
  return industries.filter((ind) => {
    const name = ind?.name;
    if (!name) return false;
    if (/^\s*[A-Z]{2,5}\s+/.test(name)) return false;
    if (/\b(Inc\.|Corp|Corporation|ETF|Fund|Ltd|plc)\b/i.test(name)) return false;
    if (ind.ytdReturn != null && Math.abs(ind.ytdReturn) > 150) return false;
    return true;
  });
}

// GET: return cached industrials industries (name, YTD, 6M)
app.get('/api/industrials', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    if (!fs.existsSync(INDUSTRIALS_CACHE_FILE)) {
      return res.json({ industries: [], fetchedAt: null, source: null });
    }
    const data = JSON.parse(fs.readFileSync(INDUSTRIALS_CACHE_FILE, 'utf8'));
    data.industries = filterIndustriesOnly(data.industries);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: fetch industrials from Yahoo Finance, fetch 6M from each industry sub-page (SSE for live progress)
let lastIndustrialsFetch = 0;
const INDUSTRIALS_FETCH_COOLDOWN_MS = 10000; // 10s to avoid Yahoo rate limit
const INDUSTRY_6M_FETCH_DELAY_MS = 500; // delay between industry page fetches
app.post('/api/industrials/fetch', async (req, res) => {
  if (Date.now() - lastIndustrialsFetch < INDUSTRIALS_FETCH_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Wait 10 seconds between fetch requests.' });
  }
  lastIndustrialsFetch = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    send({ phase: 'sector', message: 'Fetching industries from Yahoo…' });
    const { industries: yahooIndustries, source } = await fetchIndustrialsFromYahoo();

    // 2. Build 6M map from our bars (primary source - reliable)
    const industry6MoMap = new Map();
    const industry6MoMapNorm = new Map(); // normalized key for fuzzy match
    if (fs.existsSync(RESULTS_FILE) && fs.existsSync(FUNDAMENTALS_FILE)) {
      const scanData = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      const results = scanData.results || [];
      const fundamentals = loadFundamentals();
      const to = new Date();
      const from365 = new Date(to);
      from365.setDate(from365.getDate() - 365);
      const fromStr365 = from365.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const byIndustry = new Map();
      for (const r of results) {
        const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
        if (!byIndustry.has(ind)) byIndustry.set(ind, []);
        byIndustry.get(ind).push(r);
      }
      const norm = (s) => (s || '').toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim();
      for (const [industry, tickers] of byIndustry.entries()) {
        const with6Mo = tickers
          .map((r) => {
            const bars = getBarsForTrend(r.ticker, fromStr365, toStr);
            return bars ? computeChange6MoFrom1YBars(bars) : null;
          })
          .filter((v) => v != null);
        if (with6Mo.length > 0) {
          const avg = Math.round((with6Mo.reduce((s, v) => s + v, 0) / with6Mo.length) * 10) / 10;
          industry6MoMap.set(industry, avg);
          industry6MoMapNorm.set(norm(industry), avg);
        }
      }
    }
    const get6MoFromBars = (name) => {
      const v = industry6MoMap.get(name);
      if (v != null) return v;
      return industry6MoMapNorm.get((name || '').toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim()) ?? null;
    };

    // 3. Fetch 6M and 1Y from Yahoo industry sub-pages (e.g. aerospace-defense: 6M 19.11%, 1Y 50.60%)
    const industries = [];
    for (let i = 0; i < yahooIndustries.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, INDUSTRY_6M_FETCH_DELAY_MS));
      const ind = yahooIndustries[i];
      const { return6Mo, return1Y } = await fetchIndustryReturns(ind.name, 'Industrials');
      const url = industryPageUrl(ind.name, 'Industrials');
      industries.push({
        name: ind.name,
        ytdReturn: ind.ytdReturn,
        return6Mo: return6Mo ?? get6MoFromBars(ind.name),
        return1Y: return1Y ?? null,
        url: url ?? undefined,
      });
      send({ phase: 'industries', index: i + 1, total: yahooIndustries.length, industry: ind.name });
    }

    const payload = {
      industries,
      fetchedAt: new Date().toISOString(),
      source,
    };
    fs.writeFileSync(INDUSTRIALS_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    send({ done: true, payload });
  } catch (e) {
    console.error('Industrials fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// ---------- All Industries (all 11 sectors, ~145 industries) ----------
// GET: return cached all industries with tickers from scan results
app.get('/api/all-industries', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    if (!fs.existsSync(ALL_INDUSTRIES_CACHE_FILE)) {
      return res.json({ industries: [], fetchedAt: null, source: null });
    }
    const data = JSON.parse(fs.readFileSync(ALL_INDUSTRIES_CACHE_FILE, 'utf8'));
    
    // Add tickers and industryRank from scan results to each industry
    if (fs.existsSync(RESULTS_FILE)) {
      try {
        const scanData = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
        const tickersByIndustry = {};
        const ranksByIndustry = {};
        
        // Group tickers and ranks by industry name
        if (scanData.results && Array.isArray(scanData.results)) {
          scanData.results.forEach((result) => {
            const industry = result.industryName;
            if (industry) {
              if (!tickersByIndustry[industry]) {
                tickersByIndustry[industry] = [];
                ranksByIndustry[industry] = [];
              }
              tickersByIndustry[industry].push(result.ticker);
              if (result.industryRank != null) {
                ranksByIndustry[industry].push(result.industryRank);
              }
            }
          });
        }
        
        // Add tickers array and average industryRank to each industry
        if (data.industries && Array.isArray(data.industries)) {
          data.industries = data.industries.map((ind) => {
            const tickers = tickersByIndustry[ind.name] || [];
            const ranks = ranksByIndustry[ind.name] || [];
            const avgRank = ranks.length > 0 
              ? Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length)
              : null;
            return {
              ...ind,
              tickers,
              industryRank: avgRank,
            };
          });
        }
      } catch (scanErr) {
        console.error('Error loading scan results for tickers:', scanErr);
      }
    }
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: fetch all ~145 industries from all 11 Yahoo Finance sectors
let lastAllIndustriesFetch = 0;
app.post('/api/all-industries/fetch', async (req, res) => {
  if (Date.now() - lastAllIndustriesFetch < 30000) {
    return res.status(429).json({ error: 'Wait 30 seconds between fetch requests.' });
  }
  lastAllIndustriesFetch = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  const ALL_INDUSTRIES_6M_1Y_DELAY_MS = 200;

  try {
    send({ phase: 'fetching', message: 'Fetching all sectors from Yahoo Finance…' });
    const { industries: rawIndustries, source } = await fetchAllIndustriesFromYahoo();
    send({ phase: 'fetching', message: `Computing 6M & 1Y returns for ${rawIndustries.length} industries…` });

    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const industries = [];
    for (let i = 0; i < rawIndustries.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ALL_INDUSTRIES_6M_1Y_DELAY_MS));
      const ind = rawIndustries[i];
      // Primary source: Yahoo index-symbol chart performance for this industry.
      // Fallback: existing industry-page parser when symbol bars are unavailable.
      const symbolReturns = await computeIndustrySymbolReturns(ind.symbol, fromStr365, toStr);
      let return6Mo = symbolReturns.return6Mo;
      let return1Y = symbolReturns.return1Y;
      if (return6Mo == null || return1Y == null) {
        const fallback = await fetchIndustryReturns(ind.name, ind.sector);
        return6Mo = return6Mo ?? fallback.return6Mo ?? null;
        return1Y = return1Y ?? fallback.return1Y ?? null;
      }
      industries.push({
        ...ind,
        return6Mo,
        return1Y,
      });
      send({ phase: 'returns', index: i + 1, total: rawIndustries.length, industry: ind.name });
    }

    // Add tickers and industryRank from scan results to each industry
    const tickersByIndustry = {};
    const ranksByIndustry = {};
    if (fs.existsSync(RESULTS_FILE)) {
      try {
        const scanData = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
        if (scanData.results && Array.isArray(scanData.results)) {
          scanData.results.forEach((result) => {
            const industry = result.industryName;
            if (industry) {
              if (!tickersByIndustry[industry]) {
                tickersByIndustry[industry] = [];
                ranksByIndustry[industry] = [];
              }
              tickersByIndustry[industry].push(result.ticker);
              if (result.industryRank != null) {
                ranksByIndustry[industry].push(result.industryRank);
              }
            }
          });
        }
      } catch (scanErr) {
        console.error('Error loading scan results for tickers:', scanErr);
      }
    }

    // Add tickers array and average industryRank to each industry
    const industriesWithTickers = industries.map((ind) => {
      const tickers = tickersByIndustry[ind.name] || [];
      const ranks = ranksByIndustry[ind.name] || [];
      const avgRank = ranks.length > 0 
        ? Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length)
        : null;
      return {
        ...ind,
        tickers,
        industryRank: avgRank,
      };
    });

    const payload = {
      industries: industriesWithTickers,
      fetchedAt: new Date().toISOString(),
      source,
    };
    fs.writeFileSync(ALL_INDUSTRIES_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    send({ done: true, payload });
  } catch (e) {
    console.error('All industries fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// ---------- Sectors (11 sectors from https://finance.yahoo.com/sectors/) ----------
app.get('/api/sectors', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    if (!fs.existsSync(SECTORS_CACHE_FILE)) {
      return res.json({ sectors: [], fetchedAt: null, source: null });
    }
    const data = JSON.parse(fs.readFileSync(SECTORS_CACHE_FILE, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let lastSectorsFetch = 0;
app.post('/api/sectors/fetch', async (req, res) => {
  if (Date.now() - lastSectorsFetch < 30000) {
    return res.status(429).json({ error: 'Wait 30 seconds between fetch requests.' });
  }
  lastSectorsFetch = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    send({ phase: 'fetching', message: 'Fetching 11 sectors from Yahoo Finance…' });
    const { sectors, source } = await fetchSectorsFromYahoo();
    const payload = { sectors, fetchedAt: new Date().toISOString(), source };
    fs.writeFileSync(SECTORS_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    send({ done: true, payload });
  } catch (e) {
    console.error('Sectors fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// POST: fetch only Yahoo 1Y returns for industries (lightweight, no fundamentals/bars)
app.post('/api/industry-trend/fetch-yahoo', async (req, res) => {
  if (Date.now() - lastIndustryFetch < INDUSTRY_FETCH_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Wait 5 seconds between fetch requests.' });
  }
  lastIndustryFetch = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  const fundamentals = loadFundamentals();
  const industries = [...new Set(Object.values(fundamentals).filter((e) => e?.industry).map((e) => e.industry))];

  if (industries.length === 0) {
    send({ done: true, total: 0, error: 'No industries in fundamentals. Run "Fetch fundamentals" first.' });
    res.end();
    return;
  }

  const yahooReturns = loadIndustryYahooReturns();
  const YAHOO_DELAY_MS = 500;

  for (let i = 0; i < industries.length; i++) {
    await new Promise((r) => setTimeout(r, YAHOO_DELAY_MS));
    const industry = industries[i];
    const sector = Object.values(fundamentals).find((e) => e?.industry === industry)?.sector ?? null;
    try {
      const return1Y = await fetchIndustry1YReturn(industry, sector);
      if (return1Y != null) {
        yahooReturns[industry] = { ...(yahooReturns[industry] || {}), return1Y, fetchedAt: new Date().toISOString() };
      }
      send({ industry, return1Y, index: i + 1, total: industries.length });
    } catch (e) {
      send({ industry, error: e.message, index: i + 1, total: industries.length });
    }
  }
  saveIndustryYahooReturns(yahooReturns);
  send({ done: true, total: industries.length });
  res.end();
});

// ---------- Industry trend (scan-based) ----------
app.get('/api/industry-trend', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const fundamentals = loadFundamentals();
    const yahooReturns = loadIndustryYahooReturns();
    if (!fs.existsSync(RESULTS_FILE)) {
      return res.json({ industries: [], scannedAt: null });
    }
    const scanData = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    const results = scanData.results || [];
    const to = new Date();
    const from90 = new Date(to);
    from90.setDate(from90.getDate() - 90);
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr90 = from90.toISOString().slice(0, 10);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const byIndustry = new Map();
    for (const r of results) {
      const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind).push(r);
    }

    const currentYear = to.getFullYear();
    const industries = [];
    for (const [industry, tickers] of byIndustry.entries()) {
      const withTrend = tickers.map((r) => {
        let change3mo = null;
        let change1y = null;
        let ytd = null;
        let change6mo = null;
        const bars365 = getBarsForTrend(r.ticker, fromStr365, toStr);
        if (bars365 && bars365.length >= 2) {
          change1y = computePctChange(bars365);
          change3mo = computeChange3MoFrom1YBars(bars365);
          change6mo = computeChange6MoFrom1YBars(bars365);
          ytd = computeYtdFromBars(bars365, currentYear);
        }
        if (change3mo == null) {
          const bars90 = getBarsForTrend(r.ticker, fromStr90, toStr);
          change3mo = computePctChange(bars90);
        }
        return { ticker: r.ticker, lastClose: r.lastClose, change3mo, change6mo, change1y, ytd, score: r.score };
      });
      const with3Mo = withTrend.filter((t) => t.change3mo != null);
      const with6Mo = withTrend.filter((t) => t.change6mo != null);
      const with1Y = withTrend.filter((t) => t.change1y != null);
      const withYtd = withTrend.filter((t) => t.ytd != null);
      const industryAvg3Mo =
        with3Mo.length > 0 ? Math.round((with3Mo.reduce((s, t) => s + (t.change3mo ?? 0), 0) / with3Mo.length) * 10) / 10 : null;
      const industryAvg6Mo =
        with6Mo.length > 0 ? Math.round((with6Mo.reduce((s, t) => s + (t.change6mo ?? 0), 0) / with6Mo.length) * 10) / 10 : null;
      const barBased1Y =
        with1Y.length > 0 ? Math.round((with1Y.reduce((s, t) => s + (t.change1y ?? 0), 0) / with1Y.length) * 10) / 10 : null;
      // Prefer Yahoo Finance industry 1Y (e.g. aerospace-defense 50.60%) when available
      const industryAvg1Y = yahooReturns[industry]?.return1Y ?? barBased1Y;
      const industryYtd =
        withYtd.length > 0 ? Math.round((withYtd.reduce((s, t) => s + (t.ytd ?? 0), 0) / withYtd.length) * 10) / 10 : null;
      industries.push({ industry, tickers: withTrend, industryAvg3Mo, industryAvg6Mo, industryAvg1Y, industryYtd });
    }
    industries.sort((a, b) => a.industry.localeCompare(b.industry));
    res.json({ industries, scannedAt: scanData.scannedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// VCP analysis for one ticker: bars from file cache or API, then compute VCP (not persisted separately)
app.get('/api/vcp/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  try {
    let bars = getBarsFromFile(ticker, fromStr, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr, toStr, '1d');
      saveBarsToFile(ticker, fromStr, toStr, bars, '1d');
    }
    const vcp = checkVCP(bars);
    res.json({ ticker, ...vcp, barCount: bars.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Optional: run full scan every 24 hours
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
function scheduleDailyScan() {
  setInterval(async () => {
    console.log('Running scheduled 24h VCP scan...');
    const { runScan } = await import('./scan.js');
    runScan().catch((e) => console.error('Scheduled scan failed:', e));
  }, TWENTY_FOUR_HOURS_MS);
}
if (process.env.SCHEDULE_SCAN === '1') {
  scheduleDailyScan();
  console.log('24h scan scheduler enabled (SCHEDULE_SCAN=1).');
}

// ---------- Industry Data Collection ----------
// Collect 1 year of historical data for all industries
const INDUSTRY_DATA_DIR = path.join(DATA_DIR, 'industries');
const INDUSTRY_DATA_COLLECT_COOLDOWN_MS = 30000; // 30 seconds
let lastIndustryCollection = 0;

app.post('/api/industry-data/collect', async (req, res) => {
  if (Date.now() - lastIndustryCollection < INDUSTRY_DATA_COLLECT_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Wait 30 seconds between collection requests.' });
  }
  lastIndustryCollection = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  // Ensure industries directory exists
  if (!fs.existsSync(INDUSTRY_DATA_DIR)) {
    fs.mkdirSync(INDUSTRY_DATA_DIR, { recursive: true });
  }

  // Load all industries data
  let industries = [];
  try {
    if (fs.existsSync(ALL_INDUSTRIES_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALL_INDUSTRIES_CACHE_FILE, 'utf8'));
      industries = data.industries || [];
    }
  } catch (error) {
    send({ error: 'Failed to load industries data' });
    res.end();
    return;
  }

  if (industries.length === 0) {
    send({ error: 'No industries data available. Run "Fetch all industries" first.' });
    res.end();
    return;
  }

  // Filter test mode if requested
  const testMode = req.body?.testMode === true;
  if (testMode) {
    industries = industries.slice(0, 5);
    send({ message: 'Test mode: processing first 5 industries only' });
  }

  send({ message: `Starting collection for ${industries.length} industries...`, total: industries.length });

  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  // Process industries in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < industries.length; i += batchSize) {
    const batch = industries.slice(i, Math.min(i + batchSize, industries.length));
    
    for (let j = 0; j < batch.length; j++) {
      const industry = batch[j];
      const index = i + j + 1;
      
      try {
        const symbol = industry.symbol;
        const filename = `${symbol.replace('^', '')}_1y.json`;
        const filepath = path.join(INDUSTRY_DATA_DIR, filename);

        // Check if we already have this data
        if (fs.existsSync(filepath)) {
          send({ 
            industry: industry.name, 
            symbol, 
            status: 'already_exists', 
            index, 
            total: industries.length 
          });
          processed++;
          continue;
        }

        send({ 
          industry: industry.name, 
          symbol, 
          status: 'fetching', 
          index, 
          total: industries.length 
        });

        // Fetch 1 year of daily bars
        let bars = getBarsFromFile(symbol, fromStr, toStr, '1d');
        if (!bars) {
          bars = await getBars(symbol, fromStr, toStr, '1d');
          saveBarsToFile(symbol, fromStr, toStr, bars, '1d');
        }

        if (!bars || bars.length === 0) {
          failed++;
          send({ 
            industry: industry.name, 
            symbol, 
            status: 'failed', 
            error: 'No data returned', 
            index, 
            total: industries.length 
          });
        } else {
          successful++;
          
          // Create comprehensive industry data file
          const industryData = {
            industry: industry.name,
            sector: industry.sector,
            symbol: symbol,
            url: industry.url,
            dateRange: { from: fromStr, to: toStr },
            periods: bars.length,
            performance: {
              ytd: computeYtdFromBars(bars, to.getFullYear()),
              return1Y: computePctChange(bars),
              return6Mo: computeChange6MoFrom1YBars(bars),
              return3Mo: computeChange3MoFrom1YBars(bars)
            },
            data: {
              openPrice: bars[0]?.o || null,
              closePrice: bars[bars.length - 1]?.c || null,
              high52w: Math.max(...bars.map(b => b.h)),
              low52w: Math.min(...bars.map(b => b.l)),
              volatility: computeVolatility(bars)
            },
            metadata: {
              collectedAt: new Date().toISOString(),
              source: 'Yahoo Finance'
            }
          };

          fs.writeFileSync(filepath, JSON.stringify(industryData, null, 2));
          
          send({ 
            industry: industry.name, 
            symbol, 
            status: 'success', 
            periods: bars.length, 
            index, 
            total: industries.length,
            performance: industryData.performance
          });
        }
        
        processed++;
        
      } catch (error) {
        failed++;
        send({ 
          industry: industry.name, 
          symbol: industry.symbol, 
          status: 'error', 
          error: error.message, 
          index: i + j + 1, 
          total: industries.length 
        });
      }
    }

    // Rate limiting between batches
    if (i + batchSize < industries.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const summary = {
    total: industries.length,
    processed,
    successful,
    failed: failed + (industries.length - processed),
    timestamp: new Date().toISOString()
  };

  send({ done: true, summary });
  res.end();
});

// ========== BACKTEST ENDPOINTS ==========

// List available backtest snapshots
app.get('/api/backtest/snapshots', (req, res) => {
  try {
    const snapshots = listScanSnapshots();
    res.json({ snapshots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get specific snapshot
app.get('/api/backtest/snapshot/:date', (req, res) => {
  try {
    const snapshot = loadScanSnapshot(req.params.date);
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    res.json(snapshot);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run backtest for a specific snapshot
app.post('/api/backtest/run', async (req, res) => {
  const { scanDate, daysForward = 30 } = req.body;
  
  if (!scanDate) {
    return res.status(400).json({ error: 'scanDate is required' });
  }
  
  try {
    console.log(`\n🧪 Starting backtest: ${scanDate}, ${daysForward} days forward`);
    
    const result = await runBacktest(scanDate, daysForward);
    
    if (result.error) {
      return res.json(result); // Return error info (like not enough time elapsed)
    }
    
    res.json(result);
  } catch (e) {
    console.error('Backtest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Helper function to compute volatility
function computeVolatility(bars) {
  if (!bars || bars.length < 2) return null;
  
  const dailyReturns = [];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].c;
    const currentClose = bars[i].c;
    const dailyReturn = (currentClose - prevClose) / prevClose;
    dailyReturns.push(dailyReturn);
  }
  
  const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);
  
  // Annualized volatility
  return Math.round(stdDev * Math.sqrt(252) * 1000) / 10;
}

// Serve built frontend when dist exists (e.g. after npm run build)
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
  console.log('Serving static app from dist/');
}

app.listen(PORT, () => {
  console.log(`Stock screener at http://localhost:${PORT}`);
});
