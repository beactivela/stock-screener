/**
 * Historical Signal Scanner
 * 
 * Scans back through 12 months of price history to find where
 * Opus4.5 buy signals would have fired. This generates synthetic
 * trades for the learning system WITHOUT requiring manual entry.
 * 
 * For each ticker:
 * 1. Fetch 12+ months of daily bars
 * 2. Walk through each day, check if Opus4.5 criteria met
 * 3. When signal fires, simulate the trade to exit
 * 4. Record full context + outcome for learning
 * 
 * This enables cross-stock pattern analysis to optimize VCP setups.
 */

// Use the caching layer so 5-year bars are saved to Supabase bars_cache.
// First run fetches from Yahoo; subsequent runs within 90 days use the DB copy.
import { getBars, getTickersFromBarsCache } from '../db/bars.js';
import { checkVCP, sma, calculateRelativeStrength } from '../vcp.js';
import { generateOpus45Signal, checkExitSignal, EXIT_THRESHOLDS } from '../opus45Signal.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { computeATR, detectBreakout, donchianHigh, donchianLow, simulateTurtleTrade } from './turtleSignals.js';

// v1 = 4% stop / 2-day MA rule / 60-day hold
// v2 = 7% stop / 3-day MA rule / 90-day hold + breakeven + profit lock
const EXIT_STRATEGY_VERSION = 2;

export function createScanDiagnostics() {
  return {
    tickersScanned: 0,
    barsMissing: 0,
    barsTooShort: 0,
    turtle: {
      checks: 0,
      breakouts20: 0,
      breakouts55: 0,
      noBreakout: 0,
      signals: 0,
    },
  };
}

/**
 * Scan a single ticker for historical Opus4.5 signals
 * 
 * @param {string} ticker - Stock symbol
 * @param {Array} bars - Full historical bars (12+ months)
 * @param {Array} spyBars - SPY bars for RS calculation
 * @param {Object} options - Scan options
 * @returns {Array} Array of historical signals with outcomes
 */
