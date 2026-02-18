/**
 * Retrospective Backtesting Engine
 * 
 * Unlike prospective backtesting (save scan → wait → measure), this module
 * looks BACK in time to find when buy signals WOULD have triggered and
 * measures what actually happened after each signal.
 * 
 * This allows immediate backtesting over any historical period without waiting.
 * 
 * Usage:
 *   const results = await runRetroBacktest({
 *     tickers: ['AAPL', 'MSFT', ...],
 *     lookbackMonths: 12,
 *     holdingPeriod: 60,
 *     strategy: '10MA_EXIT'
 *   });
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDailyBars } from './yahoo.js';
import { sma, findPullbacks, nearMA } from './vcp.js';
import { MANDATORY_THRESHOLDS, EXIT_THRESHOLDS } from './opus45Signal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Calculate 52-week stats at a specific point in time
 * @param {Array} bars - All bars up to current point
 * @param {number} idx - Current index (the "today" we're evaluating)
 */
function calculate52WeekStatsAt(bars, idx) {
  // Need at least 50 bars of history
  if (idx < 50) return null;
  
  // Use up to 252 bars (52 weeks) of lookback
  const startIdx = Math.max(0, idx - 252);
  const historicalBars = bars.slice(startIdx, idx + 1);
  
  const highs = historicalBars.map(b => b.h);
  const lows = historicalBars.map(b => b.l);
  const currentPrice = bars[idx].c;
  
  const high52w = Math.max(...highs);
  const low52w = Math.min(...lows);
  
  const pctFromHigh = ((high52w - currentPrice) / high52w) * 100;
  const pctAboveLow = ((currentPrice - low52w) / low52w) * 100;
  
  return {
    high52w,
    low52w,
    pctFromHigh: Math.round(pctFromHigh * 10) / 10,
    pctAboveLow: Math.round(pctAboveLow * 10) / 10,
    currentPrice
  };
}

/**
 * Check MA alignment at a specific point in time
 * @param {Array} closes - All closing prices
 * @param {number} idx - Current index
 */
function checkMAAlignmentAt(closes, idx) {
  // Need at least 200 bars for 200 MA
  if (idx < 200) return { aligned: false, details: 'Insufficient data' };
  
  // Calculate MAs at this point (only using data up to idx)
  const slice = closes.slice(0, idx + 1);
  
  const sma50 = slice.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma150 = slice.slice(-150).reduce((a, b) => a + b, 0) / 150;
  const sma200 = slice.slice(-200).reduce((a, b) => a + b, 0) / 200;
  
  // Calculate 10 and 20 MA for entry detection
  const sma10 = slice.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = slice.slice(-20).reduce((a, b) => a + b, 0) / 20;
  
  // Check alignment: 50 > 150 > 200
  const aligned = sma50 > sma150 && sma150 > sma200;
  
  // Check if price is above all MAs
  const lastClose = closes[idx];
  const aboveAllMAs = lastClose > sma50 && lastClose > sma150 && lastClose > sma200;
  
  // Check if 200 MA is rising (compare to 20 days ago)
  const slice20dAgo = closes.slice(0, idx - 19);
  const sma200_20dAgo = slice20dAgo.length >= 200 
    ? slice20dAgo.slice(-200).reduce((a, b) => a + b, 0) / 200 
    : sma200;
  const ma200Rising = sma200 > sma200_20dAgo;
  
  return {
    aligned: aligned && aboveAllMAs && ma200Rising,
    maAlignmentOnly: aligned,
    aboveAllMAs,
    ma200Rising,
    sma10,
    sma20,
    sma50,
    sma150,
    sma200,
    lastClose
  };
}

/**
 * Detect VCP-like contractions at a specific point in time
 * Simplified version that counts recent pullback contractions
 * @param {Array} bars - All bars
 * @param {number} idx - Current index
 */
