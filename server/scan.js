/**
 * Scan: read tickers from data/tickers.txt (S&P 500 flat file), run VCP on each,
 * write ALL results with score to data/scan-results.json, sorted by score descending.
 * Run: node server/scan.js
 * Or call from API (POST /api/scan).
 * Populate tickers first: node server/populate-tickers.js 500
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getDailyBars } from './yahoo.js';
import { getTickerListFromScanner } from './tradingViewIndustry.js';
import { checkVCP, buildSignalSnapshots, assignIBDRelativeStrengthRatings } from './vcp.js';
import { computeEnhancedScore, rankIndustries } from './enhancedScan.js';
import { classifySignalSetups, classifySignalSetupsRecent } from './learning/signalSetupClassifier.js';
import { computeLancePreTrade, shouldIncludeLanceInSignalSetups } from './learning/lanceBreitstein.js';
import { saveScanSnapshot } from './backtest.js';
import { loadTickers as loadTickersFromDb, saveTickers as saveTickersToDb } from './db/tickers.js';
import { loadFundamentals as loadFundamentalsFromDb, saveFundamentals as saveFundamentalsToDb } from './db/fundamentals.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName } from './tradingViewIndustry.js';
import {
  createScanRun,
  saveScanResultsBatch,
  updateScanResultsBatch,
  loadLatestScanResultsWithRun,
  updateIndustryRankBatch,
} from './db/scanResults.js';
import { getCachedBars, saveBars as saveBarsToDb, saveBarsBatch as saveBarsBatchToDb } from './db/bars.js';
import { getScanPersistenceStrategy } from './scanPersistence.js';
import { MIN_DAILY_BARS_FOR_IBD_RS } from './barHistoryLimits.js';

const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');

// Max tickers to scan. When reading from tickers.txt: 0 = use ALL tickers in file. Otherwise limit to this number.
// Default 0 = scan entire data/tickers.txt (e.g. 899 tickers). Set SCAN_LIMIT=100 for faster tests.
const TICKER_LIMIT = Number(process.env.SCAN_LIMIT) || 0;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;
const DEFAULT_SCAN_BATCH_SIZE = 20;
const DEFAULT_SCAN_CONCURRENCY = 20;
const DEFAULT_SCAN_YAHOO_CONCURRENCY = 20;
const DEFAULT_SCAN_DELAY_MS = 40;

/** Same floor as vcp.calculateRelativeStrength (>252 bars). */
const MIN_CACHED_DAILY_BARS_FOR_SCAN = MIN_DAILY_BARS_FOR_IBD_RS;

function ensureDataDir() {
  // Vercel serverless runtime uses a read-only filesystem for /var/task.
  // Scan persistence is DB-backed there, so local data dirs should be skipped.
  if (process.env.VERCEL) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}

/** Get bars: DB cache first (incremental fill), then API. Set SCAN_SKIP_CACHE=1 to force API. */
async function getBarsForScan(ticker, from, to, opts = {}) {
  if (!process.env.SCAN_SKIP_CACHE) {
    const cached = await getCachedBars(ticker, from, to, '1d');
    if (cached && cached.length >= MIN_CACHED_DAILY_BARS_FOR_SCAN) return cached;
  }
  const fetchBars = () => getDailyBars(ticker, from, to);
  const bars = typeof opts.withYahooLimit === 'function'
    ? await opts.withYahooLimit(fetchBars)
    : await fetchBars();
  if (bars && bars.length > 0) {
    if (typeof opts.onFetchedBars === 'function') {
      opts.onFetchedBars({ ticker, from, to, interval: '1d', results: bars });
    } else {
      await saveBarsToDb(ticker, from, to, bars, '1d');
    }
    return bars;
  }
  return [];
}

export function createScanRateLimiter(limit = 1, minDelayMs = 0) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeDelayMs = Math.max(0, Number(minDelayMs) || 0);
  let activeCount = 0;
  let nextAllowedAt = 0;
  const waiting = [];

  const release = () => {
    activeCount = Math.max(0, activeCount - 1);
    const next = waiting.shift();
    if (next) next();
  };

  return async function withLimit(task) {
    if (activeCount >= safeLimit) {
      await new Promise((resolve) => waiting.push(resolve));
    }
    activeCount += 1;
    try {
      if (safeDelayMs > 0) {
        const waitMs = Math.max(0, nextAllowedAt - Date.now());
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        nextAllowedAt = Date.now() + safeDelayMs;
      }
      return await task();
    } finally {
      release();
    }
  };
}

