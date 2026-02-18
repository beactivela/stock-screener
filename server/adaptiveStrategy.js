/**
 * Adaptive Momentum Strategy
 * 
 * Combines Minervini VCP + O'Neil CANSLIM + Momentum indicators with
 * a self-learning feedback loop that evaluates past signals and optimizes
 * future recommendations.
 * 
 * KEY FEATURES:
 * - Enhanced entry signals with multiple confirmation factors
 * - Dynamic exit rules (trailing stops, profit targets, time-based)
 * - Learning loop that analyzes past trades and adjusts weights
 * - Portfolio-level backtesting with position sizing
 * - Full performance metrics (win rate, profit factor, max drawdown)
 * 
 * METHODOLOGY:
 * Entry: VCP pattern + MA support + RS momentum + Volume confirmation
 * Exit: Trailing stop (from 21 EMA), hard stop (4%), profit target (multiple R)
 * Position Size: Risk-based (2% account risk per trade)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDailyBars } from './yahoo.js';
import { sma, findPullbacks, nearMA } from './vcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STRATEGY_DIR = path.join(DATA_DIR, 'adaptive-strategy');

// ============================================================================
// CONFIGURATION - These get optimized by the learning system
// ============================================================================

/**
 * Default strategy parameters. The learning loop adjusts these based on
 * historical performance. Each parameter has a min/max range for safety.
 */
export const DEFAULT_PARAMS = {
  // Entry criteria weights (0-20 each, total ~100)
  entry: {
    vcpContractionsWeight: 15,      // Weight for 3+ contractions
    volumeDryUpWeight: 10,          // Weight for volume drying up
    at10MAWeight: 12,               // Weight for price at 10 MA (tight entry)
    at20MAWeight: 8,                // Weight for price at 20 MA
    rsAbove80Weight: 10,            // Weight for RS > 80
    rsAbove90Weight: 5,             // Bonus for RS > 90
    maAlignmentWeight: 15,          // Weight for 50 > 150 > 200 MA
    above52wLowWeight: 5,           // Weight for 25%+ above 52w low
    near52wHighWeight: 10,          // Weight for within 15% of 52w high
    volumeConfirmWeight: 10,        // Weight for volume expansion on bounce
  },
  
  // Entry thresholds (relaxed for more signals, learning will tighten)
  thresholds: {
    minRS: 50,                      // Minimum relative strength (relaxed from 70)
    minContractions: 1,             // Minimum VCP contractions (relaxed from 2)
    maxDistFromHigh: 35,            // Max % below 52-week high (relaxed from 25)
    minAboveLow: 15,                // Min % above 52-week low (relaxed from 25)
    maTolerance: 4.0,               // % tolerance for "at MA" (relaxed from 2.5)
    minEntryScore: 35,              // Minimum score to trigger entry (relaxed from 50)
  },
  
  // Exit rules
  exit: {
    hardStopPct: 4,                 // Hard stop loss (% from entry)
    trailingStopATR: 2.0,           // Trailing stop in ATR units
    profitTarget1: 10,              // First profit target (%)
    profitTarget2: 20,              // Second profit target (%)
    profitTarget3: 30,              // Third profit target (%)
    scaleOut1Pct: 33,               // % to sell at target 1
    scaleOut2Pct: 33,               // % to sell at target 2
    maxHoldDays: 90,                // Maximum holding period
    exitBelowMA: 10,                // Exit if closes below this MA
  },
  
  // Position sizing
  position: {
    accountRiskPct: 2.0,            // % of account to risk per trade
    maxPositionPct: 15,             // Max position size (% of account)
    maxPositions: 10,               // Max concurrent positions
    minPositionSize: 2000,          // Minimum $ per position
  },
  
  // Learning settings
  learning: {
    minTradesForLearning: 30,       // Min trades before adjusting params
    learningRate: 0.15,             // How aggressively to adjust (0-1)
    decayFactor: 0.9,               // Weight recent trades more
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Ensure strategy directory exists
 */
function ensureStrategyDir() {
  if (!fs.existsSync(STRATEGY_DIR)) {
    fs.mkdirSync(STRATEGY_DIR, { recursive: true });
  }
}

/**
 * Calculate Exponential Moving Average
 * @param {Array} values - Array of prices
 * @param {number} period - EMA period
 * @returns {Array} EMA values
 */
function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  
  for (let i = 1; i < values.length; i++) {
    const prev = result[i - 1] ?? values[i];
    result.push((values[i] - prev) * multiplier + prev);
  }
  
  return result;
}

/**
 * Calculate Average True Range
 * @param {Array} bars - OHLC bars
 * @param {number} period - ATR period
 * @returns {Array} ATR values
 */
function atr(bars, period = 14) {
  if (bars.length < 2) return bars.map(() => null);
  
  const trueRanges = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trueRanges.push(bars[i].h - bars[i].l);
    } else {
      const tr = Math.max(
        bars[i].h - bars[i].l,
        Math.abs(bars[i].h - bars[i - 1].c),
        Math.abs(bars[i].l - bars[i - 1].c)
      );
      trueRanges.push(tr);
    }
  }
  
  // Calculate ATR using SMA for first value, then EMA
  const result = [];
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      const sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    } else {
      const prev = result[i - 1];
      result.push((prev * (period - 1) + trueRanges[i]) / period);
    }
  }
  
  return result;
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param {Array} closes - Close prices
 * @param {number} period - RSI period
 * @returns {Array} RSI values
 */
