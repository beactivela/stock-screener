/**
 * Core / scan / cron / bars / market HTTP routes (extracted from index.js for maintainability).
 * @see registerHealthRoute — /api/health is registered before deploy routes to preserve middleware order.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getBars, getFundamentalsBatch, getHistoryMetadata, getQuoteInfo } from '../yahoo.js';
import { checkVCP, calculateRelativeStrength } from '../vcp.js';
import { computeEnhancedScore, rankIndustries } from '../enhancedScan.js';
import { fetchIndustrialsFromYahoo, fetchAllIndustriesFromYahoo, fetchSectorsFromYahoo, fetchIndustryReturns, industryPageUrl } from '../industrials.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName } from '../tradingViewIndustry.js';
import { dateRange, backfillIndustryRanks } from '../scan.js';
import { loadFundamentals as loadFundamentalsFromDb, saveFundamentals as saveFundamentalsToDb } from '../db/fundamentals.js';
import {
  loadScanResults as loadScanResultsFromDb,
  loadScanResultSummaries as loadScanResultSummariesFromDb,
  loadLatestScanResultForTicker,
  buildScanTickerNav,
  saveScanResults as saveScanResultsToDb,
  createScanRun,
  saveScanResultsBatch,
  updateScanResultsBatch,
  getSupabaseScanProgressIfRunning,
} from '../db/scanResults.js';
import {
  getBars as getBarsFromDb,
  getBarsBatch as getBarsBatchFromDb,
  saveBars as saveBarsToDb,
  getLatestDailyBarsFetchedAt,
} from '../db/bars.js';
import { loadIndustryCache, saveIndustryCache } from '../db/industry.js';
import {
  loadOpus45Signals as loadOpus45SignalsFromDb,
  mergeOpus45AllScoresWithSignals,
} from '../db/opus45.js';
import { resolveOpusCacheState, shouldUseCachedOpusForScan } from '../opusCachePolicy.js';
import { loadTickers as loadTickersFromDb } from '../db/tickers.js';
import { buildUppercaseTickerUniverseSet, filterScanResultsToTickerUniverse } from '../scanUniverseFilter.js';
import { assignRatingsFromRaw, buildCalibrationCurve, calibrateRating } from '../rsCompare.js';
import { chatWithMinervini } from '../minerviniAgent.js';
import { translateCriteriaToSearchCriteria } from '../agents/criteriaTranslator.js';
import { getScanPersistenceStrategy } from '../scanPersistence.js';
import { maybeClearStaleActiveScan } from '../scanStaleLock.js';
import { getCronStatusPayload } from '../cronConfig.js';
import { validateCronSecret } from './cronSecretAuth.js';
import { parseBooleanQuery, parseCsvQuery } from './query.js';
import { readThroughMemoryCache } from './memoryCache.js';
import {
  FUNDAMENTALS_RESPONSE_CACHE_TTL_MS,
  SCAN_DATA_CACHE_TTL_MS,
  SCAN_RESULTS_RESPONSE_CACHE_TTL_MS,
  fundamentalsMemoryCache,
  latestScanDataMemoryCache,
  latestScanResponseCache,
  invalidateScanResponseCaches,
  invalidateFundamentalsCache,
  shouldRefreshCachedOpusPrices,
} from './apiCaches.js';
import { getSignalStats, computeRankScore, isNewBuyToday } from '../opus45Signal.js';
import { mapCachedSignalsToAllScores, enrichCachedSignalsWithCurrentPrice } from './scanOpusMerge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * `registerOpus45Routes` assigns `computeAndSaveOpus45Scores` so executeManagedScan can trigger
 * Opus recompute without circular imports between that registrar and this file.
 */
export const coreScanRouteServices = {};

/** Wrappers that delegate to db layer (Supabase when configured, else files) */
export async function loadFundamentals(options = {}) {
  const useProjection = Boolean(
    options?.tickers ||
    options?.fields ||
    options?.includeRaw === false
  );
  if (useProjection) {
    return loadFundamentalsFromDb(options);
  }
  return readThroughMemoryCache(
    fundamentalsMemoryCache,
    FUNDAMENTALS_RESPONSE_CACHE_TTL_MS,
    () => loadFundamentalsFromDb(),
  );
}