export async function runTasksWithConcurrency({ items, concurrency = 1, worker, onResolved }) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  if (typeof worker !== 'function') throw new Error('worker must be a function');

  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const inFlight = new Set();
  let cursor = 0;

  const launchNext = () => {
    while (cursor < items.length && inFlight.size < safeConcurrency) {
      const item = items[cursor];
      const itemIndex = cursor;
      cursor += 1;

      let taskPromise;
      taskPromise = (async () => {
        const result = await worker(item, itemIndex);
        if (typeof onResolved === 'function') {
          await onResolved(result, itemIndex);
        }
        return result;
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
}

export function shouldBuildSignalSnapshots(result) {
  return !!(result?.vcpBullish || result?.recommendation === 'buy' || result?.recommendation === 'hold');
}

export function resolveScanExecutionConfig(env = process.env) {
  const parsePositive = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
  };
  const parseNonNegative = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
  };

  const batchSize = parsePositive(env.SCAN_BATCH_SIZE, DEFAULT_SCAN_BATCH_SIZE);
  const scanConcurrency = parsePositive(env.SCAN_CONCURRENCY, DEFAULT_SCAN_CONCURRENCY);
  const yahooConcurrency = parsePositive(env.SCAN_YAHOO_CONCURRENCY, DEFAULT_SCAN_YAHOO_CONCURRENCY);
  const delayMs = parseNonNegative(env.SCAN_DELAY_MS, DEFAULT_SCAN_DELAY_MS);

  return { batchSize, scanConcurrency, yahooConcurrency, delayMs };
}

async function scanSingleTicker({ ticker, from, to, withYahooLimit, onFetchedBars }) {
  try {
    const bars = await getBarsForScan(ticker, from, to, { withYahooLimit, onFetchedBars });
    if (!bars.length) {
      return {
        result: {
          ticker,
          score: 0,
          recommendation: 'avoid',
          vcpBullish: false,
          reason: 'no_bars',
          enhancedScore: 0,
          enhancedGrade: 'F',
          signalSetups: [],
        },
        bars: null,
        snapshots: null,
      };
    }

    const vcp = checkVCP(bars);
    const snapshots = shouldBuildSignalSnapshots(vcp) ? buildSignalSnapshots(bars, 5) : null;
    return {
      result: { ticker, ...vcp },
      bars,
      snapshots,
    };
  } catch (e) {
    console.warn(ticker, e.message);
    return {
      result: {
        ticker,
        score: 0,
        recommendation: 'avoid',
        vcpBullish: false,
        error: e.message,
        enhancedScore: 0,
        enhancedGrade: 'F',
        signalSetups: [],
      },
      bars: null,
      snapshots: null,
    };
  }
}

async function* scanTickersStream({ tickers, from, to, concurrency, withYahooLimit, onFetchedBars }) {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const pending = new Set();
  const ready = [];
  let nextTickerIndex = 0;
  let completedCount = 0;

  const launchNext = () => {
    while (nextTickerIndex < tickers.length && pending.size < safeConcurrency) {
      const ticker = tickers[nextTickerIndex];
      nextTickerIndex += 1;

      let taskPromise;
      taskPromise = scanSingleTicker({ ticker, from, to, withYahooLimit, onFetchedBars })
        .then((payload) => {
          ready.push(payload);
        })
        .finally(() => {
          pending.delete(taskPromise);
        });

      pending.add(taskPromise);
    }
  };

  launchNext();
  while (pending.size > 0 || ready.length > 0) {
    if (ready.length === 0) {
      await Promise.race(pending);
      launchNext();
      continue;
    }

    const payload = ready.shift();
    completedCount += 1;
    yield { ...payload, index: completedCount, total: tickers.length };
    launchNext();
  }
}

// 420 calendar days yields ~260 trading bars (enough for 12-month RS).
function dateRange(daysBack = 420) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - daysBack);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/** Fallback S&P 500 tickers when ETF API is not available (paid plan required) */
const FALLBACK_TICKERS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'BRK.B', 'UNH', 'JNJ', 'JPM',
  'V', 'PG', 'XOM', 'HD', 'CVX', 'MA', 'ABBV', 'MRK', 'PEP', 'KO',
  'COST', 'AVGO', 'LLY', 'WMT', 'MCD', 'CSCO', 'ACN', 'ABT', 'TMO', 'DHR',
  'NEE', 'NKE', 'PM', 'BMY', 'RTX', 'HON', 'INTC', 'UPS', 'LOW', 'AMGN',
  'QCOM', 'INTU', 'TXN', 'SBUX', 'AXP', 'BLK', 'C', 'GS', 'AMD', 'AMAT',
];