export function scanTickerForSignals(ticker, bars, spyBars, options = {}) {
  const {
    minDaysBetweenSignals = 10,
    requireVolumeConfirm = true,
    // Raised from 20 → 50 so a 5-year scan surfaces all valid setups per ticker
    maxSignalsPerTicker = 50,
    scanType = 'deep_historical',
    lookbackMonths = 60,
    signalFamilies = ['opus45'],
    thresholdOverrides = null,
    seedMode = false,
    diagnostics = null,
  } = options;
  
  if (!bars || bars.length < 250) {
    if (diagnostics) {
      diagnostics.barsTooShort += 1;
    }
    return [];
  }
  
  const signals = [];
  const includeOpus45 = signalFamilies.includes('opus45');
  const includeTurtle = signalFamilies.includes('turtle');
  const includeCross = signalFamilies.includes('ma_crossover');
  const lastSignalIdxByFamily = {
    opus45: -minDaysBetweenSignals,
    turtle: -minDaysBetweenSignals,
    ma_crossover: -minDaysBetweenSignals,
  };
  const signalCountByFamily = { opus45: 0, turtle: 0, ma_crossover: 0 };
  const atr20 = includeTurtle ? computeATR(bars, 20) : null;
  
  // Walk through each day starting from day 200 (need history for MAs)
  for (let i = 200; i < bars.length - 5; i++) {
    // Get bars up to this point (simulating "today" is bar i)
    const barsToDate = bars.slice(0, i + 1);
    const spyBarsToDate = spyBars ? spyBars.slice(0, i + 1) : null;
    
    // Run VCP check with SPY for RS
    const vcpResult = checkVCP(barsToDate, spyBarsToDate);
    
    // Add ticker for signal generation
    vcpResult.ticker = ticker;
    
    // ── Opus4.5 signals ─────────────────────────────────────────────────────
    if (includeOpus45 && (i - lastSignalIdxByFamily.opus45 >= minDaysBetweenSignals)) {
      const signal = generateOpus45Signal(vcpResult, barsToDate, null, null, undefined, thresholdOverrides, seedMode);

      if (signal.signal) {
        const entryBar = barsToDate[barsToDate.length - 1];
        const entryDate = new Date(entryBar.t);
        
        // Simulate trade to exit
        const futureBars = bars.slice(i);
        const tradeResult = simulateTrade(signal, futureBars);
        
        // Capture full context at entry
        const context = captureContext(ticker, barsToDate, spyBarsToDate, vcpResult, signal);
        
        signals.push({
          ticker,
          entryDate: entryDate.toISOString().slice(0, 10),
          entryPrice: signal.entryPrice,
          entryBarIdx: i,
          signalFamily: 'opus45',
          
          // Signal quality
          opus45Confidence: signal.opus45Confidence,
          opus45Grade: signal.opus45Grade,
          signalType: signal.signalType,
          
          // Trade outcome
          exitDate: tradeResult.exitDate,
          exitPrice: tradeResult.exitPrice,
          exitType: tradeResult.exitType,
          returnPct: tradeResult.returnPct,
          holdingDays: tradeResult.holdingDays,
          maxGain: tradeResult.maxGain,
          maxDrawdown: tradeResult.maxDrawdown,
          
          // Full context for learning
          context: { ...context, signalFamily: 'opus45' },
          
          // Pattern details
          pattern: vcpResult.pattern,
          patternConfidence: vcpResult.patternConfidence,
          contractions: vcpResult.contractions,
          
          // Source + scan metadata
          source: 'historical_scan',
          scanType,
          lookbackMonths,
          exitStrategyVersion: EXIT_STRATEGY_VERSION,
        });
        
        lastSignalIdxByFamily.opus45 = i;
        signalCountByFamily.opus45++;
      }
    }

    // ── 10/20 MA Cross Over signals ─────────────────────────────────────────
    if (includeCross && (i - lastSignalIdxByFamily.ma_crossover >= minDaysBetweenSignals)) {
      const closes = barsToDate.map(b => b.c);
      const sma10Arr = sma(closes, 10);
      const sma20Arr = sma(closes, 20);
      const lastIdx = closes.length - 1;
      const prevIdx = lastIdx - 1;
      const sma10 = sma10Arr[lastIdx];
      const sma20 = sma20Arr[lastIdx];
      const sma10Prev = sma10Arr[prevIdx];
      const sma20Prev = sma20Arr[prevIdx];

      const hasMA = sma10 != null && sma20 != null && sma10Prev != null && sma20Prev != null;
      const maCrossUp = hasMA && sma10 > sma20 && sma10Prev <= sma20Prev;

      if (maCrossUp) {
        const entryBar = barsToDate[barsToDate.length - 1];
        const entryDate = new Date(entryBar.t);
        const entryPrice = entryBar.c;
        const futureBars = bars.slice(i);
        const tradeResult = simulateCrossTrade({ entryPrice }, futureBars);
        const context = captureContext(ticker, barsToDate, spyBarsToDate, vcpResult, null);

        signals.push({
          ticker,
          entryDate: entryDate.toISOString().slice(0, 10),
          entryPrice,
          entryBarIdx: i,
          signalFamily: 'ma_crossover',
          signalType: 'MA_CROSS_10_20',

          // Trade outcome
          exitDate: tradeResult.exitDate,
          exitPrice: tradeResult.exitPrice,
          exitType: tradeResult.exitType,
          returnPct: tradeResult.returnPct,
          holdingDays: tradeResult.holdingDays,
          maxGain: tradeResult.maxGain,
          maxDrawdown: tradeResult.maxDrawdown,

          // Full context for learning
          context: {
            ...context,
            signalFamily: 'ma_crossover',
            ma10Above20: sma10 > sma20,
            maCrossUp: true,
          },

          // Source + scan metadata
          source: 'historical_scan',
          scanType,
          lookbackMonths,
          exitStrategyVersion: EXIT_STRATEGY_VERSION,
        });

        lastSignalIdxByFamily.ma_crossover = i;
        signalCountByFamily.ma_crossover++;
      }
    }

    // ── Turtle signals (long-only) ───────────────────────────────────────────
    if (includeTurtle && (i - lastSignalIdxByFamily.turtle >= minDaysBetweenSignals)) {
      if (diagnostics) {
        diagnostics.turtle.checks += 1;
      }
      const breakout55 = detectBreakout(bars, i, 55);
      const breakout20 = detectBreakout(bars, i, 20);
      if (diagnostics) {
        if (breakout20) diagnostics.turtle.breakouts20 += 1;
        if (breakout55) diagnostics.turtle.breakouts55 += 1;
        if (!breakout20 && !breakout55) diagnostics.turtle.noBreakout += 1;
      }
      const system = breakout55 ? 'S2' : (breakout20 ? 'S1' : null);
      
      if (system) {
        const entryBar = barsToDate[barsToDate.length - 1];
        const entryDate = new Date(entryBar.t);
        const entryPrice = entryBar.c;
        const exitLookback = system === 'S2' ? 20 : 10;
        
        const tradeResult = simulateTurtleTrade({
          bars,
          entryIndex: i,
          system,
          atrPeriod: 20,
          stopMultiple: 2,
          exitLookback,
        });
        
        const context = captureContext(ticker, barsToDate, spyBarsToDate, vcpResult, null);
        const prior20High = donchianHigh(bars, 20, i);
        const prior55High = donchianHigh(bars, 55, i);
        const prior10Low = donchianLow(bars, 10, i);
        const prior20Low = donchianLow(bars, 20, i);
        const atrN = atr20 ? atr20[i] : null;
        const atrPct = atrN != null && entryPrice ? (atrN / entryPrice) * 100 : null;
        
        signals.push({
          ticker,
          entryDate: entryDate.toISOString().slice(0, 10),
          entryPrice,
          entryBarIdx: i,
          signalFamily: 'turtle',
          signalType: `TURTLE_${system}`,
          
          // Trade outcome
          exitDate: tradeResult.exitDate,
          exitPrice: tradeResult.exitPrice,
          exitType: tradeResult.exitType,
          returnPct: tradeResult.returnPct,
          holdingDays: tradeResult.holdingDays,
          maxGain: tradeResult.maxGain,
          maxDrawdown: tradeResult.maxDrawdown,
          
          // Full context for learning
          context: {
            ...context,
            signalFamily: 'turtle',
            turtleSystem: system,
            turtleBreakout20: breakout20,
            turtleBreakout55: breakout55,
            donchian20High: round2(prior20High),
            donchian55High: round2(prior55High),
            donchian10Low: round2(prior10Low),
            donchian20Low: round2(prior20Low),
            atr20: round2(atrN),
            atr20Pct: round2(atrPct),
          },
          
          // Pattern details (shared context)
          pattern: vcpResult.pattern,
          patternConfidence: vcpResult.patternConfidence,
          contractions: vcpResult.contractions,
          
          // Source + scan metadata
          source: 'historical_scan',
          scanType,
          lookbackMonths,
          exitStrategyVersion: EXIT_STRATEGY_VERSION,
        });
        
        lastSignalIdxByFamily.turtle = i;
        signalCountByFamily.turtle++;
        if (diagnostics) {
          diagnostics.turtle.signals += 1;
        }
      }
    }

    const opusFull = includeOpus45 ? signalCountByFamily.opus45 >= maxSignalsPerTicker : true;
    const turtleFull = includeTurtle ? signalCountByFamily.turtle >= maxSignalsPerTicker : true;
    const crossFull = includeCross ? signalCountByFamily.ma_crossover >= maxSignalsPerTicker : true;
    if (opusFull && turtleFull && crossFull) break;
  }
  
  return signals;
}

