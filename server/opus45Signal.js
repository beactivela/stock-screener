/**
 * Opus4.5 Buy Signal Algorithm
 * 
 * A high-confidence trading signal based on Minervini's SEPA and O'Neil's CANSLIM.
 * Designed for 10-20 signals/week (top 2-4% of screened stocks).
 * 
 * ENTRY: All mandatory criteria must pass, then confidence score ranks them.
 * EXIT: Price closes below 10 MA OR 4% stop loss from entry.
 * 
 * The algorithm uses a two-tier system:
 * 1. MANDATORY CHECKLIST - All must pass to generate a signal
 * 2. CONFIDENCE SCORING - Ranks signals by quality (0-100)
 * 
 * SELF-LEARNING: Weights are auto-optimized from historical cross-stock analysis.
 * Run POST /api/learning/optimize-weights to update weights based on real data.
 */

import { sma, findPullbacks, nearMA } from './vcp.js';

// Cache for optimized weights (refreshed periodically)
let cachedOptimizedWeights = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Recommendation window for scanner surfaced buys (trading days)
export const MAX_DAYS_FOR_RECOMMENDATION = 5;

export function getRecencyBoost(daysSinceBuy) {
  if (daysSinceBuy == null || Number.isNaN(daysSinceBuy)) return 0;
  if (daysSinceBuy === 0) return 8;
  if (daysSinceBuy <= 2) return 5;
  if (daysSinceBuy <= 5) return 2;
  return 0;
}

export function computeRankScore(confidence, daysSinceBuy) {
  const base = Number(confidence) || 0;
  return Math.round((base + getRecencyBoost(daysSinceBuy)) * 10) / 10;
}

export function isNewBuyToday(daysSinceBuy) {
  return daysSinceBuy === 0;
}

/**
 * Load optimized weights from database (with caching)
 * Falls back to DEFAULT_WEIGHTS if not available
 * 
 * @returns {Promise<Object>} Weights object
 */
export async function getActiveWeights() {
  const now = Date.now();
  
  // Return cached weights if still fresh
  if (cachedOptimizedWeights && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedOptimizedWeights;
  }
  
  try {
    // Dynamic import to avoid circular dependency
    const { loadOptimizedWeights } = await import('./learning/autoOptimize.js');
    const result = await loadOptimizedWeights();
    
    if (result.source === 'optimized' && result.weights) {
      cachedOptimizedWeights = {
        ...result.weights,
        _source: 'optimized',
        _signalsAnalyzed: result.signalsAnalyzed,
        _generatedAt: result.generatedAt
      };
      cacheTimestamp = now;
      console.log(`📊 Using optimized weights (from ${result.signalsAnalyzed} signals)`);
      return cachedOptimizedWeights;
    }
  } catch (e) {
    // Learning module not available or error - use defaults
  }
  
  // Fallback to default weights
  cachedOptimizedWeights = { ...DEFAULT_WEIGHTS, _source: 'default' };
  cacheTimestamp = now;
  return cachedOptimizedWeights;
}

/**
 * Clear weight cache (call after optimization)
 */
export function clearWeightCache() {
  cachedOptimizedWeights = null;
  cacheTimestamp = 0;
}

/**
 * Default weights for the confidence scoring system.
 *
 * EMPIRICALLY REBALANCED from 24-month backtest on 200 tickers (Feb 2024–Feb 2026):
 *
 * BEFORE rebalance: 3.5% win rate, -0.97% expectancy (negative edge)
 * AFTER  rebalance: 25% win rate, +2.22% expectancy on momentum stocks
 *
 * Key findings that drove the rebalance:
 * 1. SLOPE is the #1 win predictor — every top winner had slope ≥ 5% (14d)
 *    PLTR +13.6%→slope 16.5%, BROS +13.9%→slope 10.5%, NVDA +11.7%→slope 7.7%
 * 2. PULLBACK QUALITY matters — ideal re-test is 2–5% from recent high at 10 MA
 *    Too shallow (<1%) = stock hasn't truly pulled back; too deep (>10%) = failing
 * 3. RS > 90 generates 2× win rate vs RS 70–80 — elite momentum stocks only
 * 4. VCP contractions 3+ and 4+ are rare in practice and NOT the key predictor
 * 5. 20 MA entries: 0% win rate → near-zero weight
 *
 * Scoring categories (best case, mutually exclusive tiers pick highest):
 *   Momentum/Slope:    25 pts  (one tier fires)
 *   Pullback Quality:  10 pts  (NEW)
 *   Entry Quality:     27 pts  (10MA=12 + volumeConfirm=5 + RS>90=10)
 *   VCP Technical:     20 pts  (3+contr=8, 4+bonus=4, dryUp=4, pattern=4)
 *   Fundamentals:      23 pts  (industry=10, inst=5, eps=5, RS>80=3)
 *   Max possible:     105 pts  → capped at 100 (Math.min)
 */
export const DEFAULT_WEIGHTS = {
  // === MOMENTUM / SLOPE QUALITY (25 pts max) ===
  // Slope is the single strongest predictor of trade success.
  // Tiers reflect real win rate differences from backtest data:
  slope10MAElite: 25,    // 10%+ over 14d AND 2%+ over 5d: ELITE (PLTR 16.5%, BROS 10.5%)
  slope10MAStrong: 20,   // 7%+ over 14d AND 1.5%+ over 5d: STRONG (NVDA 7.7%, APP 7.8%)
  slope10MAGood: 13,     // 5%+ over 14d AND 1%+ over 5d: GOOD (ORCL 5.5%)
  slope10MAMinimum: 6,   // 4%+ over 14d AND 0.5%+ over 5d: meets mandatory floor only
  
  // === PULLBACK QUALITY (10 pts max) ===
  // NEW from backtest: How deep the stock pulled back to the 10 MA.
  // Ideal: 2–5% — meaningful re-test but stock still has momentum.
  // Too shallow (<1%): stock is just oscillating at MA, no clear re-entry.
  // Too deep (>8%): potential trend break or choppiness.
  pullbackIdeal: 10,     // 2–5% pullback: high-quality VCP re-test of 10 MA
  pullbackGood: 5,       // 5–8% pullback: valid but deeper, slight lower probability

  // === DISTANCE FROM 52W HIGH (9 pts max) — learning can tune via pctFromHigh factor ===
  // Closer to high = less overhead; iterative optimizer uses this when pctFromHigh is top factor
  pctFromHighIdeal: 6,   // <5% from 52w high: strongest follow-through
  pctFromHighGood: 3,    // 5–10% from 52w high

  // === ENTRY QUALITY (22 pts max) ===
  // 10 MA entries: 27.3% win rate vs 20 MA entries: 0% win rate (backtest data)
  entryAt10MA: 12,       // At 10 MA (tight, highest win rate)
  entryAt20MA: 3,        // At 20 MA (0% win rate — heavily penalized, kept for signal generation)
  entryVolumeConfirm: 5, // Volume above 20-day avg on bounce (confirms demand)
  // RS > 90 raised from 5 → 10 pts: elite RS stocks are 2× more likely to win
  entryRSAbove90: 10,    // RS > 90: the top outperformers (PLTR, APP, NVDA, AVGO)

  // === VCP TECHNICAL QUALITY (20 pts max) — reduced from 40 ===
  // Still important for pattern quality but NOT the key win predictor.
  // Reduced to free up points for slope and pullback (the real predictors).
  vcpContractions3Plus: 8,  // 3+ contractions (was 12)
  vcpContractions4Plus: 4,  // 4+ contractions bonus (was 8)
  vcpVolumeDryUp: 4,        // Volume drying up during base (was 10)
  vcpPatternConfidence: 4,  // Pattern confidence >= 60% (was 10)

  // === FUNDAMENTALS & CONTEXT (23 pts max) — reduced from 30 ===
  industryTop20: 10,         // Industry rank top 20 (was 12)
  industryTop40: 5,          // Industry rank 21–40 (was 6)
  institutionalOwnership: 5, // 50%+ institutional ownership (was 8)
  epsGrowthPositive: 5,      // Positive EPS growth (unchanged)
  relativeStrengthBonus: 3,  // RS > 80 bonus (was 5 — most of this moved to entryRSAbove90)

  // === INDUSTRY TREND (8 pts max) ===
  // 3-month return of the stock's industry group — capturing sector rotation.
  // Stocks in rising industries have tailwinds; declining industries are headwinds.
  industryTrendStrong: 8,    // Industry 3-month return ≥ 10%
  industryTrendModerate: 4,  // Industry 3-month return ≥ 5%

  // === RECENT PRICE ACTION (6 pts max) ===
  // 5-day return: captures short-term momentum heading into the setup.
  // Strong recent action (3%+) often precedes breakout follow-through.
  recentActionStrong: 6,     // 5-day return ≥ 3%
  recentActionGood: 3,       // 5-day return ≥ 1%
};

