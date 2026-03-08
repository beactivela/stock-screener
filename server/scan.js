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
import { checkVCP, buildSignalSnapshots } from './vcp.js';
import { computeEnhancedScore, rankIndustries } from './enhancedScan.js';
import { classifySignalSetups, classifySignalSetupsRecent } from './learning/signalSetupClassifier.js';
import { saveScanSnapshot } from './backtest.js';
import { loadTickers as loadTickersFromDb, saveTickers as saveTickersToDb } from './db/tickers.js';
import { loadFundamentals as loadFundamentalsFromDb, saveFundamentals as saveFundamentalsToDb } from './db/fundamentals.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName } from './tradingViewIndustry.js';
import { saveScanResults as saveScanResultsToDb } from './db/scanResults.js';
import { getBars as getBarsFromDb, saveBars as saveBarsToDb } from './db/bars.js';

const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');

// Max tickers to scan. When reading from tickers.txt: 0 = use ALL tickers in file. Otherwise limit to this number.
// Default 0 = scan entire data/tickers.txt (e.g. 899 tickers). Set SCAN_LIMIT=100 for faster tests.
const TICKER_LIMIT = Number(process.env.SCAN_LIMIT) || 0;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}

/** Get bars: DB cache first (incremental fill), then API. Set SCAN_SKIP_CACHE=1 to force API. */
async function getBarsForScan(ticker, from, to) {
  if (!process.env.SCAN_SKIP_CACHE) {
    const cached = await getBarsFromDb(ticker, from, to, '1d');
    if (cached && cached.length > 0) return cached;
  }
  const bars = await getDailyBars(ticker, from, to);
  if (bars && bars.length > 0) await saveBarsToDb(ticker, from, to, bars, '1d');
  return bars;
}