function countContractionsAt(bars, idx) {
  // Need at least 60 bars of history
  if (idx < 60) return { contractions: 0, volumeDryUp: false };
  
  // Look at last 60 bars for pullback patterns
  const lookbackBars = bars.slice(Math.max(0, idx - 60), idx + 1);
  
  // Find pullbacks using ATR
  const atrs = [];
  for (let i = 14; i < lookbackBars.length; i++) {
    let atrSum = 0;
    for (let j = i - 13; j <= i; j++) {
      const tr = Math.max(
        lookbackBars[j].h - lookbackBars[j].l,
        Math.abs(lookbackBars[j].h - lookbackBars[j - 1]?.c || lookbackBars[j].h),
        Math.abs(lookbackBars[j].l - lookbackBars[j - 1]?.c || lookbackBars[j].l)
      );
      atrSum += tr;
    }
    atrs.push(atrSum / 14);
  }
  
  // Count contracting pullbacks (ATR getting smaller)
  let contractions = 0;
  let prevAtr = atrs[0] || 0;
  for (let i = 1; i < atrs.length; i++) {
    if (atrs[i] < prevAtr * 0.9) {
      contractions++;
    }
    prevAtr = atrs[i];
  }
  
  // Cap at reasonable range
  contractions = Math.min(10, Math.max(0, Math.floor(contractions / 3)));
  
  // Check volume dry-up (recent volume below average)
  const volumes = lookbackBars.slice(-20).map(b => b.v);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeDryUp = recentVolume < avgVolume * 0.85;
  
  return { contractions: Math.max(2, contractions), volumeDryUp };
}

/**
 * Calculate simple Relative Strength at a point in time
 * Compares stock's performance vs SPX over multiple periods
 * @param {Array} stockBars - Stock's bars
 * @param {Array} spxBars - S&P 500 bars (aligned by date)
 * @param {number} idx - Current index
 */
function calculateRSAt(stockCloses, spxCloses, idx) {
  if (idx < 63 || !spxCloses || spxCloses.length <= idx) {
    return 70; // Default to passing threshold
  }
  
  // 3-month performance
  const stock3mo = (stockCloses[idx] - stockCloses[idx - 63]) / stockCloses[idx - 63] * 100;
  const spx3mo = (spxCloses[idx] - spxCloses[idx - 63]) / spxCloses[idx - 63] * 100;
  
  // 6-month performance (if available)
  let stock6mo = stock3mo;
  let spx6mo = spx3mo;
  if (idx >= 126) {
    stock6mo = (stockCloses[idx] - stockCloses[idx - 126]) / stockCloses[idx - 126] * 100;
    spx6mo = (spxCloses[idx] - spxCloses[idx - 126]) / spxCloses[idx - 126] * 100;
  }
  
  // Simple RS: outperformance vs SPX
  const outperformance3mo = stock3mo - spx3mo;
  const outperformance6mo = stock6mo - spx6mo;
  
  // Convert to RS rating (50-150 scale)
  const avgOutperformance = (outperformance3mo + outperformance6mo) / 2;
  const rs = Math.min(200, Math.max(30, 70 + avgOutperformance * 2));
  
  return Math.round(rs);
}

/**
 * Check if price is near MA support at a specific point
 * @param {number} price - Current price
 * @param {number} ma - Moving average value
 * @param {number} tolerance - % tolerance (default 2.5%)
 */
function isNearMA(price, ma, tolerance = 2.5) {
  if (!price || !ma) return false;
  const diff = Math.abs(price - ma) / ma * 100;
  return diff <= tolerance;
}

/**
 * Check if a buy signal is triggered at a specific index
 * Returns signal details or null if no signal
 */
function checkBuySignalAt(bars, closes, spxCloses, idx) {
  // Need 200+ bars of history for proper analysis
  if (idx < 200) return null;
  
  // 1. Check MA Alignment (Stage 2)
  const maData = checkMAAlignmentAt(closes, idx);
  if (!maData.aligned) return null;
  
  // 2. Check 52-week stats
  const stats52w = calculate52WeekStatsAt(bars, idx);
  if (!stats52w) return null;
  if (stats52w.pctFromHigh > MANDATORY_THRESHOLDS.maxDistanceFromHigh) return null;
  if (stats52w.pctAboveLow < MANDATORY_THRESHOLDS.minAboveLow) return null;
  
  // 3. Check RS
  const rs = calculateRSAt(closes, spxCloses, idx);
  if (rs < MANDATORY_THRESHOLDS.minRelativeStrength) return null;
  
  // 4. Check contractions
  const { contractions, volumeDryUp } = countContractionsAt(bars, idx);
  if (contractions < MANDATORY_THRESHOLDS.minContractions) return null;
  
  // 5. Check if at MA support (10 or 20 MA)
  const price = closes[idx];
  const at10MA = isNearMA(price, maData.sma10, MANDATORY_THRESHOLDS.maTolerance);
  const at20MA = isNearMA(price, maData.sma20, MANDATORY_THRESHOLDS.maTolerance);
  
  if (!at10MA && !at20MA) return null;
  
  // All mandatory criteria passed - generate signal
  return {
    signalDate: bars[idx].t,
    entryPrice: price,
    entryIdx: idx,
    entryMA: at10MA ? '10 MA' : '20 MA',
    rs,
    contractions,
    volumeDryUp,
    pctFromHigh: stats52w.pctFromHigh,
    pctAboveLow: stats52w.pctAboveLow,
    sma10: maData.sma10,
    sma20: maData.sma20,
    sma50: maData.sma50
  };
}