/** Load industry returns from TradingView for given fundamentals. */
async function loadIndustryReturnsForScan(fundamentals) {
  const industryNames = [...new Set(Object.values(fundamentals || {}).map((e) => e?.industry).filter(Boolean))];
  const requiredIndustries = new Set(industryNames.map((name) => normalizeIndustryName(name)));
  const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns({ requiredIndustries });
  return buildIndustryReturnsFromTVMap(tvMap, industryNames);
}
export function loadFundamentalsFilteredSync(raw) {
  const filtered = {};
  for (const [ticker, entry] of Object.entries(raw || {})) {
    const hasCompanyName = entry?.companyName && String(entry.companyName).trim();
    if (entry && 'industry' in entry && 'profitMargin' in entry && 'operatingMargin' in entry && hasCompanyName) {
      filtered[ticker] = entry;
    }
  }
  return filtered;
}

/** Load scan results (DB or file), optionally filtered by tickers. */
export async function loadScanData() {
  return readThroughMemoryCache(
    latestScanDataMemoryCache,
    SCAN_DATA_CACHE_TTL_MS,
    async () => {
      const data = await loadScanResultsFromDb();
      if (!data || !data.results?.length) {
        return { ...data, results: data?.results ?? [], totalTickers: 0, vcpBullishCount: 0 };
      }
      const tickerSet = buildUppercaseTickerUniverseSet(await loadTickersFromDb());
      const results = filterScanResultsToTickerUniverse(data.results, tickerSet);
      const vcpBullishCount = results.filter((r) => r.vcpBullish).length;
      return { ...data, results, totalTickers: results.length, vcpBullishCount };
    },
  );
}

export async function loadScanSummaryData() {
  const data = await loadScanResultSummariesFromDb();
  if (!data || !data.results?.length) {
    return { ...data, results: data?.results ?? [], totalTickers: 0, vcpBullishCount: 0 };
  }
  const tickerSet = buildUppercaseTickerUniverseSet(await loadTickersFromDb());
  const results = filterScanResultsToTickerUniverse(data.results, tickerSet);
  return {
    ...data,
    results,
    totalTickers: results.length,
    vcpBullishCount: results.filter((r) => r.vcpBullish).length,
  };
}

export const BARS_BATCH_CONCURRENCY = Math.max(1, Number(process.env.BARS_BATCH_CONCURRENCY) || 8);

