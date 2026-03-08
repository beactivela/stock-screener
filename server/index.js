/**
 * Express server: API + frontend (Vite in dev, static dist in prod). Caches API data to flat JSON files.
 * Loads .env from project root. Ticker list + industry from TradingView; OHLC bars from Yahoo (TradingView has no bar API).
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
import { checkVCP, assignIBDRelativeStrengthRatings, calculateRelativeStrength } from './vcp.js';
import { computeEnhancedScore, rankIndustries } from './enhancedScan.js';
import { fetchIndustrialsFromYahoo, fetchAllIndustriesFromYahoo, fetchSectorsFromYahoo, fetchIndustryReturns, industryPageUrl } from './industrials.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName, getRequiredIndustries } from './tradingViewIndustry.js';
import { listScanSnapshots, runBacktest, loadScanSnapshot } from './backtest.js';
import { generateOpus45Signal, findOpus45Signals, checkExitSignal, getSignalStats, DEFAULT_WEIGHTS, computeRankScore, isNewBuyToday, normalizeRs, normalizeIndustryRank } from './opus45Signal.js';
import { loadOptimizedWeights, runLearningPipeline, getLearningStatus, applyWeightChanges, resetWeightsToDefault } from './opus45Learning.js';
import { dateRange } from './scan.js';
import { runRetroBacktest, getTickersForBacktest } from './retroBacktest.js';
import { runBacktestHierarchy } from './backtesting/index.js';
import { buildLearningRunFromHierarchy } from './backtesting/learningBridge.js';
import { loadCurrentRegime, loadRegimeBacktest } from './regimeHmm.js';
import { loadTickers as loadTickersFromDb, saveTickers as saveTickersToDb } from './db/tickers.js';
import { loadFundamentals as loadFundamentalsFromDb, saveFundamentals as saveFundamentalsToDb } from './db/fundamentals.js';
import { loadScanResults as loadScanResultsFromDb, saveScanResults as saveScanResultsToDb } from './db/scanResults.js';
import { getBars as getBarsFromDb, saveBars as saveBarsToDb } from './db/bars.js';
import { loadIndustryCache, saveIndustryCache } from './db/industry.js';
import { loadOpus45Signals as loadOpus45SignalsFromDb, saveOpus45Signals as saveOpus45SignalsToDb } from './db/opus45.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { assignRatingsFromRaw, buildCalibrationCurve, calibrateRating } from './rsCompare.js';
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
// Exit Learning Agent - analyzes why trades fail vs succeed
import { runExitLearning, analyzeCaseStudy, loadExitLearningHistory } from './exitLearning.js';
import { runHistoricalExitLearning } from './historicalExitAnalysis.js';
import { runConversationForSignal } from './agents/conversationOrchestrator.js';
import { saveConversation, loadConversation, labelConversation } from './agents/conversationStore.js';
import { classifyMarket } from './agents/marketPulse.js';
import { resolveSignalFromCache } from './agents/conversationSignalSource.js';
import { scanTickerForSignals } from './learning/historicalSignalScanner.js';
import { buildAgentSignalOverlay } from './agents/agentSignalOverlay.js';
import { translateCriteriaToSearchCriteria } from './agents/criteriaTranslator.js';
import { summarizePercentiles } from './utils/percentiles.js';

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
  const nonWriteApiPosts = new Set([
    '/api/agents/criteria/translate',
  ]);

  if (
    process.env.VERCEL &&
    !isSupabaseConfigured() &&
    req.method === 'POST' &&
    req.path.startsWith('/api') &&
    !nonWriteApiPosts.has(req.path)
  ) {
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

function getDefaultDateRange(years = 5) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - years);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
ensureDirs();

/** Wrappers that delegate to db layer (Supabase when configured, else files) */
async function loadFundamentals() {
  return loadFundamentalsFromDb();
}

/** Load industry returns from TradingView for given fundamentals. */
async function loadIndustryReturnsForScan(fundamentals) {
  const industryNames = [...new Set(Object.values(fundamentals || {}).map((e) => e?.industry).filter(Boolean))];
  const requiredIndustries = new Set(industryNames.map((name) => normalizeIndustryName(name)));
  const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns({ requiredIndustries });
  return buildIndustryReturnsFromTVMap(tvMap, industryNames);
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

// Translate natural-language Signal Agent criteria into executable search criteria.
// Body: { agentId: string, criteria: string[] }
app.post('/api/agents/criteria/translate', async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || '').trim();
    const criteria = Array.isArray(req.body?.criteria)
      ? req.body.criteria.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required.' });
    }
    if (criteria.length === 0) {
      return res.status(400).json({ error: 'criteria must be a non-empty string array.' });
    }

    const translated = await translateCriteriaToSearchCriteria(agentId, criteria);
    res.json(translated);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Criteria translation failed.' });
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
        isNewBuyToday: s.isNewBuyToday,
        rankScore: s.rankScore,
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
          isNewBuyToday: opus.isNewBuyToday ?? isNewBuyToday(opus.daysSinceBuy),
          rankScore: opus.rankScore ?? computeRankScore(opus.opus45Confidence ?? 0, opus.daysSinceBuy),
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

const IBD_RS_SAMPLE = [
  { ticker: 'HOOD', ibdRating: 28, ibdGroupRank: 16 },
  { ticker: 'OPY', ibdRating: 88, ibdGroupRank: 1 },
  { ticker: 'ISSC', ibdRating: 99, ibdGroupRank: 1 },
  { ticker: 'FIX', ibdRating: 98, ibdGroupRank: 1 },
  { ticker: 'PLTR', ibdRating: 82, ibdGroupRank: 1 },
  { ticker: 'GOOG', ibdRating: 89, ibdGroupRank: 1 },
  { ticker: 'CAT', ibdRating: 94, ibdGroupRank: 1 },
  { ticker: 'ALNT', ibdRating: 96, ibdGroupRank: 3 },
  { ticker: 'NVT', ibdRating: 89, ibdGroupRank: 1 },
  { ticker: 'AMZN', ibdRating: 32, ibdGroupRank: 3 },
  { ticker: 'EBAY', ibdRating: 80, ibdGroupRank: 1 },
  { ticker: 'BE', ibdRating: 99, ibdGroupRank: 4 },
  { ticker: 'WMT', ibdRating: 84, ibdGroupRank: 3 },
  { ticker: 'COST', ibdRating: 64, ibdGroupRank: 1 },
];