/**
 * Simulate a trade from entry to exit using multi-phase exit strategy.
 *
 * Designed for momentum compounding (5-10% monthly target on $100K).
 * Key insight: let winners run with trailing protection, cut losers at 7%.
 *
 * EXIT PHASES (evaluated in order each bar):
 *   1. Hard stop:      -7% from entry (Minervini's 7-8% rule)
 *   2. Breakeven stop: Once up 5%+, stop moves to entry (-0.5% buffer)
 *   3. Profit lock:    Once up 10%+, never give back >50% of max gain
 *   4. Trend exit:     3 consecutive closes below 10 MA
 *   5. Max hold:       90 trading days
 *
 * WHY THIS WORKS FOR COMPOUNDING:
 * - Wider initial stop (-7% vs -4%) survives normal VCP shakeouts → higher win rate
 * - Breakeven stop after +5% means winning trades can't become losers
 * - Profit lock after +10% captures big moves (VCP targets 15-50%)
 * - 3-day 10 MA rule (vs 2-day) avoids noise exits during healthy pullbacks
 * - 90-day hold (vs 60) lets big winners develop
 *
 * @param {Object} signal - The buy signal
 * @param {Array} futureBars - Bars from entry onward
 * @returns {Object} Trade outcome
 */
function simulateTrade(signal, futureBars) {
  if (!futureBars || futureBars.length < 2) {
    return { exitType: 'NO_DATA', returnPct: 0, holdingDays: 0 };
  }
  
  const entryPrice = signal.entryPrice;
  const stopLossPct = EXIT_THRESHOLDS.stopLossPercent;
  const stopLossPrice = entryPrice * (1 - stopLossPct / 100);
  const maxHoldDays = EXIT_THRESHOLDS.maxHoldDays || 90;
  const requiredDaysBelowMA = EXIT_THRESHOLDS.below10MADays || 3;
  const breakevenActivation = EXIT_THRESHOLDS.breakevenActivationPct || 5;
  const breakevenBuffer = EXIT_THRESHOLDS.breakevenBufferPct || 0.5;
  const profitLockActivation = EXIT_THRESHOLDS.profitLockActivationPct || 10;
  const profitGivebackPct = EXIT_THRESHOLDS.profitGivebackPct || 50;
  
  let maxGain = 0;
  let maxDrawdown = 0;
  let consecutiveBelowMA = 0;
  
  const allCloses = futureBars.map(b => b.c);
  const sma10Arr = sma(allCloses, 10);
  
  const buildResult = (bar, i, exitType) => {
    const returnPct = ((bar.c - entryPrice) / entryPrice) * 100;
    return {
      exitDate: new Date(bar.t).toISOString().slice(0, 10),
      exitPrice: bar.c,
      exitType,
      returnPct: Math.round(returnPct * 10) / 10,
      holdingDays: i,
      maxGain: Math.round(maxGain * 10) / 10,
      maxDrawdown: Math.round(maxDrawdown * 10) / 10
    };
  };
  
  for (let i = 1; i < Math.min(futureBars.length, maxHoldDays); i++) {
    const bar = futureBars[i];
    const close = bar.c;
    const sma10 = sma10Arr[i];
    
    const currentReturn = ((close - entryPrice) / entryPrice) * 100;
    const highReturn = ((bar.h - entryPrice) / entryPrice) * 100;
    maxGain = Math.max(maxGain, highReturn, currentReturn);
    maxDrawdown = Math.min(maxDrawdown, currentReturn);
    
    // PHASE 1: Hard stop loss (-7%)
    if (close <= stopLossPrice) {
      return buildResult(bar, i, 'STOP_LOSS');
    }
    
    // PHASE 2: Breakeven stop (once up 5%+, don't let it become a loser)
    if (maxGain >= breakevenActivation && currentReturn <= -breakevenBuffer) {
      return buildResult(bar, i, 'BREAKEVEN_STOP');
    }
    
    // PHASE 3: Trailing profit lock (once up 10%+, keep ≥50% of max gain)
    if (maxGain >= profitLockActivation) {
      const minAcceptableReturn = maxGain * (1 - profitGivebackPct / 100);
      if (currentReturn < minAcceptableReturn) {
        return buildResult(bar, i, 'PROFIT_LOCK');
      }
    }
    
    // PHASE 4: Trend exit (3 consecutive closes below 10 MA)
    const below10MA = sma10 != null && close < sma10;
    if (below10MA) {
      consecutiveBelowMA++;
      if (consecutiveBelowMA >= requiredDaysBelowMA) {
        return buildResult(bar, i, 'BELOW_10MA');
      }
    } else {
      consecutiveBelowMA = 0;
    }
  }
  
  // PHASE 5: Max hold exit
  const lastIdx = Math.min(futureBars.length - 1, maxHoldDays - 1);
  const lastBar = futureBars[lastIdx];
  const finalReturn = ((lastBar.c - entryPrice) / entryPrice) * 100;
  maxGain = Math.max(maxGain, finalReturn);
  
  return {
    exitDate: new Date(lastBar.t).toISOString().slice(0, 10),
    exitPrice: lastBar.c,
    exitType: 'MAX_HOLD',
    returnPct: Math.round(finalReturn * 10) / 10,
    holdingDays: lastIdx,
    maxGain: Math.round(maxGain * 10) / 10,
    maxDrawdown: Math.round(maxDrawdown * 10) / 10
  };
}