function rsi(closes, period = 14) {
  const result = [];
  const gains = [];
  const losses = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(null);
      gains.push(0);
      losses.push(0);
      continue;
    }
    
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
    
    if (i < period) {
      result.push(null);
      continue;
    }
    
    let avgGain, avgLoss;
    if (i === period) {
      avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
      avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    } else {
      const prevRSI = result[i - 1];
      // Use smoothed average
      avgGain = ((gains[i - 1] || 0) * (period - 1) + gains[i]) / period;
      avgLoss = ((losses[i - 1] || 0) * (period - 1) + losses[i]) / period;
    }
    
    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }
  
  return result;
}

/**
 * Calculate MACD
 * @param {Array} closes - Close prices
 * @returns {Object} { macd, signal, histogram }
 */
function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = ema(closes, fastPeriod);
  const slowEMA = ema(closes, slowPeriod);
  
  const macdLine = fastEMA.map((f, i) => {
    if (slowEMA[i] == null || f == null) return null;
    return f - slowEMA[i];
  });
  
  const validMacd = macdLine.filter(v => v != null);
  const signalLine = ema(validMacd, signalPeriod);
  
  // Pad signal line to match original length
  const paddedSignal = new Array(macdLine.length - signalLine.length).fill(null).concat(signalLine);
  
  const histogram = macdLine.map((m, i) => {
    if (m == null || paddedSignal[i] == null) return null;
    return m - paddedSignal[i];
  });
  
  return { macd: macdLine, signal: paddedSignal, histogram };
}

// ============================================================================
// ENTRY SIGNAL ANALYSIS
// ============================================================================

/**
 * Calculate all technical metrics at a specific point in time
 * @param {Array} bars - All historical bars
 * @param {number} idx - Current index (the "today" we're evaluating)
 * @param {Array} spxCloses - S&P 500 closes for RS calculation
 * @returns {Object} All technical metrics
 */
function calculateMetricsAt(bars, idx, spxCloses = null) {
  // Need sufficient history
  if (idx < 200) return null;
  
  const closes = bars.slice(0, idx + 1).map(b => b.c);
  const highs = bars.slice(0, idx + 1).map(b => b.h);
  const lows = bars.slice(0, idx + 1).map(b => b.l);
  const volumes = bars.slice(0, idx + 1).map(b => b.v || 0);
  
  const price = closes[idx];
  
  // Moving Averages
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma150 = closes.slice(-150).reduce((a, b) => a + b, 0) / 150;
  const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  
  const ema21 = ema(closes, 21);
  const ema21Value = ema21[ema21.length - 1];
  
  // MA Alignment check (Minervini Stage 2)
  const maAligned = sma50 > sma150 && sma150 > sma200;
  const aboveAllMAs = price > sma50 && price > sma150 && price > sma200;
  
  // 200 MA rising (compare to 20 days ago)
  const sma200_20dAgo = closes.length >= 220 
    ? closes.slice(-220, -20).slice(-200).reduce((a, b) => a + b, 0) / 200
    : sma200;
  const ma200Rising = sma200 > sma200_20dAgo;
  
  // 52-week stats
  const lookback52w = Math.min(252, idx);
  const high52w = Math.max(...highs.slice(-lookback52w));
  const low52w = Math.min(...lows.slice(-lookback52w));
  const pctFromHigh = ((high52w - price) / high52w) * 100;
  const pctAboveLow = ((price - low52w) / low52w) * 100;
  
  // At MA support checks
  const tolerance = 0.025; // 2.5%
  const at10MA = Math.abs(price - sma10) / sma10 <= tolerance;
  const at20MA = Math.abs(price - sma20) / sma20 <= tolerance;
  const at50MA = Math.abs(price - sma50) / sma50 <= tolerance;
  const atEma21 = Math.abs(price - ema21Value) / ema21Value <= tolerance;
  
  // Volume analysis
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const recentVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeRatio = avgVol20 > 0 ? recentVol5 / avgVol20 : 1;
  const volumeAboveAvg = volumeRatio > 1.0;
  
  // ATR for volatility
  const atrValues = atr(bars.slice(0, idx + 1), 14);
  const currentATR = atrValues[atrValues.length - 1] || (price * 0.02);
  const atrPct = (currentATR / price) * 100;
  
  // RSI
  const rsiValues = rsi(closes, 14);
  const currentRSI = rsiValues[rsiValues.length - 1] || 50;
  
  // MACD
  const macdData = macd(closes);
  const macdHistogram = macdData.histogram[macdData.histogram.length - 1] || 0;
  const prevMacdHistogram = macdData.histogram[macdData.histogram.length - 2] || 0;
  const macdRising = macdHistogram > prevMacdHistogram;
  const macdPositive = macdHistogram > 0;
  
  // Relative Strength vs SPX
  let rs = 70; // Default
  if (spxCloses && spxCloses.length > idx && idx >= 63) {
    const stock3mo = (price - closes[idx - 63]) / closes[idx - 63] * 100;
    const spx3mo = (spxCloses[idx] - spxCloses[idx - 63]) / spxCloses[idx - 63] * 100;
    
    let stock6mo = stock3mo;
    let spx6mo = spx3mo;
    if (idx >= 126) {
      stock6mo = (price - closes[idx - 126]) / closes[idx - 126] * 100;
      spx6mo = (spxCloses[idx] - spxCloses[idx - 126]) / spxCloses[idx - 126] * 100;
    }
    
    const outperformance = ((stock3mo + stock6mo) / 2) - ((spx3mo + spx6mo) / 2);
    rs = Math.min(100, Math.max(0, 50 + outperformance * 2));
  }
  
  // VCP Contraction analysis - simplified approach
  let contractions = 0;
  let volumeDryUp = false;
  
  const lookbackBars = bars.slice(Math.max(0, idx - 60), idx + 1);
  if (lookbackBars.length >= 20) {
    // Look at price ranges in windows to detect volatility contraction
    const windowSize = 10;
    const ranges = [];
    
    for (let i = windowSize; i < lookbackBars.length; i += Math.floor(windowSize / 2)) {
      const windowBars = lookbackBars.slice(i - windowSize, i);
      const windowHigh = Math.max(...windowBars.map(b => b.h));
      const windowLow = Math.min(...windowBars.map(b => b.l));
      const rangePct = ((windowHigh - windowLow) / windowLow) * 100;
      ranges.push(rangePct);
    }
    
    // Count contractions (each range smaller than previous)
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i] < ranges[i - 1] * 0.85) {
        contractions++;
      }
    }
    
    // Default to at least 1 contraction if in consolidation
    const recentRange = ranges[ranges.length - 1] || 10;
    if (recentRange < 8 && contractions === 0) {
      contractions = 1; // Tight base counts as at least 1
    }
    
    // Volume dry-up check
    const pullbackVol = lookbackBars.slice(-10).map(b => b.v || 0);
    const avgPullbackVol = pullbackVol.reduce((a, b) => a + b, 0) / pullbackVol.length;
    volumeDryUp = avgPullbackVol < avgVol20 * 0.9;
  }
  
  return {
    price,
    date: bars[idx].t,
    
    // Moving averages
    sma10, sma20, sma50, sma150, sma200, ema21: ema21Value,
    maAligned, aboveAllMAs, ma200Rising,
    
    // 52-week
    high52w, low52w, pctFromHigh, pctAboveLow,
    
    // MA proximity
    at10MA, at20MA, at50MA, atEma21,
    
    // Volume
    avgVol20, volumeRatio, volumeAboveAvg,
    
    // Volatility
    atr: currentATR, atrPct,
    
    // Momentum
    rsi: currentRSI, macdHistogram, macdRising, macdPositive,
    
    // VCP
    contractions, volumeDryUp,
    
    // Relative Strength
    rs
  };
}

