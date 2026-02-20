/**
 * Express server: API + frontend (Vite in dev, static dist in prod). Caches API data to flat JSON files.
 * Loads .env from project root. Yahoo Finance for bars (no API key); Massive only for populate-tickers.
 * Dev: npm run dev → one process on 5173 (API + Vite HMR). Prod: npm run serve (build + serve on PORT).
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
import { computeEnhancedScore, rankIndustries } from './enhancedScan.js';
import { fetchIndustrialsFromYahoo, fetchAllIndustriesFromYahoo, fetchSectorsFromYahoo, fetchIndustryReturns, industryPageUrl } from './industrials.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName, getRequiredIndustries } from './tradingViewIndustry.js';
import { listScanSnapshots, runBacktest, loadScanSnapshot } from './backtest.js';
import { generateOpus45Signal, findOpus45Signals, checkExitSignal, getSignalStats, DEFAULT_WEIGHTS } from './opus45Signal.js';
import { loadOptimizedWeights, runLearningPipeline, getLearningStatus, applyWeightChanges, resetWeightsToDefault } from './opus45Learning.js';
import { runRetroBacktest, getTickersForBacktest } from './retroBacktest.js';
import { loadCurrentRegime, loadRegimeBacktest } from './regimeHmm.js';
import { loadTickers as loadTickersFromDb, saveTickers as saveTickersToDb } from './db/tickers.js';
import { loadFundamentals as loadFundamentalsFromDb, saveFundamentals as saveFundamentalsToDb } from './db/fundamentals.js';
import { loadScanResults as loadScanResultsFromDb, saveScanResults as saveScanResultsToDb } from './db/scanResults.js';
import { getBars as getBarsFromDb, saveBars as saveBarsToDb } from './db/bars.js';
import { loadIndustryCache, saveIndustryCache } from './db/industry.js';
import { loadOpus45Signals as loadOpus45SignalsFromDb, saveOpus45Signals as saveOpus45SignalsToDb } from './db/opus45.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
// Trade Journal system for logging and learning from real trades
import { 
  loadTrades, 
  getAllTrades, 
  getTradesByStatus, 
  getTradeById, 
  createTrade, 
  updateTrade, 
  closeTrade, 
  deleteTrade, 
  checkAutoExits,
  generateLearningFeedback,
  getTradeStats 
} from './trades.js';
import { chatWithMinervini } from './minerviniAgent.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');

// Cache TTL: how long to use saved bar data before refetching (default 24h)
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

app.use(cors());
app.use(express.json());

// On Vercel without Supabase, writes cannot persist (read-only filesystem). With Supabase, POSTs write to DB.
app.use((req, res, next) => {
  if (process.env.VERCEL && !isSupabaseConfigured() && req.method === 'POST' && req.path.startsWith('/api')) {
    return res.status(503).json({
      error: 'Writes are disabled on Vercel (read-only filesystem). Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars, or run the API locally / set VITE_API_URL to an external API.',
    });
  }
  next();
});

function ensureDirs() {
  if (process.env.VERCEL) return; // Vercel serverless: read-only filesystem (no data/ writes)
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}
ensureDirs();

/** Wrappers that delegate to db layer (Supabase when configured, else files) */
async function loadFundamentals() {
  return loadFundamentalsFromDb();
}
function loadFundamentalsFilteredSync(raw) {
  const filtered = {};
  for (const [ticker, entry] of Object.entries(raw || {})) {
    const hasCompanyName = entry?.companyName && String(entry.companyName).trim();
    if (entry && 'industry' in entry && 'profitMargin' in entry && 'operatingMargin' in entry && hasCompanyName) {
      filtered[ticker] = entry;
    }
  }
  return filtered;
}

// ---------- API ----------