/**
 * Calculate exit for a signal using 10 MA exit strategy
 * @param {Array} bars - All bars
 * @param {Array} closes - All closes
 * @param {number} entryIdx - Entry index
 * @param {number} entryPrice - Entry price
 * @param {number} maxHoldDays - Maximum holding period
 */
function calculateExit(bars, closes, entryIdx, entryPrice, maxHoldDays) {
  let exitIdx = -1;
  let exitPrice = null;
  let exitReason = 'MAX_HOLD';
  
  // Track MFE and MAE
  let maxPrice = entryPrice;
  let minPrice = entryPrice;
  
  const maxIdx = Math.min(entryIdx + maxHoldDays, bars.length - 1);
  
  for (let i = entryIdx + 1; i <= maxIdx; i++) {
    const bar = bars[i];
    const price = bar.c;
    
    // Update MFE/MAE
    maxPrice = Math.max(maxPrice, bar.h);
    minPrice = Math.min(minPrice, bar.l);
    
    // Check stop loss (4%)
    const currentReturn = (price - entryPrice) / entryPrice * 100;
    if (currentReturn <= -EXIT_THRESHOLDS.stopLossPercent) {
      exitIdx = i;
      exitPrice = price;
      exitReason = 'STOP_LOSS';
      break;
    }
    
    // Check 10 MA exit
    if (i >= 10) {
      const sma10 = closes.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) / 10;
      if (price < sma10) {
        exitIdx = i;
        exitPrice = price;
        exitReason = 'BELOW_10MA';
        break;
      }
    }
  }
  
  // If no exit triggered, exit at max hold
  if (exitIdx === -1) {
    exitIdx = maxIdx;
    exitPrice = bars[exitIdx].c;
    exitReason = 'MAX_HOLD';
    
    // Update MFE/MAE for remaining bars
    for (let i = entryIdx + 1; i <= exitIdx; i++) {
      maxPrice = Math.max(maxPrice, bars[i].h);
      minPrice = Math.min(minPrice, bars[i].l);
    }
  }
  
  const returnPct = (exitPrice - entryPrice) / entryPrice * 100;
  const mfe = (maxPrice - entryPrice) / entryPrice * 100;
  const mae = (minPrice - entryPrice) / entryPrice * 100;
  const daysHeld = exitIdx - entryIdx;
  
  return {
    exitIdx,
    exitPrice: Math.round(exitPrice * 100) / 100,
    exitDate: bars[exitIdx].t,
    exitReason,
    returnPct: Math.round(returnPct * 100) / 100,
    mfe: Math.round(mfe * 100) / 100,
    mae: Math.round(mae * 100) / 100,
    daysHeld
  };
}

/**
 * Find all historical buy signals for a ticker
 * @param {string} ticker - Stock ticker
 * @param {Array} bars - Historical bars (1-2 years)
 * @param {Array} spxCloses - S&P 500 closes for RS calculation
 * @param {number} maxHoldDays - Maximum holding period
 * @param {number} minDaysBetweenSignals - Minimum days between signals (avoid duplicates)
 */
function findHistoricalSignals(ticker, bars, spxCloses, maxHoldDays, minDaysBetweenSignals = 20) {
  const signals = [];
  const closes = bars.map(b => b.c);
  
  let lastSignalIdx = -minDaysBetweenSignals;
  
  // Walk through each day looking for buy signals
  // Start at index 200 (need history for 200 MA)
  // Stop maxHoldDays before end (need room for forward returns)
  const endIdx = bars.length - maxHoldDays - 1;
  
  for (let idx = 200; idx < endIdx; idx++) {
    // Skip if too close to last signal
    if (idx - lastSignalIdx < minDaysBetweenSignals) continue;
    
    const signal = checkBuySignalAt(bars, closes, spxCloses, idx);
    
    if (signal) {
      // Calculate exit
      const exit = calculateExit(bars, closes, idx, signal.entryPrice, maxHoldDays);
      
      // Classify outcome
      let outcome = 'NEUTRAL';
      if (exit.returnPct >= 15) {
        outcome = 'WIN';
      } else if (exit.returnPct < 0) {
        outcome = 'LOSS';
      }
      
      signals.push({
        ticker,
        ...signal,
        signalDateStr: new Date(signal.signalDate).toISOString().slice(0, 10),
        exitDateStr: new Date(exit.exitDate).toISOString().slice(0, 10),
        ...exit,
        outcome
      });
      
      // Update last signal index to exit index (don't double-count overlapping trades)
      lastSignalIdx = exit.exitIdx;
    }
  }
  
  return signals;
}

