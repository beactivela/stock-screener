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
import { getEtfConstituents } from './massive.js';
import { checkVCP } from './vcp.js';
import { computeEnhancedScore, rankIndustries } from './enhancedScan.js';
import { saveScanSnapshot } from './backtest.js';

const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');
const TICKERS_FILE = path.join(DATA_DIR, 'tickers.txt');
const RESULTS_FILE = path.join(DATA_DIR, 'scan-results.json');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');
const INDUSTRY_YAHOO_RETURNS_FILE = path.join(DATA_DIR, 'industry-yahoo-returns.json');

// Max tickers to scan. When reading from tickers.txt: 0 = use ALL tickers in file. Otherwise limit to this number.
// Default 0 = scan entire data/tickers.txt (e.g. 899 tickers). Set SCAN_LIMIT=100 for faster tests.
const TICKER_LIMIT = Number(process.env.SCAN_LIMIT) || 0;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}

/** Get bars from file cache if present and not stale. Same format as server. */
function getBarsFromCache(ticker, from, to) {
  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw.from !== from || raw.to !== to) return null;
    const age = Date.now() - new Date(raw.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return raw.results || [];
  } catch {
    return null;
  }
}

/** Save bars to cache (same format as server). */
function saveBarsToCache(ticker, from, to, results) {
  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}.json`);
  const payload = { ticker, from, to, fetchedAt: new Date().toISOString(), results };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

/** Get bars: cache first, then API. Reduces rate-limit hits. Set SCAN_SKIP_CACHE=1 to force API. */
async function getBarsForScan(ticker, from, to) {
  if (!process.env.SCAN_SKIP_CACHE) {
    const cached = getBarsFromCache(ticker, from, to);
    if (cached && cached.length > 0) return cached;
  }
  const bars = await getDailyBars(ticker, from, to);
  if (bars.length > 0) saveBarsToCache(ticker, from, to, bars);
  return bars;
}

function dateRange(daysBack = 180) {
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

/** Read tickers from flat file. If missing, fetch SPY (or use fallback) and create file. */
async function getTickers() {
  ensureDataDir();
  if (fs.existsSync(TICKERS_FILE)) {
    const raw = fs.readFileSync(TICKERS_FILE, 'utf8');
    const tickers = raw
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    // Use all tickers when TICKER_LIMIT=0; otherwise cap for faster test runs
    return TICKER_LIMIT > 0 ? tickers.slice(0, TICKER_LIMIT) : tickers;
  }
  // Auto-populate from SPY if file doesn't exist
  console.log('tickers.txt not found. Fetching S&P 500 from SPY...');
  let list;
  try {
    const constituents = await getEtfConstituents('SPY');
    list = constituents
      .map((r) => r.constituent_ticker)
      .filter(Boolean)
      .slice(0, TICKER_LIMIT);
  } catch (e) {
    if (e.message?.includes('403') || e.message?.includes('NOT_AUTHORIZED')) {
      console.warn('ETF API not available. Using built-in S&P 500 list.');
      list = FALLBACK_TICKERS.slice(0, TICKER_LIMIT);
    } else {
      throw e;
    }
  }
  fs.writeFileSync(TICKERS_FILE, list.join('\n'), 'utf8');
  console.log(`Created ${TICKERS_FILE} with ${list.length} tickers`);
  return list;
}

/** Load fundamentals from cache. */
function loadFundamentals() {
  if (!fs.existsSync(FUNDAMENTALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FUNDAMENTALS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Load Yahoo industry returns (1Y, 6M, 3M, YTD) keyed by industry name. */
function loadIndustryYahooReturns() {
  if (!fs.existsSync(INDUSTRY_YAHOO_RETURNS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDUSTRY_YAHOO_RETURNS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function runScan() {
  ensureDataDir();
  const { from, to } = dateRange(180); // Changed from 90 to 180 to ensure 120+ trading days for RS calculation
  const tickers = await getTickers();
  
  // Load fundamentals and industry data for enhanced scoring
  const fundamentals = loadFundamentals();
  const industryReturns = loadIndustryYahooReturns();
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
  
  console.log(`Scanning ${tickers.length} tickers from ${TICKERS_FILE} (${from} to ${to})`);
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
        results.push({ ticker, score: 0, recommendation: 'avoid', vcpBullish: false, reason: 'no_bars', enhancedScore: 0, enhancedGrade: 'F' });
      } else {
        const vcp = checkVCP(bars, spyBars); // Pass SPY bars for RS calculation
        const fund = fundamentals[ticker] || null;
        const industryData = fund?.industry ? industryRanks[fund.industry] : null;
        
        // Pass industryRanks to apply multiplier
        const enhanced = computeEnhancedScore(vcp, bars, fund, industryData, industryRanks);
        results.push({ ticker, ...vcp, ...enhanced });
      }
    } catch (e) {
      console.warn(ticker, e.message);
      results.push({ ticker, score: 0, recommendation: 'avoid', vcpBullish: false, error: e.message, enhancedScore: 0, enhancedGrade: 'F' });
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

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(payload, null, 2));
  
  // Save backtest snapshot for future analysis (NEW)
  try {
    saveScanSnapshot(results, new Date());
  } catch (e) {
    console.warn('Could not save backtest snapshot:', e.message);
  }
  
  console.log(`Done. Scored ${results.length} tickers (${vcpBullishCount} VCP bullish). Written to ${RESULTS_FILE}`);
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
  const { from, to } = dateRange(180); // Changed from 90 to 180 to ensure 120+ trading days for RS calculation
  const tickers = await getTickers();
  const delayMs = Number(process.env.SCAN_DELAY_MS) || 150;
  
  // Load fundamentals and industry data
  const fundamentals = loadFundamentals();
  const industryReturns = loadIndustryYahooReturns();
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
        result = { ticker, score: 0, recommendation: 'avoid', vcpBullish: false, reason: 'no_bars', enhancedScore: 0, enhancedGrade: 'F' };
      } else {
        const vcp = checkVCP(bars, spyBars); // Pass SPY bars for RS
        const fund = fundamentals[ticker] || null;
        const industryData = fund?.industry ? industryRanks[fund.industry] : null;
        
        // Pass industryRanks to apply multiplier
        const enhanced = computeEnhancedScore(vcp, bars, fund, industryData, industryRanks);
        result = { ticker, ...vcp, ...enhanced };
      }
    } catch (e) {
      console.warn(ticker, e.message);
      result = { ticker, score: 0, recommendation: 'avoid', vcpBullish: false, error: e.message, enhancedScore: 0, enhancedGrade: 'F' };
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

export { runScan, runScanStream };
