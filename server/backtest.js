/**
 * Backtesting Engine
 * 
 * Tracks historical scan performance to validate scoring system.
 * Auto-saves scan snapshots and calculates forward returns.
 * 
 * Usage:
 * - After each scan: saveScanSnapshot(results)
 * - After 30+ days: runBacktest(scanDate, 30)
 * - View results: getBacktestAnalysis(scanDate, 30)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDailyBars } from './yahoo.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { EXIT_THRESHOLDS } from './opus45Signal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKTEST_DIR = path.join(DATA_DIR, 'backtests');

function ensureBacktestDir() {
  if (!fs.existsSync(BACKTEST_DIR)) {
    fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  }
}

/**
 * Save scan results for future backtesting
 * Creates a snapshot with date, scores, prices for each ticker
 * 
 * @param {Array} scanResults - Array of scan result objects
 * @param {Date} scanDate - Date of the scan (defaults to now)
 * @returns {Promise<Object>} Saved snapshot metadata
 */
export async function saveScanSnapshot(scanResults, scanDate = new Date()) {
  const dateStr = scanDate.toISOString().slice(0, 10);
  const tickers = scanResults
    .filter(r => r.lastClose != null && !r.error)
    .map(r => ({
      ticker: r.ticker,
      score: r.score || 0,
      enhancedScore: r.enhancedScore || r.score || 0,
      baseScore: r.baseScore || r.score || 0,
      vcpScore: r.vcpScore || 0,
      canslimScore: r.canslimScore || 0,
      industryScore: r.industryScore || 0,
      industryRank: r.industryRank || null,
      industryMultiplier: r.industryMultiplier || 1.0,
      relativeStrength: r.relativeStrength || null,
      price: r.lastClose,
      contractions: r.contractions,
      vcpBullish: r.vcpBullish,
      volumeDryUp: r.volumeDryUp,
      atMa10: r.atMa10,
      atMa20: r.atMa20,
      atMa50: r.atMa50,
    }));
  const snapshot = { scanDate: dateStr, scanTime: scanDate.toISOString(), tickerCount: tickers.length, tickers };

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { error } = await supabase.from('backtest_snapshots').upsert(
      { scan_date: dateStr, scan_time: snapshot.scanTime, ticker_count: tickers.length, tickers },
      { onConflict: 'scan_date' }
    );
    if (error) throw new Error(error.message);
  } else {
    ensureBacktestDir();
    const filepath = path.join(BACKTEST_DIR, `scan-${dateStr}.json`);
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');
  }
  console.log(`📊 Backtest snapshot saved: scan-${dateStr}.json (${tickers.length} tickers)`);
  return { filename: `scan-${dateStr}.json`, scanDate: dateStr, tickerCount: tickers.length };
}

/**
 * Load a previous scan snapshot
 * 
 * @param {string|Date} scanDate - Date of the scan to load
 * @returns {Promise<Object|null>} Snapshot object or null if not found
 */