// Compare IBD RS sample vs our RS calculation (IBD weighted returns).
app.get('/api/rs/ibd-compare', async (req, res) => {
  try {
    const interval = '1d';
    // 420 calendar days yields >252 trading bars, which the RS raw calc needs.
    const days = 420;
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const loadBarsCached = async (ticker) => {
      let bars = null;
      try {
        bars = await getBarsFromDb(ticker, fromStr, toStr, interval);
      } catch (_) {
        // DB not configured; fall through to Yahoo fetch.
      }
      if (!bars) {
        bars = await getBars(ticker, fromStr, toStr, interval);
        try {
          await saveBarsToDb(ticker, fromStr, toStr, bars, interval);
        } catch (_) {
          // Save failed; response still usable.
        }
      }
      return [...(bars || [])].sort((a, b) => a.t - b.t);
    };

    const sampleRows = [];
    for (const row of IBD_RS_SAMPLE) {
      const bars = await loadBarsCached(row.ticker);
      if (!bars.length) {
        sampleRows.push({ ...row, rsRaw: null, ourRating: null, error: 'no_bars' });
        continue;
      }
      const rsData = calculateRelativeStrength(bars);
      const rsRaw = Number.isFinite(rsData?.rsRaw) ? rsData.rsRaw : null;
      sampleRows.push({ ...row, rsRaw, rsData });
    }

    const scanData = await loadScanData();
    const universeRows = (scanData?.results || [])
      .map((r) => ({
        ticker: String(r.ticker || '').toUpperCase(),
        relativeStrength: Number.isFinite(r?.rsData?.rsRaw) ? r.rsData.rsRaw : null,
      }))
      .filter((r) => r.ticker && r.relativeStrength != null);

    const combinedByTicker = new Map();
    for (const row of universeRows) combinedByTicker.set(row.ticker, row.relativeStrength);
    for (const row of sampleRows) {
      const ticker = String(row.ticker || '').toUpperCase();
      if (ticker) combinedByTicker.set(ticker, row.rsRaw);
    }

    const combinedRows = Array.from(combinedByTicker.entries())
      .filter(([, raw]) => Number.isFinite(raw))
      .map(([ticker, raw]) => ({ ticker, relativeStrength: raw, rsData: { rsRaw: raw } }));

    const usedUniverse = combinedRows.length > sampleRows.length;
    const rated = assignRatingsFromRaw(combinedRows);
    const ratingByTicker = new Map(rated.map((r) => [String(r.ticker || '').toUpperCase(), r.relativeStrength]));

    const withRatings = sampleRows.map((row) => {
      const ticker = String(row.ticker || '').toUpperCase();
      const ourRating = ratingByTicker.get(ticker) ?? null;
      const delta = ourRating != null ? row.ibdRating - ourRating : null;
      return { ...row, ticker, ourRating, delta };
    });

    const curve = buildCalibrationCurve(withRatings.map((r) => ({
      ourRating: r.ourRating,
      ibdRating: r.ibdRating,
    })));

    const finalRows = withRatings.map((row) => {
      const ourRatingAdjusted = calibrateRating(row.ourRating, curve);
      const adjustedDelta = ourRatingAdjusted != null ? row.ibdRating - ourRatingAdjusted : null;
      return { ...row, ourRatingAdjusted, adjustedDelta };
    });

    res.json({
      benchmark: 'IBD_weighted_returns',
      from: fromStr,
      to: toStr,
      interval,
      usedUniverse,
      rows: finalRows,
      sampleSize: finalRows.length,
      universeSize: combinedRows.length,
      warning: usedUniverse ? null : 'Universe unavailable; ratings are sample-only.',
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
    const { runScanStream, applyRatingsAndEnhancements } = await import('./scan.js');
    const { from: fromStr, to: toStr } = dateRange(320);
    const fundamentals = await loadFundamentals();
    const industryReturns = await loadIndustryReturnsForScan(fundamentals);
    const industryRanks = rankIndustries(industryReturns);
    const barsByTicker = new Map();
    const snapshotsByTicker = new Map();

    const results = [];
    let vcpBullishCount = 0;

    for await (const { result, index, total, bars, snapshots } of runScanStream()) {
      results.push(result);
      activeScan.results.push(result);
      if (result.vcpBullish) vcpBullishCount++;
      if (bars && result.ticker) barsByTicker.set(result.ticker, bars);
      if (snapshots && result.ticker) snapshotsByTicker.set(result.ticker, snapshots);
      
      // Update global progress
      activeScan.progress.index = index;
      activeScan.progress.total = total;
      activeScan.progress.vcpBullishCount = vcpBullishCount;
      
      send({ result, index, total, vcpBullishCount, scanId: activeScan.id });
      
      // Write partial results every 25 tickers (survives refresh)
      if (results.length % 25 === 0 || results.length === total) {
        const rated = applyRatingsAndEnhancements({
          results,
          fundamentals,
          industryRanks,
          barsByTicker,
          snapshotsByTicker,
        });
        const sorted = [...rated].sort((a, b) => {
          const aE = a.enhancedScore ?? a.score ?? 0;
          const bE = b.enhancedScore ?? b.score ?? 0;
          return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
        });
        await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted });
      }
    }

    const rated = applyRatingsAndEnhancements({
      results,
      fundamentals,
      industryRanks,
      barsByTicker,
      snapshotsByTicker,
    });
    const sorted = rated.sort((a, b) => {
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
      const { runScanStream, applyRatingsAndEnhancements } = await import('./scan.js');
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 180);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const results = [];
      let vcpBullishCount = 0;
      const fundamentals = await loadFundamentals();
      const industryReturns = await loadIndustryReturnsForScan(fundamentals);
      const industryRanks = rankIndustries(industryReturns);
      const barsByTicker = new Map();
      const snapshotsByTicker = new Map();
      for await (const { result, index, total, bars, snapshots } of runScanStream()) {
        results.push(result);
        activeScan.results.push(result);
        if (result.vcpBullish) vcpBullishCount++;
        if (bars && result.ticker) barsByTicker.set(result.ticker, bars);
        if (snapshots && result.ticker) snapshotsByTicker.set(result.ticker, snapshots);
        activeScan.progress.index = index;
        activeScan.progress.total = total;
        activeScan.progress.vcpBullishCount = vcpBullishCount;
        if (results.length % 25 === 0 || results.length === total) {
          const rated = applyRatingsAndEnhancements({
            results,
            fundamentals,
            industryRanks,
            barsByTicker,
            snapshotsByTicker,
          });
          const sorted = [...rated].sort((a, b) => {
            const aE = a.enhancedScore ?? a.score ?? 0;
            const bE = b.enhancedScore ?? b.score ?? 0;
            return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
          });
          await saveScanResultsToDb({ scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted });
        }
      }
      const rated = applyRatingsAndEnhancements({
        results,
        fundamentals,
        industryRanks,
        barsByTicker,
        snapshotsByTicker,
      });
      const sorted = rated.sort((a, b) => {
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

    const { from: fromStr365, to: toStr } = dateRange(320);

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
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
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

// ========== BACKTEST HIERARCHY (Simple → WFO → MC → Holdout) ==========
app.post('/api/backtest/hierarchy', async (req, res) => {
  const {
    tier = 'simple',
    engine = 'node',
    agentType = null,
    startDate,
    endDate,
    holdoutPct = 0.2,
    trainMonths = 12,
    testMonths = 3,
    stepMonths = 3,
    candidateHoldingPeriods = [60, 90, 120],
    optimizeMetric = 'expectancy',
    topN = null,
    lookbackMonths = 60,
    forceRefresh = false,
    warmupMonths = 12,
    monteCarloTrials = 500,
    monteCarloSeed = 42,
    allowWeightUpdates = true,
    minImprovement = 0.25,
  } = req.body || {};

  try {
    if (!agentType) {
      return res.status(400).json({ error: 'agentType is required for backtest hierarchy' });
    }

    const defaults = getDefaultDateRange(5);
    const resolvedStart = startDate || defaults.startDate;
    const resolvedEnd = endDate || defaults.endDate;

    const objective = 'expectancy';
    if (optimizeMetric && optimizeMetric !== 'expectancy') {
      console.warn(`[Backtest hierarchy] Ignoring optimizeMetric="${optimizeMetric}". Objective is fixed to expectancy.`);
    }

    const result = await runBacktestHierarchy({
      tier,
      engine,
      agentType,
      tickerLimit: topN ?? 0,
      lookbackMonths,
      forceRefresh,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      holdoutPct,
      trainMonths,
      testMonths,
      stepMonths,
      candidateHoldingPeriods,
      optimizeMetric: objective,
      topN,
      warmupMonths,
      monteCarloTrials,
      monteCarloSeed,
    });

    const storeResult = await buildLearningRunFromHierarchy({
      agentType,
      tier,
      result,
      objective,
      allowWeightUpdates,
      minImprovement,
    });

    res.json({
      ...result,
      learningRun: storeResult,
    });
  } catch (e) {
    console.error('Backtest hierarchy error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Streamed hierarchy backtest with progress updates (SSE over POST)
app.post('/api/backtest/hierarchy/stream', async (req, res) => {
  const {
    tier = 'simple',
    engine = 'node',
    agentType = null,
    startDate,
    endDate,
    holdoutPct = 0.2,
    trainMonths = 12,
    testMonths = 3,
    stepMonths = 3,
    candidateHoldingPeriods = [60, 90, 120],
    optimizeMetric = 'expectancy',
    topN = null,
    lookbackMonths = 60,
    forceRefresh = false,
    warmupMonths = 12,
    monteCarloTrials = 500,
    monteCarloSeed = 42,
    allowWeightUpdates = true,
    minImprovement = 0.25,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    if (!agentType) {
      send({ done: true, error: 'agentType is required for backtest hierarchy' });
      return res.end();
    }

    const defaults = getDefaultDateRange(5);
    const resolvedStart = startDate || defaults.startDate;
    const resolvedEnd = endDate || defaults.endDate;

    const objective = 'expectancy';
    if (optimizeMetric && optimizeMetric !== 'expectancy') {
      console.warn(`[Backtest hierarchy stream] Ignoring optimizeMetric="${optimizeMetric}". Objective is fixed to expectancy.`);
    }

    const result = await runBacktestHierarchy({
      tier,
      engine,
      agentType,
      tickerLimit: topN ?? 0,
      lookbackMonths,
      forceRefresh,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      holdoutPct,
      trainMonths,
      testMonths,
      stepMonths,
      candidateHoldingPeriods,
      optimizeMetric: objective,
      warmupMonths,
      monteCarloTrials,
      monteCarloSeed,
      onProgress: (evt) => send({ progress: true, ...evt }),
    });

    const storeResult = await buildLearningRunFromHierarchy({
      agentType,
      tier,
      result,
      objective,
      allowWeightUpdates,
      minImprovement,
    });

    send({ done: true, result: { ...result, learningRun: storeResult } });
    res.end();
  } catch (e) {
    console.error('Backtest hierarchy stream error:', e);
    send({ done: true, error: e.message });
    res.end();
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
    const rankScore = s.rankScore ?? computeRankScore(s.opus45Confidence ?? 0, s.daysSinceBuy);
    return {
      ticker: s.ticker,
      opus45Confidence: s.opus45Confidence ?? 0,
      opus45Grade: s.opus45Grade ?? 'F',
      entryDate: entryDateIso,
      daysSinceBuy: s.daysSinceBuy,
      isNewBuyToday: s.isNewBuyToday ?? isNewBuyToday(s.daysSinceBuy),
      rankScore,
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

// Debug endpoint: RS + industry normalization summaries for top Opus scores
app.get('/api/opus45/debug/rs-industry', async (req, res) => {
  try {
    const limitParam = Number(req.query.limit) || 50;
    const limit = Math.max(1, Math.min(200, limitParam));
    const scanData = await loadScanData();
    if (!scanData.results?.length) {
      return res.json({ error: 'No scan results' });
    }

    const opusData = await computeAndSaveOpus45Scores();
    if (!opusData?.allScores?.length) {
      return res.json({ error: 'No Opus4.5 scores available' });
    }

    const scanByTicker = new Map(scanData.results.map((r) => [r.ticker, r]));
    const maxIndustryRank = scanData.results.reduce((m, r) => {
      const val = Number(r?.industryRank);
      return Number.isFinite(val) && val > m ? val : m;
    }, 0);
    const fallbackIndustryTotal = Math.max(2, maxIndustryRank || 200);

    const sorted = [...opusData.allScores].sort((a, b) => (b.opus45Confidence ?? 0) - (a.opus45Confidence ?? 0));
    const top = sorted.slice(0, limit);

    const enriched = top.map((row) => {
      const scan = scanByTicker.get(row.ticker) || {};
      const industryTotal = scan?.industryTotalCount ?? fallbackIndustryTotal;
      const rsNormalized = normalizeRs(scan?.relativeStrength);
      const industryNormalized = normalizeIndustryRank(scan?.industryRank, industryTotal);
      return {
        ticker: row.ticker,
        opus45Confidence: row.opus45Confidence ?? 0,
        opus45Grade: row.opus45Grade ?? 'F',
        relativeStrength: scan?.relativeStrength ?? null,
        industryRank: scan?.industryRank ?? null,
        industryTotalCount: industryTotal,
        rsNormalized: rsNormalized == null ? null : Math.round(rsNormalized * 1000) / 1000,
        industryNormalized: industryNormalized == null ? null : Math.round(industryNormalized * 1000) / 1000
      };
    });

    const rsValues = enriched.map((r) => r.rsNormalized).filter((v) => Number.isFinite(v));
    const industryValues = enriched.map((r) => r.industryNormalized).filter((v) => Number.isFinite(v));

    res.json({
      limit,
      scannedAt: scanData.scannedAt,
      computedAt: opusData.computedAt,
      summary: {
        rs: summarizePercentiles(rsValues, [50, 90]),
        industry: summarizePercentiles(industryValues, [50, 90])
      },
      top: enriched
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
    
    // Get VCP analysis
    const vcpResult = checkVCP(bars);
    
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
    let highSinceEntry = 0;
    
    // Need at least 200 bars before we can check signals
    for (let i = 200; i < sortedBars.length; i++) {
      const bar = sortedBars[i];
      const barsToDate = sortedBars.slice(0, i + 1);
      
      if (!inPosition) {
        // Check for buy signal
        const vcpResult = checkVCP(barsToDate);
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
          highSinceEntry = bar.h;
        }
      } else {
        highSinceEntry = Math.max(highSinceEntry, bar.h);
        const exitCheck = checkExitSignal({ entryPrice, highSinceEntry }, barsToDate);
        
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
          highSinceEntry = 0;
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
    
    // Set cache headers to prevent stale data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const response = {
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
    };
    
    // Debug log for STRL
    if (ticker === 'STRL') {
      console.log(`[STRL DEBUG] Sending response:`, {
        currentStatus: response.currentStatus,
        lastBuyDate: lastBuySignal ? new Date(lastBuySignal.time * 1000).toISOString() : null,
        lastBuyPrice: lastBuySignal?.price,
        holdingPeriod: response.holdingPeriod
      });
    }
    
    res.json(response);
  } catch (e) {
    console.error(`Opus4.5 history error for ${ticker}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// Get per-agent buy signals for chart overlays (Momentum Scout, Base Hunter, Breakout Tracker, Turtle Trader)
app.get('/api/agents/signals/:ticker/history', async (req, res) => {
  const { ticker } = req.params;

  try {
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    // Get bars (need 250+ days for historical signal evaluation)
    let bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr365, toStr, '1d');
      await saveBarsToDb(ticker, fromStr365, toStr, bars, '1d');
    }

    if (!bars || bars.length < 250) {
      return res.json({
        ticker,
        agents: {},
        reason: 'Insufficient data (need 250+ days)',
      });
    }

    const signals = scanTickerForSignals(ticker, bars, {
      lookbackMonths: 12,
      signalFamilies: ['opus45', 'turtle'],
    });

    const agents = buildAgentSignalOverlay({ signals, bars });

    // Set cache headers to prevent stale data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
      ticker,
      agents,
      scannedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`Agent signal history error for ${ticker}:`, e);
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
app.get('/api/regime', async (req, res) => {
  try {
    const data = await loadCurrentRegime();
    if (!data.spy && !data.qqq) {
      return res.status(404).json({ error: 'Regime not trained. Run: npm run fetch-regime-data && npm run regime:train' });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5-year regime backtest: prediction vs actual forward returns (correlation)
app.get('/api/regime/backtest', async (req, res) => {
  try {
    const data = await loadRegimeBacktest();
    if (!data.spy && !data.qqq) {
      return res.status(404).json({ error: 'Regime backtest not found. Run: npm run regime:train' });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Harry Historian regime analytics: leaderboard, regime filter profile, stage timeline, and sector RS percentile ranking.
app.get('/api/regime/harry', async (req, res) => {
  const normalizeRegime = (value) => {
    const v = String(value || '').toUpperCase();
    if (v === 'BULL' || v === 'UNCERTAIN' || v === 'CORRECTION' || v === 'BEAR') return v;
    return 'UNCERTAIN';
  };

  const fallbackStageHistory = (backtestData) => {
    const base = backtestData?.spy?.fullHistory || backtestData?.qqq?.fullHistory || [];
    return base.map((item) => ({
      date: item.date,
      regime: item.regime === 'bull' ? 'BULL' : 'BEAR',
      source: 'hmm_fallback',
    }));
  };

  try {
    const [
      { listBatchRuns },
      {
        buildRegimeLeaderboard,
        buildRegimeProfile,
        buildTopDownFilterProfile,
        buildSectorRankByTicker,
        buildSectorRsPercentileByTicker,
      },
      { getHistoricalMarketConditions },
    ] = await Promise.all([
      import('./learning/batchCheckpointStore.js'),
      import('./agents/harryHistorian.js'),
      import('./learning/distributionDays.js'),
    ]);

    const runs = await listBatchRuns(1);
    const latestRun = runs?.[0] || null;
    const cycles = latestRun?.finalResult?.cycles || [];
    const leaderboardByRegime = latestRun?.finalResult?.leaderboardByRegime || buildRegimeLeaderboard(cycles);
    const profileByRegime = buildRegimeProfile(cycles);
    const topDownProfileByRegime = {
      BULL: buildTopDownFilterProfile('BULL'),
      UNCERTAIN: buildTopDownFilterProfile('UNCERTAIN'),
      CORRECTION: buildTopDownFilterProfile('CORRECTION'),
      BEAR: buildTopDownFilterProfile('BEAR'),
    };

    // Stage history (uses logged market_conditions when available, otherwise falls back to HMM bull/bear)
    const backtestData = await loadRegimeBacktest();
    const allDates = [
      ...(backtestData?.spy?.fullHistory || []).map((r) => r.date),
      ...(backtestData?.qqq?.fullHistory || []).map((r) => r.date),
    ].filter(Boolean);
    const sortedDates = [...new Set(allDates)].sort();
    const fromDate = sortedDates[0] || null;
    const toDate = sortedDates[sortedDates.length - 1] || null;

    let stageHistory = [];
    let stageHistorySource = 'none';
    if (fromDate && toDate) {
      try {
        const historical = await getHistoricalMarketConditions(fromDate, toDate);
        stageHistory = (historical || []).map((row) => ({
          date: row.date,
          regime: normalizeRegime(row.market_regime || row.regime),
          source: 'market_conditions',
        }));
        stageHistorySource = stageHistory.length > 0 ? 'market_conditions' : 'hmm_fallback';
      } catch {
        stageHistory = [];
      }
    }
    if (stageHistory.length === 0) {
      stageHistory = fallbackStageHistory(backtestData);
      stageHistorySource = stageHistory.length > 0 ? 'hmm_fallback' : 'none';
    }

    // Sector RS percentile ranking by ticker
    const tvPayload = await fetchTradingViewIndustryReturns({ useCache: true });
    const sectorRankByTicker = buildSectorRankByTicker(tvPayload);
    const sectorRsPercentileByTicker = buildSectorRsPercentileByTicker(tvPayload);
    const tickerRows = Object.keys(sectorRsPercentileByTicker).map((ticker) => ({
      ticker,
      industry: tvPayload?.tickerToTvIndustry?.get?.(ticker) || null,
      sectorRankPct: sectorRankByTicker[ticker] ?? null,
      sectorRsPercentile: sectorRsPercentileByTicker[ticker] ?? null,
    }));

    tickerRows.sort((a, b) => {
      const p = (b.sectorRsPercentile ?? -Infinity) - (a.sectorRsPercentile ?? -Infinity);
      if (p !== 0) return p;
      const r = (a.sectorRankPct ?? Infinity) - (b.sectorRankPct ?? Infinity);
      if (r !== 0) return r;
      return a.ticker.localeCompare(b.ticker);
    });

    res.json({
      latestBatchRun: latestRun
        ? {
            runId: latestRun.runId,
            status: latestRun.status,
            updatedAt: latestRun.updatedAt,
            cyclesCompleted: latestRun.finalResult?.cyclesCompleted ?? 0,
            cyclesPlanned: latestRun.finalResult?.cyclesPlanned ?? 0,
          }
        : null,
      leaderboardByRegime,
      profileByRegime,
      topDownProfileByRegime,
      stageHistorySource,
      stageHistory,
      sectorRsRankings: tickerRows.slice(0, 250),
    });
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

// ========== EXIT LEARNING ENDPOINTS ==========
// Advanced exit analysis - learns from what makes trades stop out vs succeed

// Run complete exit learning analysis
// Query params: ?includeBehaviorAnalysis=true (slower but more detailed)
app.post('/api/exit-learning/run', async (req, res) => {
  try {
    const includeBehaviorAnalysis = req.query.includeBehaviorAnalysis === 'true';
    
    console.log('\n🧠 Starting Exit Learning Analysis...');
    const analysis = await runExitLearning({ includeBehaviorAnalysis });
    
    if (analysis.error) {
      return res.status(400).json(analysis);
    }
    
    res.json(analysis);
  } catch (e) {
    console.error('Exit learning error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get exit learning history
app.get('/api/exit-learning/history', (req, res) => {
  try {
    const history = loadExitLearningHistory();
    res.json({ history, count: history.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analyze specific failed trade (case study)
// Body: { ticker, entryDate }
// Example: { ticker: "CMC", entryDate: "2026-02-17" }
app.post('/api/exit-learning/case-study', async (req, res) => {
  try {
    const { ticker, entryDate } = req.body;
    
    if (!ticker || !entryDate) {
      return res.status(400).json({ 
        error: 'ticker and entryDate are required',
        example: { ticker: 'CMC', entryDate: '2026-02-17' }
      });
    }
    
    console.log(`\n🔍 Analyzing case study: ${ticker} @ ${entryDate}`);
    const analysis = await analyzeCaseStudy(ticker, entryDate);
    
    if (analysis.error) {
      return res.status(400).json(analysis);
    }
    
    res.json(analysis);
  } catch (e) {
    console.error('Case study error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Run historical exit learning on past Opus signals
// Query params: ?maxSignals=50&daysToTrack=30&fromDate=2025-01-01
app.post('/api/exit-learning/historical', async (req, res) => {
  try {
    const maxSignals = parseInt(req.query.maxSignals) || 50;
    const daysToTrack = parseInt(req.query.daysToTrack) || 30;
    const fromDate = req.query.fromDate || null;
    const includeTradeDetails = req.query.includeTradeDetails === 'true';
    
    console.log('\n🧠 Starting Historical Exit Learning...');
    console.log(`  Max signals: ${maxSignals}`);
    console.log(`  Days to track: ${daysToTrack}`);
    if (fromDate) console.log(`  From date: ${fromDate}`);
    
    const analysis = await runHistoricalExitLearning({
      maxSignals,
      daysToTrack,
      fromDate,
      includeTradeDetails,
      saveReport: true
    });
    
    if (analysis.error) {
      return res.status(400).json(analysis);
    }
    
    res.json(analysis);
  } catch (e) {
    console.error('Historical exit learning error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== SELF-LEARNING SYSTEM ENDPOINTS ==========
// Advanced self-learning trading system with failure analysis, pattern recognition,
// and adaptive scoring. See server/learning/ for implementation.

// Get learning dashboard summary
app.get('/api/learning/dashboard', async (req, res) => {
  try {
    const { getLearningDashboard } = await import('./learning/index.js');
    const dashboard = await getLearningDashboard();
    res.json(dashboard);
  } catch (e) {
    console.error('Learning dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get current market condition (distribution days, regime)
app.get('/api/learning/market-condition', async (req, res) => {
  try {
    const { getCurrentMarketCondition } = await import('./learning/index.js');
    const condition = await getCurrentMarketCondition();
    res.json(condition || { error: 'Could not fetch market condition' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get failure classification statistics
app.get('/api/learning/failures', async (req, res) => {
  try {
    const { getClassificationStats } = await import('./learning/index.js');
    const stats = await getClassificationStats();
    res.json(stats || { error: 'No failure data available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Classify all unclassified losing trades
app.post('/api/learning/failures/classify', async (req, res) => {
  try {
    const { classifyAllUnclassified } = await import('./learning/index.js');
    const result = await classifyAllUnclassified();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run pattern analysis across all trades
app.post('/api/learning/analyze-patterns', async (req, res) => {
  try {
    const { analyzePatterns } = await import('./learning/index.js');
    const analysis = await analyzePatterns();
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get latest pattern analysis
app.get('/api/learning/patterns', async (req, res) => {
  try {
    const { getLatestPatternAnalysis } = await import('./learning/index.js');
    const analysis = await getLatestPatternAnalysis();
    res.json(analysis || { error: 'No pattern analysis available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate weekly learning report
app.post('/api/learning/weekly-report', async (req, res) => {
  try {
    const { weekEndDate } = req.body;
    const { generateWeeklyReport } = await import('./learning/index.js');
    const report = await generateWeeklyReport(weekEndDate);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get latest weekly report
app.get('/api/learning/weekly-report', async (req, res) => {
  try {
    const { getLatestWeeklyReport, formatReportAsMarkdown } = await import('./learning/index.js');
    const report = await getLatestWeeklyReport();
    const format = req.query.format;
    
    if (format === 'markdown' && report) {
      res.type('text/markdown').send(formatReportAsMarkdown(report));
    } else {
      res.json(report || { error: 'No weekly report available' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all weekly reports
app.get('/api/learning/weekly-reports', async (req, res) => {
  try {
    const { getAllWeeklyReports } = await import('./learning/index.js');
    const reports = await getAllWeeklyReports();
    res.json({ reports, count: reports.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run full weekly learning cycle
app.post('/api/learning/run-weekly-cycle', async (req, res) => {
  try {
    const { runWeeklyLearningCycle } = await import('./learning/index.js');
    const results = await runWeeklyLearningCycle();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update setup win rates from trade history
app.post('/api/learning/update-win-rates', async (req, res) => {
  try {
    const { updateSetupWinRates } = await import('./learning/index.js');
    const result = await updateSetupWinRates();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get historical win rate for a setup
app.post('/api/learning/historical-win-rate', async (req, res) => {
  try {
    const { getHistoricalWinRate } = await import('./learning/index.js');
    const setup = req.body;
    const result = await getHistoricalWinRate(setup);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get effective weights (default or learned)
app.get('/api/learning/weights', async (req, res) => {
  try {
    const { getEffectiveWeights } = await import('./learning/index.js');
    const weights = await getEffectiveWeights();
    res.json(weights);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Apply learned weight adjustments
app.post('/api/learning/apply-weights', async (req, res) => {
  try {
    const { applyLearnedWeights } = await import('./learning/index.js');
    const result = await applyLearnedWeights();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Validate entry with learning system
app.post('/api/learning/validate-entry', async (req, res) => {
  try {
    const { ticker, bars, vcpResult, opus45Signal, fundamentals, industryData } = req.body;
    
    // If bars not provided, fetch them
    let barsData = bars;
    if (!barsData && ticker) {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 365);
      barsData = await getBars(ticker, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    }
    
    const { validateEntryWithLearning } = await import('./learning/index.js');
    const validation = await validateEntryWithLearning({
      bars: barsData,
      vcpResult: vcpResult || {},
      opus45Signal: opus45Signal || {},
      fundamentals: fundamentals || {},
      industryData: industryData || {}
    });
    
    res.json({ ticker, ...validation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analyze a breakout
app.post('/api/learning/analyze-breakout', async (req, res) => {
  try {
    const { ticker, breakoutDate, pivotPrice, patternData } = req.body;
    
    if (!ticker || !breakoutDate) {
      return res.status(400).json({ error: 'ticker and breakoutDate required' });
    }
    
    const { analyzeBreakout } = await import('./learning/index.js');
    const analysis = await analyzeBreakout(ticker, breakoutDate, pivotPrice, patternData);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get breakout success statistics
app.get('/api/learning/breakout-stats', async (req, res) => {
  try {
    const { getBreakoutStats } = await import('./learning/index.js');
    const stats = await getBreakoutStats();
    res.json(stats || { error: 'No breakout data available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get context snapshot for a trade
app.get('/api/learning/context/:tradeId', async (req, res) => {
  try {
    const { getContextSnapshotByTradeId } = await import('./learning/index.js');
    const context = await getContextSnapshotByTradeId(req.params.tradeId);
    res.json(context || { error: 'No context snapshot found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get failure classification for a trade
app.get('/api/learning/classification/:tradeId', async (req, res) => {
  try {
    const { getClassification } = await import('./learning/index.js');
    const classification = await getClassification(req.params.tradeId);
    res.json(classification || { error: 'No classification found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== HISTORICAL SIGNAL ANALYSIS ENDPOINTS ==========
// Auto-generate trades from Opus4.5 signals over past 5 years (60 months)
// Learn cross-stock patterns without manual trade entry

// Run full historical analysis (main entry point)
// This scans tickers, finds signals, simulates trades, and analyzes patterns
app.post('/api/learning/historical/run', async (req, res) => {
  try {
    const { tickers, lookbackMonths = 60, storeInDatabase = true, tickerLimit = 0, relaxedThresholds = false, seedMode = false, signalFamilies = null } = req.body;
    
    const { runHistoricalAnalysis } = await import('./learning/index.js');
    
    // This can take a while - start it and stream progress
    const results = await runHistoricalAnalysis({
      tickers,
      lookbackMonths,
      tickerLimit,
      storeInDatabase,
      relaxedThresholds,
      seedMode,
      signalFamilies,
      onProgress: (progress) => {
        console.log(`Scanning ${progress.ticker} (${progress.current}/${progress.total})`);
      }
    });
    
    res.json(results);
  } catch (e) {
    console.error('Historical analysis error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Quick analysis on specific tickers (faster, no DB storage)
app.post('/api/learning/historical/quick', async (req, res) => {
  try {
    const { tickers, lookbackMonths = 6 } = req.body;
    
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: 'tickers array required' });
    }
    
    const { quickAnalysis } = await import('./learning/index.js');
    const results = await quickAnalysis(tickers, lookbackMonths);
    
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get latest cross-stock analysis results
app.get('/api/learning/historical/latest', async (req, res) => {
  try {
    const { getLatestAnalysis } = await import('./learning/index.js');
    const analysis = await getLatestAnalysis();
    res.json(analysis || { error: 'No historical analysis available. Run /api/learning/historical/run first.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get stored historical signals from database
app.get('/api/learning/historical/signals', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const { getStoredSignals } = await import('./learning/index.js');
    const signals = await getStoredSignals(limit);
    res.json({ signals, count: signals.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Re-analyze stored signals without re-scanning
app.post('/api/learning/historical/reanalyze', async (req, res) => {
  try {
    const { getStoredSignals, runCrossStockAnalysis, storeAnalysisResults } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length === 0) {
      return res.json({ error: 'No stored signals. Run historical scan first.' });
    }
    
    const analysis = runCrossStockAnalysis(signals);
    await storeAnalysisResults(analysis);
    
    res.json({
      signalsAnalyzed: signals.length,
      ...analysis
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan a single ticker for historical signals (for testing)
app.get('/api/learning/historical/scan/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const lookbackMonths = parseInt(req.query.months) || 60;
    
    const { scanMultipleTickers } = await import('./learning/index.js');
    const results = await scanMultipleTickers([ticker], lookbackMonths);
    
    res.json({
      ticker,
      signals: results.signals,
      stats: results.stats
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get optimal VCP setup parameters (cross-stock learned)
app.get('/api/learning/historical/optimal-setup', async (req, res) => {
  try {
    const { getStoredSignals, findOptimalSetup } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length < 10) {
      return res.json({ 
        error: 'Not enough signals. Need at least 10 historical trades.',
        signalsFound: signals.length 
      });
    }
    
    const optimal = findOptimalSetup(signals);
    res.json(optimal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get factor analysis (win rate by RS, contractions, volume, etc.)
app.get('/api/learning/historical/factors', async (req, res) => {
  try {
    const { getStoredSignals, analyzeAllFactors } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length < 5) {
      return res.json({ error: 'Not enough signals for factor analysis' });
    }
    
    const factors = analyzeAllFactors(signals);
    res.json(factors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pattern type analysis (VCP vs Cup-with-Handle vs Flat Base)
app.get('/api/learning/historical/pattern-types', async (req, res) => {
  try {
    const { getStoredSignals, analyzePatternTypes } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length < 5) {
      return res.json({ error: 'Not enough signals for pattern analysis' });
    }
    
    const patterns = analyzePatternTypes(signals);
    res.json(patterns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get exit type analysis
app.get('/api/learning/historical/exits', async (req, res) => {
  try {
    const { getStoredSignals, analyzeExitTypes } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length < 5) {
      return res.json({ error: 'Not enough signals for exit analysis' });
    }
    
    const exits = analyzeExitTypes(signals);
    res.json(exits);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get weight adjustment recommendations based on historical data
app.get('/api/learning/historical/weight-recommendations', async (req, res) => {
  try {
    const { getStoredSignals, analyzeAllFactors, generateWeightRecommendations } = await import('./learning/index.js');
    
    const signals = await getStoredSignals(1000);
    
    if (signals.length < 10) {
      return res.json({ error: 'Not enough signals for weight recommendations' });
    }
    
    const factors = analyzeAllFactors(signals);
    const recommendations = generateWeightRecommendations(factors);
    
    res.json({
      signalsAnalyzed: signals.length,
      recommendations
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== OPUS4.5 SELF-OPTIMIZATION ENDPOINTS ==========

// Run full weight optimization (auto-update Opus4.5 based on historical data)
app.post('/api/learning/optimize-weights', async (req, res) => {
  try {
    const { minSignals = 50, forceRun = false } = req.body;
    
    const { runWeightOptimization } = await import('./learning/index.js');
    const result = await runWeightOptimization({ minSignals, forceRun });
    
    // Clear weight cache so new weights are used immediately
    if (result.success && result.stored) {
      const { clearWeightCache } = await import('./opus45Signal.js');
      clearWeightCache();
    }
    
    res.json(result);
  } catch (e) {
    console.error('Weight optimization error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get current active weights (optimized or default)
app.get('/api/learning/active-weights', async (req, res) => {
  try {
    const { loadOptimizedWeights } = await import('./learning/index.js');
    const result = await loadOptimizedWeights();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Compare default vs optimized weights
app.get('/api/learning/compare-weights', async (req, res) => {
  try {
    const { loadOptimizedWeights } = await import('./learning/index.js');
    const { DEFAULT_WEIGHTS } = await import('./opus45Signal.js');
    
    const optimized = await loadOptimizedWeights();
    
    // Calculate differences
    const differences = [];
    if (optimized.source === 'optimized') {
      for (const [key, defaultVal] of Object.entries(DEFAULT_WEIGHTS)) {
        const optimizedVal = optimized.weights[key];
        if (optimizedVal !== defaultVal) {
          differences.push({
            weight: key,
            default: defaultVal,
            optimized: optimizedVal,
            delta: optimizedVal - defaultVal
          });
        }
      }
    }
    
    res.json({
      default: DEFAULT_WEIGHTS,
      optimized: optimized.weights,
      source: optimized.source,
      signalsAnalyzed: optimized.signalsAnalyzed,
      generatedAt: optimized.generatedAt,
      differences
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Latest A/B learning run result (control vs variant comparison)
app.get('/api/learning/latest-ab', async (req, res) => {
  try {
    const { loadLatestLearningRun } = await import('./learning/index.js');
    const run = await loadLatestLearningRun();
    if (!run) {
      return res.json({ available: false, message: 'No learning runs found. Run iterative-optimize first.' });
    }
    res.json({
      available: true,
      runNumber: run.run_number,
      objective: run.objective,
      control: {
        source: run.control_source,
        avgReturn: run.control_avg_return,
        expectancy: run.control_expectancy,
        winRate: run.control_win_rate,
        avgWin: run.control_avg_win,
        avgLoss: run.control_avg_loss,
        profitFactor: run.control_profit_factor,
        signalCount: run.control_signal_count
      },
      variant: {
        avgReturn: run.variant_avg_return,
        expectancy: run.variant_expectancy,
        winRate: run.variant_win_rate,
        avgWin: run.variant_avg_win,
        avgLoss: run.variant_avg_loss,
        profitFactor: run.variant_profit_factor,
        signalCount: run.variant_signal_count
      },
      delta: {
        avgReturn: run.delta_avg_return,
        expectancy: run.delta_expectancy,
        winRate: run.delta_win_rate
      },
      factorChanges: run.factor_changes || [],
      topFactors: run.top_factors || [],
      promoted: run.promoted,
      promotionReason: run.promotion_reason,
      iterationsRun: run.iterations_run,
      signalsEvaluated: run.signals_evaluated,
      completedAt: run.completed_at
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Learning run history (last N A/B comparisons, optionally filtered by agent)
app.get('/api/learning/run-history', async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const agentType = req.query.agent || null;
    const { loadLearningRunHistory } = await import('./learning/index.js');
    const runs = await loadLearningRunHistory(limit, agentType);
    res.json({
      total: runs.length,
      runs: runs.map(r => ({
        runNumber: r.run_number,
        agentType: r.agent_type || 'default',
        regimeTag: r.regime_tag || null,
        objective: r.objective,
        controlAvgReturn: r.control_avg_return,
        variantAvgReturn: r.variant_avg_return,
        deltaAvgReturn: r.delta_avg_return,
        controlExpectancy: r.control_expectancy,
        variantExpectancy: r.variant_expectancy,
        deltaExpectancy: r.delta_expectancy,
        controlWinRate: r.control_win_rate,
        variantWinRate: r.variant_win_rate,
        controlProfitFactor: r.control_profit_factor,
        variantProfitFactor: r.variant_profit_factor,
        promoted: r.promoted,
        promotionReason: r.promotion_reason,
        iterationsRun: r.iterations_run,
        signalsEvaluated: r.signals_evaluated,
        completedAt: r.completed_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Regime leaderboard from learning run history.
app.get('/api/learning/leaderboard/regime', async (req, res) => {
  try {
    const limit = Math.min(5000, parseInt(req.query.limit) || 1000);
    const { loadLearningRunHistory } = await import('./learning/index.js');
    const runs = await loadLearningRunHistory(limit, null);

    const leaderboard = {};
    for (const r of runs || []) {
      const regime = r.regime_tag || 'UNKNOWN';
      const agent = r.agent_type || 'default';
      if (!leaderboard[regime]) leaderboard[regime] = {};
      if (!leaderboard[regime][agent]) {
        leaderboard[regime][agent] = {
          runs: 0,
          promotions: 0,
          avgDeltaExpectancy: 0,
          avgDeltaWinRate: 0,
          avgDeltaAvgReturn: 0,
          promotionRate: 0,
        };
      }
      const row = leaderboard[regime][agent];
      row.runs += 1;
      if (r.promoted) row.promotions += 1;
      row.avgDeltaExpectancy += Number(r.delta_expectancy || 0);
      row.avgDeltaWinRate += Number(r.delta_win_rate || 0);
      row.avgDeltaAvgReturn += Number(r.delta_avg_return || 0);
    }

    for (const regime of Object.keys(leaderboard)) {
      for (const agent of Object.keys(leaderboard[regime])) {
        const row = leaderboard[regime][agent];
        row.avgDeltaExpectancy = Math.round((row.avgDeltaExpectancy / Math.max(row.runs, 1)) * 100) / 100;
        row.avgDeltaWinRate = Math.round((row.avgDeltaWinRate / Math.max(row.runs, 1)) * 100) / 100;
        row.avgDeltaAvgReturn = Math.round((row.avgDeltaAvgReturn / Math.max(row.runs, 1)) * 100) / 100;
        row.promotionRate = Math.round((row.promotions / Math.max(row.runs, 1)) * 1000) / 10;
      }
    }

    res.json({ totalRuns: runs.length, leaderboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Archive legacy learning runs whose objective is not expectancy.
// This keeps the active dashboard focused on one comparable objective.
app.post('/api/learning/run-history/archive-legacy', async (req, res) => {
  try {
    const {
      keepObjective = 'expectancy',
      dryRun = false,
      beforeDate = null,
      limit = 5000,
    } = req.body || {};

    const { archiveLearningRuns } = await import('./learning/index.js');
    const result = await archiveLearningRuns({
      keepObjective,
      dryRun: !!dryRun,
      beforeDate,
      limit,
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full self-learning pipeline: scan history + analyze + optimize weights
app.post('/api/learning/full-pipeline', async (req, res) => {
  try {
    const { tickers, lookbackMonths = 60, tickerLimit = 0 } = req.body;
    
    console.log('🚀 Starting full self-learning pipeline...');
    if (tickerLimit > 0) {
      console.log(`   Ticker limit: ${tickerLimit}`);
    }
    
    // Step 1: Run historical analysis
    const { runHistoricalAnalysis } = await import('./learning/index.js');
    const scanResult = await runHistoricalAnalysis({
      tickers,
      lookbackMonths,
      tickerLimit,
      storeInDatabase: true
    });
    
    if (!scanResult.success) {
      return res.json({ success: false, step: 'scan', error: scanResult.message });
    }
    
    console.log(`📊 Scanned ${scanResult.totalSignals} signals`);
    
    // Step 2: Optimize weights
    const { runWeightOptimization } = await import('./learning/index.js');
    const optimizeResult = await runWeightOptimization({ 
      minSignals: 10, 
      forceRun: true 
    });
    
    // Step 3: Clear cache so new weights are used
    if (optimizeResult.success) {
      const { clearWeightCache } = await import('./opus45Signal.js');
      clearWeightCache();
    }
    
    console.log('✅ Full pipeline complete');
    
    res.json({
      success: true,
      
      // Scan results
      signalsScanned: scanResult.totalSignals,
      overallStats: scanResult.overallStats,
      
      // Optimization results
      weightAdjustments: optimizeResult.adjustments,
      optimizedWeights: optimizeResult.optimizedWeights,
      
      // Summary
      report: scanResult.report,
      optimizationSummary: optimizeResult.summary
    });
    
  } catch (e) {
    console.error('Full pipeline error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// MULTI-AGENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// Get current market regime from Market Pulse agent
app.get('/api/agents/regime', async (req, res) => {
  try {
    const regime = await classifyMarket({ persist: false });
    res.json(regime);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcus money manager snapshot (fast): IBD-style market summary + news + subagent health
app.get('/api/marcus/summary', async (req, res) => {
  try {
    const includeNews = String(req.query.includeNews ?? '1') !== '0';
    const newsLimitRaw = Number(req.query.newsLimit ?? 8);
    const newsLimit = Number.isFinite(newsLimitRaw) ? Math.max(0, Math.min(20, newsLimitRaw)) : 8;

    const { getMarcusSummary } = await import('./agents/marcus.js');
    const summary = await getMarcusSummary({ includeNews, newsLimit });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ticker news search for a specific date (Yahoo Finance RSS)
app.get('/api/news/search', async (req, res) => {
  try {
    const ticker = String(req.query.ticker ?? '').trim();
    const date = String(req.query.date ?? '').trim();
    if (!ticker) return res.status(400).json({ error: 'Missing ticker query param.' });
    if (!date) return res.status(400).json({ error: 'Missing date query param (YYYY-MM-DD).' });

    const limitRaw = Number(req.query.limit ?? 8);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, limitRaw)) : 8;

    const { fetchYahooTickerNews } = await import('./news/newsSearch.js');
    const items = await fetchYahooTickerNews({ ticker, date, limit });
    res.json({ ticker, date, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcus full orchestration run (SSE): runs Harry + strategy agents + Sam scoring + Marcus briefing
app.post('/api/marcus/orchestrate', async (req, res) => {
  const { tickerLimit = 200, forceRefresh = false } = req.body || {};

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
    send({ phase: 'starting', message: 'Marcus: starting orchestration...' });
    const { runMarcusOrchestration } = await import('./agents/marcus.js');
    const result = await runMarcusOrchestration({
      tickerLimit,
      forceRefresh,
      onProgress: (p) => send(p),
    });
    send({ done: true, result });
    res.end();
  } catch (e) {
    console.error('Marcus orchestration error:', e);
    send({ done: true, error: e.message });
    res.end();
  }
});

// Run-agents: same as Marcus orchestration, SSE shape expected by UI + Python heartbeat (phase/message, final phase: 'done' + result)
app.post('/api/learning/run-agents', async (req, res) => {
  const { tickerLimit = 200, forceRefresh = false } = req.body || {};

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
    send({ phase: 'starting', message: 'Marcus: starting orchestration...' });
    const { runMarcusOrchestration } = await import('./agents/marcus.js');
    const result = await runMarcusOrchestration({
      tickerLimit,
      forceRefresh,
      onProgress: (p) => send(p),
    });
    // UI expects phase: 'done' and result with regime.regime, signalCount, elapsedMs
    const payload = {
      phase: 'done',
      result: {
        ...result,
        regime: result.regime != null ? { regime: result.regime } : undefined,
        signalCount: result.signalCount,
        successfulAgents: result.approvedCount,
        elapsedMs: result.elapsedMs,
      },
    };
    send(payload);
    res.end();
  } catch (e) {
    console.error('Run-agents error:', e);
    send({ phase: 'done', result: { error: e.message } });
    res.end();
  }
});

// ─── Heartbeat cron (5 min): in-server scheduler, user can turn on/off ────────
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const heartbeatState = {
  enabled: false,
  timerId: null,
  running: false,
  lastRun: null,      // ISO string
  lastResult: null,   // { regime, signalCount, elapsedMs, ... }
  nextRun: null,      // ISO string (when next tick will fire)
};

async function runHeartbeatTick() {
  if (heartbeatState.running) {
    console.log('[Heartbeat] Previous run still in progress — skipping tick.');
    return;
  }
  heartbeatState.running = true;
  heartbeatState.lastRun = new Date().toISOString();
  try {
    const { runMarcusOrchestration } = await import('./agents/marcus.js');
    const result = await runMarcusOrchestration({
      tickerLimit: 200,
      forceRefresh: false,
      onProgress: () => {},
    });
    heartbeatState.lastResult = {
      regime: result.regime,
      signalCount: result.signalCount,
      approvedCount: result.approvedCount,
      elapsedMs: result.elapsedMs,
    };
    console.log(`[Heartbeat] Tick complete — regime=${result.regime} signals=${result.signalCount} elapsed=${result.elapsedMs}ms`);
  } catch (e) {
    console.error('[Heartbeat] Tick error:', e);
    heartbeatState.lastResult = { error: e.message };
  } finally {
    heartbeatState.running = false;
  }
}

function startHeartbeatCron() {
  if (heartbeatState.timerId) return;
  heartbeatState.enabled = true;
  const scheduleNext = () => {
    heartbeatState.nextRun = new Date(Date.now() + HEARTBEAT_INTERVAL_MS).toISOString();
    runHeartbeatTick().catch(() => {});
  };
  heartbeatState.timerId = setInterval(scheduleNext, HEARTBEAT_INTERVAL_MS);
  heartbeatState.nextRun = new Date(Date.now() + HEARTBEAT_INTERVAL_MS).toISOString();
  // Run first tick immediately so user sees activity when they turn cron on
  runHeartbeatTick().catch(() => {});
  console.log('[Heartbeat] Cron started — fires every 5 minutes (first tick running now).');
}

function stopHeartbeatCron() {
  if (heartbeatState.timerId) {
    clearInterval(heartbeatState.timerId);
    heartbeatState.timerId = null;
  }
  heartbeatState.enabled = false;
  heartbeatState.nextRun = null;
  console.log('[Heartbeat] Cron stopped.');
}

app.get('/api/heartbeat', (req, res) => {
  try {
    res.json({
      enabled: heartbeatState.enabled,
      status: heartbeatState.running ? 'running' : 'idle',
      lastRun: heartbeatState.lastRun ?? null,
      lastResult: heartbeatState.lastResult ?? null,
      nextRun: heartbeatState.nextRun ?? null,
    });
  } catch (e) {
    console.error('[Heartbeat] GET error:', e);
    res.status(500).json({ error: String(e.message), enabled: false, status: 'idle', lastRun: null, lastResult: null, nextRun: null });
  }
});

app.post('/api/heartbeat/start', (req, res) => {
  try {
    startHeartbeatCron();
    res.json({ ok: true, enabled: true, message: 'Heartbeat cron started (every 5 min).' });
  } catch (e) {
    console.error('[Heartbeat] start error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/heartbeat/stop', (req, res) => {
  try {
    stopHeartbeatCron();
    res.json({ ok: true, enabled: false, message: 'Heartbeat cron stopped.' });
  } catch (e) {
    console.error('[Heartbeat] stop error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// Get full agent hierarchy manifest (Marcus + all subagents)
app.get('/api/agents/manifest', async (req, res) => {
  try {
    const { getMarcusManifest } = await import('./agents/marcus.js');
    res.json(getMarcusManifest());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run a structured multi-agent conversation for a single signal (advisory-only)
app.post('/api/agents/conversation/run', async (req, res) => {
  try {
    const { ticker, signal, regime, constraints } = req.body || {};

    let targetSignal = signal || null;
    if (!targetSignal) {
      const cached = await loadOpus45SignalsFromDb().catch(() => null);
      const signals = cached?.signals || [];
      targetSignal = resolveSignalFromCache({ ticker, cachedSignals: signals });
    }

    // If no cached signals and a ticker was provided, compute JUST that ticker.
    if (!targetSignal && ticker) {
      const to = new Date();
      const from365 = new Date(to);
      from365.setDate(from365.getDate() - 365);
      const fromStr365 = from365.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
      if (!bars || bars.length < 200) {
        return res.status(400).json({
          error: 'No cached bars for that ticker. Run “Fetch 5yr history” or a scan first, then retry.',
        });
      }

      const vcpResult = checkVCP(bars);
      const fundamentals = await loadFundamentals();
      const tickerFundamentals = fundamentals[ticker] || null;
      const industryData = null;
      const weights = loadOptimizedWeights();
      const singleSignal = generateOpus45Signal(vcpResult, bars, tickerFundamentals, industryData, weights);
      targetSignal = { ticker, ...singleSignal };
    }

    if (!targetSignal && !ticker) {
      targetSignal = {
        ticker: 'SYSTEM',
        signalType: 'META',
        opus45Confidence: 0,
        riskRewardRatio: null,
        metrics: {},
      };
    }

    if (!targetSignal) {
      return res.status(400).json({
        error: 'No cached Opus45 signals found. Provide { ticker } to compute a single signal, or run /api/opus45/signals first.',
      });
    }

    const market = regime ? { regime } : await classifyMarket({ persist: false });
    const result = await runConversationForSignal(targetSignal, {
      regime: market.regime || 'UNCERTAIN',
      constraints,
      timeoutMs: Number(process.env.AGENT_DIALOGUE_TIMEOUT_MS) || 30000,
    });

    const saved = await saveConversation({
      ticker: targetSignal.ticker,
      regime: market.regime || 'UNCERTAIN',
      signal: targetSignal,
      decision: result.decision,
      transcript: result.transcript,
    });

    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch a saved conversation by id
app.get('/api/agents/conversation/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const convo = await loadConversation(id);
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    res.json(convo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Attach outcome labels for calibration
app.post('/api/agents/conversation/:id/label', async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome } = req.body || {};
    if (!outcome) return res.status(400).json({ error: 'Outcome is required' });
    const updated = await labelConversation(id, outcome);
    if (!updated) return res.status(404).json({ error: 'Conversation not found' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// In-memory state for Harry fetch so progress survives client disconnect (background job)
const harryFetchState = {
  status: 'idle', // 'idle' | 'running' | 'done' | 'error'
  phase: null,
  message: null,
  current: null,
  total: null,
  ticker: null,
  signalCount: null,
  result: null,
  error: null,
  startedAt: null,
  completedAt: null,
};

// Harry Historian: fetch status (for polling when job runs in background)
app.get('/api/agents/harry/fetch/status', (req, res) => {
  res.json({
    status: harryFetchState.status,
    phase: harryFetchState.phase,
    message: harryFetchState.message,
    current: harryFetchState.current,
    total: harryFetchState.total,
    ticker: harryFetchState.ticker,
    signalCount: harryFetchState.signalCount,
    result: harryFetchState.result,
    error: harryFetchState.error,
    startedAt: harryFetchState.startedAt,
    completedAt: harryFetchState.completedAt,
  });
});

// Harry Historian: count of tickers with 5yr OHLC, total tickers in DB, last fetch time
app.get('/api/agents/harry/ohlc-count', async (req, res) => {
  try {
    const { getTickerCountWith5YrBars } = await import('./db/bars.js');
    const { getTickerList } = await import('./learning/historicalSignalScanner.js');
    const { getLastHarryFetchAt } = await import('./learning/autoPopulate.js');
    const [count, tickerList, lastFetchAt] = await Promise.all([
      getTickerCountWith5YrBars(),
      getTickerList(),
      getLastHarryFetchAt(),
    ]);
    res.json({
      count,
      totalTickers: tickerList?.length ?? 0,
      lastFetchAt: lastFetchAt || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Harry Historian: fetch 5yr OHLC for all tickers, save signals to DB (SSE progress; runs in background if client leaves)
app.post('/api/agents/harry/fetch', async (req, res) => {
  const { tickerLimit = 0, forceRefresh = true } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    } catch (e) {
      // Client disconnected; job continues, progress is in harryFetchState
    }
  };

  const updateState = (p) => {
    harryFetchState.phase = p.phase ?? harryFetchState.phase;
    harryFetchState.message = p.message ?? harryFetchState.message;
    harryFetchState.current = p.current ?? harryFetchState.current;
    harryFetchState.total = p.total ?? harryFetchState.total;
    harryFetchState.ticker = p.ticker ?? harryFetchState.ticker;
    harryFetchState.signalCount = p.signalCount ?? harryFetchState.signalCount;
  };

  harryFetchState.status = 'running';
  harryFetchState.startedAt = new Date().toISOString();
  harryFetchState.phase = null;
  harryFetchState.message = null;
  harryFetchState.current = null;
  harryFetchState.total = null;
  harryFetchState.ticker = null;
  harryFetchState.signalCount = null;
  harryFetchState.result = null;
  harryFetchState.error = null;
  harryFetchState.completedAt = null;

  try {
    const { runHarryFetchOnly } = await import('./agents/harryHistorian.js');
    const result = await runHarryFetchOnly({
      tickerLimit,
      forceRefresh: !!forceRefresh,
      onProgress: (p) => {
        updateState(p);
        send(p);
      },
    });
    harryFetchState.status = result.success ? 'done' : 'error';
    harryFetchState.result = result;
    harryFetchState.error = result.error ?? null;
    harryFetchState.completedAt = new Date().toISOString();
    send({ done: true, result });
    res.end();
  } catch (e) {
    console.error('Harry fetch error:', e);
    harryFetchState.status = 'error';
    harryFetchState.error = e.message;
    harryFetchState.completedAt = new Date().toISOString();
    send({ done: true, error: e.message });
    res.end();
  }
});

// Run multi-agent optimization pipeline (SSE)
app.post('/api/agents/optimize', async (req, res) => {
  const {
    maxIterations = 20,
    targetProfit = 5,
    lookbackMonths = 60,
    tickerLimit = 200,
    agentTypes = null,
    forceRefresh = false,
    topDownFilter = true,
  } = req.body;

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
    send({ phase: 'starting', message: 'Starting multi-agent optimization...' });

    const { runMultiAgentOptimization } = await import('./agents/harryHistorian.js');

    const result = await runMultiAgentOptimization({
      maxIterations,
      targetProfit,
      lookbackMonths,
      tickerLimit,
      forceRefresh,
      agentTypes,
      topDownFilter,
      onProgress: (progress) => send(progress),
    });

    send({ done: true, result });
    res.end();
  } catch (e) {
    console.error('Multi-agent optimization error:', e);
    send({ done: true, error: e.message });
    res.end();
  }
});

// Batch multi-agent optimization with checkpoints (SSE).
app.post('/api/agents/optimize/batch', async (req, res) => {
  const {
    runId = `batch_${Date.now()}`,
    cyclesPerAgent = 25,
    maxIterations = 20,
    targetProfit = 5,
    lookbackMonths = 60,
    tickerLimit = 200,
    agentTypes = null,
    forceRefresh = false,
    topDownFilter = true,
    stopOnError = false,
    resume = false,
    maxCyclesPerRequest = 0,
    validationEnabled = false,
    validationWfoEveryNCycles = 10,
    validationWfoMcEveryNCycles = 25,
    validationHoldoutEveryNCycles = 0,
    validationHoldoutOnFinalCycle = true,
    validationPromotedOnly = true,
    validationMinDeltaExpectancy = 0.25,
    validationTrainMonths = 12,
    validationTestMonths = 3,
    validationStepMonths = 3,
    validationHoldoutPct = 0.2,
    validationHoldingPeriods = [60, 90, 120],
    validationMonteCarloTrials = 500,
    validationMinImprovement = 0.25,
    validationAllowWeightUpdates = true,
    validationTopN = null,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    send({ phase: 'starting', runId, message: `Starting batch loop (${cyclesPerAgent} cycles per agent)...` });

    const { runBatchLearningLoop } = await import('./agents/harryHistorian.js');
    const {
      initializeBatchRun,
      appendBatchCheckpoint,
      finalizeBatchRun,
      getBatchRun,
    } = await import('./learning/batchCheckpointStore.js');

    const validationPolicy = {
      enabled: !!validationEnabled,
      wfoEveryNCycles: Number(validationWfoEveryNCycles) || 0,
      wfoMcEveryNCycles: Number(validationWfoMcEveryNCycles) || 0,
      holdoutEveryNCycles: Number(validationHoldoutEveryNCycles) || 0,
      holdoutOnFinalCycle: validationHoldoutOnFinalCycle !== false,
      validatePromotedOnly: validationPromotedOnly !== false,
      minPromotedDeltaExpectancy: Number.isFinite(Number(validationMinDeltaExpectancy))
        ? Number(validationMinDeltaExpectancy)
        : null,
    };

    const validationDateRange = getDefaultDateRange(5);
    const normalizedHoldingPeriods = Array.isArray(validationHoldingPeriods) && validationHoldingPeriods.length > 0
      ? validationHoldingPeriods.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
      : [60, 90, 120];

    const summarizeHierarchyMetrics = (tier, hierarchyResult) => {
      if (!hierarchyResult) return null;
      if (tier === 'wfo' || tier === 'wfo_mc') {
        return hierarchyResult.combinedTest || hierarchyResult.combinedTrain || null;
      }
      if (tier === 'holdout') {
        return hierarchyResult.holdout?.node?.summary || hierarchyResult.inSample?.wfo?.combinedTest || null;
      }
      return hierarchyResult.node?.summary || hierarchyResult.summary || null;
    };

    const runValidation = validationPolicy.enabled
      ? async ({ tier, agentType, cycle, cyclesPerAgent }) => {
          const tierLabel = String(tier || '').toUpperCase();
          const startedAtMs = Date.now();
          const emitValidationProgress = (payload = {}) => {
            send({
              phase: 'batch_validation_progress',
              tier,
              agentType,
              cycle,
              cyclesPerAgent,
              ...payload,
            });
          };

          emitValidationProgress({
            status: 'start',
            elapsedSec: 0,
            message: `Validation ${tierLabel} started for ${agentType} (cycle ${cycle}/${cyclesPerAgent})`,
          });

          const heartbeat = setInterval(() => {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            emitValidationProgress({
              status: 'heartbeat',
              elapsedSec,
              message: `Validation ${tierLabel} running for ${agentType} (${elapsedSec}s elapsed)`,
            });
          }, 5000);

          try {
            const hierarchyResult = await runBacktestHierarchy({
              tier,
              engine: 'vectorbt',
              agentType,
              startDate: validationDateRange.startDate,
              endDate: validationDateRange.endDate,
              holdoutPct: Number(validationHoldoutPct) || 0.2,
              trainMonths: Number(validationTrainMonths) || 12,
              testMonths: Number(validationTestMonths) || 3,
              stepMonths: Number(validationStepMonths) || 3,
              candidateHoldingPeriods: normalizedHoldingPeriods.length > 0 ? normalizedHoldingPeriods : [60, 90, 120],
              optimizeMetric: 'expectancy',
              topN: validationTopN ?? tickerLimit ?? null,
              lookbackMonths,
              forceRefresh: false,
              warmupMonths: 12,
              monteCarloTrials: Number(validationMonteCarloTrials) || 500,
              monteCarloSeed: 42,
              onProgress: (evt) => {
                const current = Number(evt?.current) || 0;
                const total = Number(evt?.total) || 0;
                const label = evt?.label ? String(evt.label) : 'Working';
                emitValidationProgress({
                  status: 'step',
                  current,
                  total,
                  label,
                  elapsedSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
                  message: `Validation ${tierLabel} ${current}/${total}: ${label}`,
                });
              },
            });

            const learningRun = await buildLearningRunFromHierarchy({
              agentType,
              tier,
              result: hierarchyResult,
              objective: 'expectancy',
              allowWeightUpdates: validationAllowWeightUpdates !== false,
              minImprovement: Number(validationMinImprovement) || 0.25,
            });

            const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            emitValidationProgress({
              status: 'complete',
              elapsedSec,
              message: `Validation ${tierLabel} complete for ${agentType} (${elapsedSec}s)`,
            });

            const m = summarizeHierarchyMetrics(tier, hierarchyResult);
            return {
              cycle,
              tier,
              agentType,
              metrics: {
                expectancy: m?.expectancy ?? null,
                avgReturn: m?.avgReturn ?? null,
                winRate: m?.winRate ?? null,
                profitFactor: m?.profitFactor ?? null,
                totalSignals: m?.totalSignals ?? null,
              },
              learningRun: {
                stored: Boolean(learningRun?.stored),
                promoted: Boolean(learningRun?.promoted),
                objectiveDelta: learningRun?.objectiveDelta ?? null,
                promotionReason: learningRun?.promotionReason ?? null,
                weightUpdate: learningRun?.weightUpdate || null,
              },
            };
          } catch (e) {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            emitValidationProgress({
              status: 'error',
              elapsedSec,
              error: e?.message || 'validation_failed',
              message: `Validation ${tierLabel} failed for ${agentType}: ${e?.message || 'validation_failed'}`,
            });
            throw e;
          } finally {
            clearInterval(heartbeat);
          }
        }
      : null;

    let startCycle = 1;
    let existingCycles = [];
    const normalizedMaxCyclesPerRequest = Math.max(0, Number(maxCyclesPerRequest) || 0);

    if (resume) {
      const priorRun = await getBatchRun(runId);
      if (priorRun) {
        const cycleMap = new Map();
        for (const c of priorRun?.finalResult?.cycles || []) {
          if (c?.cycle != null) cycleMap.set(c.cycle, c);
        }
        for (const cp of priorRun?.checkpoints || []) {
          const c = cp?.lastCycle;
          if (c?.cycle != null) cycleMap.set(c.cycle, c);
        }
        existingCycles = [...cycleMap.values()].sort((a, b) => (a?.cycle || 0) - (b?.cycle || 0));
        const lastCheckpointCycle = priorRun?.checkpoints?.length > 0
          ? (priorRun.checkpoints[priorRun.checkpoints.length - 1]?.cycle || 0)
          : existingCycles.length;
        startCycle = Math.max(1, lastCheckpointCycle + 1);

        if (lastCheckpointCycle >= cyclesPerAgent && priorRun?.finalResult) {
          send({
            done: true,
            result: priorRun.finalResult,
            message: 'Batch already complete; returned stored final result.',
          });
          res.end();
          return;
        }
      } else {
        await initializeBatchRun({
          runId,
          options: {
            cyclesPerAgent,
            maxIterations,
            targetProfit,
            lookbackMonths,
            tickerLimit,
            agentTypes,
            forceRefresh,
            topDownFilter,
            stopOnError,
            resume: true,
            maxCyclesPerRequest: normalizedMaxCyclesPerRequest,
            validationPolicy,
          },
        });
      }
    } else {
      await initializeBatchRun({
        runId,
        options: {
          cyclesPerAgent,
          maxIterations,
          targetProfit,
          lookbackMonths,
          tickerLimit,
          agentTypes,
          forceRefresh,
          topDownFilter,
          stopOnError,
          resume: false,
          maxCyclesPerRequest: normalizedMaxCyclesPerRequest,
          validationPolicy,
        },
      });
    }

    const result = await runBatchLearningLoop({
      runId,
      cyclesPerAgent,
      maxCycles: normalizedMaxCyclesPerRequest,
      startCycle,
      existingCycles,
      maxIterations,
      targetProfit,
      lookbackMonths,
      tickerLimit,
      agentTypes,
      forceRefresh,
      topDownFilter,
      stopOnError,
      validationPolicy,
      runValidation,
      onProgress: (progress) => send(progress),
      onCheckpoint: async (checkpoint) => {
        await appendBatchCheckpoint(runId, checkpoint);
        send({ phase: 'batch_checkpoint', checkpoint });
      },
    });

    if (result?.completed) {
      await finalizeBatchRun(runId, result);
    }
    send({ done: true, result, partial: !result?.completed });
    res.end();
  } catch (e) {
    console.error('Batch multi-agent optimization error:', e);
    send({ done: true, error: e.message });
    res.end();
  }
});

// Get one batch run state (checkpoint + final result).
app.get('/api/agents/optimize/batch/:runId', async (req, res) => {
  try {
    const { getBatchRun } = await import('./learning/batchCheckpointStore.js');
    const run = await getBatchRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Batch run not found' });
    res.json(run);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List recent batch runs.
app.get('/api/agents/optimize/batch', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const { listBatchRuns } = await import('./learning/batchCheckpointStore.js');
    const runs = await listBatchRuns(limit);
    res.json({ total: runs.length, runs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get per-agent active weights
app.get('/api/agents/:agentType/weights', async (req, res) => {
  try {
    const { loadOptimizedWeights } = await import('./learning/index.js');
    const result = await loadOptimizedWeights(req.params.agentType);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get per-agent latest A/B run
app.get('/api/agents/:agentType/latest-ab', async (req, res) => {
  try {
    const { loadLatestLearningRun } = await import('./learning/index.js');
    const run = await loadLatestLearningRun(req.params.agentType);
    if (!run) {
      return res.json({ available: false, agentType: req.params.agentType });
    }
    res.json({
      available: true,
      agentType: run.agent_type,
      runNumber: run.run_number,
      control: {
        avgReturn: run.control_avg_return,
        expectancy: run.control_expectancy,
        winRate: run.control_win_rate,
        profitFactor: run.control_profit_factor,
      },
      variant: {
        avgReturn: run.variant_avg_return,
        expectancy: run.variant_expectancy,
        winRate: run.variant_win_rate,
        profitFactor: run.variant_profit_factor,
      },
      delta: {
        avgReturn: run.delta_avg_return,
        expectancy: run.delta_expectancy,
        winRate: run.delta_win_rate,
      },
      promoted: run.promoted,
      promotionReason: run.promotion_reason,
      completedAt: run.completed_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Iterative Profitability Optimization - SSE version with real-time progress
// Now includes A/B comparison: control vs variant with automatic promotion
app.post('/api/learning/iterative-optimize', async (req, res) => {
  const {
    maxIterations = 100,
    targetProfit = 8,
    lookbackMonths = 12,
    tickerLimit = 200
  } = req.body;

  // Set up SSE
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
    console.log('\n🔄 Starting iterative optimization loop...');
    console.log(`   Target: ${targetProfit}% avg profit`);
    console.log(`   Max iterations: ${maxIterations}`);
    console.log(`   Ticker limit: ${tickerLimit}`);

    send({ phase: 'starting', message: 'Starting optimization...', tickerLimit, maxIterations });

    const { runIterativeOptimizationWithProgress } = await import('./learning/index.js');

    const result = await runIterativeOptimizationWithProgress({
      maxIterations,
      targetProfit,
      lookbackMonths,
      tickerLimit,
      onProgress: (progress) => {
        send(progress);
      }
    });

    // Weight saving and A/B promotion is now handled inside runIterativeOptimization.
    // The result includes abComparison with promoted flag.

    send({ done: true, result });
    res.end();

  } catch (e) {
    console.error('Iterative optimization error:', e);
    send({ done: true, error: e.message });
    res.end();
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
      server: {
        middlewareMode: true,
        watch: {
          // Avoid full-page reload loops when backend jobs update cached data files.
          ignored: ['**/data/**'],
        },
      },
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