/**
 * Calculate entry signal score
 * @param {Object} metrics - Technical metrics from calculateMetricsAt
 * @param {Object} params - Strategy parameters
 * @returns {Object} { score, passed, factors, failReasons }
 */
function calculateEntryScore(metrics, params = DEFAULT_PARAMS) {
  if (!metrics) return { score: 0, passed: false, factors: [], failReasons: ['No metrics'] };
  
  const { entry, thresholds } = params;
  const factors = [];
  const failReasons = [];
  let score = 0;
  
  // === MANDATORY CHECKS (must pass KEY requirements) ===
  // Relaxed to generate more signals - the scoring system will filter quality
  
  // 1. Stage 2: Price above 50 MA minimum (less strict than full alignment)
  const inUptrend = metrics.price > metrics.sma50;
  if (!inUptrend) {
    failReasons.push('Not in uptrend (below 50 MA)');
  }
  
  // 2. Relative Strength - must show some outperformance
  if (metrics.rs < thresholds.minRS) {
    failReasons.push(`RS ${Math.round(metrics.rs)} < ${thresholds.minRS}`);
  }
  
  // 3. 52-week position - not too extended from high
  if (metrics.pctFromHigh > thresholds.maxDistFromHigh) {
    failReasons.push(`${Math.round(metrics.pctFromHigh)}% from high > ${thresholds.maxDistFromHigh}%`);
  }
  
  // 4. Near some form of support (MA or 50 MA) - expanded tolerance
  const at50MA = Math.abs(metrics.price - metrics.sma50) / metrics.sma50 <= (thresholds.maTolerance + 2) / 100;
  const atSupport = metrics.at10MA || metrics.at20MA || metrics.atEma21 || at50MA;
  if (!atSupport) {
    failReasons.push('Not near any MA support');
  }
  
  // Note: Contractions check moved to scoring (not mandatory)
  
  // If any mandatory check fails, return early
  if (failReasons.length > 0) {
    return { score: 0, passed: false, factors, failReasons };
  }
  
  // === SCORING FACTORS ===
  
  // VCP contractions (15 pts)
  if (metrics.contractions >= 3) {
    score += entry.vcpContractionsWeight;
    factors.push({ name: '3+ VCP contractions', points: entry.vcpContractionsWeight });
  } else if (metrics.contractions >= 2) {
    const pts = Math.round(entry.vcpContractionsWeight * 0.6);
    score += pts;
    factors.push({ name: '2 VCP contractions', points: pts });
  }
  
  // Volume dry-up (10 pts)
  if (metrics.volumeDryUp) {
    score += entry.volumeDryUpWeight;
    factors.push({ name: 'Volume dry-up', points: entry.volumeDryUpWeight });
  }
  
  // MA support quality (12 pts for 10 MA, 8 pts for 20 MA)
  if (metrics.at10MA) {
    score += entry.at10MAWeight;
    factors.push({ name: 'At 10 MA (tight entry)', points: entry.at10MAWeight });
  } else if (metrics.atEma21) {
    const pts = Math.round((entry.at10MAWeight + entry.at20MAWeight) / 2);
    score += pts;
    factors.push({ name: 'At 21 EMA', points: pts });
  } else if (metrics.at20MA) {
    score += entry.at20MAWeight;
    factors.push({ name: 'At 20 MA', points: entry.at20MAWeight });
  }
  
  // Relative Strength (15 pts)
  if (metrics.rs >= 90) {
    score += entry.rsAbove80Weight + entry.rsAbove90Weight;
    factors.push({ name: `RS ${Math.round(metrics.rs)} > 90`, points: entry.rsAbove80Weight + entry.rsAbove90Weight });
  } else if (metrics.rs >= 80) {
    score += entry.rsAbove80Weight;
    factors.push({ name: `RS ${Math.round(metrics.rs)} > 80`, points: entry.rsAbove80Weight });
  }
  
  // MA alignment (15 pts)
  if (metrics.maAligned && metrics.aboveAllMAs && metrics.ma200Rising) {
    score += entry.maAlignmentWeight;
    factors.push({ name: 'Full MA alignment (Stage 2)', points: entry.maAlignmentWeight });
  }
  
  // 52-week position (15 pts)
  if (metrics.pctFromHigh <= 10) {
    score += entry.near52wHighWeight;
    factors.push({ name: `Within ${Math.round(metrics.pctFromHigh)}% of 52w high`, points: entry.near52wHighWeight });
  } else if (metrics.pctFromHigh <= 15) {
    const pts = Math.round(entry.near52wHighWeight * 0.7);
    score += pts;
    factors.push({ name: `Within ${Math.round(metrics.pctFromHigh)}% of 52w high`, points: pts });
  }
  
  if (metrics.pctAboveLow >= 50) {
    score += entry.above52wLowWeight;
    factors.push({ name: `${Math.round(metrics.pctAboveLow)}% above 52w low`, points: entry.above52wLowWeight });
  }
  
  // Volume confirmation (10 pts)
  if (metrics.volumeAboveAvg) {
    score += entry.volumeConfirmWeight;
    factors.push({ name: 'Volume above average', points: entry.volumeConfirmWeight });
  }
  
  // Momentum bonus (unlisted - up to 10 pts)
  if (metrics.macdRising && metrics.macdPositive) {
    score += 5;
    factors.push({ name: 'MACD positive & rising', points: 5 });
  }
  if (metrics.rsi >= 50 && metrics.rsi <= 70) {
    score += 5;
    factors.push({ name: `RSI ${Math.round(metrics.rsi)} in sweet spot`, points: 5 });
  }
  
  const passed = score >= thresholds.minEntryScore;
  
  return {
    score: Math.min(100, score),
    passed,
    factors,
    failReasons: passed ? [] : [`Score ${score} < ${thresholds.minEntryScore}`]
  };
}