export async function loadScanSnapshot(scanDate) {
  const dateStr = typeof scanDate === 'string' ? scanDate : scanDate.toISOString().slice(0, 10);
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('backtest_snapshots').select('*').eq('scan_date', dateStr).single();
    if (error || !data) return null;
    return {
      scanDate: data.scan_date,
      scanTime: data.scan_time,
      tickerCount: data.ticker_count,
      tickers: data.tickers || [],
    };
  }
  ensureBacktestDir();
  const filepath = path.join(BACKTEST_DIR, `scan-${dateStr}.json`);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error loading snapshot scan-${dateStr}.json:`, e.message);
    return null;
  }
}

/**
 * List all available scan snapshots
 * 
 * @returns {Promise<Array>} Array of {date, filename, tickerCount}
 */
export async function listScanSnapshots() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('backtest_snapshots').select('scan_date, scan_time, ticker_count').order('scan_date', { ascending: false });
    if (error) return [];
    return (data || []).map(r => ({
      date: r.scan_date,
      filename: `scan-${r.scan_date}.json`,
      tickerCount: r.ticker_count,
      scanTime: r.scan_time,
    }));
  }
  ensureBacktestDir();
  if (!fs.existsSync(BACKTEST_DIR)) return [];
  const files = fs.readdirSync(BACKTEST_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.map(filename => {
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(BACKTEST_DIR, filename), 'utf8'));
      return { date: snapshot.scanDate, filename, tickerCount: snapshot.tickerCount, scanTime: snapshot.scanTime };
    } catch { return null; }
  }).filter(Boolean);
}

/**
 * Calculate simple moving average for a series
 * @param {Array} values - Array of numbers
 * @param {number} period - Period for SMA calculation
 * @returns {number|null} SMA value or null if insufficient data
 */
function calculateSMA(values, period) {
  if (!values || values.length < period) return null;
  const sum = values.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Check if price is near MA (within 2%)
 * This is the "buy signal" - price bouncing off or near the MA
 * @param {number} price - Current price
 * @param {number} ma - Moving average value
 * @returns {boolean} True if price is within 2% of MA
 */
function isPriceNearMA(price, ma) {
  if (!price || !ma) return false;
  const diff = Math.abs(price - ma);
  const pct = (diff / ma) * 100;
  return pct <= 2.0; // Within 2%
}

/**
 * Calculate forward returns using 10 MA exit strategy
 * 
 * EXIT STRATEGY (aligned with opus45Signal.js and retroBacktest.js):
 * - Entry: First time price is at/near 10 MA after scan date (buy signal)
 * - Exit: 2 CONSECUTIVE closes below 10 MA (prevents whipsaw)
 * - Exit: -4% hard stop loss (aligned with opus45Signal.EXIT_THRESHOLDS, was -8%)
 * - Max hold: daysForward parameter (e.g., 30, 60, 90 days)
 * - Portfolio filtering: Optional topN to test only highest scoring stocks
 * 
 * @param {Object} snapshot - Scan snapshot from loadScanSnapshot()
 * @param {number} daysForward - Maximum days to hold (exit if no signal by then)
 * @param {number|null} topN - Optional: only test top N stocks by enhancedScore (null = all)
 * @returns {Object|null} Backtest results or null if not enough time elapsed
 */
export async function calculateForwardReturns(snapshot, daysForward = 30, topN = null) {
  const scanDate = new Date(snapshot.scanDate);
  const today = new Date();
  const daysElapsed = Math.floor((today - scanDate) / (1000 * 60 * 60 * 24));
  
  if (daysElapsed < daysForward) {
    return {
      error: 'not_enough_time',
      message: `Only ${daysElapsed} days elapsed, need ${daysForward}`,
      daysElapsed,
      daysNeeded: daysForward
    };
  }
  
  // Filter to top N stocks by enhancedScore if specified
  let tickersToTest = snapshot.tickers;
  if (topN && topN > 0) {
    tickersToTest = [...snapshot.tickers]
      .sort((a, b) => (b.enhancedScore || 0) - (a.enhancedScore || 0))
      .slice(0, topN);
    console.log(`📊 Portfolio filter: Testing top ${topN} stocks (out of ${snapshot.tickers.length})`);
  }
  
  console.log(`📈 Calculating ${daysForward}-day returns (10 MA exit strategy) for ${tickersToTest.length} tickers...`);
  
  const results = [];
  let processed = 0;
  
  for (const entry of tickersToTest) {
    try {
      // Calculate target date (scanDate + daysForward)
      const targetDate = new Date(scanDate);
      targetDate.setDate(targetDate.getDate() + daysForward);
      
      // FIX: Fetch bars starting 30 days BEFORE scan date
      // This provides enough historical data to calculate 10 MA from day 1
      const fromDate = new Date(scanDate);
      fromDate.setDate(fromDate.getDate() - 30); // 30 days of history for MA calculation
      
      // Get bars to target date (plus buffer for holidays)
      const toDate = new Date(targetDate);
      toDate.setDate(toDate.getDate() + 10); // Buffer for weekends/holidays
      
      const allBars = await getDailyBars(
        entry.ticker,
        fromDate.toISOString().slice(0, 10),
        toDate.toISOString().slice(0, 10)
      );
      
      if (!allBars || allBars.length < 15) {
        // Not enough data (delisted, suspended, etc.)
        results.push({
          ...entry,
          entryPrice: null,
          exitPrice: null,
          entryDate: null,
          exitDate: null,
          exitReason: 'NO_DATA',
          daysHeld: null,
          forwardReturn: null,
          mfe: null,
          mae: null,
          outcome: 'NO_DATA',
          error: 'Insufficient data'
        });
        processed++;
        continue;
      }
      
      // Find the index where scan date starts (first bar on or after scan date)
      const scanDateTs = scanDate.getTime();
      let scanDateIdx = allBars.findIndex(b => b.t >= scanDateTs);
      if (scanDateIdx === -1) {
        scanDateIdx = 0; // Fallback if no exact match
      }
      
      // We need bars AFTER the scan date for trading
      // The historical bars before scanDateIdx are just for MA calculation
      const bars = allBars; // Keep all bars for MA calculation
      
      // Step 1: Find entry point - first time price is at/near 10 MA after scan date
      let entryIdx = -1;
      let entryPrice = null;
      let entryDate = null;
      
      // Start looking from the scan date index (not index 0)
      // Look for buy signal starting from day after scan date
      for (let i = scanDateIdx + 1; i < Math.min(scanDateIdx + daysForward + 5, bars.length); i++) {
        const bar = bars[i];
        const closes = bars.slice(0, i + 1).map(b => b.c);
        
        // Calculate 10 MA at this point (now we have enough history!)
        const ma10 = calculateSMA(closes, 10);
        
        if (ma10 && isPriceNearMA(bar.c, ma10)) {
          // Found buy signal - price at/near 10 MA
          entryIdx = i;
          entryPrice = bar.c;
          entryDate = bar.t;
          break;
        }
      }
      
      // If no buy signal found, mark as NO_SIGNAL
      if (entryIdx === -1) {
        results.push({
          ...entry,
          entryPrice: null,
          exitPrice: null,
          entryDate: null,
          exitDate: null,
          exitReason: 'NO_SIGNAL',
          daysHeld: null,
          forwardReturn: null,
          mfe: null,
          mae: null,
          outcome: 'NO_SIGNAL',
          error: 'No buy signal (price never at 10 MA)'
        });
        processed++;
        continue;
      }
      
      // Step 2: Find exit using multi-phase strategy (matched to EXIT_THRESHOLDS)
      let exitIdx = -1;
      let exitPrice = null;
      let exitDate = null;
      let exitReason = 'MAX_HOLD';
      
      let maxPrice = entryPrice;
      let minPrice = entryPrice;
      let consecutiveBelowCount = 0;
      const requiredDaysBelowMA = EXIT_THRESHOLDS.below10MADays || 3;

      for (let i = entryIdx + 1; i < Math.min(entryIdx + daysForward, bars.length); i++) {
        const bar = bars[i];
        const allCloses = bars.slice(0, i + 1).map(b => b.c);
        
        maxPrice = Math.max(maxPrice, bar.h || bar.c);
        minPrice = Math.min(minPrice, bar.l || bar.c);
        
        const currentReturn = ((bar.c - entryPrice) / entryPrice) * 100;
        const maxGainPct = ((maxPrice - entryPrice) / entryPrice) * 100;
        
        // Phase 1: Hard stop loss
        if (currentReturn <= -EXIT_THRESHOLDS.stopLossPercent) {
          exitIdx = i; exitPrice = bar.c; exitDate = bar.t; exitReason = 'STOP_LOSS'; break;
        }
        
        // Phase 2: Breakeven stop
        if (maxGainPct >= (EXIT_THRESHOLDS.breakevenActivationPct || 5) && currentReturn <= -(EXIT_THRESHOLDS.breakevenBufferPct || 0.5)) {
          exitIdx = i; exitPrice = bar.c; exitDate = bar.t; exitReason = 'BREAKEVEN_STOP'; break;
        }
        
        // Phase 3: Trailing profit lock
        if (maxGainPct >= (EXIT_THRESHOLDS.profitLockActivationPct || 10)) {
          const minAcceptable = maxGainPct * (1 - (EXIT_THRESHOLDS.profitGivebackPct || 50) / 100);
          if (currentReturn < minAcceptable) {
            exitIdx = i; exitPrice = bar.c; exitDate = bar.t; exitReason = 'PROFIT_LOCK'; break;
          }
        }
        
        // Phase 4: Consecutive closes below 10 MA
        const ma10 = calculateSMA(allCloses, 10);
        if (ma10 && bar.c < ma10) {
          consecutiveBelowCount++;
          if (consecutiveBelowCount >= requiredDaysBelowMA) {
            exitIdx = i; exitPrice = bar.c; exitDate = bar.t; exitReason = `BELOW_10MA_${requiredDaysBelowMA}DAY`; break;
          }
        } else {
          consecutiveBelowCount = 0;
        }
      }
      
      if (exitIdx === -1) {
        exitIdx = Math.min(entryIdx + daysForward, bars.length - 1);
        const exitBar = bars[exitIdx];
        exitPrice = exitBar.c;
        exitDate = exitBar.t;
        exitReason = 'MAX_HOLD';
        for (let i = entryIdx + 1; i <= exitIdx; i++) {
          maxPrice = Math.max(maxPrice, bars[i].h || bars[i].c);
          minPrice = Math.min(minPrice, bars[i].l || bars[i].c);
        }
      }
      
      // Calculate metrics
      const daysHeld = exitIdx - entryIdx;
      const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const mfe = ((maxPrice - entryPrice) / entryPrice) * 100;
      const mae = ((minPrice - entryPrice) / entryPrice) * 100;
      
      // Classify outcome (aligned with retroBacktest.js)
      // WIN:     +10%+ gain (realistic for swing trades averaging 5-15 day holds)
      // LOSS:    negative return OR -4%+ drawdown hit stop
      // NEUTRAL: positive but below 10% (still profitable, just not a "big win")
      let outcome = 'NEUTRAL';
      if (returnPct >= 10) {
        outcome = 'WIN';
      } else if (returnPct < 0 || mae <= -4) {
        outcome = 'LOSS';
      }
      
      results.push({
        ...entry,
        entryPrice: Math.round(entryPrice * 100) / 100,
        exitPrice: Math.round(exitPrice * 100) / 100,
        entryDate: new Date(entryDate).toISOString().slice(0, 10),
        exitDate: new Date(exitDate).toISOString().slice(0, 10),
        exitReason,
        daysHeld,
        forwardReturn: Math.round(returnPct * 100) / 100,
        mfe: Math.round(mfe * 100) / 100,
        mae: Math.round(mae * 100) / 100,
        outcome
      });
      
      processed++;
      
      // Progress log every 25 tickers
      if (processed % 25 === 0 || processed === tickersToTest.length) {
        console.log(`  ${processed} / ${tickersToTest.length}`);
      }
      
    } catch (e) {
      console.warn(`  ${entry.ticker}: ${e.message}`);
      results.push({
        ...entry,
        entryPrice: null,
        exitPrice: null,
        entryDate: null,
        exitDate: null,
        exitReason: 'ERROR',
        daysHeld: null,
        forwardReturn: null,
        mfe: null,
        mae: null,
        outcome: 'ERROR',
        error: e.message
      });
      processed++;
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 150));
  }
  
  // Save backtest results
  const backtestResult = {
    scanDate: snapshot.scanDate,
    daysForward,
    calculatedAt: new Date().toISOString(),
    daysElapsed,
    totalTickers: results.length,
    portfolioSize: topN || 'ALL', // Track portfolio size filter
    strategy: '10MA_EXIT', // Mark which strategy was used
    results
  };
  
  const portfolioSuffix = topN ? `-top${topN}` : '';
  const outputFilename = `backtest-${snapshot.scanDate}-${daysForward}d-10ma${portfolioSuffix}.json`;
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase.from('backtest_results').upsert(
      { scan_date: snapshot.scanDate, holding_days: daysForward, result: backtestResult },
      { onConflict: 'scan_date,holding_days' }
    );
  }
  ensureBacktestDir();
  fs.writeFileSync(path.join(BACKTEST_DIR, outputFilename), JSON.stringify(backtestResult, null, 2), 'utf8');
  console.log(`✅ Backtest results saved: ${outputFilename}`);
  
  return backtestResult;
}

/**
 * Analyze backtest results - win rate by score bucket
 * 
 * @param {Object} backtestResults - Results from calculateForwardReturns()
 * @returns {Object} Analysis with win rates by score bucket
 */
export function analyzeBacktestResults(backtestResults) {
  const buckets = {
    '90-100': [],
    '80-89': [],
    '70-79': [],
    '60-69': [],
    '50-59': [],
    'below-50': []
  };
  
  // Group results by score bucket (exclude NO_DATA, ERROR, and NO_SIGNAL)
  for (const r of backtestResults.results) {
    if (r.outcome === 'NO_DATA' || r.outcome === 'ERROR' || r.outcome === 'NO_SIGNAL') continue;
    
    const score = r.enhancedScore;
    let bucket;
    if (score >= 90) bucket = '90-100';
    else if (score >= 80) bucket = '80-89';
    else if (score >= 70) bucket = '70-79';
    else if (score >= 60) bucket = '60-69';
    else if (score >= 50) bucket = '50-59';
    else bucket = 'below-50';
    
    buckets[bucket].push(r);
  }
  
  // Calculate statistics for each bucket
  const analysis = {};
  
  for (const [bucket, trades] of Object.entries(buckets)) {
    if (trades.length === 0) {
      analysis[bucket] = { count: 0 };
      continue;
    }
    
    const wins = trades.filter(t => t.outcome === 'WIN').length;
    const losses = trades.filter(t => t.outcome === 'LOSS').length;
    const neutrals = trades.filter(t => t.outcome === 'NEUTRAL').length;
    
    const avgReturn = trades.reduce((sum, t) => sum + (t.forwardReturn || 0), 0) / trades.length;
    const avgMFE = trades.reduce((sum, t) => sum + (t.mfe || 0), 0) / trades.length;
    const avgMAE = trades.reduce((sum, t) => sum + (t.mae || 0), 0) / trades.length;
    
    const winningTrades = trades.filter(t => t.outcome === 'WIN');
    const losingTrades = trades.filter(t => t.outcome === 'LOSS');
    
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.forwardReturn, 0) / winningTrades.length
      : 0;
    
    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.forwardReturn, 0) / losingTrades.length
      : 0;
    
    analysis[bucket] = {
      count: trades.length,
      winCount: wins,
      lossCount: losses,
      neutralCount: neutrals,
      winRate: Math.round((wins / trades.length) * 100 * 10) / 10,
      lossRate: Math.round((losses / trades.length) * 100 * 10) / 10,
      avgReturn: Math.round(avgReturn * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      avgMFE: Math.round(avgMFE * 100) / 100,
      avgMAE: Math.round(avgMAE * 100) / 100,
      bestTrade: Math.max(...trades.map(t => t.forwardReturn || -Infinity)),
      worstTrade: Math.min(...trades.map(t => t.forwardReturn || Infinity)),
      expectancy: Math.round((avgWin * (wins / trades.length) + avgLoss * (losses / trades.length)) * 100) / 100
    };
  }
  
  // Overall summary
  const validTrades = backtestResults.results.filter(
    r => r.outcome !== 'NO_DATA' && r.outcome !== 'ERROR' && r.outcome !== 'NO_SIGNAL'
  );
  
  const totalWins = validTrades.filter(t => t.outcome === 'WIN').length;
  const totalLosses = validTrades.filter(t => t.outcome === 'LOSS').length;
  const noSignalCount = backtestResults.results.filter(r => r.outcome === 'NO_SIGNAL').length;
  const overallWinRate = validTrades.length > 0
    ? Math.round((totalWins / validTrades.length) * 100 * 10) / 10
    : 0;
  
  // Calculate average hold time for valid trades
  const avgHoldTime = validTrades.length > 0
    ? Math.round(validTrades.reduce((sum, t) => sum + (t.daysHeld || 0), 0) / validTrades.length * 10) / 10
    : 0;
  
  const exitReasons = {
    STOP_LOSS: validTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    BREAKEVEN_STOP: validTrades.filter(t => t.exitReason === 'BREAKEVEN_STOP').length,
    PROFIT_LOCK: validTrades.filter(t => t.exitReason === 'PROFIT_LOCK').length,
    BELOW_10MA: validTrades.filter(t => t.exitReason?.startsWith('BELOW_10MA')).length,
    MAX_HOLD: validTrades.filter(t => t.exitReason === 'MAX_HOLD').length
  };
  
  return {
    scanDate: backtestResults.scanDate,
    daysForward: backtestResults.daysForward,
    calculatedAt: backtestResults.calculatedAt,
    strategy: backtestResults.strategy || 'UNKNOWN',
    portfolioSize: backtestResults.portfolioSize || 'ALL',
    byScoreBucket: analysis,
    summary: {
      totalTrades: validTrades.length,
      totalWins,
      totalLosses,
      overallWinRate,
      avgHoldTime,
      exitReasons,
      noSignalCount,
      invalidResults: backtestResults.results.length - validTrades.length
    }
  };
}

/**
 * Run complete backtest: load snapshot, calculate returns, analyze
 * 
 * @param {string} scanDate - Date of scan to backtest (YYYY-MM-DD)
 * @param {number} daysForward - Days forward to measure (30, 60, 90, 180)
 * @param {number|null} topN - Optional: only test top N stocks by enhancedScore
 * @returns {Object} Complete backtest analysis
 */
export async function runBacktest(scanDate, daysForward = 30, topN = null) {
  const portfolioMsg = topN ? ` (top ${topN} stocks)` : '';
  console.log(`\n🧪 Running backtest for ${scanDate}, ${daysForward} days forward${portfolioMsg}...\n`);
  
  // Load snapshot
  const snapshot = await loadScanSnapshot(scanDate);
  if (!snapshot) {
    throw new Error(`No scan snapshot found for ${scanDate}`);
  }
  
  console.log(`Loaded snapshot: ${snapshot.tickerCount} tickers`);
  
  // Calculate forward returns
  const backtestResults = await calculateForwardReturns(snapshot, daysForward, topN);
  
  if (backtestResults.error) {
    return backtestResults; // Return error info
  }
  
  // Analyze results
  const analysis = analyzeBacktestResults(backtestResults);
  
  return {
    backtestResults,
    analysis
  };
}