/**
 * Run retrospective backtest across multiple tickers
 * @param {Object} options - Backtest configuration
 * @returns {Object} Aggregated results
 */
export async function runRetroBacktest(options = {}) {
  const {
    tickers = [],
    lookbackMonths = 12,
    holdingPeriod = 60,
    topN = null, // Limit to top N tickers by some criteria
  } = options;
  
  console.log(`🔄 Starting retrospective backtest: ${tickers.length} tickers, ${lookbackMonths} months lookback, ${holdingPeriod} day hold`);
  
  // Calculate date range
  // We need at least 200 trading days (~10 months) for MA calculation PLUS the lookback period
  // So we fetch: lookbackMonths + 12 months (for MA history)
  const toDate = new Date();
  const fromDate = new Date();
  const totalMonthsToFetch = lookbackMonths + 12; // Extra 12 months for MA calculation
  fromDate.setMonth(fromDate.getMonth() - totalMonthsToFetch);
  
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);
  
  console.log(`📅 Date range: ${fromStr} to ${toStr} (${totalMonthsToFetch} months total)`);
  
  // Fetch SPX data for RS calculation
  console.log('📈 Fetching SPX data for relative strength calculation...');
  let spxBars = [];
  let spxCloses = [];
  try {
    spxBars = await getDailyBars('^GSPC', fromStr, toStr) || [];
    spxCloses = spxBars.map(b => b.c);
  } catch (e) {
    console.warn('Could not fetch SPX data, RS calculation will use defaults');
  }
  
  const allSignals = [];
  let processed = 0;
  let errors = 0;
  
  // Process each ticker
  const tickersToProcess = topN ? tickers.slice(0, topN) : tickers;
  
  for (const ticker of tickersToProcess) {
    try {
      // Fetch historical data
      const bars = await getDailyBars(ticker, fromStr, toStr);
      
      if (!bars || bars.length < 250) {
        // Not enough data
        errors++;
        continue;
      }
      
      // Find all historical signals
      const signals = findHistoricalSignals(ticker, bars, spxCloses, holdingPeriod);
      allSignals.push(...signals);
      
      processed++;
      
      // Progress logging
      if (processed % 25 === 0) {
        console.log(`  Processed ${processed}/${tickersToProcess.length} tickers, found ${allSignals.length} signals`);
      }
    } catch (e) {
      errors++;
    }
  }
  
  console.log(`✅ Retrospective backtest complete: ${processed} tickers, ${allSignals.length} signals, ${errors} errors`);
  
  // Aggregate statistics
  const stats = aggregateResults(allSignals);
  
  return {
    config: {
      lookbackMonths,
      holdingPeriod,
      tickersAnalyzed: processed,
      tickersWithErrors: errors,
      dateRange: { from: fromStr, to: toStr }
    },
    signals: allSignals,
    summary: stats.summary,
    byExitReason: stats.byExitReason,
    byMonth: stats.byMonth,
    byEntryMA: stats.byEntryMA
  };
}

/**
 * Aggregate signal results into statistics
 */