/**
 * Simulate a trade from entry to exit for MA crossover rules.
 *
 * Exit rule: first close below 10 MA.
 */
function simulateCrossTrade(signal, futureBars) {
  if (!futureBars || futureBars.length < 2) {
    return { exitType: 'NO_DATA', returnPct: 0, holdingDays: 0 };
  }

  const entryPrice = signal.entryPrice;
  let maxGain = 0;
  let maxDrawdown = 0;
  const allCloses = futureBars.map(b => b.c);
  const sma10Arr = sma(allCloses, 10);

  const buildResult = (bar, i, exitType) => {
    const returnPct = ((bar.c - entryPrice) / entryPrice) * 100;
    return {
      exitDate: new Date(bar.t).toISOString().slice(0, 10),
      exitPrice: bar.c,
      exitType,
      returnPct: Math.round(returnPct * 10) / 10,
      holdingDays: i,
      maxGain: Math.round(maxGain * 10) / 10,
      maxDrawdown: Math.round(maxDrawdown * 10) / 10
    };
  };

  for (let i = 1; i < futureBars.length; i++) {
    const bar = futureBars[i];
    const close = bar.c;
    const sma10 = sma10Arr[i];
    const currentReturn = ((close - entryPrice) / entryPrice) * 100;
    const highReturn = ((bar.h - entryPrice) / entryPrice) * 100;
    maxGain = Math.max(maxGain, highReturn, currentReturn);
    maxDrawdown = Math.min(maxDrawdown, currentReturn);

    if (sma10 != null && close < sma10) {
      return buildResult(bar, i, 'BELOW_10MA');
    }
  }

  const lastIdx = futureBars.length - 1;
  const lastBar = futureBars[lastIdx];
  const finalReturn = ((lastBar.c - entryPrice) / entryPrice) * 100;
  maxGain = Math.max(maxGain, finalReturn);

  return {
    exitDate: new Date(lastBar.t).toISOString().slice(0, 10),
    exitPrice: lastBar.c,
    exitType: 'MAX_HOLD',
    returnPct: Math.round(finalReturn * 10) / 10,
    holdingDays: lastIdx,
    maxGain: Math.round(maxGain * 10) / 10,
    maxDrawdown: Math.round(maxDrawdown * 10) / 10
  };
}