/** Read tickers from DB. If empty, fetch from TradingView scanner and save to DB. */
async function getTickers() {
  let tickers = await loadTickersFromDb();
  if (tickers.length > 0) return TICKER_LIMIT > 0 ? tickers.slice(0, TICKER_LIMIT) : tickers;
  console.log('No tickers in DB. Fetching US stocks from TradingView scanner...');
  let list;
  try {
    list = await getTickerListFromScanner(TICKER_LIMIT || 500);
  } catch (e) {
    console.warn('TradingView scanner failed. Using built-in fallback list.');
    list = FALLBACK_TICKERS.slice(0, TICKER_LIMIT || 50);
  }
  await saveTickersToDb(list);
  console.log(`Created tickers with ${list.length} entries`);
  return TICKER_LIMIT > 0 ? list.slice(0, TICKER_LIMIT) : list;
}

/** Load fundamentals and industry returns from DB. */
async function loadFundamentals() {
  return loadFundamentalsFromDb();
}
/** Load industry returns from TradingView (3M, 6M, 1Y, YTD) for fundamentals' industries. */
async function loadIndustryReturns(fundamentals) {
  const industryNames = [...new Set(Object.values(fundamentals || {}).map((e) => e?.industry).filter(Boolean))];
  // Pass requiredIndustries for early exit optimization
  const requiredIndustries = new Set(industryNames.map((name) => normalizeIndustryName(name)));
  const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns({ requiredIndustries });
  return buildIndustryReturnsFromTVMap(tvMap, industryNames);
}

function appendLanceSetup(list, lancePreTrade) {
  if (!shouldIncludeLanceInSignalSetups(lancePreTrade)) return list;
  if (list.includes('lance')) return list;
  return [...list, 'lance'];
}

function buildNormalizedIndustryRankIndex(industryRanks = {}) {
  const index = new Map();
  for (const [name, data] of Object.entries(industryRanks || {})) {
    const normalized = normalizeIndustryName(name);
    if (!normalized || index.has(normalized)) continue;
    index.set(normalized, data);
  }
  return index;
}

function resolveIndustryRankData(industryName, industryRanks = {}, normalizedIndex = new Map()) {
  if (!industryName) return null;
  return (
    industryRanks?.[industryName] ||
    normalizedIndex.get(normalizeIndustryName(industryName)) ||
    null
  );
}

export function applyRatingsAndEnhancements({
  results,
  fundamentals,
  industryRanks,
  barsByTicker,
  snapshotsByTicker,
}) {
  const rated = assignIBDRelativeStrengthRatings(results);
  const normalizedIndustryRanks = buildNormalizedIndustryRankIndex(industryRanks);
  return rated.map((row) => {
    const fund = fundamentals?.[row.ticker] || null;
    const industryData = resolveIndustryRankData(
      fund?.industry,
      industryRanks,
      normalizedIndustryRanks,
    );
    const bars = barsByTicker?.get(row.ticker) || null;
    const enhanced = bars ? computeEnhancedScore(row, bars, fund, industryData, industryRanks) : {};
    const lancePreTrade = computeLancePreTrade(row, bars || []);
    let signalSetups = classifySignalSetups(row);
    signalSetups = appendLanceSetup(signalSetups, lancePreTrade);
    const snapshots = snapshotsByTicker?.get(row.ticker) || [];
    const snapshotsWithRating = snapshots.map((snapshot) => ({
      ...snapshot,
      relativeStrength: row.relativeStrength,
      rsData: row.rsData,
    }));
    let signalSetupsRecent = classifySignalSetupsRecent(snapshotsWithRating);
    signalSetupsRecent = appendLanceSetup(signalSetupsRecent, lancePreTrade);
    let signalSetupsRecent5 = classifySignalSetupsRecent(snapshotsWithRating, 5);
    signalSetupsRecent5 = appendLanceSetup(signalSetupsRecent5, lancePreTrade);
    return {
      ...row,
      ...enhanced,
      lancePreTrade,
      signalSetups,
      signalSetupsRecent,
      signalSetupsRecent5,
    };
  });
}

/**
 * One-time backfill to populate industryRank across existing scan results.
 * Uses fundamentals + industry returns to compute ranks, then updates in batches.
 */