function dateRange(daysBack = 320) {
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

async function runScan() {
  ensureDataDir();
  const { from, to } = dateRange(320); // 320d supports 200 MA based agent criteria
  const tickers = await getTickers();
  
  // Load fundamentals and industry returns (TradingView) for enhanced scoring
  const fundamentals = await loadFundamentals();
  const industryReturns = await loadIndustryReturns(fundamentals);
  const industryRanks = rankIndustries(industryReturns);
  
  // Fetch SPY bars once for RS calculations (NEW)
  console.log(`Fetching SPY bars for Relative Strength calculations...`);
  let spyBars = null;
  try {
    spyBars = await getBarsForScan('SPY', from, to);
    console.log(`Loaded SPY bars: ${spyBars.length} days`);
  } catch (e) {
    console.warn(`Could not fetch SPY bars: ${e.message}. RS will be null for all stocks.`);
  }
  
  console.log(`Scanning ${tickers.length} tickers (${from} to ${to})`);
  console.log(`Loaded ${Object.keys(fundamentals).length} fundamentals, ${Object.keys(industryRanks).length} ranked industries`);

  const results = [];
  // Sequential queue: 1 ticker at a time with delay to avoid Yahoo throttling
  const delayMs = Number(process.env.SCAN_DELAY_MS) || 150;
  for (let i = 0; i < tickers.length; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const ticker = tickers[i];
    try {
      const bars = await getBarsForScan(ticker, from, to);
      if (!bars.length) {
        results.push({ ticker, score: 0, recommendation: 'avoid', vcpBullish: false, reason: 'no_bars', enhancedScore: 0, enhancedGrade: 'F', signalSetups: [] });
      } else {
        const vcp = checkVCP(bars, spyBars); // Pass SPY bars for RS calculation
        const fund = fundamentals[ticker] || null;
        const industryData = fund?.industry ? industryRanks[fund.industry] : null;
        
        // Pass industryRanks to apply multiplier
        const enhanced = computeEnhancedScore(vcp, bars, fund, industryData, industryRanks);
        const merged = { ticker, ...vcp, ...enhanced };
        merged.signalSetups = classifySignalSetups(merged);
        const snapshots = buildSignalSnapshots(bars, spyBars, 5);
        merged.signalSetupsRecent = classifySignalSetupsRecent(snapshots);
        merged.signalSetupsRecent5 = classifySignalSetupsRecent(snapshots, 5);
        results.push(merged);
      }
    } catch (e) {
      console.warn(ticker, e.message);
      results.push({ ticker, score: 0, recommendation: 'avoid', vcpBullish: false, error: e.message, enhancedScore: 0, enhancedGrade: 'F', signalSetups: [] });
    }
    if ((i + 1) % 25 === 0 || i + 1 === tickers.length) {
      console.log(`  ${i + 1} / ${tickers.length}`);
    }
  }

  // Sort by enhanced score first (when available), then by original VCP score
  results.sort((a, b) => {
    const aEnhanced = a.enhancedScore ?? a.score ?? 0;
    const bEnhanced = b.enhancedScore ?? b.score ?? 0;
    if (bEnhanced !== aEnhanced) return bEnhanced - aEnhanced;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  const vcpBullishCount = results.filter((r) => r.vcpBullish).length;

  const payload = {
    scannedAt: new Date().toISOString(),
    from,
    to,
    totalTickers: tickers.length,
    vcpBullishCount,
    results,
  };

  await saveScanResultsToDb(payload);

  // Save backtest snapshot for future analysis
  try {
    await saveScanSnapshot(results, new Date());
  } catch (e) {
    console.warn('Could not save backtest snapshot:', e.message);
  }
  
  console.log(`Done. Scored ${results.length} tickers (${vcpBullishCount} VCP bullish). Saved to DB.`);
  return payload;
}

/**
 * Streaming scan: yields each ticker result as it completes.
 * Used by POST /api/scan for live UI updates.
 * Throttling: 1 ticker at a time, SCAN_DELAY_MS between (default 150ms).
 * 
 * IMPROVEMENT: Now uses industry ranks with multiplier
 */
async function* runScanStream() {
  ensureDataDir();
  const { from, to } = dateRange(320); // 320d supports 200 MA based agent criteria
  const tickers = await getTickers();
  const delayMs = Number(process.env.SCAN_DELAY_MS) || 150;
  
  // Load fundamentals and industry returns (TradingView)
  const fundamentals = await loadFundamentals();
  const industryReturns = await loadIndustryReturns(fundamentals);
  const industryRanks = rankIndustries(industryReturns);
  
  // Fetch SPY bars once for RS calculations (NEW)
  let spyBars = null;
  try {
    spyBars = await getBarsForScan('SPY', from, to);
  } catch (e) {
    console.warn(`Could not fetch SPY bars: ${e.message}`);
  }

  for (let i = 0; i < tickers.length; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const ticker = tickers[i];
    let result;
    try {
      const bars = await getBarsForScan(ticker, from, to);
      if (!bars.length) {
        result = { ticker, score: 0, recommendation: 'avoid', vcpBullish: false, reason: 'no_bars', enhancedScore: 0, enhancedGrade: 'F', signalSetups: [] };
      } else {
        const vcp = checkVCP(bars, spyBars); // Pass SPY bars for RS
        const fund = fundamentals[ticker] || null;
        const industryData = fund?.industry ? industryRanks[fund.industry] : null;
        
        // Pass industryRanks to apply multiplier
        const enhanced = computeEnhancedScore(vcp, bars, fund, industryData, industryRanks);
        const merged = { ticker, ...vcp, ...enhanced };
        merged.signalSetups = classifySignalSetups(merged);
        const snapshots = buildSignalSnapshots(bars, spyBars, 5);
        merged.signalSetupsRecent = classifySignalSetupsRecent(snapshots);
        merged.signalSetupsRecent5 = classifySignalSetupsRecent(snapshots, 5);
        result = merged;
      }
    } catch (e) {
      console.warn(ticker, e.message);
      result = { ticker, score: 0, recommendation: 'avoid', vcpBullish: false, error: e.message, enhancedScore: 0, enhancedGrade: 'F', signalSetups: [] };
    }
    yield { result, index: i + 1, total: tickers.length };
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
