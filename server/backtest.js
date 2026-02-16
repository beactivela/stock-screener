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
 * @returns {Object} Saved snapshot metadata
 */
export function saveScanSnapshot(scanResults, scanDate = new Date()) {
  ensureBacktestDir();
  
  const dateStr = scanDate.toISOString().slice(0, 10);
  const snapshot = {
    scanDate: dateStr,
    scanTime: scanDate.toISOString(),
    tickerCount: scanResults.length,
    tickers: scanResults
      .filter(r => r.lastClose != null && !r.error) // Only valid results
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
      }))
  };
  
  const filename = `scan-${dateStr}.json`;
  const filepath = path.join(BACKTEST_DIR, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`📊 Backtest snapshot saved: ${filename} (${snapshot.tickers.length} tickers)`);
  
  return {
    filename,
    scanDate: dateStr,
    tickerCount: snapshot.tickers.length
  };
}

/**
 * Load a previous scan snapshot
 * 
 * @param {string|Date} scanDate - Date of the scan to load
 * @returns {Object|null} Snapshot object or null if not found
 */
export function loadScanSnapshot(scanDate) {
  ensureBacktestDir();
  
  const dateStr = typeof scanDate === 'string' ? scanDate : scanDate.toISOString().slice(0, 10);
  const filename = `scan-${dateStr}.json`;
  const filepath = path.join(BACKTEST_DIR, filename);
  
  if (!fs.existsSync(filepath)) return null;
  
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error loading snapshot ${filename}:`, e.message);
    return null;
  }
}

/**
 * List all available scan snapshots
 * 
 * @returns {Array} Array of {date, filename, tickerCount}
 */
export function listScanSnapshots() {
  ensureBacktestDir();
  
  if (!fs.existsSync(BACKTEST_DIR)) return [];
  
  const files = fs.readdirSync(BACKTEST_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first
  
  return files.map(filename => {
    try {
      const filepath = path.join(BACKTEST_DIR, filename);
      const snapshot = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      return {
        date: snapshot.scanDate,
        filename,
        tickerCount: snapshot.tickerCount,
        scanTime: snapshot.scanTime
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Calculate forward returns for a scan snapshot
 * Fetches current prices and compares to entry prices
 * 
 * @param {Object} snapshot - Scan snapshot from loadScanSnapshot()
 * @param {number} daysForward - Number of days forward to measure (e.g., 30, 60, 90)
 * @returns {Object|null} Backtest results or null if not enough time elapsed
 */
export async function calculateForwardReturns(snapshot, daysForward = 30) {
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
  
  console.log(`📈 Calculating ${daysForward}-day returns for ${snapshot.tickers.length} tickers...`);
  
  const results = [];
  let processed = 0;
  
  for (const entry of snapshot.tickers) {
    try {
      // Calculate target date (scanDate + daysForward)
      const targetDate = new Date(scanDate);
      targetDate.setDate(targetDate.getDate() + daysForward);
      
      // Get bars from scan date to target date (plus buffer for holidays)
      const toDate = new Date(targetDate);
      toDate.setDate(toDate.getDate() + 10); // Buffer for weekends/holidays
      
      const bars = await getDailyBars(
        entry.ticker,
        snapshot.scanDate,
        toDate.toISOString().slice(0, 10)
      );
      
      if (!bars || bars.length < Math.floor(daysForward * 0.7)) {
        // Not enough data (delisted, suspended, etc.)
        results.push({
          ...entry,
          forwardReturn: null,
          currentPrice: null,
          mfe: null,
          mae: null,
          outcome: 'NO_DATA',
          error: 'Insufficient data'
        });
        processed++;
        continue;
      }
      
      // Find price at T+daysForward (or closest available)
      const targetBar = bars[Math.min(daysForward, bars.length - 1)];
      const currentPrice = targetBar.c;
      
      const returnPct = ((currentPrice - entry.price) / entry.price) * 100;
      
      // Calculate max favorable excursion (MFE) and max adverse excursion (MAE)
      let maxPrice = entry.price;
      let minPrice = entry.price;
      const barsToAnalyze = bars.slice(0, Math.min(daysForward + 5, bars.length));
      
      for (const bar of barsToAnalyze) {
        maxPrice = Math.max(maxPrice, bar.h || bar.c);
        minPrice = Math.min(minPrice, bar.l || bar.c);
      }
      
      const mfe = ((maxPrice - entry.price) / entry.price) * 100;
      const mae = ((minPrice - entry.price) / entry.price) * 100;
      
      // Classify outcome
      // WIN: +20% gain OR +15% with <-8% drawdown
      // LOSS: -8% stop loss hit
      // NEUTRAL: Neither
      let outcome = 'NEUTRAL';
      if (returnPct >= 20 || (returnPct >= 15 && mae > -8)) {
        outcome = 'WIN';
      } else if (mae <= -8) {
        outcome = 'LOSS';
      }
      
      results.push({
        ...entry,
        forwardReturn: Math.round(returnPct * 100) / 100,
        currentPrice: Math.round(currentPrice * 100) / 100,
        mfe: Math.round(mfe * 100) / 100,
        mae: Math.round(mae * 100) / 100,
        outcome,
        barsAnalyzed: barsToAnalyze.length
      });
      
      processed++;
      
      // Progress log every 25 tickers
      if (processed % 25 === 0 || processed === snapshot.tickers.length) {
        console.log(`  ${processed} / ${snapshot.tickers.length}`);
      }
      
    } catch (e) {
      console.warn(`  ${entry.ticker}: ${e.message}`);
      results.push({
        ...entry,
        forwardReturn: null,
        currentPrice: null,
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
    results
  };
  
  const outputFilename = `backtest-${snapshot.scanDate}-${daysForward}d.json`;
  const outputPath = path.join(BACKTEST_DIR, outputFilename);
  fs.writeFileSync(outputPath, JSON.stringify(backtestResult, null, 2), 'utf8');
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
  
  // Group results by score bucket
  for (const r of backtestResults.results) {
    if (r.outcome === 'NO_DATA' || r.outcome === 'ERROR') continue;
    
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
    r => r.outcome !== 'NO_DATA' && r.outcome !== 'ERROR'
  );
  
  const totalWins = validTrades.filter(t => t.outcome === 'WIN').length;
  const totalLosses = validTrades.filter(t => t.outcome === 'LOSS').length;
  const overallWinRate = validTrades.length > 0
    ? Math.round((totalWins / validTrades.length) * 100 * 10) / 10
    : 0;
  
  return {
    scanDate: backtestResults.scanDate,
    daysForward: backtestResults.daysForward,
    calculatedAt: backtestResults.calculatedAt,
    byScoreBucket: analysis,
    summary: {
      totalTrades: validTrades.length,
      totalWins,
      totalLosses,
      overallWinRate,
      invalidResults: backtestResults.results.length - validTrades.length
    }
  };
}

/**
 * Run complete backtest: load snapshot, calculate returns, analyze
 * 
 * @param {string} scanDate - Date of scan to backtest (YYYY-MM-DD)
 * @param {number} daysForward - Days forward to measure (30, 60, 90, 180)
 * @returns {Object} Complete backtest analysis
 */
export async function runBacktest(scanDate, daysForward = 30) {
  console.log(`\n🧪 Running backtest for ${scanDate}, ${daysForward} days forward...\n`);
  
  // Load snapshot
  const snapshot = loadScanSnapshot(scanDate);
  if (!snapshot) {
    throw new Error(`No scan snapshot found for ${scanDate}`);
  }
  
  console.log(`Loaded snapshot: ${snapshot.tickerCount} tickers`);
  
  // Calculate forward returns
  const backtestResults = await calculateForwardReturns(snapshot, daysForward);
  
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