// ============================================================================
// EXIT SIGNAL ANALYSIS
// ============================================================================

/**
 * Check exit conditions
 * @param {Object} position - Current position { entryPrice, entryDate, entryIdx, shares, ticker }
 * @param {Array} bars - All bars
 * @param {number} currentIdx - Current bar index
 * @param {Object} params - Strategy parameters
 * @returns {Object} { shouldExit, exitType, exitPrice, remainingShares, reason }
 */
function checkExitConditions(position, bars, currentIdx, params = DEFAULT_PARAMS) {
  const { exit } = params;
  const bar = bars[currentIdx];
  const price = bar.c;
  const entryPrice = position.entryPrice;
  const daysHeld = currentIdx - position.entryIdx;
  
  const closes = bars.slice(0, currentIdx + 1).map(b => b.c);
  const atrValues = atr(bars.slice(0, currentIdx + 1), 14);
  const currentATR = atrValues[currentIdx] || (price * 0.02);
  
  // Calculate current return
  const returnPct = ((price - entryPrice) / entryPrice) * 100;
  
  // Track highest price since entry for trailing stop
  let highSinceEntry = entryPrice;
  for (let i = position.entryIdx; i <= currentIdx; i++) {
    highSinceEntry = Math.max(highSinceEntry, bars[i].h);
  }
  
  // === EXIT RULE 1: Hard Stop Loss ===
  if (returnPct <= -exit.hardStopPct) {
    return {
      shouldExit: true,
      exitType: 'HARD_STOP',
      exitPrice: price,
      reason: `Hard stop: ${returnPct.toFixed(1)}% loss`
    };
  }
  
  // === EXIT RULE 2: Trailing Stop (2 ATR from high) ===
  const trailingStopPrice = highSinceEntry - (currentATR * exit.trailingStopATR);
  if (price < trailingStopPrice && returnPct > 0) {
    return {
      shouldExit: true,
      exitType: 'TRAILING_STOP',
      exitPrice: price,
      reason: `Trailing stop: ${((highSinceEntry - price) / highSinceEntry * 100).toFixed(1)}% off high`
    };
  }
  
  // === EXIT RULE 3: Close below exit MA ===
  const exitMA = closes.slice(-exit.exitBelowMA).reduce((a, b) => a + b, 0) / exit.exitBelowMA;
  if (price < exitMA && daysHeld >= 5) {
    return {
      shouldExit: true,
      exitType: 'BELOW_MA',
      exitPrice: price,
      reason: `Closed below ${exit.exitBelowMA} MA`
    };
  }
  
  // === EXIT RULE 4: Max holding period ===
  if (daysHeld >= exit.maxHoldDays) {
    return {
      shouldExit: true,
      exitType: 'TIME_EXIT',
      exitPrice: price,
      reason: `Max hold period (${exit.maxHoldDays} days)`
    };
  }
  
  // === SCALE-OUT: Profit targets (partial exits) ===
  // This is handled separately in the trade execution logic
  
  return { shouldExit: false, currentReturn: returnPct, daysHeld };
}