/**
 * Capture full entry context for learning
 */
function captureContext(ticker, bars, spyBars, vcpResult, signal) {
  const lastIdx = bars.length - 1;
  const lastBar = bars[lastIdx];
  const closes = bars.map(b => b.c);
  
  // Calculate all MAs
  const sma10Arr = sma(closes, 10);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma150Arr = sma(closes, 150);
  const sma200Arr = sma(closes, 200);
  
  // MA values
  const sma10 = sma10Arr[lastIdx];
  const sma20 = sma20Arr[lastIdx];
  const sma50 = sma50Arr[lastIdx];
  const sma150 = sma150Arr[lastIdx];
  const sma200 = sma200Arr[lastIdx];
  
  // MA alignment
  const maAlignmentValid = sma50 > sma150 && sma150 > sma200;
  const priceAboveAllMAs = lastBar.c > sma10 && lastBar.c > sma20 && 
                           lastBar.c > sma50 && lastBar.c > sma150 && lastBar.c > sma200;
  
  // 200 MA rising
  const sma200_20dAgo = sma200Arr[lastIdx - 20];
  const ma200Rising = sma200 > sma200_20dAgo;
  
  // 10 MA slope
  const sma10_14dAgo = sma10Arr[lastIdx - 14];
  const sma10_5dAgo = sma10Arr[lastIdx - 5];
  const ma10Slope14d = sma10_14dAgo > 0 ? ((sma10 - sma10_14dAgo) / sma10_14dAgo) * 100 : 0;
  const ma10Slope5d = sma10_5dAgo > 0 ? ((sma10 - sma10_5dAgo) / sma10_5dAgo) * 100 : 0;
  
  // 52-week stats
  const lookback = Math.min(252, bars.length);
  const recentBars = bars.slice(-lookback);
  const high52w = Math.max(...recentBars.map(b => b.h));
  const low52w = Math.min(...recentBars.map(b => b.l));
  const pctFromHigh = ((high52w - lastBar.c) / high52w) * 100;
  const pctAboveLow = ((lastBar.c - low52w) / low52w) * 100;
  
  // Base metrics
  const baseHigh = Math.max(...bars.slice(-60).map(b => b.h));
  const baseLow = Math.min(...bars.slice(-60).map(b => b.l));
  const baseDepthPct = ((baseHigh - baseLow) / baseHigh) * 100;
  
  // Volume metrics
  const volumes = bars.slice(-51, -1).map(b => b.v || 0);
  const avgVolume50d = volumes.reduce((a, b) => a + b, 0) / 50;
  const breakoutVolume = lastBar.v || 0;
  const breakoutVolumeRatio = avgVolume50d > 0 ? breakoutVolume / avgVolume50d : null;
  
  // Relative strength
  const rsData = spyBars ? calculateRelativeStrength(bars, spyBars) : null;
  
  // Pullback calculation
  const recent5High = Math.max(...bars.slice(-6, -1).map(b => b.c));
  const pullbackPct = recent5High > 0 ? ((recent5High - lastBar.c) / recent5High) * 100 : 0;
  
  return {
    ticker,
    entryPrice: lastBar.c,
    entryDate: new Date(lastBar.t).toISOString().slice(0, 10),
    
    // MAs
    sma10: round2(sma10),
    sma20: round2(sma20),
    sma50: round2(sma50),
    sma150: round2(sma150),
    sma200: round2(sma200),
    
    // MA alignment
    maAlignmentValid,
    priceAboveAllMAs,
    ma200Rising,
    ma10Slope14d: round2(ma10Slope14d),
    ma10Slope5d: round2(ma10Slope5d),
    
    // VCP pattern
    vcpValid: vcpResult.vcpBullish,
    contractions: vcpResult.contractions,
    pullbackPcts: vcpResult.pullbackPcts,
    baseDepthPct: round2(baseDepthPct),
    volumeDryUp: vcpResult.volumeDryUp,
    patternType: vcpResult.pattern,
    patternConfidence: vcpResult.patternConfidence,
    
    // Breakout quality
    breakoutVolumeRatio: round2(breakoutVolumeRatio),
    breakoutConfirmed: breakoutVolumeRatio >= 1.4,
    pullbackPct: round2(pullbackPct),
    
    // 52-week
    high52w: round2(high52w),
    low52w: round2(low52w),
    pctFromHigh: round2(pctFromHigh),
    pctAboveLow: round2(pctAboveLow),
    
    // Relative strength
    relativeStrength: rsData?.rs || null,
    rsVsSpy6m: rsData?.stockChange || null,
    
    // Signal quality
    opus45Confidence: signal?.opus45Confidence ?? null,
    opus45Grade: signal?.opus45Grade ?? null,
    seedMode: signal?.seedMode ?? false,
    
    // Entry position relative to MA
    entryAt10MA: Math.abs(lastBar.c - sma10) / sma10 <= 0.02,
    entryAt20MA: Math.abs(lastBar.c - sma20) / sma20 <= 0.02,
    distanceFrom10MA: round2(((lastBar.c - sma10) / sma10) * 100),

    // Recent 5-day price return (short-term momentum heading into setup)
    recentReturn5d: bars.length >= 6
      ? round2(((lastBar.c - bars[lastIdx - 5].c) / bars[lastIdx - 5].c) * 100)
      : null,
  };
}