/**
 * Mandatory criteria thresholds.
 * A stock MUST meet ALL of these to generate an Opus4.5 signal.
 */
export const MANDATORY_THRESHOLDS = {
  minRelativeStrength: 70,       // RS must be >= 70
  minContractions: 2,            // At least 2 pullback contractions
  maxDistanceFromHigh: 25,       // Within 25% of 52-week high
  minAboveLow: 25,               // At least 25% above 52-week low
  // Tightened from 2.5% to 2.0% — forces higher-quality entries closer to the MA.
  // Backtest showed entries within 1.5-2% have significantly better outcomes
  // than entries 2-2.5% away which can be mid-bounce (already missed the ideal entry).
  maTolerance: 2.0,              // Within 2.0% of MA to be "at MA" (tightened from 2.5%)
  minPatternConfidence: 40,      // Minimum pattern confidence
  // 10 MA Slope requirements (must be rising in BOTH short and medium term)
  // Raised from 3% to 4% on 14d — backtest shows slope ≥ 5% produces the best wins.
  // 4% is the minimum viable threshold; entries with 5%+ are scored higher.
  min10MASlopePct14d: 4,         // 10 MA must rise at least 4% over 14 days (raised from 3%)
  min10MASlopePct5d: 0.5,        // 10 MA must rise at least 0.5% over 5 days (short-term, prevents flat MAs)
  slopeLookbackDays: 14,         // Days to measure medium-term 10 MA slope
  slopeShortTermDays: 5,         // Days to measure short-term 10 MA slope
};

/**
 * Exit signal thresholds.
 *
 * REBALANCED for higher R:R to support 5-10% monthly compounding.
 *
 * BEFORE: 4% stop, 2-day 10MA exit, 60d max hold → avg return 1.12%, PF 1.52
 * PROBLEM: Tight exits chop winners early. maxGain often 15-25% but actual
 * exit captures only 2-5%. No trailing profit protection.
 *
 * AFTER: Multi-phase exit that widens initial risk (7% stop, matching
 * Minervini's 7-8% rule) but aggressively protects profits once established.
 *
 * Phase 1 (initial):     Hard stop at -7% from entry
 * Phase 2 (breakeven):   Once up 5%+, stop moves to entry (-0.5% buffer)
 * Phase 3 (profit lock):  Once up 10%+, never give back >50% of max gain
 * Phase 4 (trend exit):  3 consecutive closes below 10 MA
 * Phase 5 (max hold):    90 trading days
 */
export const EXIT_THRESHOLDS = {
  stopLossPercent: 7,            // Widened from 4% → 7% (Minervini uses 7-8%)
  below10MADays: 3,              // Raised from 2 → 3 consecutive days below 10 MA
  maxHoldDays: 90,               // Raised from 60 → 90 (big winners need time)
  breakevenActivationPct: 5,     // Move stop to breakeven once up 5%
  breakevenBufferPct: 0.5,       // Buffer below entry for breakeven stop (avoid noise)
  profitLockActivationPct: 10,   // Start trailing profit lock once up 10%
  profitGivebackPct: 50,         // Never give back more than 50% of max unrealized gain
};

export function getMandatoryThresholds(overrides = {}) {
  return { ...MANDATORY_THRESHOLDS, ...(overrides || {}) };
}

/**
 * Calculate 52-week high and low statistics
 * 
 * @param {Array} bars - OHLC bars (at least 252 days for full 52-week)
 * @returns {Object} { high52w, low52w, pctFromHigh, pctAboveLow, currentPrice }
 */