// ============================================================================
// PORTFOLIO-LEVEL BACKTESTING
// ============================================================================

/**
 * Run comprehensive backtest with portfolio management
 * @param {Object} options - Backtest configuration
 * @returns {Object} Complete backtest results
 */
export async function runAdaptiveBacktest(options = {}) {
  const {
    tickers = [],
    lookbackDays = 360,
    startingCapital = 100000,
    params = DEFAULT_PARAMS,
    verbose = true
  } = options;
  
  ensureStrategyDir();
  
  if (verbose) {
    console.log(`\n🚀 Starting Adaptive Strategy Backtest`);
    console.log(`   Capital: $${startingCapital.toLocaleString()}`);
    console.log(`   Lookback: ${lookbackDays} days`);
    console.log(`   Tickers: ${tickers.length}`);
    console.log(`   Risk per trade: ${params.position.accountRiskPct}%\n`);
  }
  
  // Fetch SPX data first for RS calculations
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - lookbackDays - 300); // Extra for MA calc
  
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);
  
  let spxBars = [];
  let spxCloses = [];
  try {
    spxBars = await getDailyBars('^GSPC', fromStr, toStr) || [];
    spxCloses = spxBars.map(b => b.c);
    if (verbose) console.log(`📈 Loaded SPX data: ${spxBars.length} bars`);
  } catch (e) {
    if (verbose) console.warn('⚠️ Could not fetch SPX data');
  }
  
  // Initialize portfolio tracking
  const portfolio = {
    cash: startingCapital,
    positions: [],
    trades: [],
    equityCurve: [{ date: fromStr, value: startingCapital }],
    peakEquity: startingCapital,
    maxDrawdown: 0,
    maxDrawdownDate: null
  };
  
  // Process each ticker
  const allSignals = [];
  let processed = 0;
  
  for (const ticker of tickers) {
    try {
      const bars = await getDailyBars(ticker, fromStr, toStr);
      
      if (!bars || bars.length < 300) {
        continue;
      }
      
      // Find signals for this ticker
      const tickerSignals = findSignalsForTicker(ticker, bars, spxCloses, params);
      allSignals.push(...tickerSignals);
      
      processed++;
      if (verbose && processed % 50 === 0) {
        console.log(`   Processed ${processed}/${tickers.length} tickers...`);
      }
    } catch (e) {
      // Skip failed tickers
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (verbose) {
    console.log(`\n✅ Found ${allSignals.length} signals across ${processed} tickers`);
  }
  
  // Sort signals by date
  allSignals.sort((a, b) => a.entryDate - b.entryDate);
  
  // Simulate portfolio trading
  const simulationResult = simulatePortfolio(allSignals, portfolio, params);
  
  // Calculate final statistics
  const stats = calculateBacktestStats(simulationResult, startingCapital);
  
  // Save results
  const resultFile = path.join(STRATEGY_DIR, `backtest-${toStr}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({
    config: { lookbackDays, startingCapital, params },
    summary: stats,
    trades: simulationResult.trades.slice(-100), // Last 100 trades
    equityCurve: simulationResult.equityCurve
  }, null, 2), 'utf8');
  
  if (verbose) {
    console.log(`\n📊 BACKTEST RESULTS (${lookbackDays} days)`);
    console.log(`   ══════════════════════════════════════`);
    console.log(`   Starting Capital: $${startingCapital.toLocaleString()}`);
    console.log(`   Ending Capital:   $${stats.endingCapital.toLocaleString()}`);
    console.log(`   Total Return:     ${stats.totalReturnPct.toFixed(1)}%`);
    console.log(`   `);
    console.log(`   Total Trades:     ${stats.totalTrades}`);
    console.log(`   Win Rate:         ${stats.winRate.toFixed(1)}%`);
    console.log(`   Profit Factor:    ${stats.profitFactor.toFixed(2)}`);
    console.log(`   `);
    console.log(`   Max Drawdown:     ${stats.maxDrawdownPct.toFixed(1)}%`);
    console.log(`   Avg Win:          ${stats.avgWinPct.toFixed(1)}%`);
    console.log(`   Avg Loss:         ${stats.avgLossPct.toFixed(1)}%`);
    console.log(`   Expectancy (R):   ${stats.expectancyR.toFixed(2)}`);
    console.log(`   ══════════════════════════════════════\n`);
  }
  
  return {
    summary: stats,
    trades: simulationResult.trades,
    equityCurve: simulationResult.equityCurve,
    signals: allSignals
  };
}

/**
 * Find all signals for a single ticker
 */
function findSignalsForTicker(ticker, bars, spxCloses, params) {
  const signals = [];
  const minDaysBetweenSignals = 20;
  let lastSignalIdx = -minDaysBetweenSignals;
  
  // Start after enough history, stop with room for exit
  const startIdx = 250;
  const endIdx = bars.length - params.exit.maxHoldDays - 1;
  
  for (let idx = startIdx; idx < endIdx; idx++) {
    // Skip if too close to last signal
    if (idx - lastSignalIdx < minDaysBetweenSignals) continue;
    
    const metrics = calculateMetricsAt(bars, idx, spxCloses);
    if (!metrics) continue;
    
    const signal = calculateEntryScore(metrics, params);
    
    if (signal.passed) {
      // Find exit
      const exitResult = findExit(bars, idx, metrics.price, params);
      
      signals.push({
        ticker,
        entryIdx: idx,
        entryDate: bars[idx].t,
        entryDateStr: new Date(bars[idx].t).toISOString().slice(0, 10),
        entryPrice: metrics.price,
        entryScore: signal.score,
        entryFactors: signal.factors,
        metrics: {
          rs: metrics.rs,
          contractions: metrics.contractions,
          volumeDryUp: metrics.volumeDryUp,
          pctFromHigh: metrics.pctFromHigh,
          atrPct: metrics.atrPct
        },
        ...exitResult
      });
      
      lastSignalIdx = exitResult.exitIdx;
    }
  }
  
  return signals;
}

/**
 * Find exit point for a signal
 */
function findExit(bars, entryIdx, entryPrice, params) {
  const { exit } = params;
  const closes = bars.map(b => b.c);
  
  let exitIdx = entryIdx;
  let exitPrice = entryPrice;
  let exitReason = 'MAX_HOLD';
  let highSinceEntry = entryPrice;
  
  const maxIdx = Math.min(entryIdx + exit.maxHoldDays, bars.length - 1);
  const atrValues = atr(bars, 14);
  
  for (let i = entryIdx + 1; i <= maxIdx; i++) {
    const bar = bars[i];
    const price = bar.c;
    const currentATR = atrValues[i] || (price * 0.02);
    
    highSinceEntry = Math.max(highSinceEntry, bar.h);
    
    const returnPct = ((price - entryPrice) / entryPrice) * 100;
    
    // Hard stop
    if (returnPct <= -exit.hardStopPct) {
      exitIdx = i;
      exitPrice = price;
      exitReason = 'HARD_STOP';
      break;
    }
    
    // Trailing stop (only when in profit)
    const trailingStopPrice = highSinceEntry - (currentATR * exit.trailingStopATR);
    if (price < trailingStopPrice && returnPct > 5) {
      exitIdx = i;
      exitPrice = price;
      exitReason = 'TRAILING_STOP';
      break;
    }
    
    // Close below 10 MA
    const sma10 = closes.slice(Math.max(0, i - 9), i + 1).reduce((a, b) => a + b, 0) / Math.min(10, i + 1);
    if (price < sma10 && i - entryIdx >= 5) {
      exitIdx = i;
      exitPrice = price;
      exitReason = 'BELOW_10MA';
      break;
    }
  }
  
  // Max hold exit
  if (exitReason === 'MAX_HOLD') {
    exitIdx = maxIdx;
    exitPrice = bars[exitIdx].c;
    
    for (let i = entryIdx + 1; i <= exitIdx; i++) {
      highSinceEntry = Math.max(highSinceEntry, bars[i].h);
    }
  }
  
  const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const mfe = ((highSinceEntry - entryPrice) / entryPrice) * 100;
  
  let minSinceEntry = entryPrice;
  for (let i = entryIdx; i <= exitIdx; i++) {
    minSinceEntry = Math.min(minSinceEntry, bars[i].l);
  }
  const mae = ((minSinceEntry - entryPrice) / entryPrice) * 100;
  
  return {
    exitIdx,
    exitDate: bars[exitIdx].t,
    exitDateStr: new Date(bars[exitIdx].t).toISOString().slice(0, 10),
    exitPrice: Math.round(exitPrice * 100) / 100,
    exitReason,
    returnPct: Math.round(returnPct * 100) / 100,
    mfe: Math.round(mfe * 100) / 100,
    mae: Math.round(mae * 100) / 100,
    daysHeld: exitIdx - entryIdx,
    outcome: returnPct >= 10 ? 'WIN' : returnPct < 0 ? 'LOSS' : 'NEUTRAL'
  };
}

/**
 * Simulate portfolio trading through signals
 * Uses proper equity tracking including unrealized P&L
 */
function simulatePortfolio(signals, portfolio, params) {
  const { position } = params;
  const trades = [];
  
  // Sort signals by entry date
  signals.sort((a, b) => a.entryDate - b.entryDate);
  
  // Track running equity for realistic drawdown
  let runningEquity = portfolio.cash;
  let peakEquity = runningEquity;
  let maxDrawdown = 0;
  let maxDrawdownDate = null;
  
  // Process each signal
  for (const signal of signals) {
    // Check position limits (simplified - not tracking concurrent positions)
    
    // Calculate position size (risk-based with fixed $ risk per trade)
    const riskDollars = runningEquity * (position.accountRiskPct / 100);
    const stopDist = signal.entryPrice * (params.exit.hardStopPct / 100);
    let shares = Math.floor(riskDollars / stopDist);
    
    // Apply max position limit
    const maxPositionValue = runningEquity * (position.maxPositionPct / 100);
    const maxShares = Math.floor(maxPositionValue / signal.entryPrice);
    shares = Math.min(shares, maxShares);
    
    // Skip if position would be too small
    if (shares * signal.entryPrice < position.minPositionSize) continue;
    if (shares <= 0) continue;
    
    // Calculate trade P&L
    const cost = shares * signal.entryPrice;
    const proceeds = shares * signal.exitPrice;
    const pnl = proceeds - cost;
    
    // Track lowest point during trade (for drawdown)
    const tradeMAEValue = shares * signal.entryPrice * (signal.mae / 100);
    const lowestEquityDuringTrade = runningEquity + tradeMAEValue;
    
    // Update peak and drawdown at lowest point
    if (lowestEquityDuringTrade < peakEquity) {
      const dd = ((peakEquity - lowestEquityDuringTrade) / peakEquity) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownDate = signal.entryDateStr;
      }
    }
    
    // Update running equity after trade completes
    runningEquity += pnl;
    
    // Update peak after winning trade
    if (runningEquity > peakEquity) {
      peakEquity = runningEquity;
    }
    
    // Record drawdown at exit
    const exitDrawdown = ((peakEquity - runningEquity) / peakEquity) * 100;
    if (exitDrawdown > maxDrawdown) {
      maxDrawdown = exitDrawdown;
      maxDrawdownDate = signal.exitDateStr;
    }
    
    const trade = {
      ...signal,
      shares,
      cost: Math.round(cost),
      proceeds: Math.round(proceeds),
      pnl: Math.round(pnl),
      pnlPct: signal.returnPct,
      equityAfter: Math.round(runningEquity)
    };
    trades.push(trade);
    
    // Track equity curve
    portfolio.equityCurve.push({
      date: signal.exitDateStr,
      value: Math.round(runningEquity)
    });
  }
  
  portfolio.maxDrawdown = maxDrawdown;
  portfolio.maxDrawdownDate = maxDrawdownDate;
  portfolio.cash = runningEquity;
  
  return {
    trades,
    equityCurve: portfolio.equityCurve,
    finalCash: runningEquity,
    maxDrawdown: maxDrawdown,
    maxDrawdownDate: maxDrawdownDate
  };
}

/**
 * Calculate comprehensive backtest statistics
 */
function calculateBacktestStats(result, startingCapital) {
  const { trades, finalCash, maxDrawdown, equityCurve } = result;
  
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      endingCapital: startingCapital,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      expectancyR: 0
    };
  }
  
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl < 0);
  
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));
  
  const avgWinPct = winners.length > 0 
    ? winners.reduce((sum, t) => sum + t.pnlPct, 0) / winners.length 
    : 0;
  const avgLossPct = losers.length > 0 
    ? losers.reduce((sum, t) => sum + t.pnlPct, 0) / losers.length 
    : 0;
  
  const winRate = (winners.length / trades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  
  // Expectancy in R (risk units)
  // E = (Win% × Avg Win) - (Loss% × Avg Loss) / Avg Loss
  const avgRisk = 4; // 4% stop loss
  const expectancyR = avgLossPct !== 0 
    ? ((winRate / 100) * avgWinPct - ((100 - winRate) / 100) * Math.abs(avgLossPct)) / avgRisk
    : 0;
  
  const endingCapital = equityCurve[equityCurve.length - 1]?.value || finalCash;
  
  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate: Math.round(winRate * 10) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    endingCapital: Math.round(endingCapital),
    totalReturnPct: Math.round(((endingCapital - startingCapital) / startingCapital) * 1000) / 10,
    maxDrawdownPct: Math.round(maxDrawdown * 10) / 10,
    grossProfit: Math.round(grossProfit),
    grossLoss: Math.round(grossLoss),
    avgWinPct: Math.round(avgWinPct * 10) / 10,
    avgLossPct: Math.round(avgLossPct * 10) / 10,
    expectancyR: Math.round(expectancyR * 100) / 100,
    avgHoldDays: Math.round(trades.reduce((sum, t) => sum + t.daysHeld, 0) / trades.length)
  };
}

// ============================================================================
// LEARNING LOOP
// ============================================================================

/**
 * Analyze trade results and generate parameter adjustments
 * @param {Array} trades - Completed trades with outcomes
 * @returns {Object} Suggested parameter adjustments
 */
export function analyzeAndLearn(trades, currentParams = DEFAULT_PARAMS) {
  if (trades.length < currentParams.learning.minTradesForLearning) {
    return {
      hasAdjustments: false,
      reason: `Need ${currentParams.learning.minTradesForLearning} trades, have ${trades.length}`
    };
  }
  
  const { learning } = currentParams;
  const adjustments = [];
  
  // Analyze which factors correlate with winning trades
  const factorAnalysis = {};
  
  // RS threshold analysis
  const rsGroups = {
    '90+': trades.filter(t => t.metrics?.rs >= 90),
    '80-90': trades.filter(t => t.metrics?.rs >= 80 && t.metrics?.rs < 90),
    '70-80': trades.filter(t => t.metrics?.rs >= 70 && t.metrics?.rs < 80)
  };
  
  for (const [group, groupTrades] of Object.entries(rsGroups)) {
    if (groupTrades.length >= 10) {
      const winRate = groupTrades.filter(t => t.outcome === 'WIN').length / groupTrades.length;
      factorAnalysis[`rs_${group}`] = {
        count: groupTrades.length,
        winRate: Math.round(winRate * 100),
        avgReturn: Math.round(groupTrades.reduce((s, t) => s + t.returnPct, 0) / groupTrades.length * 10) / 10
      };
    }
  }
  
  // Contraction count analysis
  const contractionGroups = {
    '4+': trades.filter(t => t.metrics?.contractions >= 4),
    '3': trades.filter(t => t.metrics?.contractions === 3),
    '2': trades.filter(t => t.metrics?.contractions === 2)
  };
  
  for (const [group, groupTrades] of Object.entries(contractionGroups)) {
    if (groupTrades.length >= 10) {
      const winRate = groupTrades.filter(t => t.outcome === 'WIN').length / groupTrades.length;
      factorAnalysis[`contractions_${group}`] = {
        count: groupTrades.length,
        winRate: Math.round(winRate * 100),
        avgReturn: Math.round(groupTrades.reduce((s, t) => s + t.returnPct, 0) / groupTrades.length * 10) / 10
      };
    }
  }
  
  // Volume dry-up analysis
  const withVolumeDryUp = trades.filter(t => t.metrics?.volumeDryUp);
  const withoutVolumeDryUp = trades.filter(t => !t.metrics?.volumeDryUp);
  
  if (withVolumeDryUp.length >= 10 && withoutVolumeDryUp.length >= 10) {
    const winRateWith = withVolumeDryUp.filter(t => t.outcome === 'WIN').length / withVolumeDryUp.length;
    const winRateWithout = withoutVolumeDryUp.filter(t => t.outcome === 'WIN').length / withoutVolumeDryUp.length;
    
    if (winRateWith > winRateWithout + 0.1) {
      adjustments.push({
        param: 'entry.volumeDryUpWeight',
        change: Math.round(currentParams.entry.volumeDryUpWeight * learning.learningRate),
        reason: `Volume dry-up shows +${Math.round((winRateWith - winRateWithout) * 100)}% higher win rate`
      });
    }
  }
  
  // Exit reason analysis
  const byExitReason = {};
  for (const t of trades) {
    if (!byExitReason[t.exitReason]) byExitReason[t.exitReason] = [];
    byExitReason[t.exitReason].push(t);
  }
  
  // Check if trailing stop is leaving money on table
  const trailingStopTrades = byExitReason['TRAILING_STOP'] || [];
  if (trailingStopTrades.length >= 10) {
    const avgMFE = trailingStopTrades.reduce((s, t) => s + t.mfe, 0) / trailingStopTrades.length;
    const avgReturn = trailingStopTrades.reduce((s, t) => s + t.returnPct, 0) / trailingStopTrades.length;
    
    // If MFE is much higher than actual return, widen trailing stop
    if (avgMFE > avgReturn + 10) {
      adjustments.push({
        param: 'exit.trailingStopATR',
        change: 0.25,
        reason: `Trailing stop leaving ${Math.round(avgMFE - avgReturn)}% on table (MFE: ${Math.round(avgMFE)}%, Return: ${Math.round(avgReturn)}%)`
      });
    }
  }
  
  // Check if hard stop is too tight
  const hardStopTrades = byExitReason['HARD_STOP'] || [];
  if (hardStopTrades.length >= 10) {
    const recoveredTrades = hardStopTrades.filter(t => t.mfe > t.returnPct + 5);
    if (recoveredTrades.length / hardStopTrades.length > 0.3) {
      adjustments.push({
        param: 'exit.hardStopPct',
        change: 1,
        reason: `${Math.round(recoveredTrades.length / hardStopTrades.length * 100)}% of stopped trades recovered - consider wider stop`
      });
    }
  }
  
  return {
    hasAdjustments: adjustments.length > 0,
    adjustments,
    factorAnalysis,
    byExitReason: Object.fromEntries(
      Object.entries(byExitReason).map(([k, v]) => [k, {
        count: v.length,
        winRate: Math.round(v.filter(t => t.outcome === 'WIN').length / v.length * 100),
        avgReturn: Math.round(v.reduce((s, t) => s + t.returnPct, 0) / v.length * 10) / 10
      }])
    )
  };
}

/**
 * Apply learned adjustments to parameters
 */
export function applyLearning(currentParams, adjustments) {
  if (!adjustments.hasAdjustments) return currentParams;
  
  const newParams = JSON.parse(JSON.stringify(currentParams));
  
  for (const adj of adjustments.adjustments) {
    const path = adj.param.split('.');
    let obj = newParams;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }
    const key = path[path.length - 1];
    const current = obj[key];
    obj[key] = Math.round((current + adj.change) * 100) / 100;
  }
  
  return newParams;
}

/**
 * Save learned parameters
 */
export function saveLearning(params, stats) {
  ensureStrategyDir();
  const filepath = path.join(STRATEGY_DIR, 'learned-params.json');
  
  const data = {
    params,
    learnedAt: new Date().toISOString(),
    basedOnStats: stats,
    version: 1
  };
  
  // Load existing to increment version
  if (fs.existsSync(filepath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      data.version = (existing.version || 0) + 1;
    } catch (e) { /* ignore */ }
  }
  
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Saved learned parameters (version ${data.version})`);
  
  return data;
}

/**
 * Load learned parameters (or defaults)
 */
export function loadLearnedParams() {
  const filepath = path.join(STRATEGY_DIR, 'learned-params.json');
  
  if (!fs.existsSync(filepath)) {
    return { ...DEFAULT_PARAMS };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return { ...DEFAULT_PARAMS, ...data.params };
  } catch (e) {
    return { ...DEFAULT_PARAMS };
  }
}

// ============================================================================
// EXPORTS FOR API
// ============================================================================

export {
  calculateMetricsAt,
  calculateEntryScore,
  checkExitConditions,
  findSignalsForTicker,
  calculateBacktestStats,
  ema,
  atr,
  rsi,
  macd
};