// Cached fundamentals (% held by inst, qtr earnings YoY)
app.get('/api/fundamentals', async (req, res) => {
  try {
    res.json(await loadFundamentals());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single-ticker fundamentals (from cache; use POST /api/fundamentals/fetch to populate)
app.get('/api/fundamentals/:ticker', async (req, res) => {
  try {
    const ticker = String(req.params.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
    const all = await loadFundamentals();
    const f = all[ticker] || null;
    res.json(f ? { ticker, ...f } : { ticker, pctHeldByInst: null, qtrEarningsYoY: null, profitMargin: null, operatingMargin: null, industry: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Minervini AI coach: chat with SEPA/CANSLIM expert persona. Body: { messages: [{ role, content }] }.
app.post('/api/chat', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'Minervini coach is disabled. Set ANTHROPIC_API_KEY in .env to enable.',
      });
    }
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Request body must include messages: [{ role, content }].' });
    }
    const reply = await chatWithMinervini(messages);
    res.json({ message: reply });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Chat failed.' });
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
  const fullCache = await loadFundamentals();
  const filteredForCheck = loadFundamentalsFilteredSync(fullCache);
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
  await saveFundamentalsToDb(fullCache);
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

/** Load scan results (DB or file), optionally filtered by tickers. */
async function loadScanData() {
  const data = await loadScanResultsFromDb();
  if (!data || !data.results?.length) return { ...data, results: data?.results ?? [], totalTickers: 0, vcpBullishCount: 0 };
  const tickers = await loadTickersFromDb();
  const tickerSet = new Set(tickers);
  const results = tickerSet.size > 0 ? data.results.filter((r) => tickerSet.has((r.ticker || '').toUpperCase())) : data.results;
  const vcpBullishCount = results.filter((r) => r.vcpBullish).length;
  return { ...data, results, totalTickers: results.length, vcpBullishCount };
}

// Latest scan results. Filtered to tickers in tickers.txt (source of truth).
// When ?includeOpus=true (default), merges Opus4.5 scores into each result for unified payload.
app.get('/api/scan-results', async (req, res) => {
  try {
    const data = await loadScanData();
    const includeOpus = req.query.includeOpus !== 'false';

    if (!data.scannedAt || !data.results?.length) {
      return res.json({ scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0, opus45Signals: [], opus45Stats: null });
    }

    if (!includeOpus) {
      return res.json(data);
    }

    // Load Opus4.5 cache and merge scores into each result
    const cached = await loadOpus45SignalsFromDb();
    let opus45Signals = [];
    let opus45Stats = null;
    const opusByTicker = new Map();

    if (cached?.signals?.length >= 0) {
      await enrichCachedSignalsWithCurrentPrice(cached.signals);
      opus45Signals = cached.signals;
      opus45Stats = cached.stats ?? getSignalStats(cached.signals);
      const allScores = mapCachedSignalsToAllScores(cached.signals);
      allScores.forEach((s) => opusByTicker.set(s.ticker, {
        opus45Confidence: s.opus45Confidence,
        opus45Grade: s.opus45Grade,
        entryDate: s.entryDate,
        daysSinceBuy: s.daysSinceBuy,
        pctChange: s.pctChange,
        entryPrice: s.entryPrice,
        stopLossPrice: s.stopLossPrice,
        riskRewardRatio: s.riskRewardRatio,
      }));
    }

    const resultsWithOpus = data.results.map((r) => {
      const opus = opusByTicker.get(r.ticker);
      return {
        ...r,
        opus45Confidence: opus?.opus45Confidence ?? 0,
        opus45Grade: opus?.opus45Grade ?? 'F',
        ...(opus?.entryDate != null || opus?.daysSinceBuy != null ? {
          entryDate: opus.entryDate,
          daysSinceBuy: opus.daysSinceBuy,
          pctChange: opus.pctChange,
          entryPrice: opus.entryPrice,
          stopLossPrice: opus.stopLossPrice,
          riskRewardRatio: opus.riskRewardRatio,
        } : {}),
      };
    });

    res.json({
      ...data,
      results: resultsWithOpus,
      opus45Signals,
      opus45Stats,
    });
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
        await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted });
      }
    }

    const sorted = results.sort((a, b) => {
      const aE = a.enhancedScore ?? a.score ?? 0;
      const bE = b.enhancedScore ?? b.score ?? 0;
      return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
    });
    await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: results.length, vcpBullishCount, results: sorted });

    // Save backtest snapshot for future learning (needs 30+ days to run backtest)
    try {
      const { saveScanSnapshot } = await import('./backtest.js');
      await saveScanSnapshot(sorted, new Date());
    } catch (e) {
      console.warn('Could not save backtest snapshot:', e.message);
    }
    
    // Compute and cache Opus4.5 scores immediately after scan completes
    // This runs in background so dashboard loads instantly
    console.log('Opus4.5: Computing scores after scan...');
    await computeAndSaveOpus45Scores();
    
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

// Cron-only endpoint: trigger full scan (e.g. from Supabase Cron). Returns 202 immediately; scan runs in background.
// Auth: set CRON_SECRET in .env; caller must send Authorization: Bearer <CRON_SECRET> or x-cron-secret: <CRON_SECRET>.
// Schedule in Supabase: Database → Cron → New job → HTTP request → POST to https://YOUR_API_URL/api/cron/scan at 5 PM CST (23:00 UTC).
app.post('/api/cron/scan', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = req.headers['x-cron-secret'] || bearer;
  if (secret && headerSecret !== secret) {
    return res.status(401).json({ error: 'Invalid or missing cron secret' });
  }
  if (activeScan.running) {
    return res.status(202).json({
      ok: true,
      message: 'Scan already in progress',
      scanId: activeScan.id,
      progress: activeScan.progress
    });
  }
  if (Date.now() - lastScanStarted < SCAN_COOLDOWN_MS) {
    return res.status(202).json({ ok: true, message: 'Scan run recently; skipped to avoid overlap' });
  }
  lastScanStarted = Date.now();
  activeScan.id = generateScanId();
  activeScan.running = true;
  activeScan.progress = { index: 0, total: 0, vcpBullishCount: 0, startedAt: new Date().toISOString(), completedAt: null };
  activeScan.results = [];

  // Run full scan in background (same as /api/scan but no SSE)
  (async () => {
    try {
      const { runScanStream } = await import('./scan.js');
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 180);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const results = [];
      let vcpBullishCount = 0;
      for await (const { result, index, total } of runScanStream()) {
        results.push(result);
        activeScan.results.push(result);
        if (result.vcpBullish) vcpBullishCount++;
        activeScan.progress.index = index;
        activeScan.progress.total = total;
        activeScan.progress.vcpBullishCount = vcpBullishCount;
        if (results.length % 25 === 0 || results.length === total) {
          const sorted = [...results].sort((a, b) => {
            const aE = a.enhancedScore ?? a.score ?? 0;
            const bE = b.enhancedScore ?? b.score ?? 0;
            return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
          });
          await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted });
        }
      }
      const sorted = results.sort((a, b) => {
        const aE = a.enhancedScore ?? a.score ?? 0;
        const bE = b.enhancedScore ?? b.score ?? 0;
        return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
      });
      await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: results.length, vcpBullishCount, results: sorted });
      try {
        const { saveScanSnapshot } = await import('./backtest.js');
        await saveScanSnapshot(sorted, new Date());
      } catch (e) {
        console.warn('Could not save backtest snapshot:', e.message);
      }
      console.log('Opus4.5: Computing scores after cron scan...');
      await computeAndSaveOpus45Scores();
      activeScan.running = false;
      activeScan.progress.completedAt = new Date().toISOString();
      console.log('Cron scan completed:', results.length, 'tickers,', vcpBullishCount, 'VCP bullish');
    } catch (e) {
      console.error('Cron scan failed:', e);
      activeScan.running = false;
      activeScan.progress.completedAt = new Date().toISOString();
    }
  })();

  res.status(202).json({
    ok: true,
    started: true,
    scanId: activeScan.id,
    message: 'Scan started in background (runs every 24h after 5 PM CST via Supabase Cron)'
  });
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

  let bars = null;
  try {
    bars = await getBarsFromDb(ticker, fromStr, toStr, interval);
  } catch (_) {
    // Supabase not configured or DB error: fall back to Yahoo below
  }
  if (!bars) {
    try {
      bars = await getBars(ticker, fromStr, toStr, interval);
      try {
        await saveBarsToDb(ticker, fromStr, toStr, bars, interval);
      } catch (_) {
        // Save failed (e.g. no Supabase); response still valid
      }
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  // lightweight-charts requires asc by time; Yahoo can return unsorted
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  res.json({ ticker, from: fromStr, to: toStr, interval, results: sorted });
});