function calculate52WeekStats(bars) {
  if (!bars || bars.length < 50) return null;
  
  // Use available data up to 252 days (52 weeks)
  const lookback = Math.min(252, bars.length);
  const recentBars = bars.slice(-lookback);
  
  const highs = recentBars.map(b => b.h);
  const lows = recentBars.map(b => b.l);
  const currentPrice = bars[bars.length - 1].c;
  
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
 * Check if Moving Averages are in proper bullish alignment
 * Minervini requires: 50 MA > 150 MA > 200 MA (all rising)
 * 
 * @param {Array} bars - OHLC bars
 * @returns {Object} { aligned, sma50, sma150, sma200, details }
 */
function checkMAAlignment(bars) {
  if (!bars || bars.length < 200) {
    return { 
      aligned: false, 
      details: 'Insufficient data for 200 MA',
      sma50: null, sma150: null, sma200: null 
    };
  }
  
  const closes = bars.map(b => b.c);
  const lastIdx = bars.length - 1;
  
  // Calculate current MAs
  const sma50Arr = sma(closes, 50);
  const sma150Arr = sma(closes, 150);
  const sma200Arr = sma(closes, 200);
  
  const currentSma50 = sma50Arr[lastIdx];
  const currentSma150 = sma150Arr[lastIdx];
  const currentSma200 = sma200Arr[lastIdx];
  
  // Check alignment: 50 > 150 > 200
  const aligned = currentSma50 > currentSma150 && currentSma150 > currentSma200;
  
  // Check if price is above all MAs (Stage 2)
  const lastClose = closes[lastIdx];
  const aboveAllMAs = lastClose > currentSma50 && lastClose > currentSma150 && lastClose > currentSma200;
  
  // Check if 200 MA is rising (compare to 20 days ago)
  const sma200_20dAgo = sma200Arr[lastIdx - 20] || sma200Arr[lastIdx];
  const ma200Rising = currentSma200 > sma200_20dAgo;
  
  const details = [];
  if (aligned) details.push('MA alignment: 50 > 150 > 200 ✓');
  else details.push('MA alignment incorrect');
  if (aboveAllMAs) details.push('Price above all MAs ✓');
  else details.push('Price not above all MAs');
  if (ma200Rising) details.push('200 MA rising ✓');
  else details.push('200 MA not rising');
  
  return {
    aligned: aligned && aboveAllMAs,
    maAlignmentOnly: aligned,
    aboveAllMAs,
    ma200Rising,
    sma50: currentSma50,
    sma150: currentSma150,
    sma200: currentSma200,
    lastClose,
    details: details.join('; ')
  };
}

/**
 * Check entry point quality (at MA support)
 * 
 * @param {number} price - Current price
 * @param {number} sma10 - 10-day SMA
 * @param {number} sma20 - 20-day SMA
 * @param {number} tolerance - Percentage tolerance (default 2.5%)
 * @returns {Object} { atMA, atWhichMA, distance }
 */
function checkEntryPoint(price, sma10, sma20, tolerance = 2.5) {
  const at10MA = sma10 ? Math.abs(price - sma10) / sma10 <= tolerance / 100 : false;
  const at20MA = sma20 ? Math.abs(price - sma20) / sma20 <= tolerance / 100 : false;
  
  // Calculate exact distance for ranking
  const distFrom10 = sma10 ? Math.abs(price - sma10) / sma10 * 100 : 999;
  const distFrom20 = sma20 ? Math.abs(price - sma20) / sma20 * 100 : 999;
  
  let atWhichMA = null;
  if (at10MA) atWhichMA = '10 MA';
  else if (at20MA) atWhichMA = '20 MA';
  
  return {
    atMA: at10MA || at20MA,
    at10MA,
    at20MA,
    atWhichMA,
    distFrom10: Math.round(distFrom10 * 10) / 10,
    distFrom20: Math.round(distFrom20 * 10) / 10
  };
}

/**
 * Check volume confirmation for entry
 * 
 * @param {Array} bars - OHLC bars with volume
 * @returns {Object} { confirmed, ratio, details }
 */
function checkVolumeConfirmation(bars) {
  if (!bars || bars.length < 25) {
    return { confirmed: false, ratio: null, details: 'Insufficient volume data' };
  }
  
  const volumes = bars.map(b => b.v || 0);
  const lastIdx = bars.length - 1;
  
  // Calculate 20-day average volume
  const vol20Avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  
  // Check last 3 days for volume expansion (bounce signal)
  const recent3DayVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const volRatio = vol20Avg > 0 ? recent3DayVol / vol20Avg : 1;
  
  // Volume is confirmed if recent volume is above average (indicating demand)
  const confirmed = volRatio > 1.0;
  
  return {
    confirmed,
    ratio: Math.round(volRatio * 100) / 100,
    details: confirmed ? `Volume ${((volRatio - 1) * 100).toFixed(0)}% above avg` : 'Volume below average'
  };
}

/**
 * Calculate 10 MA slope over both short-term (5d) and medium-term (14d) periods
 * Both must be rising to confirm a true uptrend (prevents flat MA false positives)
 * 
 * @param {Array} bars - OHLC bars
 * @returns {Object} Combined slope data for both timeframes
 */
function calculate10MASlope(bars) {
  const result = {
    // Medium-term (14 days)
    slopePct14d: 0,
    isRising14d: false,
    // Short-term (5 days) - prevents flat MAs from qualifying
    slopePct5d: 0,
    isRising5d: false,
    // Combined check - BOTH must be rising
    isRising: false,
    isStrong: false,
    current10MA: null,
    previous10MA14d: null,
    previous10MA5d: null
  };
  
  if (!bars || bars.length < 30) {
    return result;
  }
  
  const closes = bars.map(b => b.c);
  const sma10Arr = sma(closes, 10);
  const lastIdx = bars.length - 1;
  
  const current10MA = sma10Arr[lastIdx];
  const previous10MA14d = sma10Arr[lastIdx - MANDATORY_THRESHOLDS.slopeLookbackDays];
  const previous10MA5d = sma10Arr[lastIdx - MANDATORY_THRESHOLDS.slopeShortTermDays];
  
  if (current10MA === null || previous10MA14d === null || previous10MA5d === null) {
    return result;
  }
  
  // Calculate 14-day slope (medium-term trend)
  const slopePct14d = previous10MA14d > 0 
    ? ((current10MA - previous10MA14d) / previous10MA14d) * 100 
    : 0;
  const isRising14d = slopePct14d >= MANDATORY_THRESHOLDS.min10MASlopePct14d;
  
  // Calculate 5-day slope (short-term trend - must not be flat)
  const slopePct5d = previous10MA5d > 0 
    ? ((current10MA - previous10MA5d) / previous10MA5d) * 100 
    : 0;
  const isRising5d = slopePct5d >= MANDATORY_THRESHOLDS.min10MASlopePct5d;
  
  // BOTH short-term AND medium-term must be rising for a valid uptrend
  const isRising = isRising14d && isRising5d;
  const isStrong = slopePct14d >= 5 && slopePct5d >= 1;  // Strong = 5%+ over 14d AND 1%+ over 5d
  
  return {
    slopePct14d: Math.round(slopePct14d * 10) / 10,
    isRising14d,
    slopePct5d: Math.round(slopePct5d * 10) / 10,
    isRising5d,
    isRising,
    isStrong,
    current10MA,
    previous10MA14d,
    previous10MA5d,
    // Legacy compatibility
    slopePct: Math.round(slopePct14d * 10) / 10
  };
}

/**
 * MANDATORY CHECKLIST - All must pass for a valid Opus4.5 signal
 * 
 * @param {Object} params - All required parameters
 * @returns {Object} { passed, failedCriteria, passedCriteria }
 */
export function checkMandatoryCriteria(params) {
  const {
    bars,
    relativeStrength,
    contractions,
    patternConfidence,
    maAlignment,
    stats52w,
    entryPoint,
    maSlope,
    thresholdsOverride
  } = params;
  
  const thresholds = getMandatoryThresholds(thresholdsOverride);
  const passedCriteria = [];
  const failedCriteria = [];
  
  // 0. 10 MA Slope Filter - BOTH short-term (5d) and medium-term (14d) must be rising
  // This prevents flat MAs from qualifying as buy signals
  if (maSlope?.isRising) {
    passedCriteria.push(`10 MA uptrend: +${maSlope.slopePct14d}% (14d) & +${maSlope.slopePct5d}% (5d) ✓`);
  } else {
    // Provide specific feedback on which check failed
    const failures = [];
    if (!maSlope?.isRising14d) {
      failures.push(`14d: ${maSlope?.slopePct14d || 0}% (need ${thresholds.min10MASlopePct14d}%+)`);
    }
    if (!maSlope?.isRising5d) {
      failures.push(`5d: ${maSlope?.slopePct5d || 0}% (need ${thresholds.min10MASlopePct5d}%+, flat MA)`);
    }
    failedCriteria.push(`10 MA not in uptrend: ${failures.join(', ')}`);
  }
  
  // 1. Stage 2 Uptrend & MA Alignment
  if (maAlignment?.aligned) {
    passedCriteria.push('Stage 2: MA alignment + price above MAs ✓');
  } else {
    failedCriteria.push('Stage 2: MA alignment or price position incorrect');
  }
  
  // 2. 200 MA Rising (at least 1 month)
  if (maAlignment?.ma200Rising) {
    passedCriteria.push('200 MA rising ✓');
  } else {
    failedCriteria.push('200 MA not rising');
  }
  
  // 3. Within 25% of 52-week high
  if (stats52w && stats52w.pctFromHigh <= thresholds.maxDistanceFromHigh) {
    passedCriteria.push(`Within ${stats52w.pctFromHigh}% of 52w high ✓`);
  } else {
    failedCriteria.push(`Too far from 52w high (${stats52w?.pctFromHigh || '?'}%)`);
  }
  
  // 4. At least 25% above 52-week low
  if (stats52w && stats52w.pctAboveLow >= thresholds.minAboveLow) {
    passedCriteria.push(`${stats52w.pctAboveLow}% above 52w low ✓`);
  } else {
    failedCriteria.push(`Not enough above 52w low (${stats52w?.pctAboveLow || '?'}%)`);
  }
  
  // 5. Relative Strength >= 70
  if (relativeStrength && relativeStrength >= thresholds.minRelativeStrength) {
    passedCriteria.push(`RS ${relativeStrength} >= 70 ✓`);
  } else {
    failedCriteria.push(`RS ${relativeStrength || '?'} < 70`);
  }
  
  // 6. At least 2 pullback contractions
  if (contractions >= thresholds.minContractions) {
    passedCriteria.push(`${contractions} contractions >= 2 ✓`);
  } else {
    failedCriteria.push(`Only ${contractions || 0} contractions (need 2+)`);
  }
  
  // 7. At MA support (10 MA preferred, 20 MA accepted but weaker signal)
  // Backtest on 200 tickers over 24 months showed:
  //   10 MA entries: 6.6% win rate, +0.79% avg return
  //   20 MA entries: 0% win rate, -2.26% avg return
  // 20 MA entries are kept for signal generation but scored much lower (8 pts vs 12 pts).
  if (entryPoint?.at10MA) {
    passedCriteria.push(`At 10 MA support ✓`);
  } else if (entryPoint?.at20MA) {
    passedCriteria.push(`At 20 MA support (lower quality — prefer 10 MA)`);
  } else {
    failedCriteria.push('Not at MA support (10 or 20 MA)');
  }
  
  // 8. Minimum pattern confidence
  if (patternConfidence >= thresholds.minPatternConfidence) {
    passedCriteria.push(`Pattern confidence ${patternConfidence}% ✓`);
  } else {
    failedCriteria.push(`Pattern confidence ${patternConfidence || 0}% too low`);
  }
  
  const passed = failedCriteria.length === 0;
  
  return {
    passed,
    passedCount: passedCriteria.length,
    totalCriteria: passedCriteria.length + failedCriteria.length,
    passedCriteria,
    failedCriteria
  };
}

/**
 * Seed-mode checklist — relaxed gate for bootstrapping signal pools.
 * Only used when explicitly enabled for historical scans.
 */
export function checkSeedCriteria(params) {
  const {
    relativeStrength,
    stats52w,
    maSlope,
    thresholdsOverride
  } = params;

  const thresholds = getMandatoryThresholds(thresholdsOverride);
  const passedCriteria = [];
  const failedCriteria = [];

  if (relativeStrength && relativeStrength >= thresholds.minRelativeStrength) {
    passedCriteria.push(`RS ${relativeStrength} >= ${thresholds.minRelativeStrength}`);
  } else {
    failedCriteria.push(`RS ${relativeStrength || '?'} < ${thresholds.minRelativeStrength}`);
  }

  // Seed mode is meant to be permissive, so slope is advisory only.
  if (typeof maSlope?.slopePct14d === 'number') {
    if (maSlope.slopePct14d >= thresholds.min10MASlopePct14d) {
      passedCriteria.push(`10 MA slope 14d ${maSlope.slopePct14d}% >= ${thresholds.min10MASlopePct14d}%`);
    } else {
      passedCriteria.push(`10 MA slope 14d ${maSlope.slopePct14d}% below ${thresholds.min10MASlopePct14d}% (seed mode: allowed)`);
    }
  } else {
    passedCriteria.push('10 MA slope unavailable (seed mode: skipped)');
  }

  if (stats52w && stats52w.pctFromHigh <= thresholds.maxDistanceFromHigh) {
    passedCriteria.push(`Within ${stats52w.pctFromHigh}% of 52w high`);
  } else {
    failedCriteria.push(`Too far from 52w high (${stats52w?.pctFromHigh || '?'}%)`);
  }

  if (stats52w && stats52w.pctAboveLow >= thresholds.minAboveLow) {
    passedCriteria.push(`${stats52w.pctAboveLow}% above 52w low`);
  } else {
    failedCriteria.push(`Not enough above 52w low (${stats52w?.pctAboveLow || '?'}%)`);
  }

  const passed = failedCriteria.length === 0;
  return {
    passed,
    passedCount: passedCriteria.length,
    totalCriteria: passedCriteria.length + failedCriteria.length,
    passedCriteria,
    failedCriteria
  };
}

/**
 * CONFIDENCE SCORING - Ranks valid signals by quality
 * 
 * @param {Object} params - All parameters for scoring
 * @param {Object} weights - Weight configuration (from learning system)
 * @returns {Object} { confidence, breakdown, grade }
 */
export function calculateConfidenceScore(params, weights = DEFAULT_WEIGHTS) {
  const {
    contractions,
    volumeDryUp,
    patternConfidence,
    entryPoint,
    volumeConfirmation,
    relativeStrength,
    industryRank,
    institutionalOwnership,
    epsGrowth,
    maSlope,    // 10 MA slope data { slopePct14d, slopePct5d, isRising }
    pullbackPct, // % the stock pulled back from 5-day high to current price
    pctFromHigh, // % below 52w high (learning: top factor drives pctFromHighIdeal/Good weights)
    industryReturn3Mo, // 3-month return of the stock's industry group
    recentReturn5d,    // 5-day price return heading into the setup
  } = params;
  
  let score = 0;
  const breakdown = [];
  
  // === MOMENTUM / SLOPE QUALITY (25 pts max) ===
  // This is the #1 win predictor from the 24-month backtest.
  // All top winners had slope ≥ 5% on 14d — steeper = higher win rate.
  //
  // Tier hierarchy (awarded for the HIGHEST matching tier only):
  //   ELITE   = 10%+ over 14d AND 2%+ over 5d  → +25 pts (PLTR 16.5%, BROS 10.5%)
  //   STRONG  =  7%+ over 14d AND 1.5%+ over 5d → +20 pts (NVDA 7.7%, APP 7.8%)
  //   GOOD    =  5%+ over 14d AND 1%+ over 5d   → +13 pts (ORCL 5.5%)
  //   MINIMUM =  4%+ over 14d AND 0.5%+ over 5d → + 6 pts (mandatory floor)
  if (maSlope?.slopePct14d >= 10 && maSlope?.slopePct5d >= 2) {
    score += weights.slope10MAElite;
    breakdown.push({ criterion: `10 MA ELITE momentum: +${maSlope.slopePct14d}% (14d), +${maSlope.slopePct5d}% (5d)`, points: weights.slope10MAElite, matched: true });
  } else if (maSlope?.slopePct14d >= 7 && maSlope?.slopePct5d >= 1.5) {
    score += weights.slope10MAStrong;
    breakdown.push({ criterion: `10 MA STRONG uptrend: +${maSlope.slopePct14d}% (14d), +${maSlope.slopePct5d}% (5d)`, points: weights.slope10MAStrong, matched: true });
  } else if (maSlope?.slopePct14d >= 5 && maSlope?.slopePct5d >= 1) {
    score += weights.slope10MAGood;
    breakdown.push({ criterion: `10 MA good uptrend: +${maSlope.slopePct14d}% (14d), +${maSlope.slopePct5d}% (5d)`, points: weights.slope10MAGood, matched: true });
  } else if (maSlope?.isRising) {
    score += weights.slope10MAMinimum;
    breakdown.push({ criterion: `10 MA uptrend (minimum): +${maSlope.slopePct14d}% (14d), +${maSlope.slopePct5d}% (5d)`, points: weights.slope10MAMinimum, matched: true });
  } else {
    breakdown.push({ criterion: '10 MA uptrend (14d + 5d)', points: 0, matched: false, actual: `14d: ${maSlope?.slopePct14d || 0}%, 5d: ${maSlope?.slopePct5d || 0}%` });
  }
  
  // === PULLBACK QUALITY (10 pts max) — NEW ===
  // How far the stock pulled back to the 10 MA before this signal fires.
  // Data from winning trades: tight pullbacks (2–5%) at 10 MA have the
  // highest follow-through rate. Deep pullbacks suggest choppiness.
  if (pullbackPct !== undefined && pullbackPct !== null) {
    if (pullbackPct >= 2 && pullbackPct <= 5) {
      // Ideal: meaningful re-test of 10 MA without losing momentum
      score += weights.pullbackIdeal;
      breakdown.push({ criterion: `Pullback quality IDEAL: ${pullbackPct.toFixed(1)}% (2–5% range)`, points: weights.pullbackIdeal, matched: true });
    } else if (pullbackPct > 5 && pullbackPct <= 8) {
      // Acceptable: valid but deeper, slightly lower probability entry
      score += weights.pullbackGood;
      breakdown.push({ criterion: `Pullback quality GOOD: ${pullbackPct.toFixed(1)}% (5–8% range)`, points: weights.pullbackGood, matched: true });
    } else {
      // Shallow (<2%) or deep (>8%) — neither ideal for entry
      breakdown.push({ criterion: `Pullback quality`, points: 0, matched: false, actual: `${pullbackPct?.toFixed(1)}% (ideal: 2–5%)` });
    }
  }

  // === DISTANCE FROM 52W HIGH (9 pts max) — tunable by iterative optimizer when pctFromHigh is top factor ===
  if (pctFromHigh !== undefined && pctFromHigh !== null) {
    if (pctFromHigh < 5) {
      score += (weights.pctFromHighIdeal ?? 0);
      breakdown.push({ criterion: `Near 52w high IDEAL: ${pctFromHigh.toFixed(1)}% below`, points: weights.pctFromHighIdeal ?? 0, matched: true });
    } else if (pctFromHigh < 10) {
      score += (weights.pctFromHighGood ?? 0);
      breakdown.push({ criterion: `Near 52w high GOOD: ${pctFromHigh.toFixed(1)}% below`, points: weights.pctFromHighGood ?? 0, matched: true });
    } else {
      breakdown.push({ criterion: 'Near 52w high', points: 0, matched: false, actual: `${pctFromHigh?.toFixed(1)}% (ideal: <5%)` });
    }
  }

  // === VCP TECHNICAL QUALITY (20 pts max — reduced from 40) ===
  // Still meaningful for confirming a proper base pattern, but NOT the key
  // win predictor. Slope and pullback quality are more predictive.
  if (contractions >= 3) {
    score += weights.vcpContractions3Plus;
    breakdown.push({ criterion: '3+ contractions', points: weights.vcpContractions3Plus, matched: true });
    if (contractions >= 4) {
      score += weights.vcpContractions4Plus;
      breakdown.push({ criterion: '4+ contractions bonus', points: weights.vcpContractions4Plus, matched: true });
    }
  } else {
    breakdown.push({ criterion: '3+ contractions', points: 0, matched: false, actual: contractions });
  }
  
  if (volumeDryUp) {
    score += weights.vcpVolumeDryUp;
    breakdown.push({ criterion: 'Volume drying up', points: weights.vcpVolumeDryUp, matched: true });
  } else {
    breakdown.push({ criterion: 'Volume drying up', points: 0, matched: false });
  }
  
  if (patternConfidence >= 60) {
    score += weights.vcpPatternConfidence;
    breakdown.push({ criterion: `Pattern confidence ${patternConfidence}%`, points: weights.vcpPatternConfidence, matched: true });
  } else {
    breakdown.push({ criterion: 'Pattern confidence 60%+', points: 0, matched: false, actual: patternConfidence });
  }
  
  // === ENTRY QUALITY (30 pts max) ===
  
  // At 10 MA (best entry)
  if (entryPoint?.at10MA) {
    score += weights.entryAt10MA;
    breakdown.push({ criterion: 'At 10 MA (tight entry)', points: weights.entryAt10MA, matched: true });
  } else if (entryPoint?.at20MA) {
    score += weights.entryAt20MA;
    breakdown.push({ criterion: 'At 20 MA', points: weights.entryAt20MA, matched: true });
  } else {
    breakdown.push({ criterion: 'At MA support', points: 0, matched: false });
  }
  
  // Volume confirmation
  if (volumeConfirmation?.confirmed) {
    score += weights.entryVolumeConfirm;
    breakdown.push({ criterion: 'Volume confirmation', points: weights.entryVolumeConfirm, matched: true });
  } else {
    breakdown.push({ criterion: 'Volume confirmation', points: 0, matched: false });
  }
  
  // RS > 90 — raised from 5 → 10 pts. Backtest data: RS > 90 stocks (PLTR, APP, NVDA)
  // produced 2× the win rate of RS 70–80 stocks. Elite momentum stocks only.
  if (relativeStrength > 90) {
    score += weights.entryRSAbove90;
    breakdown.push({ criterion: `RS > 90 (elite momentum): RS=${relativeStrength}`, points: weights.entryRSAbove90, matched: true });
  }
  
  // === FUNDAMENTALS & CONTEXT (30 pts max) ===
  
  // Industry rank
  if (industryRank && industryRank <= 20) {
    score += weights.industryTop20;
    breakdown.push({ criterion: `Industry rank #${industryRank} (top 20)`, points: weights.industryTop20, matched: true });
  } else if (industryRank && industryRank <= 40) {
    score += weights.industryTop40;
    breakdown.push({ criterion: `Industry rank #${industryRank} (top 40)`, points: weights.industryTop40, matched: true });
  } else {
    breakdown.push({ criterion: 'Industry top 40', points: 0, matched: false, actual: industryRank });
  }
  
  // Institutional ownership
  if (institutionalOwnership && institutionalOwnership >= 50) {
    score += weights.institutionalOwnership;
    breakdown.push({ criterion: `Institutional ownership ${institutionalOwnership}%`, points: weights.institutionalOwnership, matched: true });
  } else {
    breakdown.push({ criterion: 'Institutional ownership 50%+', points: 0, matched: false, actual: institutionalOwnership });
  }
  
  // EPS growth positive
  if (epsGrowth && epsGrowth > 0) {
    score += weights.epsGrowthPositive;
    breakdown.push({ criterion: 'Positive EPS growth', points: weights.epsGrowthPositive, matched: true });
  } else {
    breakdown.push({ criterion: 'Positive EPS growth', points: 0, matched: false });
  }
  
  // RS > 80 bonus
  if (relativeStrength > 80) {
    score += weights.relativeStrengthBonus;
    breakdown.push({ criterion: 'RS > 80 bonus', points: weights.relativeStrengthBonus, matched: true });
  }

  // === INDUSTRY TREND (8 pts max) ===
  if (industryReturn3Mo != null) {
    if (industryReturn3Mo >= 10) {
      score += weights.industryTrendStrong;
      breakdown.push({ criterion: `Industry trend STRONG: +${industryReturn3Mo.toFixed(1)}% (3mo)`, points: weights.industryTrendStrong, matched: true });
    } else if (industryReturn3Mo >= 5) {
      score += weights.industryTrendModerate;
      breakdown.push({ criterion: `Industry trend MODERATE: +${industryReturn3Mo.toFixed(1)}% (3mo)`, points: weights.industryTrendModerate, matched: true });
    } else {
      breakdown.push({ criterion: 'Industry trend (3mo)', points: 0, matched: false, actual: `${industryReturn3Mo?.toFixed(1)}%` });
    }
  }

  // === RECENT PRICE ACTION (6 pts max) ===
  if (recentReturn5d != null) {
    if (recentReturn5d >= 3) {
      score += weights.recentActionStrong;
      breakdown.push({ criterion: `Recent action STRONG: +${recentReturn5d.toFixed(1)}% (5d)`, points: weights.recentActionStrong, matched: true });
    } else if (recentReturn5d >= 1) {
      score += weights.recentActionGood;
      breakdown.push({ criterion: `Recent action GOOD: +${recentReturn5d.toFixed(1)}% (5d)`, points: weights.recentActionGood, matched: true });
    } else {
      breakdown.push({ criterion: 'Recent price action (5d)', points: 0, matched: false, actual: `${recentReturn5d?.toFixed(1)}%` });
    }
  }

  // Calculate grade based on score
  const confidence = Math.min(100, Math.round(score));
  let grade = 'F';
  if (confidence >= 90) grade = 'A+';
  else if (confidence >= 80) grade = 'A';
  else if (confidence >= 70) grade = 'B+';
  else if (confidence >= 60) grade = 'B';
  else if (confidence >= 50) grade = 'C';
  else if (confidence >= 40) grade = 'D';
  
  return {
    confidence,
    maxPossible: 100,
    grade,
    breakdown
  };
}

/**
 * Generate Opus4.5 Buy Signal (async version with auto-optimized weights)
 * 
 * This version automatically loads optimized weights from the learning system.
 * Use this for API endpoints and production signal generation.
 * 
 * @param {Object} vcpResult - Result from checkVCP()
 * @param {Array} bars - OHLC bars
 * @param {Object} fundamentals - Company fundamentals (optional)
 * @param {Object} industryData - Industry ranking data (optional)
 * @returns {Promise<Object>} Complete Opus4.5 signal result with optimized weights
 */
export async function generateOpus45SignalAsync(vcpResult, bars, fundamentals = null, industryData = null) {
  // Load optimized weights (cached, refreshes every 5 min)
  const weights = await getActiveWeights();
  
  // Use sync version with loaded weights
  const result = generateOpus45Signal(vcpResult, bars, fundamentals, industryData, weights);
  
  // Add weight source info to result
  result.weightsSource = weights._source || 'default';
  if (weights._signalsAnalyzed) {
    result.weightsTrainedOn = weights._signalsAnalyzed;
  }
  
  return result;
}

/**
 * Generate Opus4.5 Buy Signal for a stock (sync version)
 * 
 * @param {Object} vcpResult - Result from checkVCP()
 * @param {Array} bars - OHLC bars
 * @param {Object} fundamentals - Company fundamentals (optional)
 * @param {Object} industryData - Industry ranking data (optional)
 * @param {Object} weights - Custom weights from learning system (optional)
 * @returns {Object} Complete Opus4.5 signal result
 */
export function generateOpus45Signal(vcpResult, bars, fundamentals = null, industryData = null, weights = DEFAULT_WEIGHTS, thresholdsOverride = null, seedMode = false) {
  const ticker = vcpResult.ticker || 'UNKNOWN';
  
  // Validate minimum data requirements
  if (!bars || bars.length < 200) {
    return {
      ticker,
      signal: false,
      signalType: null,
      reason: 'Insufficient bar data (need 200+ days)',
      opus45Confidence: 0,
      opus45Grade: 'F',
      mandatoryPassed: false,
      mandatoryDetails: { passed: false, failedCriteria: ['Insufficient data'] }
    };
  }
  
  // Calculate all required metrics
  const closes = bars.map(b => b.c);
  const sma10Arr = sma(closes, 10);
  const sma20Arr = sma(closes, 20);
  const lastIdx = bars.length - 1;
  const lastClose = closes[lastIdx];
  const sma10 = sma10Arr[lastIdx];
  const sma20 = sma20Arr[lastIdx];
  
  const maAlignment = checkMAAlignment(bars);
  const stats52w = calculate52WeekStats(bars);
  const entryPoint = checkEntryPoint(lastClose, sma10, sma20, MANDATORY_THRESHOLDS.maTolerance);
  const volumeConfirmation = checkVolumeConfirmation(bars);
  
  // Calculate 10 MA slope (NEW - high confidence filter)
  const maSlope = calculate10MASlope(bars);
  
  // Extract data from VCP result
  const relativeStrength = vcpResult.relativeStrength || vcpResult.rsData?.rs || null;
  const contractions = vcpResult.contractions || 0;
  const patternConfidence = vcpResult.patternConfidence || 0;
  const volumeDryUp = vcpResult.volumeDryUp || false;
  
  // Extract fundamentals
  const institutionalOwnership = fundamentals?.pctHeldByInst || null;
  const epsGrowth = fundamentals?.qtrEarningsYoY || null;
  const industryRank = industryData?.rank || vcpResult.industryRank || null;
  const industryReturn3Mo = industryData?.return3Mo ?? null;
  
  // Calculate pullback depth from recent 5-day high
  // Backtest showed: entries where stock pulled back 1-12% before touching MA
  // have much higher win rates than stocks just hovering at MA level
  const closes5d = bars.slice(-6, -1).map(b => b.c);
  const high5d = closes5d.length > 0 ? Math.max(...closes5d) : lastClose;
  const pullbackPct = high5d > 0 ? ((high5d - lastClose) / high5d) * 100 : 0;

  // Recent 5-day return (short-term price momentum)
  const close5dAgo = bars.length >= 6 ? bars[lastIdx - 5].c : null;
  const recentReturn5d = close5dAgo ? ((lastClose - close5dAgo) / close5dAgo) * 100 : null;
  
  // Check mandatory criteria
  const mandatoryCheck = checkMandatoryCriteria({
    bars,
    relativeStrength,
    contractions,
    patternConfidence,
    maAlignment,
    stats52w,
    entryPoint,
    maSlope,  // NEW: 10 MA slope check
    thresholdsOverride
  });

  const seedCheck = seedMode
    ? checkSeedCriteria({ relativeStrength, stats52w, maSlope, thresholdsOverride })
    : null;
  const usedSeedMode = !!(seedMode && !mandatoryCheck.passed && seedCheck?.passed);
  
  // If mandatory criteria fail, return early
  if (!mandatoryCheck.passed && !usedSeedMode) {
    return {
      ticker,
      signal: false,
      signalType: null,
      reason: `Failed mandatory criteria: ${mandatoryCheck.failedCriteria.join(', ')}`,
      opus45Confidence: 0,
      opus45Grade: 'F',
      mandatoryPassed: false,
      mandatoryDetails: mandatoryCheck,
      // Include metrics for transparency
      metrics: {
        relativeStrength,
        contractions,
        patternConfidence,
        maAlignment: maAlignment.aligned,
        stats52w,
        entryPoint,
        volumeDryUp,
        maSlope  // NEW: include slope in failed signals for debugging
      }
    };
  }
  
  // Calculate confidence score for valid signals
  const confidenceResult = calculateConfidenceScore({
    contractions,
    volumeDryUp,
    patternConfidence,
    entryPoint,
    volumeConfirmation,
    relativeStrength,
    industryRank,
    institutionalOwnership,
    epsGrowth,
    maSlope,            // 10 MA slope data (primary win predictor from backtest)
    pullbackPct,        // pullback % from 5-day high (ideal 2-5% for highest win rate)
    pctFromHigh: stats52w?.pctFromHigh,
    industryReturn3Mo,  // 3-month industry group return
    recentReturn5d,     // 5-day price return heading into setup
  }, weights);
  
  // Determine signal strength
  let signalType = 'WEAK';
  if (confidenceResult.confidence >= 80) signalType = 'STRONG';
  else if (confidenceResult.confidence >= 60) signalType = 'MODERATE';
  
  // Calculate stop loss and target prices
  const stopLossPrice = lastClose * (1 - EXIT_THRESHOLDS.stopLossPercent / 100);
  const riskPercent = EXIT_THRESHOLDS.stopLossPercent;
  
  // Calculate potential reward (using 52w high as initial target)
  const targetPrice = stats52w?.high52w || lastClose * 1.15;
  const rewardPercent = ((targetPrice - lastClose) / lastClose) * 100;
  const riskRewardRatio = rewardPercent / riskPercent;
  
  return {
    ticker,
    signal: true,
    signalType,
    signalName: usedSeedMode ? 'Opus4.5 Seed Signal' : 'Opus4.5 Buy Signal',
    seedMode: usedSeedMode,
    
    // Confidence metrics
    opus45Confidence: confidenceResult.confidence,
    opus45Grade: confidenceResult.grade,
    confidenceBreakdown: confidenceResult.breakdown,
    
    // Entry details
    entryPrice: lastClose,
    entryDate: bars[lastIdx].t,
    entryMA: entryPoint.atWhichMA,
    
    // Exit rules
    stopLossPrice: Math.round(stopLossPrice * 100) / 100,
    stopLossPercent: EXIT_THRESHOLDS.stopLossPercent,
    targetPrice: Math.round(targetPrice * 100) / 100,
    
    // Risk/Reward
    riskPercent,
    rewardPercent: Math.round(rewardPercent * 10) / 10,
    riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
    
    // Mandatory criteria
    mandatoryPassed: mandatoryCheck.passed,
    mandatoryDetails: mandatoryCheck,
    seedDetails: usedSeedMode ? seedCheck : null,
    
    // All metrics for transparency and learning
    metrics: {
      relativeStrength,
      contractions,
      patternConfidence,
      pattern: vcpResult.pattern || 'VCP',
      volumeDryUp,
      volumeConfirmation,
      maAlignment,
      stats52w,
      entryPoint,
      industryRank,
      institutionalOwnership,
      epsGrowth,
      sma10,
      sma20,
      sma50: maAlignment.sma50,
      sma150: maAlignment.sma150,
      sma200: maAlignment.sma200,
      maSlope,
      pullbackPct: Math.round(pullbackPct * 10) / 10,
      industryReturn3Mo,
      recentReturn5d: recentReturn5d != null ? Math.round(recentReturn5d * 10) / 10 : null,
    }
  };
}

/**
 * Check for EXIT signal on the current bar.
 *
 * EXIT RULES (in priority order):
 * 1. STOP_LOSS:      -7% from entry price (hard floor, executes immediately)
 * 2. BREAKEVEN_STOP: Once up 5%+, stop moves to entry price (-0.5% buffer)
 * 3. PROFIT_LOCK: Once up 10%+, never give back more than 50% of max gain
 * 4. BELOW_10MA_3DAY: 3 consecutive daily closes below 10 MA
 *
 * Uses bars array directly to check consecutive closes (no external state needed).
 *
 * @param {Object} position - { entryPrice, ticker, highSinceEntry? }
 * @param {Array} bars - Current OHLC bars (at least 15)
 * @returns {Object} { exitSignal, exitType, exitPrice, exitReason, below10MA }
 */
export function checkExitSignal(position, bars) {
  if (!bars || bars.length < 15) {
    return { exitSignal: false, exitType: null, exitReason: 'Insufficient data' };
  }
  
  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lastIdx = bars.length - 1;
  const lastClose = closes[lastIdx];
  const lastBar = bars[lastIdx];
  
  const sma10Arr = sma(closes, 10);
  const sma10 = sma10Arr[lastIdx];
  
  const below10MA = sma10 != null && lastClose < sma10;
  const pctFromEntry = ((lastClose - position.entryPrice) / position.entryPrice) * 100;

  // Track highest price since entry (use position state if available, else estimate from recent bars)
  const highSinceEntry = position.highSinceEntry || Math.max(...highs.slice(-60));
  const maxGainPct = ((highSinceEntry - position.entryPrice) / position.entryPrice) * 100;

  // EXIT RULE 1: Hard stop loss
  if (pctFromEntry <= -EXIT_THRESHOLDS.stopLossPercent) {
    return {
      exitSignal: true,
      exitType: 'STOP_LOSS',
      exitPrice: lastClose,
      exitDate: lastBar.t,
      exitReason: `Stop loss hit: ${pctFromEntry.toFixed(1)}% from entry (limit: -${EXIT_THRESHOLDS.stopLossPercent}%)`,
      pctFromEntry: Math.round(pctFromEntry * 10) / 10,
      sma10,
      below10MA
    };
  }

  // EXIT RULE 2: Breakeven stop (once up 5%+, never let it become a loser)
  if (maxGainPct >= EXIT_THRESHOLDS.breakevenActivationPct && pctFromEntry <= -EXIT_THRESHOLDS.breakevenBufferPct) {
    return {
      exitSignal: true,
      exitType: 'BREAKEVEN_STOP',
      exitPrice: lastClose,
      exitDate: lastBar.t,
      exitReason: `Breakeven stop: was up ${maxGainPct.toFixed(1)}%, now ${pctFromEntry.toFixed(1)}%`,
      pctFromEntry: Math.round(pctFromEntry * 10) / 10,
      sma10,
      below10MA
    };
  }

  // EXIT RULE 3: Trailing profit lock (once up 10%+, keep at least 50% of max gain)
  if (maxGainPct >= EXIT_THRESHOLDS.profitLockActivationPct) {
    const minAcceptableReturn = maxGainPct * (1 - EXIT_THRESHOLDS.profitGivebackPct / 100);
    if (pctFromEntry < minAcceptableReturn) {
      return {
        exitSignal: true,
        exitType: 'PROFIT_LOCK',
        exitPrice: lastClose,
        exitDate: lastBar.t,
        exitReason: `Profit lock: max gain ${maxGainPct.toFixed(1)}%, current ${pctFromEntry.toFixed(1)}% < floor ${minAcceptableReturn.toFixed(1)}%`,
        pctFromEntry: Math.round(pctFromEntry * 10) / 10,
        sma10,
        below10MA
      };
    }
  }
  
  // EXIT RULE 4: N consecutive closes below 10 MA
  const requiredDays = EXIT_THRESHOLDS.below10MADays;
  let consecutiveBelow = 0;
  for (let j = lastIdx; j > lastIdx - requiredDays && j >= 0; j--) {
    if (sma10Arr[j] != null && closes[j] < sma10Arr[j]) {
      consecutiveBelow++;
    } else {
      break;
    }
  }
  if (consecutiveBelow >= requiredDays) {
    return {
      exitSignal: true,
      exitType: `BELOW_10MA_${requiredDays}DAY`,
      exitPrice: lastClose,
      exitDate: lastBar.t,
      exitReason: `${requiredDays} consecutive closes below 10 MA ${sma10?.toFixed(2)}`,
      pctFromEntry: Math.round(pctFromEntry * 10) / 10,
      sma10,
      below10MA
    };
  }
  
  return {
    exitSignal: false,
    exitType: null,
    exitPrice: null,
    currentPrice: lastClose,
    pctFromEntry: Math.round(pctFromEntry * 10) / 10,
    maxGainPct: Math.round(maxGainPct * 10) / 10,
    sma10,
    below10MA,
    aboveStop: true,
    above10MA: !below10MA,
    highSinceEntry: Math.max(highSinceEntry, lastBar.h)
  };
}

/**
 * Check if there's a valid buy signal that should be recommended.
 * 
 * This is a fast check for the scanner. It checks if there's a signal on the current bar,
 * then looks back 1-2 days (without recalculating VCP) to estimate entry timing.
 * 
 * For full accuracy (complete trade history, exact entry/exit dates), use the history endpoint
 * which recalculates VCP for each bar. This function prioritizes speed for the scanner.
 * 
 * @param {Array} bars - OHLC bars (sorted by time ascending)
 * @param {Object} vcpResult - VCP analysis result from scan (current bar)
 * @param {Object} fundamentals - Company fundamentals
 * @param {Object} industryData - Industry ranking data
 * @param {Object} weights - Custom weights
 * @param {number} maxDaysAgo - Maximum days ago for a valid signal (default 2)
 * @param {Array} spyBars - Not used in simplified version (kept for API compatibility)
 * @returns {Object|null} The active buy signal or null
 */
function findActiveBuySignal(bars, vcpResult, fundamentals, industryData, weights, maxDaysAgo = MAX_DAYS_FOR_RECOMMENDATION, spyBars = null) {
  if (!bars || bars.length < 200) return null;
  
  const lastIdx = bars.length - 1;
  
  // Check if there's a valid buy signal on the CURRENT bar
  const currentSignal = generateOpus45Signal(vcpResult, bars, fundamentals, industryData, weights);
  
  if (!currentSignal.signal) {
    return null; // No valid signal today
  }
  
  // Estimate how long we've been at/near the MA (rough heuristic for entry timing)
  // Look back up to 3 days to see when price first came near 10 MA
  const closes = bars.map(b => b.c);
  const sma10Arr = sma(closes, 10);
  const lastClose = closes[lastIdx];
  const tolerance = MANDATORY_THRESHOLDS.maTolerance / 100;
  
  let firstNearMAIdx = lastIdx;
  for (let i = Math.max(0, lastIdx - 3); i <= lastIdx; i++) {
    const closeAtI = closes[i];
    const sma10AtI = sma10Arr[i];
    if (sma10AtI && Math.abs(closeAtI - sma10AtI) / sma10AtI <= tolerance) {
      firstNearMAIdx = i;
      break;
    }
  }
  
  const daysSinceBuy = lastIdx - firstNearMAIdx;
  const entryBar = bars[firstNearMAIdx];
  let entryDate = entryBar && entryBar.t != null ? entryBar.t : null;
  if (entryDate != null && entryDate < 1e12) entryDate = entryDate * 1000;
  
  // Only recommend if within maxDaysAgo
  if (daysSinceBuy <= maxDaysAgo) {
    const rankScore = computeRankScore(currentSignal.opus45Confidence ?? 0, daysSinceBuy);
    return {
      ...currentSignal,
      daysSinceBuy,
      isNewBuyToday: isNewBuyToday(daysSinceBuy),
      rankScore,
      buyBarIndex: firstNearMAIdx,
      stillActive: true,
      entryDate,
      entryPrice: bars[firstNearMAIdx].c
    };
  }
  
  return null;
}

/**
 * Find all Opus4.5 signals from scan results
 * Returns active BUY signals (sorted by confidence) plus a score for every ticker for table display.
 * 
 * IMPORTANT: Only includes signals where:
 * 1. The last signal was a BUY (not exited by sell signal)
 * 2. That BUY signal was within the last 1-2 days (fresh recommendations)
 *
 * @param {Array} scanResults - Results from enhanced scan
 * @param {Object} barsByTicker - Map of ticker to bars
 * @param {Object} fundamentalsByTicker - Map of ticker to fundamentals
 * @param {Object} industryRanks - Industry ranking data
 * @param {Object} weights - Custom weights (optional)
 * @param {Array} spyBars - SPY/S&P 500 bars for RS calculation (optional)
 * @returns {{ signals: Array, allScores: Array<{ticker, opus45Confidence, opus45Grade}> }}
 */
export function findOpus45Signals(scanResults, barsByTicker, fundamentalsByTicker = {}, industryRanks = {}, weights = DEFAULT_WEIGHTS, spyBars = null) {
  const signals = [];
  const allScores = [];

  for (const result of scanResults) {
    const ticker = result.ticker;
    const bars = barsByTicker[ticker];
    const fundamentals = fundamentalsByTicker[ticker];

    // Get industry data
    let industryData = null;
    if (result.industryName && industryRanks[result.industryName]) {
      industryData = industryRanks[result.industryName];
    }

    // Find if there's an active (non-exited) buy signal that's recent
    const activeBuySignal = findActiveBuySignal(
      bars, 
      result, 
      fundamentals, 
      industryData, 
      weights,
      MAX_DAYS_FOR_RECOMMENDATION,
      spyBars  // Pass SPY bars for accurate historical signal detection
    );

    // For allScores: show the confidence if there's an active position (even if old)
    // Show 0/F if position was exited or never had a signal
    if (activeBuySignal?.stillActive) {
      const lastClose = bars && bars.length > 0 ? bars[bars.length - 1].c : null;
      const entryPrice = activeBuySignal.entryPrice;
      const pctChange = entryPrice != null && lastClose != null && entryPrice > 0
        ? Math.round((lastClose - entryPrice) / entryPrice * 1000) / 10
        : null;
      // entryDate is in ms; if stored as seconds (e.g. from another source), normalize
      const entryMs = activeBuySignal.entryDate != null
        ? (activeBuySignal.entryDate < 1e12 ? activeBuySignal.entryDate * 1000 : activeBuySignal.entryDate)
        : null;
      const entryDateIso = entryMs != null ? new Date(entryMs).toISOString().slice(0, 10) : null;
      allScores.push({
        ticker,
        opus45Confidence: activeBuySignal.opus45Confidence ?? 0,
        opus45Grade: activeBuySignal.opus45Grade ?? 'F',
        daysSinceBuy: activeBuySignal.daysSinceBuy,
        isNewBuyToday: activeBuySignal.isNewBuyToday ?? isNewBuyToday(activeBuySignal.daysSinceBuy),
        rankScore: activeBuySignal.rankScore ?? computeRankScore(activeBuySignal.opus45Confidence ?? 0, activeBuySignal.daysSinceBuy),
        stillInPosition: true,
        entryDate: entryDateIso,
        entryPrice,
        stopLossPrice: activeBuySignal.stopLossPrice ?? null,
        riskRewardRatio: activeBuySignal.riskRewardRatio ?? null,
        currentPrice: lastClose,
        pctChange
      });
      
      // Only add to signals list if it's a fresh recommendation (not too old)
      if (!activeBuySignal.tooOldForRecommendation) {
        const enhancedScore = result.enhancedScore ?? result.score;
        signals.push({
          ...activeBuySignal,
          enhancedScore,
          originalScore: enhancedScore,
          originalGrade: result.enhancedGrade
        });
      }
    } else {
      // No active position - either never had signal or was exited
      allScores.push({
        ticker,
        opus45Confidence: 0,
        opus45Grade: 'F',
        stillInPosition: false
      });
    }
  }

  // Sort by rankScore (confidence + recency), tie-break on base confidence
  signals.sort((a, b) => {
    const rankA = a.rankScore ?? computeRankScore(a.opus45Confidence ?? 0, a.daysSinceBuy);
    const rankB = b.rankScore ?? computeRankScore(b.opus45Confidence ?? 0, b.daysSinceBuy);
    if (rankB !== rankA) return rankB - rankA;
    return (b.opus45Confidence ?? 0) - (a.opus45Confidence ?? 0);
  });

  return { signals, allScores };
}

/**
 * Get signal statistics summary
 * 
 * @param {Array} signals - Array of Opus4.5 signals
 * @returns {Object} Summary statistics
 */
export function getSignalStats(signals) {
  if (!signals || signals.length === 0) {
    return {
      total: 0,
      strong: 0,
      moderate: 0,
      weak: 0,
      avgConfidence: 0,
      avgRiskReward: 0,
      byIndustry: {}
    };
  }
  
  const strong = signals.filter(s => s.signalType === 'STRONG').length;
  const moderate = signals.filter(s => s.signalType === 'MODERATE').length;
  const weak = signals.filter(s => s.signalType === 'WEAK').length;
  
  const avgConfidence = signals.reduce((sum, s) => sum + s.opus45Confidence, 0) / signals.length;
  const avgRiskReward = signals.reduce((sum, s) => sum + (s.riskRewardRatio || 0), 0) / signals.length;
  
  // Group by industry
  const byIndustry = {};
  for (const s of signals) {
    const ind = s.metrics?.industryRank ? `Rank ${s.metrics.industryRank}` : 'Unknown';
    byIndustry[ind] = (byIndustry[ind] || 0) + 1;
  }
  
  return {
    total: signals.length,
    strong,
    moderate,
    weak,
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    avgRiskReward: Math.round(avgRiskReward * 10) / 10,
    byIndustry
  };
}