export async function backfillIndustryRanks({ batchSize = 20 } = {}) {
  const {
    scanRunId,
    results,
    scannedAt,
    from,
    to,
    totalTickers,
    vcpBullishCount,
  } = await loadLatestScanResultsWithRun();

  if (!results || results.length === 0) {
    return { updated: 0, total: 0, scanRunId: scanRunId ?? null, industryCount: 0 };
  }

  const fundamentals = await loadFundamentals();
  const industryReturns = await loadIndustryReturns(fundamentals);
  const industryRanks = rankIndustries(industryReturns);
  const normalizedIndustryRanks = buildNormalizedIndustryRankIndex(industryRanks);

  const updatedResults = results.map((row) => {
    const fund = fundamentals?.[row.ticker] || null;
    const industryName = fund?.industry ?? row.industryName ?? null;
    const rankData = resolveIndustryRankData(
      industryName,
      industryRanks,
      normalizedIndustryRanks,
    );
    const industryRank = rankData?.rank ?? null;
    return { ...row, industryName, industryRank };
  });

  const meta = {
    scannedAt,
    from,
    to,
    totalTickers,
    vcpBullishCount,
  };

  let updated = 0;
  for (let i = 0; i < updatedResults.length; i += batchSize) {
    const batch = updatedResults.slice(i, i + batchSize);
    await updateIndustryRankBatch({ scanRunId, results: batch, meta });
    updated += batch.length;
  }

  return {
    updated,
    total: updatedResults.length,
    scanRunId: scanRunId ?? null,
    industryCount: Object.keys(industryRanks || {}).length,
  };
}