export function registerCoreScanCronBarsMarketRoutes(app) {
// ---------- API ----------

// Cached fundamentals (% held by inst, qtr earnings YoY)
app.get('/api/fundamentals', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  try {
    const tickers = parseCsvQuery(req.query.tickers);
    const fields = parseCsvQuery(req.query.fields);
    const includeRaw = req.query.includeRaw == null
      ? fields == null
      : parseBooleanQuery(req.query.includeRaw, fields == null);
    res.json(await loadFundamentals({ tickers, fields, includeRaw }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single-ticker fundamentals (from cache; use POST /api/fundamentals/fetch to populate).
// includeRaw: true merges JSONB `raw` so newer Yahoo fields (market cap, revenue, EPS, etc.) appear without extra DB columns.
app.get('/api/fundamentals/:ticker', async (req, res) => {
  try {
    const ticker = String(req.params.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
    const all = await loadFundamentals({ tickers: [ticker], fields: null, includeRaw: true });
    const f = all[ticker] || null;
    res.json(
      f
        ? { ticker, ...f }
        : {
            ticker,
            pctHeldByInst: null,
            qtrEarningsYoY: null,
            profitMargin: null,
            operatingMargin: null,
            industry: null,
            marketCap: null,
            totalRevenue: null,
            fullTimeEmployees: null,
            trailingEps: null,
            businessSummary: null,
            ibdCompositeRating: null,
            ibdEpsRating: null,
            ibdRsRating: null,
            ibdSmrRating: null,
            ibdAccDisRating: null,
            ibdGroupRelStrRating: null,
            ibdImportedAt: null,
          },
    );
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
const FUNDAMENTALS_BATCH_CONCURRENCY = Math.max(1, Number(process.env.FUNDAMENTALS_BATCH_CONCURRENCY) || 5);
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

  const pendingFetches = [];
  for (let i = 0; i < tickers.length; i++) {
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
    pendingFetches.push({ ticker, index: i });
  }

  await getFundamentalsBatch(
    pendingFetches.map((item) => item.ticker),
    {
      concurrency: FUNDAMENTALS_BATCH_CONCURRENCY,
      onResult: (result, batchIndex) => {
        const pending = pendingFetches[batchIndex];
        if (!pending) return;
        if (result?.status === 'fulfilled') {
          fullCache[pending.ticker] = result.entry;
          send({ ticker: pending.ticker, ...result.entry, index: pending.index + 1, total: tickers.length });
          return;
        }
        send({ ticker: pending.ticker, error: result?.error ?? 'Fundamentals fetch failed', index: pending.index + 1, total: tickers.length });
      },
    }
  );

  if (Object.keys(fullCache).length > 0) {
    await saveFundamentalsToDb(fullCache);
  }
  invalidateFundamentalsCache();
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

// Latest scan results. Filtered to tickers in tickers.txt (source of truth).
// When ?includeOpus=true (default), merges Opus4.5 scores into each result for unified payload.
app.get('/api/scan-results/nav', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
  try {
    const data = await loadScanSummaryData();
    if (!data.scannedAt || !data.results?.length) {
      return res.json({ scannedAt: null, totalTickers: 0, results: [] });
    }
    const cached = await loadOpus45SignalsFromDb().catch(() => null);
    const actionableBuyTickers = new Set(
      (cached?.signals || [])
        .map((signal) => String(signal?.ticker || '').toUpperCase())
        .filter(Boolean)
    );
    res.json({
      scannedAt: data.scannedAt,
      totalTickers: data.totalTickers,
      results: buildScanTickerNav({ results: data.results, actionableBuyTickers }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scan-results/summary', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
  try {
    const data = await loadScanSummaryData();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scan-results/ticker/:ticker', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
  try {
    const ticker = String(req.params.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
    const row = await loadLatestScanResultForTicker(ticker);
    if (!row) return res.status(404).json({ error: 'Scan result not found.' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scan-results', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
  try {
    const includeOpus = req.query.includeOpus !== 'false';
    const cacheKey = includeOpus ? 'with-opus' : 'without-opus';
    const cachedResponse = latestScanResponseCache.get(cacheKey);
    if (cachedResponse && Date.now() - cachedResponse.at <= SCAN_RESULTS_RESPONSE_CACHE_TTL_MS) {
      return res.json(cachedResponse.payload);
    }

    const data = await loadScanData();

    if (!data.scannedAt || !data.results?.length) {
      const emptyPayload = {
        scannedAt: null,
        results: [],
        totalTickers: 0,
        vcpBullishCount: 0,
        opus45Signals: [],
        opus45Stats: null,
        opusCacheState: 'none',
      };
      latestScanResponseCache.set(cacheKey, { at: Date.now(), payload: emptyPayload });
      return res.json(emptyPayload);
    }

    if (!includeOpus) {
      latestScanResponseCache.set(cacheKey, { at: Date.now(), payload: data });
      return res.json(data);
    }

    // Load Opus4.5 cache and merge scores into each result
    const cached = await loadOpus45SignalsFromDb();
    let opus45Signals = [];
    let opus45Stats = null;
    const opusByTicker = new Map();

    const opusCacheState = resolveOpusCacheState(data, cached);
    if (cached?.signals?.length >= 0 && opusCacheState !== 'none' && shouldUseCachedOpusForScan(data, cached)) {
      if (shouldRefreshCachedOpusPrices(cached)) {
        await enrichCachedSignalsWithCurrentPrice(cached.signals);
      }
      opus45Signals = cached.signals;
      opus45Stats = cached.stats ?? getSignalStats(cached.signals);
      const mergedCachedScores = mergeOpus45AllScoresWithSignals(cached.allScores, cached.signals);
      const allScores = mapCachedSignalsToAllScores(mergedCachedScores);
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

    const payload = {
      ...data,
      results: resultsWithOpus,
      opus45Signals,
      opus45Stats,
      opusCacheState,
    };
    latestScanResponseCache.set(cacheKey, { at: Date.now(), payload });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// One-time backfill to populate industryRank for existing scan results.
app.post('/api/industry-rank/backfill', async (req, res) => {
  try {
    const batchSize = Number(req.body?.batchSize) || 20;
    const result = await backfillIndustryRanks({ batchSize });
    res.json({ ok: true, ...result });
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

    const batchOutputs = await getBarsBatchFromDb(
      IBD_RS_SAMPLE.map((row) => ({
        ticker: row.ticker,
        from: fromStr,
        to: toStr,
        interval,
      })),
      { concurrency: BARS_BATCH_CONCURRENCY }
    );

    const sampleRows = [];
    for (let i = 0; i < IBD_RS_SAMPLE.length; i++) {
      const row = IBD_RS_SAMPLE[i];
      const output = batchOutputs[i];
      const bars = output?.status === 'fulfilled'
        ? [...(output.bars || [])].sort((a, b) => a.t - b.t)
        : [];
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

function sortScanResultsByScore(results) {
  return [...results].sort((a, b) => {
    const aE = a.enhancedScore ?? a.score ?? 0;
    const bE = b.enhancedScore ?? b.score ?? 0;
    return bE !== aE ? bE - aE : (b.score ?? 0) - (a.score ?? 0);
  });
}

async function persistFinalScanResults({ scanRunId, scannedAt, from, to, results, batchSize = 20, mode = 'insert' }) {
  const vcpBullishCount = results.filter((row) => row.vcpBullish).length;
  const meta = {
    scannedAt,
    from,
    to,
    totalTickers: results.length,
    vcpBullishCount,
  };

  for (let i = 0; i < results.length; i += batchSize) {
    const chunk = results.slice(i, i + batchSize);
    if (mode === 'update') {
      await updateScanResultsBatch({
        scanRunId,
        results: chunk,
        meta,
      });
    } else {
      await saveScanResultsBatch({
        scanRunId,
        results: chunk,
        meta,
      });
    }
  }

  return meta;
}

function queueOpus45Recompute(context = {}) {
  console.log('Opus4.5: Computing scores after scan...');
  void coreScanRouteServices.computeAndSaveOpus45Scores?.(context)
    .then(() => {
      invalidateScanResponseCaches();
    })
    .catch((error) => {
      console.error('Opus4.5 compute error:', error);
    });
}

async function executeManagedScan({ onProgress, onTickersReady } = {}) {
  const { runScanStream, applyRatingsAndEnhancements, resolveScanExecutionConfig, getTickers } = await import('../scan.js');
  const { from: fromStr, to: toStr } = dateRange(420);
  const scannedAt = new Date().toISOString();
  const fundamentals = await loadFundamentals();
  const industryReturns = await loadIndustryReturnsForScan(fundamentals);
  const industryRanks = rankIndustries(industryReturns);
  const tickers = await getTickers();
  if (typeof onTickersReady === 'function') {
    await Promise.resolve(onTickersReady(tickers.length));
  }
  const barsByTicker = new Map();
  const snapshotsByTicker = new Map();
  const results = [];
  const pendingBatch = [];
  let vcpBullishCount = 0;
  let totalTickers = 0;
  const persistenceStrategy = getScanPersistenceStrategy();
  const { batchSize } = resolveScanExecutionConfig();

  const { scanRunId } = await createScanRun({
    scannedAt,
    from: fromStr,
    to: toStr,
    totalTickers: tickers.length,
    vcpBullishCount: 0,
  });

  const flushScanBatch = async () => {
    if (pendingBatch.length === 0) return;
    await saveScanResultsBatch({
      scanRunId,
      results: pendingBatch.splice(0, pendingBatch.length),
      meta: {
        scannedAt,
        from: fromStr,
        to: toStr,
        totalTickers: totalTickers || results.length,
        vcpBullishCount,
      },
    });
  };

  for await (const { result, index, total, bars, snapshots } of runScanStream(tickers)) {
    results.push(result);
    pendingBatch.push(result);
    totalTickers = total;
    if (result.vcpBullish) vcpBullishCount++;
    if (bars && result.ticker) barsByTicker.set(result.ticker, bars);
    if (snapshots && result.ticker) snapshotsByTicker.set(result.ticker, snapshots);
    if (persistenceStrategy === 'stream_batches' && pendingBatch.length >= batchSize) {
      await flushScanBatch();
    }
    if (typeof onProgress === 'function') {
      await onProgress({ result, index, total, vcpBullishCount, bars, snapshots });
    }
  }
  if (persistenceStrategy === 'stream_batches') {
    await flushScanBatch();
  }

  const rated = applyRatingsAndEnhancements({
    results,
    fundamentals,
    industryRanks,
    barsByTicker,
    snapshotsByTicker,
  });
  const sorted = sortScanResultsByScore(rated);
  const meta = await persistFinalScanResults({
    scanRunId,
    scannedAt,
    from: fromStr,
    to: toStr,
    results: sorted,
    batchSize,
    mode: persistenceStrategy === 'stream_batches' ? 'update' : 'insert',
  });
  invalidateScanResponseCaches();

  try {
    const { saveScanSnapshot } = await import('../backtest.js');
    await saveScanSnapshot(sorted, new Date());
  } catch (e) {
    console.warn('Could not save backtest snapshot:', e.message);
  }

  queueOpus45Recompute({
    scanData: {
      scannedAt,
      from: fromStr,
      to: toStr,
      totalTickers: meta.totalTickers,
      vcpBullishCount: meta.vcpBullishCount,
      results: sorted,
    },
    fundamentals,
    barsByTicker,
  });

  return {
    scannedAt,
    from: fromStr,
    to: toStr,
    totalTickers: meta.totalTickers,
    vcpBullishCount: meta.vcpBullishCount,
    results: sorted,
  };
}

// Get current scan progress (memory on single instance; Supabase when idle so polls stay accurate after restarts)
app.get('/api/scan/progress', async (req, res) => {
  maybeClearStaleActiveScan(activeScan);
  const idlePayload = {
    scanId: null,
    running: false,
    progress: {
      index: 0,
      total: 0,
      vcpBullishCount: 0,
      startedAt: null,
      completedAt: null,
    },
    hasResults: false,
    source: 'none',
  };
  try {
    if (activeScan.running) {
      return res.json({
        scanId: activeScan.id,
        running: true,
        progress: activeScan.progress,
        hasResults: activeScan.results.length > 0,
        source: 'memory',
      });
    }
    const dbSnapshot = await getSupabaseScanProgressIfRunning();
    if (dbSnapshot) return res.json(dbSnapshot);
  } catch (e) {
    console.warn('GET /api/scan/progress:', e?.message || e);
  }
  res.json(idlePayload);
});

// Trigger scan: streams each ticker result as SSE. Throttled queue (1 ticker at a time) avoids rate limits.
let lastScanStarted = 0;
const SCAN_COOLDOWN_MS = 10 * 1000; // 10s between scan starts (allow new scan if previous finished)

app.post('/api/scan', async (req, res) => {
  maybeClearStaleActiveScan(activeScan);
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

  // If the client aborts the fetch body (e.g. old code called reader.cancel()), writes can throw.
  // Swallow write errors so the scan keeps running; UI uses GET /api/scan/progress.
  const send = (obj) => {
    try {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    } catch {
      /* client disconnected */
    }
  };

  // Send initial scan ID
  send({ scanId: activeScan.id, started: true, startedAt: activeScan.progress.startedAt });

  try {
    const completedScan = await executeManagedScan({
      onTickersReady: (universeSize) => {
        activeScan.progress.total = universeSize;
        send({ universeSize, scanId: activeScan.id });
      },
      onProgress: async ({ result, index, total, vcpBullishCount }) => {
        activeScan.results.push(result);
        activeScan.progress.index = index;
        activeScan.progress.total = total;
        activeScan.progress.vcpBullishCount = vcpBullishCount;
        send({ result, index, total, vcpBullishCount, scanId: activeScan.id });
      },
    });

    activeScan.results = completedScan.results;
    activeScan.running = false;
    activeScan.progress.completedAt = new Date().toISOString();
    activeScan.progress.index = completedScan.totalTickers;
    activeScan.progress.total = completedScan.totalTickers;
    activeScan.progress.vcpBullishCount = completedScan.vcpBullishCount;

    send({
      done: true,
      total: completedScan.totalTickers,
      vcpBullishCount: completedScan.vcpBullishCount,
      scanId: activeScan.id,
    });
  } catch (e) {
    console.error('Scan failed:', e);
    activeScan.running = false;
    activeScan.progress.completedAt = new Date().toISOString();
    send({ error: e.message, scanId: activeScan.id });
  } finally {
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* ignore */
    }
  }
});

// Shared auth: ./cronSecretAuth.js validateCronSecret

// Cron-only: trigger full scan (VPS cron → localhost, Supabase pg_cron + pg_net → https, etc.). Returns 202; scan runs in background.
// POST /api/cron/scan and POST /api/cron/run-scan are aliases.
// Idempotency: returns 202 with "already in progress" or cooldown skip if a scan is active / recently started.
async function postCronScanHandler(req, res) {
  if (!validateCronSecret(req, res)) return;

  maybeClearStaleActiveScan(activeScan);
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
      const completedScan = await executeManagedScan({
        onProgress: async ({ result, index, total, vcpBullishCount }) => {
          activeScan.results.push(result);
          activeScan.progress.index = index;
          activeScan.progress.total = total;
          activeScan.progress.vcpBullishCount = vcpBullishCount;
        },
      });
      activeScan.results = completedScan.results;
      activeScan.running = false;
      activeScan.progress.completedAt = new Date().toISOString();
      activeScan.progress.index = completedScan.totalTickers;
      activeScan.progress.total = completedScan.totalTickers;
      activeScan.progress.vcpBullishCount = completedScan.vcpBullishCount;
      console.log('Cron scan completed:', completedScan.totalTickers, 'tickers,', completedScan.vcpBullishCount, 'VCP bullish');
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
    message: 'Scan started in background',
  });
}

app.post('/api/cron/scan', postCronScanHandler);
// Alias for external schedulers / docs (same handler, same auth)
app.post('/api/cron/run-scan', postCronScanHandler);

// Pre-fetch daily bars for the scan universe (Yahoo → bars_cache). Run ~30+ min before cron scan so EOD data is warm.
const barsRefreshJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

async function postCronRefreshBarsHandler(req, res) {
  if (!validateCronSecret(req, res)) return;
  if (barsRefreshJob.running) {
    return res.status(202).json({ ok: true, message: 'Bars refresh already in progress' });
  }
  barsRefreshJob.running = true;
  barsRefreshJob.lastStartedAt = new Date().toISOString();
  barsRefreshJob.lastResult = null;

  (async () => {
    try {
      const { runUniverseBarsRefresh } = await import('../cronRefreshBars.js');
      const result = await runUniverseBarsRefresh();
      barsRefreshJob.lastResult = result;
      console.log('Cron bars refresh finished:', result);
    } catch (e) {
      console.error('Cron bars refresh failed:', e);
      barsRefreshJob.lastResult = { ok: false, error: e.message };
    } finally {
      barsRefreshJob.running = false;
      barsRefreshJob.lastFinishedAt = new Date().toISOString();
    }
  })();

  res.status(202).json({
    ok: true,
    started: true,
    message: 'Universe bars refresh started in background',
  });
}

app.post('/api/cron/refresh-bars', postCronRefreshBarsHandler);
app.post('/api/cron/fetch-prices', postCronRefreshBarsHandler);

// Read-only: where cron config comes from (.env path) and whether the secret is set — never exposes CRON_SECRET.
app.get('/api/cron/status', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getCronStatusPayload());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Latest Yahoo→DB write time for daily bars (max fetched_at in bars_cache for interval 1d). Public; short CDN cache.
app.get('/api/bars-cache/last-yahoo-at', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
    const result = await getLatestDailyBarsFetchedAt();
    res.json(result);
  } catch (e) {
    res.status(500).json({
      ok: false,
      lastFetchedAt: null,
      dailyTickerCount: 0,
      error: e?.message || String(e),
    });
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
  const sorted = dedupeBarsForResponse(bars, interval);
  res.json({ ticker, from: fromStr, to: toStr, interval, results: sorted });
});

app.get('/api/history-metadata/:ticker', async (req, res) => {
  const { ticker } = req.params;
  let interval = req.query.interval;
  if (Array.isArray(interval)) interval = interval[0];
  const intervalStr = String(interval || '').toLowerCase();
  interval = ['1d', '1wk', '1mo'].includes(intervalStr) ? intervalStr : '1d';
  let days = Number(req.query.days) || 180;
  if (interval === '1wk') days = Math.max(days, 730);
  if (interval === '1mo') days = Math.max(days, 1825);

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);

  try {
    const metadata = await getHistoryMetadata(
      ticker,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
      interval,
    );
    res.json(metadata);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
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
  await getFundamentalsBatch(needFundamentals, {
    concurrency: FUNDAMENTALS_BATCH_CONCURRENCY,
    onResult: (result, index) => {
      const ticker = needFundamentals[index];
      if (!ticker) return;
      if (result?.status === 'fulfilled') {
        fundamentals[ticker] = result.entry;
        fundamentalsFetched++;
        send({ phase: 'fundamentals', ticker, index: index + 1, total: needFundamentals.length });
        return;
      }
      fundamentalsFailed++;
      send({ phase: 'fundamentals', ticker, error: result?.error ?? 'Fundamentals fetch failed' });
    },
  });
  await saveFundamentalsToDb(fundamentals);
  invalidateFundamentalsCache();

  const industriesCount = new Set(
    Object.values(fundamentals).filter((e) => e && e.industry).map((e) => e.industry)
  ).size;

  // 2. Load/fetch 365-day bars in one shared batch path (used for both 3M and 1Y return)
  let barsFetched = 0;
  let barsFailed = 0;
  const barRequests = results.map((row) => ({
    ticker: row.ticker,
    from: fromStr365,
    to: toStr,
    interval: '1d',
  }));
  const barResults = await getBarsBatchFromDb(barRequests, { concurrency: BARS_BATCH_CONCURRENCY });
  for (let i = 0; i < barResults.length; i++) {
    const output = barResults[i];
    const ticker = barRequests[i]?.ticker;
    const hasBars = !!(output?.status === 'fulfilled' && output.bars?.length >= 2);
    if (output?.status === 'fulfilled' && output.source === 'yahoo' && hasBars) {
      barsFetched++;
    } else if (!hasBars) {
      barsFailed++;
    }
    if (output?.status === 'rejected') {
      send({ phase: 'bars', ticker, error: output.error });
    } else {
      send({ phase: 'bars', ticker, index: i + 1, total: barRequests.length, hasBars, source: output?.source ?? 'cache' });
    }
  }


  send({
    done: true,
    fundamentalsFetched,
    fundamentalsFailed,
    fundamentalsTotal: needFundamentals.length,
    barsFetched,
    barsFailed,
    barsTotal: barRequests.length,
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
    const requestedIndustry = String(req.query.industry || '').trim() || null;
    const includeTickers = !parseBooleanQuery(req.query.summary, false) && parseBooleanQuery(req.query.includeTickers, true);
    const scanData = await loadScanSummaryData();
    if (!scanData.results?.length) {
      return res.json({ industries: [], scannedAt: null, source: 'tradingview' });
    }
    const results = scanData.results || [];
    const fundamentals = await loadFundamentals({
      tickers: results.map((row) => row.ticker),
      fields: ['industry'],
      includeRaw: false,
    });

    const byIndustry = new Map();
    for (const r of results) {
      const ind = fundamentals[r.ticker]?.industry ?? 'Unknown';
      if (requestedIndustry && ind !== requestedIndustry) continue;
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind).push(r);
    }

    if (byIndustry.size === 0) {
      return res.json({
        industries: [],
        scannedAt: scanData.scannedAt,
        source: 'tradingview',
        cached: false,
        cacheAge: 0,
        stale: false,
      });
    }

    // Industry returns from TradingView scanner (3M, 6M, 1Y, YTD).
    // OPTIMIZATION: Pass requiredIndustries for early exit - stops fetching when all needed industries found
    const requiredIndustries = requestedIndustry
      ? [requestedIndustry]
      : [...byIndustry.keys()];
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
      industries.push({
        industry,
        ...(includeTickers ? { tickers: withTrend } : {}),
        industryAvg3Mo,
        industryAvg6Mo,
        industryAvg1Y,
        industryYtd,
      });
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
      const requiredIndustriesVcp = fund?.industry
        ? new Set([normalizeIndustryName(fund.industry)])
        : null;
      const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns(
        requiredIndustriesVcp && requiredIndustriesVcp.size > 0 ? { requiredIndustries: requiredIndustriesVcp } : {},
      );
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

// Helper function to compute volatility (used by industry-data collection)
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
}

/** Docker / load balancers — no auth, no DB hit (must register before deploy routes; see index.js). */
export function registerHealthRoute(app) {
  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, uptime: process.uptime() });
  });
}
function dedupeBarsForResponse(bars, interval = '1d') {
  const rows = Array.isArray(bars) ? bars : [];
  const useDateKey = interval === '1d';
  const byKey = new Map();
  for (const bar of rows) {
    if (!bar || bar.t == null) continue;
    const key = useDateKey
      ? new Date(bar.t).toISOString().slice(0, 10)
      : String(Number(bar.t));
    const prior = byKey.get(key);
    if (!prior || Number(bar.t) >= Number(prior.t)) byKey.set(key, bar);
  }
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}