/**
 * Scan multiple tickers for historical signals
 * 
 * @param {Array} tickers - List of tickers to scan
 * @param {number} lookbackMonths - How many months to look back (default 12)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} All signals with statistics
 */
export async function scanMultipleTickers(tickers, lookbackMonths = 60, onProgress = null, options = {}) {
  console.log(`📊 Scanning ${tickers.length} tickers for historical signals (${lookbackMonths}mo lookback)...`);
  
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - lookbackMonths - 2); // Extra buffer for MAs
  
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  
  // Fetch SPY bars first for RS calculation
  console.log('Fetching SPY bars for RS calculation...');
  const spyBars = await getBars('SPY', fromStr, toStr);
  const sortedSpyBars = spyBars ? [...spyBars].sort((a, b) => a.t - b.t) : null;
  
  const allSignals = [];
  const errors = [];
  const diagnostics = options.diagnostics || createScanDiagnostics();
  
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    
    if (onProgress) {
      onProgress({ current: i + 1, total: tickers.length, ticker });
    }
    diagnostics.tickersScanned += 1;
    
    try {
      // Fetch bars for this ticker
      const bars = await getBars(ticker, fromStr, toStr);
      
      if (!bars) {
        diagnostics.barsMissing += 1;
        continue;
      }
      if (bars.length < 250) {
        diagnostics.barsTooShort += 1;
        continue;
      }
      
      // Sort by time
      const sortedBars = [...bars].sort((a, b) => a.t - b.t);
      
      // Scan for signals — pass scan metadata through
      const signals = scanTickerForSignals(ticker, sortedBars, sortedSpyBars, {
        scanType: 'deep_historical',
        lookbackMonths,
        signalFamilies: options.signalFamilies,
        thresholdOverrides: options.thresholdOverrides,
        seedMode: options.seedMode,
        diagnostics,
      });
      
      allSignals.push(...signals);
      
      if (signals.length > 0) {
        console.log(`  ${ticker}: Found ${signals.length} signals`);
      }
      
      // Rate limiting (Yahoo Finance)
      if (i > 0 && i % 5 === 0) {
        await sleep(500);
      }
      
    } catch (e) {
      errors.push({ ticker, error: e.message });
    }
  }
  
  // Calculate statistics
  const winners = allSignals.filter(s => s.returnPct > 0);
  const losers = allSignals.filter(s => s.returnPct <= 0);
  
  const stats = {
    totalSignals: allSignals.length,
    winners: winners.length,
    losers: losers.length,
    winRate: allSignals.length > 0 
      ? Math.round((winners.length / allSignals.length) * 100 * 10) / 10 
      : 0,
    avgReturn: allSignals.length > 0 
      ? Math.round(allSignals.reduce((sum, s) => sum + s.returnPct, 0) / allSignals.length * 10) / 10 
      : 0,
    avgWin: winners.length > 0 
      ? Math.round(winners.reduce((sum, s) => sum + s.returnPct, 0) / winners.length * 10) / 10 
      : 0,
    avgLoss: losers.length > 0 
      ? Math.round(losers.reduce((sum, s) => sum + s.returnPct, 0) / losers.length * 10) / 10 
      : 0,
    avgHoldingDays: allSignals.length > 0 
      ? Math.round(allSignals.reduce((sum, s) => sum + s.holdingDays, 0) / allSignals.length) 
      : 0
  };
  
  console.log(`✅ Scan complete: ${stats.totalSignals} signals, ${stats.winRate}% win rate`);
  
  return {
    signals: allSignals,
    stats,
    errors,
    scanDate: new Date().toISOString(),
    lookbackMonths,
    diagnostics
  };
}