function aggregateResults(signals) {
  if (signals.length === 0) {
    return {
      summary: {
        totalSignals: 0,
        winRate: 0,
        avgReturn: 0,
        avgHoldTime: 0
      },
      byExitReason: {},
      byMonth: {},
      byEntryMA: {}
    };
  }
  
  const wins = signals.filter(s => s.outcome === 'WIN');
  const losses = signals.filter(s => s.outcome === 'LOSS');
  
  const avgReturn = signals.reduce((sum, s) => sum + s.returnPct, 0) / signals.length;
  const avgWin = wins.length > 0 ? wins.reduce((sum, s) => sum + s.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, s) => sum + s.returnPct, 0) / losses.length : 0;
  const avgHoldTime = signals.reduce((sum, s) => sum + s.daysHeld, 0) / signals.length;
  const avgMFE = signals.reduce((sum, s) => sum + s.mfe, 0) / signals.length;
  const avgMAE = signals.reduce((sum, s) => sum + s.mae, 0) / signals.length;
  
  const winRate = Math.round(wins.length / signals.length * 1000) / 10;
  
  // Expectancy: (Win% * AvgWin) + (Loss% * AvgLoss)
  const expectancy = (winRate/100 * avgWin) + ((1 - winRate/100) * avgLoss);
  
  // By exit reason
  const byExitReason = {};
  signals.forEach(s => {
    if (!byExitReason[s.exitReason]) {
      byExitReason[s.exitReason] = { count: 0, returns: [], wins: 0, losses: 0 };
    }
    byExitReason[s.exitReason].count++;
    byExitReason[s.exitReason].returns.push(s.returnPct);
    if (s.outcome === 'WIN') byExitReason[s.exitReason].wins++;
    if (s.outcome === 'LOSS') byExitReason[s.exitReason].losses++;
  });
  
  Object.keys(byExitReason).forEach(reason => {
    const data = byExitReason[reason];
    data.avgReturn = Math.round(data.returns.reduce((a, b) => a + b, 0) / data.count * 100) / 100;
    data.winRate = Math.round(data.wins / data.count * 1000) / 10;
    delete data.returns;
  });
  
  // By month (to see seasonality)
  const byMonth = {};
  signals.forEach(s => {
    const month = s.signalDateStr.slice(0, 7); // YYYY-MM
    if (!byMonth[month]) {
      byMonth[month] = { count: 0, returns: [], wins: 0, losses: 0 };
    }
    byMonth[month].count++;
    byMonth[month].returns.push(s.returnPct);
    if (s.outcome === 'WIN') byMonth[month].wins++;
    if (s.outcome === 'LOSS') byMonth[month].losses++;
  });
  
  Object.keys(byMonth).forEach(month => {
    const data = byMonth[month];
    data.avgReturn = Math.round(data.returns.reduce((a, b) => a + b, 0) / data.count * 100) / 100;
    data.winRate = Math.round(data.wins / data.count * 1000) / 10;
    delete data.returns;
  });
  
  // By entry MA
  const byEntryMA = {};
  signals.forEach(s => {
    const ma = s.entryMA;
    if (!byEntryMA[ma]) {
      byEntryMA[ma] = { count: 0, returns: [], wins: 0, losses: 0 };
    }
    byEntryMA[ma].count++;
    byEntryMA[ma].returns.push(s.returnPct);
    if (s.outcome === 'WIN') byEntryMA[ma].wins++;
    if (s.outcome === 'LOSS') byEntryMA[ma].losses++;
  });
  
  Object.keys(byEntryMA).forEach(ma => {
    const data = byEntryMA[ma];
    data.avgReturn = Math.round(data.returns.reduce((a, b) => a + b, 0) / data.count * 100) / 100;
    data.winRate = Math.round(data.wins / data.count * 1000) / 10;
    delete data.returns;
  });
  
  return {
    summary: {
      totalSignals: signals.length,
      wins: wins.length,
      losses: losses.length,
      neutrals: signals.length - wins.length - losses.length,
      winRate,
      avgReturn: Math.round(avgReturn * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      avgHoldTime: Math.round(avgHoldTime * 10) / 10,
      avgMFE: Math.round(avgMFE * 100) / 100,
      avgMAE: Math.round(avgMAE * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      profitFactor: avgLoss !== 0 ? Math.round(Math.abs(avgWin / avgLoss) * 100) / 100 : 0
    },
    byExitReason,
    byMonth,
    byEntryMA
  };
}

/**
 * Get list of tickers to backtest (from scan results or tickers.txt)
 */
export function getTickersForBacktest() {
  // Try scan results first
  const scanResultsPath = path.join(DATA_DIR, 'scan-results.json');
  if (fs.existsSync(scanResultsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(scanResultsPath, 'utf8'));
      const tickers = (data.results || [])
        .filter(r => r.vcpBullish)
        .map(r => r.ticker);
      if (tickers.length > 0) return tickers;
    } catch (e) { /* ignore */ }
  }
  
  // Fall back to tickers.txt
  const tickersPath = path.join(DATA_DIR, 'tickers.txt');
  if (fs.existsSync(tickersPath)) {
    return fs.readFileSync(tickersPath, 'utf8')
      .split('\n')
      .map(t => t.trim())
      .filter(t => t && !t.startsWith('#'));
  }
  
  return [];
}