async function runScan() {
  ensureDataDir();
  const { from, to } = dateRange(420); // 420d ensures 12m RS + 200 MA coverage
  const tickers = await getTickers();
  const scannedAt = new Date().toISOString();
  
  // Load fundamentals and industry returns (TradingView) for enhanced scoring
  const fundamentals = await loadFundamentals();
  const industryReturns = await loadIndustryReturns(fundamentals);
  const industryRanks = rankIndustries(industryReturns);
  const normalizedIndustryRanks = buildNormalizedIndustryRankIndex(industryRanks);
  const requiredIndustries = new Set(
    Object.values(fundamentals || {})
      .map((entry) => normalizeIndustryName(entry?.industry))
      .filter(Boolean),
  );
  let matchedIndustryCount = 0;
  requiredIndustries.forEach((industry) => {
    if (normalizedIndustryRanks.has(industry)) matchedIndustryCount += 1;
  });
  
  console.log(`Scanning ${tickers.length} tickers (${from} to ${to})`);
  console.log(`Loaded ${Object.keys(fundamentals).length} fundamentals, ${Object.keys(industryRanks).length} ranked industries`);
  console.log(`Industry rank coverage: ${matchedIndustryCount}/${requiredIndustries.size} mapped from fundamentals`);

  const results = [];
  const barsByTicker = new Map();
  const snapshotsByTicker = new Map();
  const pendingBarsCacheWrites = [];
  const { batchSize, delayMs, scanConcurrency, yahooConcurrency } = resolveScanExecutionConfig();
  const pendingBatch = [];
  let vcpBullishCount = 0;
  const persistenceStrategy = getScanPersistenceStrategy();
  const { scanRunId } = await createScanRun({
    scannedAt,
    from,
    to,
    totalTickers: tickers.length,
    vcpBullishCount: 0,
  });
  const withYahooLimit = createScanRateLimiter(yahooConcurrency, delayMs);
  const queueBarsCacheWrite = (entry) => {
    if (!entry?.ticker || !Array.isArray(entry?.results) || entry.results.length === 0) return;
    pendingBarsCacheWrites.push(entry);
  };
  async function flushBatch() {
    const nextResults = pendingBatch.splice(0, pendingBatch.length);
    const nextBars = pendingBarsCacheWrites.splice(0, pendingBarsCacheWrites.length);
    if (nextResults.length > 0) {
      await saveScanResultsBatch({
        scanRunId,
        results: nextResults,
        meta: {
          scannedAt,
          from,
          to,
          totalTickers: tickers.length,
          vcpBullishCount,
        },
      });
    }
    if (nextBars.length > 0) {
      await saveBarsBatchToDb(nextBars);
    }
  }

  for await (const { result, bars, snapshots, index, total } of scanTickersStream({
    tickers,
    from,
    to,
    concurrency: scanConcurrency,
    withYahooLimit,
    onFetchedBars: queueBarsCacheWrite,
  })) {
    results.push(result);
    pendingBatch.push(result);
    if (bars && result.ticker) barsByTicker.set(result.ticker, bars);
    if (snapshots && result.ticker) snapshotsByTicker.set(result.ticker, snapshots);
    if (result.vcpBullish) vcpBullishCount++;
    if (persistenceStrategy === 'stream_batches' && pendingBatch.length >= batchSize) await flushBatch();
    if (index % 25 === 0 || index === total) {
      console.log(`  ${index} / ${total}`);
    }
  }
  if (persistenceStrategy === 'stream_batches') {
    await flushBatch();
  }

  // Convert raw RS weighted performance into IBD-style 1-99 rating across this scan universe.
  const ratedResults = applyRatingsAndEnhancements({
    results,
    fundamentals,
    industryRanks,
    barsByTicker,
    snapshotsByTicker,
  });

  // Sort by enhanced score first (when available), then by original VCP score
  ratedResults.sort((a, b) => {
    const aEnhanced = a.enhancedScore ?? a.score ?? 0;
    const bEnhanced = b.enhancedScore ?? b.score ?? 0;
    if (bEnhanced !== aEnhanced) return bEnhanced - aEnhanced;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  vcpBullishCount = ratedResults.filter((r) => r.vcpBullish).length;

  const payload = {
    scannedAt,
    from,
    to,
    totalTickers: tickers.length,
    vcpBullishCount,
    results: ratedResults,
  };

  if (persistenceStrategy === 'stream_batches') {
    for (let i = 0; i < ratedResults.length; i += batchSize) {
      await updateScanResultsBatch({
        scanRunId,
        results: ratedResults.slice(i, i + batchSize),
        meta: {
          scannedAt,
          from,
          to,
          totalTickers: tickers.length,
          vcpBullishCount,
        },
      });
    }
  } else {
    await saveScanResultsBatch({
      scanRunId,
      results: ratedResults,
      meta: {
        scannedAt,
        from,
        to,
        totalTickers: tickers.length,
        vcpBullishCount,
      },
    });
  }

  // Save backtest snapshot for future analysis
  try {
    await saveScanSnapshot(ratedResults, new Date());
  } catch (e) {
    console.warn('Could not save backtest snapshot:', e.message);
  }
  
  console.log(`Done. Scored ${ratedResults.length} tickers (${vcpBullishCount} VCP bullish). Saved to DB.`);
  return payload;
}

/**
 * Streaming scan: yields each ticker result as it completes.
 * Used by POST /api/scan for live UI updates.
 * Concurrency: cached-bar work can fan out, while Yahoo fetches stay rate-limited.
 * 
 * IMPROVEMENT: Now uses industry ranks with multiplier
 */
async function* runScanStream() {
  ensureDataDir();
  const { from, to } = dateRange(420); // 420d ensures 12m RS + 200 MA coverage
  const tickers = await getTickers();
  const { delayMs, scanConcurrency, yahooConcurrency } = resolveScanExecutionConfig();
  const withYahooLimit = createScanRateLimiter(yahooConcurrency, delayMs);

  for await (const payload of scanTickersStream({
    tickers,
    from,
    to,
    concurrency: scanConcurrency,
    withYahooLimit,
  })) {
    yield payload;
  }
}

// When run directly (node server/scan.js): execute scan and exit
const isMain = process.argv[1] === path.join(__dirname, 'scan.js') || process.argv[1]?.endsWith('scan.js');
if (isMain) {
  runScan().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { runScan, runScanStream, dateRange };

/**
 * Measure scan duration for a list of tickers using an injected scan function.
 * Intended for unit tests to avoid real network calls.
 */
export async function measureScanDuration({ tickers, scanFn, nowFn = () => Date.now(), delayMs = 0 }) {
  if (!Array.isArray(tickers)) throw new Error('tickers must be an array');
  if (typeof scanFn !== 'function') throw new Error('scanFn must be a function');

  const start = nowFn();
  for (let i = 0; i < tickers.length; i++) {
    // Simulate scanner work per ticker via injected scanFn
    await scanFn(tickers[i], i);
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  const end = nowFn();
  const durationMs = Math.max(0, end - start);
  const tickersScanned = tickers.length;
  const avgPerTickerMs = tickersScanned > 0 ? Math.round((durationMs / tickersScanned) * 10) / 10 : 0;
  return { tickersScanned, durationMs, avgPerTickerMs };
}