/**
 * Get ticker list from database or file.
 * When tickers table is empty, falls back to tickers that have bars in bars_cache
 * so first-time runs can build a signal pool from existing bar data.
 */
export async function getTickerList() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data } = await supabase.from('tickers').select('ticker');
    // Filter to equity-only tickers. Removes:
    //   - Preferred stocks with slash notation: BAC/PK
    //   - Baby bonds / trust preferred: HBANL, HBANZ, XELLL, WTFCN (6+ chars)
    //   - Dot-class shares: CWEN.A
    // Keeps: 1-5 uppercase letter tickers (AAPL, GOOGL, NWSA, CMCSA, FWONA, LBRDA)
    const fromTickersTable = (data || [])
      .map(r => r.ticker)
      .filter(t => /^[A-Z]{1,5}$/.test(t));
    if (fromTickersTable.length > 0) return fromTickersTable;
    // First-time / bars-only: use tickers that have enough bars in bars_cache (e.g. 500 stocks × 5yr)
    const fromBars = await getTickersFromBarsCache({ minSpanDays: 250 });
    if (fromBars.length > 0) {
      console.log(`getTickerList: tickers table empty; using ${fromBars.length} tickers from bars_cache for signal pool`);
      return fromBars;
    }
  }

  // Fallback: return a default list of liquid stocks
  return [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'AVGO', 'CRM',
    'ORCL', 'ADBE', 'NFLX', 'COST', 'PEP', 'CSCO', 'INTC', 'QCOM', 'TXN', 'HON',
    'UNH', 'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'TMO', 'DHR', 'ABT', 'BMY',
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'BLK', 'SCHW', 'USB',
    'V', 'MA', 'PYPL', 'SQ', 'COIN', 'SHOP', 'PLTR', 'SNOW', 'NET', 'DDOG'
  ];
}

// Helpers
function round2(val) {
  return val != null ? Math.round(val * 100) / 100 : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { simulateTrade, captureContext };