// S&P 500 (^GSPC) bars for Relative Strength calculation. Cached like other tickers.
app.get('/api/spx/bars', async (req, res) => {
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

  const spxTicker = '^GSPC';
  let bars = await getBarsFromDb(spxTicker, fromStr, toStr, interval);
  if (!bars) {
    try {
      bars = await getBars(spxTicker, fromStr, toStr, interval);
      await saveBarsToDb(spxTicker, fromStr, toStr, bars, interval);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  // lightweight-charts requires asc by time; Yahoo can return unsorted
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  res.json({ ticker: spxTicker, from: fromStr, to: toStr, interval, results: sorted });
});

/**
 * Resolve industry name to Yahoo index symbol (e.g. "Semiconductors" -> "^YH31130020").
 * Uses all-industries from DB; fallback: data/industries/*.json (not migrated).
 */
async function getIndustrySymbolByName(industryName) {
  if (!industryName || typeof industryName !== 'string') return null;
  const name = industryName.trim();
  if (!name) return null;
  // 1. Prefer all-industries from DB
  try {
    const data = await loadIndustryCache('all-industries');
    if (data?.industries?.length) {
      const industries = data.industries;
      const exact = industries.find((ind) => ind.name && ind.name.trim() === name);
      if (exact?.symbol) return exact.symbol;
      const lower = name.toLowerCase();
      const fuzzy = industries.find((ind) => ind.name && ind.name.trim().toLowerCase() === lower);
      if (fuzzy?.symbol) return fuzzy.symbol;
    }
  } catch (e) {
    console.error('getIndustrySymbolByName: all-industries read failed', e.message);
  }
  // 2. Fallback: industry data files in data/industries (from industry-data/collect)
  if (fs.existsSync(INDUSTRY_DATA_DIR)) {
    try {
      const files = fs.readdirSync(INDUSTRY_DATA_DIR).filter((f) => f.endsWith('_1y.json'));
      for (const f of files) {
        const raw = JSON.parse(fs.readFileSync(path.join(INDUSTRY_DATA_DIR, f), 'utf8'));
        if (raw.industry && raw.industry.trim() === name && raw.symbol) return raw.symbol;
      }
    } catch (e) {
      console.error('getIndustrySymbolByName: industries dir read failed', e.message);
    }
  }
  return null;
}

// OHLC bars for an industry by name (12 months default). Uses Yahoo industry index symbol; same format as /api/bars/:ticker.
app.get('/api/industry-bars', async (req, res) => {
  const industryName = req.query.industry;
  if (!industryName) {
    return res.status(400).json({ error: 'Query "industry" (industry name) is required.' });
  }
  const symbol = await getIndustrySymbolByName(industryName);
  if (!symbol) {
    return res.status(404).json({
      error: `No symbol found for industry "${industryName}". Run "Fetch all industries" from the Industry page to populate industry symbols.`,
      industry: industryName,
      results: [],
    });
  }
  let interval = req.query.interval;
  if (Array.isArray(interval)) interval = interval[0];
  const intervalStr = String(interval || '').toLowerCase();
  interval = ['1d', '1wk', '1mo'].includes(intervalStr) ? intervalStr : '1d';
  let days = Number(req.query.days) || 365;
  if (interval === '1wk') days = Math.max(days, 730);
  if (interval === '1mo') days = Math.max(days, 1825);
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  let bars = await getBarsFromDb(symbol, fromStr, toStr, interval);
  if (!bars || bars.length === 0) {
    try {
      bars = await getBars(symbol, fromStr, toStr, interval);
      if (bars && bars.length > 0) await saveBarsToDb(symbol, fromStr, toStr, bars, interval);
    } catch (e) {
      return res.status(502).json({ error: e.message, industry: industryName, symbol, results: [] });
    }
  }
  const sorted = bars && bars.length ? [...bars].sort((a, b) => a.t - b.t) : [];
  res.json({ industry: industryName, symbol, from: fromStr, to: toStr, interval, results: sorted });
});

// Industry summary with 3-month price trend. Groups scan-result tickers by industry, computes % change from bars.
async function getBarsForTrend(ticker, fromStr, toStr) {
  const bars = await getBarsFromDb(ticker, fromStr, toStr, '1d');
  if (bars && bars.length >= 2) return bars;
  return null;
}

/** Fetch bars from Yahoo when file cache misses. Saves to file for future use. */
async function fetchBarsForTrend(ticker, fromStr, toStr) {
  let bars = await getBarsForTrend(ticker, fromStr, toStr);
  if (bars && bars.length >= 2) return bars;
  try {
    bars = await getBars(ticker, fromStr, toStr, '1d');
    if (bars && bars.length >= 2) {
      saveBarsToDb(ticker, fromStr, toStr, bars, '1d');
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
    let bars = await getBarsFromDb(symbol, fromStr365, toStr, '1d');
    if (!bars || bars.length < 2) {
      bars = await getBars(symbol, fromStr365, toStr, '1d');
      if (bars && bars.length >= 2) {
        await saveBarsToDb(symbol, fromStr365, toStr, bars, '1d');
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

  const scanData = await loadScanData();
  if (!scanData.results?.length) {
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

  const results = scanData.results || [];
  const fundamentals = await loadFundamentals();

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
  await saveFundamentalsToDb(fundamentals);

  const industriesCount = new Set(
    Object.values(fundamentals).filter((e) => e && e.industry).map((e) => e.industry)
  ).size;

  // 2. Fetch 365-day bars for tickers missing data (used for both 3M and 1Y return)
  const needBars = [];
  for (const r of results) {
    const b = await getBarsForTrend(r.ticker, fromStr365, toStr);
    if (!b) needBars.push(r);
  }
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


  send({
    done: true,
    fundamentalsFetched,
    fundamentalsFailed,
    fundamentalsTotal: needFundamentals.length,
    barsFetched,
    barsFailed,
    barsTotal: needBars.length,
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
app.get('/api/industrials', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const data = await loadIndustryCache('industrials');
    if (!data) {
      return res.json({ industries: [], fetchedAt: null, source: null });
    }
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
    const scanDataIndustrials = await loadScanData();
    const hasFundamentals = true; // DB has fundamentals when Supabase configured
    if (scanDataIndustrials.results?.length && hasFundamentals) {
      const results = scanDataIndustrials.results || [];
      const fundamentals = await loadFundamentals();
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
        const with6Mo = [];
        for (const r of tickers) {
          const bars = await getBarsForTrend(r.ticker, fromStr365, toStr);
          const v = bars ? computeChange6MoFrom1YBars(bars) : null;
          if (v != null) with6Mo.push(v);
        }
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
    await saveIndustryCache('industrials', payload);
    send({ done: true, payload });
  } catch (e) {
    console.error('Industrials fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// ---------- All Industries (all 11 sectors, ~145 industries) ----------
// GET: return cached all industries with tickers from scan results
app.get('/api/all-industries', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    let data = await loadIndustryCache('all-industries');
    if (!data) {
      return res.json({ industries: [], fetchedAt: null, source: null });
    }
    // Build ticker → companyName map from fundamentals for hover tooltips on Industry page
    let tickerNames = {};
    try {
      const fundamentals = await loadFundamentals();
      for (const [ticker, entry] of Object.entries(fundamentals)) {
        const name = entry?.companyName && String(entry.companyName).trim();
        if (name) tickerNames[ticker] = name;
      }
      data.tickerNames = tickerNames;
    } catch (e) {
      data.tickerNames = {};
    }

    // Add tickers and industryRank from scan results to each industry
    const scanDataAllInd = await loadScanData();
    if (scanDataAllInd.results?.length) {
      try {
        const tickersByIndustry = {};
        const ranksByIndustry = {};
        
        // Group tickers and ranks by industry name
        if (scanDataAllInd.results && Array.isArray(scanDataAllInd.results)) {
          scanDataAllInd.results.forEach((result) => {
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
    try {
      const scanData = await loadScanResultsFromDb();
        if (scanData.results && Array.isArray(scanData.results)) {
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
      }
    } catch (scanErr) {
      console.error('Error loading scan results for tickers:', scanErr);
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
    await saveIndustryCache('all-industries', payload);
    send({ done: true, payload });
  } catch (e) {
    console.error('All industries fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// ---------- Industry (TradingView Scanner API) ----------
// Fetches sector/industry from TradingView's scanner (scanner.tradingview.com/america/scan).
// Columns 'sector' and 'industry' come from scanner.qf.json; we aggregate by industry and attach tickers.
// No official REST API for "industry list" — we derive it from scanning stocks with sector/industry columns.
const TRADINGVIEW_SCANNER_URL = 'https://scanner.tradingview.com/america/scan';
const TV_SCAN_PAGE_SIZE = 250;
const TV_SCAN_MAX_PAGES = 40; // 250*40 = 10k symbols max

app.get('/api/industry-tradingview', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const columns = [
      'name', 'sector', 'industry', 'close', 'market_cap_basic',
      'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.YTD', 'Perf.Y',
    ];
    const allRows = [];
    for (let page = 0; page < TV_SCAN_MAX_PAGES; page++) {
      const start = page * TV_SCAN_PAGE_SIZE;
      const body = {
        filter: [
          { left: 'type', operation: 'equal', right: 'stock' },
          { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
        ],
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
      if (!scanRes.ok) {
        throw new Error(`TradingView scanner HTTP ${scanRes.status}`);
      }
      const scanJson = await scanRes.json();
      const data = scanJson.data || [];
      for (const row of data) {
        const symbol = row.s;
        const values = row.d;
        if (!values || values.length < 5) continue;
        const name = values[0];
        const sector = values[1];
        const industry = values[2];
        const close = values[3];
        const marketCap = values[4];
        const toNum = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
        const perf1M = toNum(values[5]);
        const perf3M = toNum(values[6]);
        const perf6M = toNum(values[7]);
        const perfYTD = toNum(values[8]);
        const perf1Y = toNum(values[9]);
        if (!industry || (typeof industry === 'string' && industry.trim() === '')) continue;
        allRows.push({
          symbol,
          name: name ?? null,
          sector: sector ?? null,
          industry: industry ?? null,
          close: close ?? null,
          market_cap_basic: marketCap ?? null,
          perf1M,
          perf3M,
          perf6M,
          perfYTD,
          perf1Y,
        });
      }
      if (data.length < TV_SCAN_PAGE_SIZE) break;
    }

    // Aggregate by sector + industry: tickers + average performance (1M, 3M, 6M, YTD, 1Y)
    const byKey = new Map();
    for (const row of allRows) {
      const sector = row.sector || 'Unknown';
      const industry = row.industry || 'Unknown';
      const key = `${sector}|${industry}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          sector,
          industry,
          tickers: [],
          count: 0,
          sum1M: 0, sum3M: 0, sum6M: 0, sumYTD: 0, sum1Y: 0,
          n1M: 0, n3M: 0, n6M: 0, nYTD: 0, n1Y: 0,
        });
      }
      const rec = byKey.get(key);
      const ticker = row.symbol ? row.symbol.split(':').pop() : null;
      if (ticker) rec.tickers.push(ticker);
      rec.count++;
      if (row.perf1M != null) { rec.sum1M += row.perf1M; rec.n1M++; }
      if (row.perf3M != null) { rec.sum3M += row.perf3M; rec.n3M++; }
      if (row.perf6M != null) { rec.sum6M += row.perf6M; rec.n6M++; }
      if (row.perfYTD != null) { rec.sumYTD += row.perfYTD; rec.nYTD++; }
      if (row.perf1Y != null) { rec.sum1Y += row.perf1Y; rec.n1Y++; }
    }

    const industries = Array.from(byKey.values())
      .map((r) => ({
        name: r.industry,
        sector: r.sector,
        tickers: r.tickers,
        count: r.count,
        url: 'https://www.tradingview.com/screener/',
        perf1M: r.n1M > 0 ? Math.round(r.sum1M / r.n1M * 100) / 100 : null,
        perf3M: r.n3M > 0 ? Math.round(r.sum3M / r.n3M * 100) / 100 : null,
        perf6M: r.n6M > 0 ? Math.round(r.sum6M / r.n6M * 100) / 100 : null,
        perfYTD: r.nYTD > 0 ? Math.round(r.sumYTD / r.nYTD * 100) / 100 : null,
        perf1Y: r.n1Y > 0 ? Math.round(r.sum1Y / r.n1Y * 100) / 100 : null,
      }))
      .sort((a, b) => a.sector.localeCompare(b.sector) || a.name.localeCompare(b.name));

    res.json({
      industries,
      source: 'tradingview',
      fetchedAt: new Date().toISOString(),
      totalSymbols: allRows.length,
    });
  } catch (e) {
    console.error('TradingView industry fetch failed:', e);
    res.status(500).json({ error: e.message, source: 'tradingview' });
  }
});

// ---------- Sectors (11 sectors from https://finance.yahoo.com/sectors/) ----------
app.get('/api/sectors', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const data = await loadIndustryCache('sectors');
    if (!data) {
      return res.json({ sectors: [], fetchedAt: null, source: null });
    }
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
    await saveIndustryCache('sectors', payload);
    send({ done: true, payload });
  } catch (e) {
    console.error('Sectors fetch failed:', e);
    send({ done: true, error: e.message });
  }
  res.end();
});

// ---------- Industry trend (scan-based); returns from TradingView only ----------
app.get('/api/industry-trend', async (req, res) => {
  // Allow browser caching for 5 minutes (server uses stale-while-revalidate internally)
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  try {
    const [fundamentals, scanData] = await Promise.all([loadFundamentals(), loadScanData()]);
    if (!scanData.results?.length) {
      return res.json({ industries: [], scannedAt: null, source: 'tradingview' });
    }
    const results = scanData.results || [];

    const byIndustry = new Map();
    for (const r of results) {
      const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind).push(r);
    }

    // Industry returns from TradingView scanner (3M, 6M, 1Y, YTD).
    // OPTIMIZATION: Pass requiredIndustries for early exit - stops fetching when all needed industries found
    const requiredIndustries = getRequiredIndustries(fundamentals);
    const { 
      returnsMap: tvReturnsByIndustry, 
      tickerToTvIndustry, 
      fromCache, 
      cacheAge,
      stale 
    } = await fetchTradingViewIndustryReturns({ requiredIndustries });

    const industries = [];
    for (const [industry, tickers] of byIndustry.entries()) {
      // Accumulate returns by looking up each ticker's TradingView industry name,
      // then averaging (handles many-to-one and one-to-many Yahoo↔TV mappings).
      const acc = { s3M: 0, n3M: 0, s6M: 0, n6M: 0, s1Y: 0, n1Y: 0, sYTD: 0, nYTD: 0 };
      for (const r of tickers) {
        const tvIndName = tickerToTvIndustry.get(r.ticker);
        const tv = tvIndName ? tvReturnsByIndustry.get(normalizeIndustryName(tvIndName)) : null;
        if (!tv) continue;
        if (tv.perf3M != null) { acc.s3M += tv.perf3M; acc.n3M++; }
        if (tv.perf6M != null) { acc.s6M += tv.perf6M; acc.n6M++; }
        if (tv.perf1Y != null) { acc.s1Y += tv.perf1Y; acc.n1Y++; }
        if (tv.perfYTD != null) { acc.sYTD += tv.perfYTD; acc.nYTD++; }
      }
      // Fall back to exact name match for industries where Yahoo/TV names happen to match
      const fallback = tvReturnsByIndustry.get(normalizeIndustryName(industry));
      const round2 = (v) => Math.round(v * 100) / 100;
      const industryAvg3Mo = acc.n3M > 0 ? round2(acc.s3M / acc.n3M) : (fallback?.perf3M ?? null);
      const industryAvg6Mo = acc.n6M > 0 ? round2(acc.s6M / acc.n6M) : (fallback?.perf6M ?? null);
      const industryAvg1Y  = acc.n1Y > 0 ? round2(acc.s1Y / acc.n1Y) : (fallback?.perf1Y ?? null);
      const industryYtd    = acc.nYTD > 0 ? round2(acc.sYTD / acc.nYTD) : (fallback?.perfYTD ?? null);
      const withTrend = tickers.map((r) => ({
        ticker: r.ticker,
        lastClose: r.lastClose,
        change3mo: null,
        change6mo: null,
        change1y: null,
        ytd: null,
        score: r.score,
      }));
      industries.push({ industry, tickers: withTrend, industryAvg3Mo, industryAvg6Mo, industryAvg1Y, industryYtd });
    }
    industries.sort((a, b) => a.industry.localeCompare(b.industry));
    
    // Include cache metadata in response for debugging
    const response = { 
      industries, 
      scannedAt: scanData.scannedAt, 
      source: 'tradingview',
      cached: fromCache,
      cacheAge: cacheAge ?? 0,
      stale: stale ?? false,
    };
    
    res.json(response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// VCP analysis for one ticker: bars from file cache or API, then VCP + enhanced score (same as scan).
// Use 180 days to match the full scan so we have 60+ bars (required for scoring).
app.get('/api/vcp/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 180);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  try {
    let bars = await getBarsFromDb(ticker, fromStr, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr, toStr, '1d');
      await saveBarsToDb(ticker, fromStr, toStr, bars, '1d');
    }
    const vcp = checkVCP(bars);
    // Always attach enhanced score when we have fundamentals + industry data (TradingView returns)
    let payload = { ticker, ...vcp, barCount: bars.length };
    try {
      const fundamentals = await loadFundamentals();
      const fund = fundamentals[ticker] || null;
      const industryNames = fund?.industry ? [fund.industry] : [];
      const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns();
      const industryReturns = buildIndustryReturnsFromTVMap(tvMap, industryNames);
      const industryRanksMap = rankIndustries(industryReturns);
      const industryData = fund?.industry && industryRanksMap[fund.industry] ? industryRanksMap[fund.industry] : null;
      const enhanced = computeEnhancedScore(vcp, bars, fund, industryData, industryRanksMap);
      payload = { ...payload, ...enhanced };
    } catch (enhanceErr) {
      // Non-fatal: keep base vcp; enhanced fields omitted
    }
    res.json(payload);
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

  // Vercel: no persistent filesystem; skip industry file writes
  if (process.env.VERCEL) {
    return res.status(503).json({ error: 'Industry data collection writes to disk. Run locally or use VITE_API_URL to an external API.' });
  }
  if (!fs.existsSync(INDUSTRY_DATA_DIR)) {
    fs.mkdirSync(INDUSTRY_DATA_DIR, { recursive: true });
  }

  // Load all industries data
  let industries = [];
  try {
    const data = await loadIndustryCache('all-industries');
    if (data?.industries?.length) industries = data.industries;
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
        let bars = await getBarsFromDb(symbol, fromStr, toStr, '1d');
        if (!bars) {
          bars = await getBars(symbol, fromStr, toStr, '1d');
          await saveBarsToDb(symbol, fromStr, toStr, bars, '1d');
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
app.get('/api/backtest/snapshots', async (req, res) => {
  try {
    const snapshots = await listScanSnapshots();
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
  const { scanDate, daysForward = 30, topN = null } = req.body;
  
  if (!scanDate) {
    return res.status(400).json({ error: 'scanDate is required' });
  }
  
  try {
    const portfolioMsg = topN ? ` (top ${topN} stocks)` : '';
    console.log(`\n🧪 Starting backtest: ${scanDate}, ${daysForward} days forward${portfolioMsg}`);
    
    const result = await runBacktest(scanDate, daysForward, topN);
    
    if (result.error) {
      return res.json(result); // Return error info (like not enough time elapsed)
    }
    
    res.json(result);
  } catch (e) {
    console.error('Backtest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== RETROSPECTIVE BACKTESTING ==========

/**
 * Run retrospective backtest - looks back in time to find when signals
 * WOULD have triggered and measures actual forward returns.
 * This allows immediate backtesting over any historical period.
 */
app.post('/api/backtest/retro', async (req, res) => {
  const { 
    lookbackMonths = 12,   // How many months to look back
    holdingPeriod = 60,    // Max days to hold each trade
    topN = 100             // Limit to top N tickers (null = all)
  } = req.body;
  
  try {
    console.log(`\n🔄 Starting retrospective backtest: ${lookbackMonths} months, ${holdingPeriod}-day hold, top ${topN || 'all'} tickers`);
    
    // Get tickers from scan results or tickers.txt
    const tickers = await getTickersForBacktest();
    
    if (tickers.length === 0) {
      return res.status(400).json({ error: 'No tickers available. Run a scan first.' });
    }
    
    console.log(`  Found ${tickers.length} tickers to analyze`);
    
    const result = await runRetroBacktest({
      tickers,
      lookbackMonths,
      holdingPeriod,
      topN
    });
    
    res.json(result);
  } catch (e) {
    console.error('Retrospective backtest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== OPUS4.5 SIGNAL ENDPOINTS ==========

/**
 * Compute Opus4.5 scores for all tickers and save to cache.
 * Called after scan completes to pre-compute scores for instant dashboard load.
 */
async function computeAndSaveOpus45Scores() {
  try {
    const scanData = await loadScanData();
    if (!scanData.results?.length) {
      console.log('Opus4.5: No scan results to score.');
      return null;
    }
    const results = scanData.results || [];
    const [fundamentals, weights] = await Promise.all([loadFundamentals(), loadOptimizedWeights()]);
    const industryNames = [...new Set(results.map((r) => fundamentals[r.ticker]?.industry).filter(Boolean))];
    const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns();
    const industryReturns = buildIndustryReturnsFromTVMap(tvMap, industryNames);

    // Build bars map for each ticker (need 200+ days for Opus4.5)
    const barsByTicker = {};
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const resultsToAnalyze = results;

    // Collect tickers that need a bar fetch. Try Opus cache (_1d.json) first, then scan cache (.json).
    const needFetch = [];
    for (const r of resultsToAnalyze) {
      try {
        const safeTicker = r.ticker.replace(/[^A-Za-z0-9.-]/g, '_');
        let bars = null;
        // 1) DB cache
        bars = await getBarsFromDb(r.ticker, fromStr365, toStr, '1d');
        if (bars && bars.length >= 200) {
          barsByTicker[r.ticker] = [...bars].sort((a, b) => a.t - b.t);
        }
        if (!bars || bars.length < 200) needFetch.push(r);
      } catch (e) {
        console.error(`Error loading bars for ${r.ticker}:`, e.message);
      }
    }

    // Fetch missing bars in batches
    const BATCH_SIZE = 15;
    for (let i = 0; i < needFetch.length; i += BATCH_SIZE) {
      const chunk = needFetch.slice(i, i + BATCH_SIZE);
      const chunkPromises = chunk.map((r) =>
        getBars(r.ticker, fromStr365, toStr, '1d')
          .then((fetchedBars) => {
            if (fetchedBars && fetchedBars.length >= 200) {
              barsByTicker[r.ticker] = [...fetchedBars].sort((a, b) => a.t - b.t);
              saveBarsToDb(r.ticker, fromStr365, toStr, fetchedBars, '1d');
            }
          })
          .catch((e) => console.error(`Fetch failed for ${r.ticker}:`, e.message))
      );
      await Promise.all(chunkPromises);
      if (needFetch.length > BATCH_SIZE && i > 0 && i % 60 === 0) {
        console.log(`Opus4.5: Fetched bars for ${Math.min(i + BATCH_SIZE, needFetch.length)}/${needFetch.length} tickers...`);
      }
    }

    // Generate Opus4.5 signals and scores for every ticker
    const { signals, allScores } = findOpus45Signals(resultsToAnalyze, barsByTicker, fundamentals, industryReturns, weights);
    const stats = getSignalStats(signals);

    // Enrich each signal with currentPrice so when we serve from cache we can compute P/L for Open Trade column
    const signalsToCache = signals.map((s) => {
      const bars = barsByTicker[s.ticker];
      const currentPrice = bars?.length ? bars[bars.length - 1].c : null;
      return { ...s, currentPrice };
    });

    const cacheData = {
      signals: signalsToCache,
      allScores,
      total: signals.length,
      stats,
      scannedAt: scanData.scannedAt,
      computedAt: new Date().toISOString(),
      weightsVersion: weights._version || 'default',
      analyzedTickers: resultsToAnalyze.length,
      tickersWithBars: Object.keys(barsByTicker).length
    };

    await saveOpus45SignalsToDb({ signals: cacheData.signals, stats: cacheData.stats, total: cacheData.total, computedAt: cacheData.computedAt });
    console.log(`Opus4.5: Cached ${signals.length} active signals; ${allScores.length} tickers scored.`);
    
    return cacheData;
  } catch (e) {
    console.error('Opus4.5 compute error:', e);
    return null;
  }
}

// Map cached signal objects (entryDate may be ms number) to allScores shape for Dashboard Open Trade column.
// Dashboard expects entryDate as ISO date string and pctChange for P/L display.
function mapCachedSignalsToAllScores(cachedSignals) {
  if (!cachedSignals?.length) return [];
  return cachedSignals.map((s) => {
    const entryMs = s.entryDate != null
      ? (s.entryDate < 1e12 ? s.entryDate * 1000 : s.entryDate)
      : null;
    const entryDateIso = entryMs != null ? new Date(entryMs).toISOString().slice(0, 10) : (typeof s.entryDate === 'string' ? s.entryDate : null);
    let pctChange = s.pctChange;
    if (pctChange == null && s.entryPrice != null && s.currentPrice != null && s.entryPrice > 0) {
      pctChange = Math.round((s.currentPrice - s.entryPrice) / s.entryPrice * 1000) / 10;
    }
    return {
      ticker: s.ticker,
      opus45Confidence: s.opus45Confidence ?? 0,
      opus45Grade: s.opus45Grade ?? 'F',
      entryDate: entryDateIso,
      daysSinceBuy: s.daysSinceBuy,
      pctChange: pctChange ?? null,
      entryPrice: s.entryPrice ?? null,
      stopLossPrice: s.stopLossPrice ?? null,
      riskRewardRatio: s.riskRewardRatio ?? null,
    };
  });
}

// When serving from cache, signals may lack currentPrice (old cache or never set). Fetch latest close from bars so we can show P/L.
// Also set pctChange when we have entryPrice and currentPrice so Dashboard Open Trade column can display it.
async function enrichCachedSignalsWithCurrentPrice(signals) {
  const needPrice = signals.filter((s) => s.entryPrice != null && s.currentPrice == null && s.ticker);
  if (needPrice.length > 0) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);
    await Promise.all(
      needPrice.map(async (s) => {
        try {
          const bars = await getBarsFromDb(s.ticker, fromStr, toStr, '1d');
          if (bars?.length) {
            const sorted = [...bars].sort((a, b) => a.t - b.t);
            s.currentPrice = sorted[sorted.length - 1].c;
          }
        } catch (e) {
          // leave currentPrice null so P/L won't show for this ticker
        }
      })
    );
  }
  // Ensure pctChange is set for Open Trade display when we have both prices
  for (const s of signals) {
    if (s.pctChange == null && s.entryPrice != null && s.currentPrice != null && s.entryPrice > 0) {
      s.pctChange = Math.round((s.currentPrice - s.entryPrice) / s.entryPrice * 1000) / 10;
    }
  }
}

// Get all active Opus4.5 signals - reads from cache for instant load
// Use ?force=true to recalculate (called after scan)
app.get('/api/opus45/signals', async (req, res) => {
  try {
    const forceRecalc = req.query.force === 'true';
    
    if (!forceRecalc) {
      const cached = await loadOpus45SignalsFromDb();
      if (cached && cached.signals?.length >= 0) {
        await enrichCachedSignalsWithCurrentPrice(cached.signals);
        const allScores = mapCachedSignalsToAllScores(cached.signals);
        return res.json({ signals: cached.signals, allScores, total: cached.total ?? cached.signals?.length, stats: cached.stats, fromCache: true });
      }
    }
    
    // No cache or force recalc - compute fresh
    const scanData = await loadScanData();
  if (!scanData.results?.length) {
      return res.json({ signals: [], total: 0, stats: null, error: 'No scan results. Run a scan first.' });
    }
    
    const result = await computeAndSaveOpus45Scores();
    if (result) {
      res.json({ ...result, fromCache: false });
    } else {
      res.json({ signals: [], allScores: [], total: 0, stats: null, error: 'Failed to compute Opus4.5 scores' });
    }
  } catch (e) {
    console.error('Opus4.5 signals error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Debug endpoint: Analyze why top stocks don't qualify for Opus4.5
app.get('/api/opus45/debug', async (req, res) => {
  try {
    const scanData = await loadScanData();
    if (!scanData.results?.length) {
      return res.json({ error: 'No scan results' });
    }
    const results = scanData.results || [];
    const [fundamentals, weights] = await Promise.all([loadFundamentals(), loadOptimizedWeights()]);
    
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    
    const debugResults = [];
    
    // Analyze top 10 stocks
    for (const r of results.slice(0, 10)) {
      const debug = {
        ticker: r.ticker,
        enhancedScore: r.enhancedScore,
        relativeStrength: r.relativeStrength,
        contractions: r.contractions,
        pattern: r.pattern,
        patternConfidence: r.patternConfidence,
        atMa10: r.atMa10,
        atMa20: r.atMa20,
        industryRank: r.industryRank,
        barsLoaded: 0,
        signalResult: null
      };
      
      // Try to load bars from cache
      const safeTicker = r.ticker.replace(/[^A-Za-z0-9.-]/g, '_');
      const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}_1d.json`);
      
      let bars = null;
      if (fs.existsSync(filePath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          bars = raw.results || [];
          debug.barsLoaded = bars.length;
          debug.barsCacheFrom = raw.from;
          debug.barsCacheTo = raw.to;
        } catch (e) {
          debug.signalResult = { error: e.message };
        }
      }
      
      // Fetch fresh bars if cache is insufficient
      if (!bars || bars.length < 200) {
        try {
          debug.fetchingBars = true;
          bars = await getBars(r.ticker, fromStr365, toStr, '1d');
          if (bars && bars.length > 0) {
            debug.barsLoaded = bars.length;
            debug.barsFetched = true;
            // Cache for future
            if (bars.length >= 200) {
              saveBarsToDb(r.ticker, fromStr365, toStr, bars, '1d');
            }
          }
        } catch (e) {
          debug.fetchError = e.message;
        }
      }
      
      if (bars && bars.length >= 200) {
        const sortedBars = [...bars].sort((a, b) => a.t - b.t);
        const signal = generateOpus45Signal(r, sortedBars, fundamentals[r.ticker], null, weights);
        debug.signalResult = {
          signal: signal.signal,
          confidence: signal.opus45Confidence,
          mandatoryPassed: signal.mandatoryPassed,
          failedCriteria: signal.mandatoryDetails?.failedCriteria,
          passedCriteria: signal.mandatoryDetails?.passedCriteria
        };
      } else {
        debug.signalResult = { error: `Only ${debug.barsLoaded} bars (need 200+)` };
      }
      
      debugResults.push(debug);
    }
    
    res.json({
      analyzed: debugResults.length,
      results: debugResults
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get Opus4.5 signal for a specific ticker
app.get('/api/opus45/signal/:ticker', async (req, res) => {
  const { ticker } = req.params;
  
  try {
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    
    // Get bars (need 200+ days)
    let bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr365, toStr, '1d');
      await saveBarsToDb(ticker, fromStr365, toStr, bars, '1d');
    }
    
    if (!bars || bars.length < 200) {
      return res.json({
        ticker,
        signal: false,
        reason: 'Insufficient data (need 200+ days)',
        opus45Confidence: 0
      });
    }
    
    // Get SPY bars for RS calculation
    let spyBars = await getBarsFromDb('^GSPC', fromStr365, toStr, '1d');
    if (!spyBars) {
      spyBars = await getBars('^GSPC', fromStr365, toStr, '1d');
      await saveBarsToDb('^GSPC', fromStr365, toStr, spyBars, '1d');
    }
    
    // Get VCP analysis
    const vcpResult = checkVCP(bars, spyBars);
    
    // Get fundamentals
    const fundamentals = await loadFundamentals();
    const tickerFundamentals = fundamentals[ticker] || null;

    // Industry returns from TradingView (same shape as before for generateOpus45Signal)
    const industryNames = tickerFundamentals?.industry ? [tickerFundamentals.industry] : [];
    const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns();
    const industryReturns = buildIndustryReturnsFromTVMap(tvMap, industryNames);
    const industryData = tickerFundamentals?.industry ? industryReturns[tickerFundamentals.industry] : null;

    // Load optimized weights
    const weights = loadOptimizedWeights();
    
    // Generate Opus4.5 signal
    const signal = generateOpus45Signal(vcpResult, bars, tickerFundamentals, industryData, weights);
    
    res.json({
      ticker,
      ...signal,
      weightsVersion: weights._version || 'default'
    });
  } catch (e) {
    console.error(`Opus4.5 signal error for ${ticker}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// Get historical Opus4.5 signals for chart overlay
// Returns all buy/sell signals over the bar history for chart markers
app.get('/api/opus45/signals/:ticker/history', async (req, res) => {
  const { ticker } = req.params;
  
  try {
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    
    // Get bars (need 200+ days)
    let bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr365, toStr, '1d');
      await saveBarsToDb(ticker, fromStr365, toStr, bars, '1d');
    }
    
    if (!bars || bars.length < 200) {
      return res.json({
        ticker,
        buySignals: [],
        sellSignals: [],
        currentStatus: 'no_position',
        lastBuySignal: null,
        lastSellSignal: null,
        reason: 'Insufficient data (need 200+ days)'
      });
    }
    
    // Get SPY bars for RS calculation
    let spyBars = await getBarsFromDb('^GSPC', fromStr365, toStr, '1d');
    if (!spyBars) {
      spyBars = await getBars('^GSPC', fromStr365, toStr, '1d');
      await saveBarsToDb('^GSPC', fromStr365, toStr, spyBars, '1d');
    }
    
    // Load optimized weights
    const weights = loadOptimizedWeights();
    
    // Sort bars by time
    const sortedBars = [...bars].sort((a, b) => a.t - b.t);
    
    // Detect all buy/sell signals across bar history
    const buySignals = [];
    const sellSignals = [];
    let inPosition = false;
    let entryPrice = 0;
    let lastBuySignal = null;
    let lastSellSignal = null;
    
    // Need at least 200 bars before we can check signals
    for (let i = 200; i < sortedBars.length; i++) {
      const bar = sortedBars[i];
      const barsToDate = sortedBars.slice(0, i + 1);
      
      if (!inPosition) {
        // Check for buy signal
        const vcpResult = checkVCP(barsToDate, spyBars);
        const signal = generateOpus45Signal(vcpResult, barsToDate, null, null, weights);
        
        if (signal.signal) {
          const buyMarker = {
            time: Math.floor(bar.t / 1000), // Unix seconds
            type: 'buy',
            price: bar.c,
            confidence: signal.opus45Confidence,
            grade: signal.opus45Grade || null,
            reason: signal.mandatoryDetails?.passedCriteria?.join(', ') || 'All criteria passed',
            stopLoss: signal.stopLossPrice,
            target: signal.targetPrice
          };
          buySignals.push(buyMarker);
          lastBuySignal = buyMarker;
          inPosition = true;
          entryPrice = bar.c;
        }
      } else {
        // Check for sell signal
        const exitCheck = checkExitSignal({ entryPrice }, barsToDate);
        
        if (exitCheck.exitSignal) {
          const sellMarker = {
            time: Math.floor(bar.t / 1000),
            type: 'sell',
            price: bar.c,
            reason: exitCheck.exitReason,
            exitType: exitCheck.exitType
          };
          sellSignals.push(sellMarker);
          lastSellSignal = sellMarker;
          inPosition = false;
          entryPrice = 0;
        }
      }
    }
    
    // Calculate completed trades
    const completedTrades = [];
    const minLen = Math.min(buySignals.length, sellSignals.length);
    for (let i = 0; i < minLen; i++) {
      const buy = buySignals[i];
      const sell = sellSignals[i];
      const returnPct = ((sell.price - buy.price) / buy.price) * 100;
      const daysInTrade = Math.round((sell.time - buy.time) / 86400);
      completedTrades.push({
        entryDate: new Date(buy.time * 1000).toISOString().slice(0, 10),
        entryPrice: buy.price,
        exitDate: new Date(sell.time * 1000).toISOString().slice(0, 10),
        exitPrice: sell.price,
        returnPct: Math.round(returnPct * 10) / 10,
        daysInTrade,
        profitDollars: Math.round((sell.price - buy.price) * 100) / 100
      });
    }
    
    // Calculate holding period
    const holdingPeriod = inPosition && lastBuySignal 
      ? Math.round((Date.now() / 1000 - lastBuySignal.time) / 86400) 
      : null;
    
    // Only show as actionable BUY if the buy signal was within last 2 days
    // Otherwise it's just "Holding" - the buy opportunity has passed
    const MAX_DAYS_FOR_ACTIONABLE_BUY = 2;
    const isActionableBuy = inPosition && holdingPeriod !== null && holdingPeriod <= MAX_DAYS_FOR_ACTIONABLE_BUY;
    
    res.json({
      ticker,
      buySignals,
      sellSignals,
      currentStatus: inPosition ? 'in_position' : 'no_position',
      lastBuySignal,
      lastSellSignal,
      completedTrades,
      holdingPeriod,
      isActionableBuy,  // true only if buy signal triggered in last 2 days
      weightsVersion: weights._version || 'default'
    });
  } catch (e) {
    console.error(`Opus4.5 history error for ${ticker}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// Check exit signal for a position
app.post('/api/opus45/exit-check', async (req, res) => {
  const { ticker, entryPrice, entryDate } = req.body;
  
  if (!ticker || !entryPrice) {
    return res.status(400).json({ error: 'ticker and entryPrice are required' });
  }
  
  try {
    const to = new Date();
    const from = new Date(entryDate || to);
    from.setDate(from.getDate() - 30);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    
    let bars = await getBarsFromDb(ticker, fromStr, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr, toStr, '1d');
      await saveBarsToDb(ticker, fromStr, toStr, bars, '1d');
    }
    
    const exitCheck = checkExitSignal({ ticker, entryPrice, entryDate }, bars);
    
    res.json({
      ticker,
      entryPrice,
      ...exitCheck
    });
  } catch (e) {
    console.error(`Exit check error for ${ticker}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// ========== OPUS4.5 LEARNING ENDPOINTS ==========

// Get learning system status
app.get('/api/opus45/learning/status', async (req, res) => {
  try {
    const status = await getLearningStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run learning pipeline on HISTORICAL retrospective backtest (no saved snapshots needed)
// Looks back in time to find when signals would have triggered, measures outcomes, learns weights
app.post('/api/opus45/learning/run-retro', async (req, res) => {
  // Extend timeout to 10 min (retro backtest fetches bars per ticker, can take 5–15+ min)
  req.setTimeout(600000);
  res.setTimeout(600000);

  const {
    lookbackMonths = 12,
    holdingPeriod = 60,
    topN = 100,
    autoApply = false
  } = req.body;

  try {
    console.log(`\n🔄 Opus4.5 Learning: Running retrospective backtest (${lookbackMonths}mo, ${holdingPeriod}d hold)...`);

    const tickers = await getTickersForBacktest();
    if (tickers.length === 0) {
      return res.status(400).json({ error: 'No tickers. Run a scan first or ensure data/tickers.txt exists.' });
    }

    const retroResult = await runRetroBacktest({
      tickers,
      lookbackMonths,
      holdingPeriod,
      topN
    });

    const signals = retroResult.signals || [];
    if (signals.length < 20) {
      return res.json({
        error: 'INSUFFICIENT_SIGNALS',
        message: `Need 20+ signals for learning, found ${signals.length}`,
        retro: retroResult
      });
    }

    // Map retro signals to learning pipeline trade format
    const tradesForLearning = signals.map((s) => ({
      ticker: s.ticker,
      outcome: s.outcome,
      forwardReturn: s.returnPct,
      contractions: s.contractions ?? 0,
      volumeDryUp: s.volumeDryUp ?? false,
      relativeStrength: s.rs ?? null,
      atMa10: s.entryMA === '10 MA',
      atMa20: s.entryMA === '20 MA',
      industryRank: null,
      institutionalOwnership: null,
      epsGrowth: null,
      enhancedScore: null,
      patternConfidence: null
    }));

    const backtestResultsForLearning = {
      scanDate: 'retro',
      daysForward: holdingPeriod,
      results: tradesForLearning
    };

    const learningResult = await runLearningPipeline(backtestResultsForLearning, autoApply);

    res.json({
      retro: {
        config: retroResult.config,
        summary: retroResult.summary,
        signalsFound: signals.length
      },
      learning: learningResult
    });
  } catch (e) {
    console.error('Retro learning error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Run learning pipeline on a backtest
app.post('/api/opus45/learning/run', async (req, res) => {
  const { scanDate, daysForward = 30, topN = null, autoApply = false } = req.body;
  
  if (!scanDate) {
    return res.status(400).json({ error: 'scanDate is required' });
  }
  
  try {
    console.log(`\n🧠 Running Opus4.5 learning on backtest ${scanDate}...`);
    
    // First run the backtest
    const backtestResult = await runBacktest(scanDate, daysForward, topN);
    
    if (backtestResult.error) {
      return res.json({ error: backtestResult.error, message: backtestResult.message });
    }
    
    // Then run the learning pipeline
    const learningResult = await runLearningPipeline(backtestResult.backtestResults, autoApply);
    
    res.json({
      backtest: backtestResult.analysis,
      learning: learningResult
    });
  } catch (e) {
    console.error('Learning error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Manually apply weight changes
app.post('/api/opus45/learning/apply-weights', async (req, res) => {
  const { weights } = req.body;
  
  if (!weights || typeof weights !== 'object') {
    return res.status(400).json({ error: 'weights object is required' });
  }
  
  try {
    const result = await applyWeightChanges(weights);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset weights to defaults
app.post('/api/opus45/learning/reset', (req, res) => {
  try {
    const weights = resetWeightsToDefault();
    res.json({ success: true, weights });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get current weights
app.get('/api/opus45/weights', async (req, res) => {
  try {
    const current = await loadOptimizedWeights();
    res.json({
      current,
      defaults: DEFAULT_WEIGHTS,
      isOptimized: Object.keys(current).some(k => current[k] !== DEFAULT_WEIGHTS[k])
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== REGIME (HMM) ==========
// Separate SPY and QQQ regime + forward predictions (run fetch-regime-data + regime:train first)
app.get('/api/regime', (req, res) => {
  try {
    const data = loadCurrentRegime();
    if (!data.spy && !data.qqq) {
      return res.status(404).json({ error: 'Regime not trained. Run: npm run fetch-regime-data && npm run regime:train' });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5-year regime backtest: prediction vs actual forward returns (correlation)
app.get('/api/regime/backtest', (req, res) => {
  try {
    const data = loadRegimeBacktest();
    if (!data.spy && !data.qqq) {
      return res.status(404).json({ error: 'Regime backtest not found. Run: npm run regime:train' });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5-year OHLCV bars used for regime training (SPY or QQQ). Supabase when configured (Vercel); else file.
app.get('/api/regime/bars/:ticker', async (req, res) => {
  try {
    const ticker = (req.params.ticker || '').toUpperCase();
    if (ticker !== 'SPY' && ticker !== 'QQQ') {
      return res.status(400).json({ error: 'Ticker must be SPY or QQQ' });
    }
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('regime_bars').select('results').eq('ticker', ticker).single();
      if (error || !data) return res.status(404).json({ error: '5y data not found. Run: npm run fetch-regime-data' });
      return res.json({ ticker, results: data.results || [] });
    }
    const filePath = path.join(DATA_DIR, 'regime', `${ticker.toLowerCase()}_5y.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '5y data not found. Run: npm run fetch-regime-data' });
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json({ ticker, results: raw.results || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== TRADE JOURNAL ENDPOINTS ==========
// These endpoints manage the trade journal for logging entries and learning

// Get all trades (with optional status filter)
app.get('/api/trades', async (req, res) => {
  try {
    const status = req.query.status;
    const trades = status ? await getTradesByStatus(status) : await getAllTrades();
    const stats = await getTradeStats();
    res.json({ trades, stats, total: trades.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get trade statistics only
app.get('/api/trades/stats', async (req, res) => {
  try {
    const stats = await getTradeStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a single trade by ID
app.get('/api/trades/:id', async (req, res) => {
  try {
    const trade = await getTradeById(req.params.id);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a new trade entry
// Body: { ticker, entryDate, entryPrice, conviction, notes, entryMetrics }
app.post('/api/trades', async (req, res) => {
  try {
    const { ticker, entryDate, entryPrice, conviction, notes, companyName, entryMetrics } = req.body;
    
    if (!ticker || !entryPrice) {
      return res.status(400).json({ error: 'ticker and entryPrice are required' });
    }
    
    // If entryMetrics not provided, try to fetch current metrics for the ticker
    let metrics = entryMetrics || {};
    
    if (!entryMetrics || Object.keys(entryMetrics).length === 0) {
      try {
        // Try to get metrics from latest scan results
        const scanData = await loadScanResultsFromDb();
        if (scanData?.results?.length) {
          const scanResult = scanData.results.find(r => r.ticker === ticker.toUpperCase());
          
          if (scanResult) {
            metrics = {
              sma10: scanResult.sma10 || null,
              sma20: scanResult.sma20 || null,
              sma50: scanResult.sma50 || null,
              sma150: null, // Not in scan results
              sma200: null, // Not in scan results
              contractions: scanResult.contractions || 0,
              volumeDryUp: scanResult.volumeDryUp || false,
              pattern: scanResult.pattern || 'VCP',
              patternConfidence: scanResult.patternConfidence || null,
              relativeStrength: scanResult.relativeStrength || null,
              pctFromHigh: null, // Would need to calculate
              pctAboveLow: null, // Would need to calculate
              high52w: null, // Would need to calculate
              low52w: null, // Would need to calculate
              industryName: scanResult.industryName || null,
              industryRank: scanResult.industryRank || null,
              opus45Confidence: scanResult.opus45Confidence || null,
              opus45Grade: scanResult.opus45Grade || null,
              vcpScore: scanResult.score || null,
              enhancedScore: scanResult.enhancedScore || null
            };
          }
        }
      } catch (e) {
        console.error('Error fetching metrics for trade:', e.message);
      }
    }
    
    const trade = await createTrade(
      { ticker, entryDate, entryPrice, conviction, notes, companyName },
      metrics
    );
    
    res.status(201).json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update a trade
app.patch('/api/trades/:id', async (req, res) => {
  try {
    const trade = await updateTrade(req.params.id, req.body);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Close a trade (exit)
// Body: { exitPrice, exitDate, exitNotes }
app.post('/api/trades/:id/close', async (req, res) => {
  try {
    const { exitPrice, exitDate, exitNotes } = req.body;
    
    if (!exitPrice) {
      return res.status(400).json({ error: 'exitPrice is required' });
    }
    
    const trade = await closeTrade(req.params.id, exitPrice, exitDate, exitNotes);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a trade
app.delete('/api/trades/:id', async (req, res) => {
  try {
    const deleted = await deleteTrade(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check all open trades for auto-exit signals
// This can be called manually or set up on a schedule
app.post('/api/trades/check-exits', async (req, res) => {
  try {
    const results = await checkAutoExits();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate learning feedback from trade history
// Returns analysis of which metrics correlate with winning trades
app.get('/api/trades/learning', async (req, res) => {
  try {
    const feedback = await generateLearningFeedback();
    res.json(feedback);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Apply learning feedback to Opus4.5 weights
// This takes the suggested weights and applies them
app.post('/api/trades/learning/apply', (req, res) => {
  try {
    const feedback = generateLearningFeedback();
    
    if (feedback.error) {
      return res.status(400).json(feedback);
    }
    
    // Apply suggested weights if any
    if (feedback.suggestedWeights && Object.keys(feedback.suggestedWeights).length > 0) {
      const newWeights = {};
      for (const [key, data] of Object.entries(feedback.suggestedWeights)) {
        newWeights[key] = data.suggested;
      }
      
      const result = applyWeightChanges(newWeights);
      res.json({
        feedback,
        applied: true,
        weightsUpdated: result
      });
    } else {
      res.json({
        feedback,
        applied: false,
        message: 'No weight changes to apply'
      });
    }
  } catch (e) {
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

// --- Frontend: Vite dev middleware (dev) or static dist (production) ---
const DIST_DIR = path.join(__dirname, '..', 'dist');
const isDev = process.env.NODE_ENV === 'development';

async function attachFrontend() {
  if (isDev) {
    // Single process: Express serves /api, Vite serves app + HMR on same port
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Dev: Vite middleware attached (HMR on same port)');
  } else if (fs.existsSync(DIST_DIR)) {
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
}

// On Vercel, the app is used as serverless handler (api/[[...path]].js); do not start a server.
if (!process.env.VERCEL) {
  attachFrontend();
}

export { app };
