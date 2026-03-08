/**
 * Trade Guardian — Exit Management Agent
 *
 * Replaces static EXIT_THRESHOLDS with per-trade adaptive exit logic.
 * Each trade gets exit parameters tuned to:
 *   - The stock's volatility (ATR-based)
 *   - The originating strategy agent
 *   - Current market regime (distribution day awareness)
 *   - Known failure patterns from failureClassifier
 *
 * Phases (same multi-phase structure as current exits, but adaptive):
 *   1. Hard stop (ATR-based instead of flat %)
 *   2. Breakeven stop (after reaching activation threshold)
 *   3. Profit lock (trailing, never give back > X% of max gain)
 *   4. Trend exit (consecutive closes below exit MA)
 *   5. Max hold
 */

import { EXIT_THRESHOLDS } from '../opus45Signal.js';

// Per-agent exit tuning: momentum trades get tighter trailing,
// base trades get wider stops to allow the thesis time to play out
const AGENT_EXIT_PROFILES = {
  momentum_scout: {
    hardStopATRMultiple: 1.5,   // Tighter: momentum breaks fast
    breakevenActivationPct: 4,  // Lock in breakeven earlier
    profitGivebackPct: 40,      // Tighter trailing (momentum can reverse sharply)
    below10MADays: 2,           // Exit faster on MA break (momentum trades)
    maxHoldDays: 60,            // Momentum plays resolve faster
  },
  base_hunter: {
    hardStopATRMultiple: 2.5,   // Wider: bases need room to shake out weak hands
    breakevenActivationPct: 7,  // Patient: wait longer before locking breakeven
    profitGivebackPct: 50,      // Standard trailing
    below10MADays: 3,           // More patience on MA tests
    maxHoldDays: 120,           // Deep bases can take longer to play out
  },
  breakout_tracker: {
    hardStopATRMultiple: 2.0,   // Standard
    breakevenActivationPct: 5,  // Standard
    profitGivebackPct: 45,      // Slightly tighter
    below10MADays: 3,           // Standard
    maxHoldDays: 90,            // Standard
  },
  default: {
    hardStopATRMultiple: 2.0,
    breakevenActivationPct: EXIT_THRESHOLDS.breakevenActivationPct,
    profitGivebackPct: EXIT_THRESHOLDS.profitGivebackPct,
    below10MADays: EXIT_THRESHOLDS.below10MADays,
    maxHoldDays: EXIT_THRESHOLDS.maxHoldDays,
  },
};

/**
 * Calculate Average True Range for a set of bars
 */
function calculateATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;

  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

/**
 * Generate adaptive exit parameters for a specific trade.
 *
 * @param {Object} options
 * @param {Array}  options.bars         - Recent OHLC bars for the stock
 * @param {number} options.entryPrice   - The entry price
 * @param {string} options.agentType    - Which strategy agent originated this signal
 * @param {Object} options.regime       - Current market regime from Market Pulse
 * @returns {Object} Adaptive exit parameters
 */
export function generateExitParams(options = {}) {
  const {
    bars = [],
    entryPrice,
    agentType = 'default',
    regime = null,
  } = options;

  const profile = AGENT_EXIT_PROFILES[agentType] || AGENT_EXIT_PROFILES.default;
  const atr = calculateATR(bars) || (entryPrice * 0.03);
  const atrPct = entryPrice > 0 ? (atr / entryPrice) * 100 : 3;

  // ATR-based hard stop: use the agent's ATR multiple, but floor at 4% and cap at 10%
  const atrStop = atrPct * profile.hardStopATRMultiple;
  const hardStopPct = Math.min(10, Math.max(4, Math.round(atrStop * 10) / 10));

  let params = {
    hardStopPct,
    breakevenActivationPct: profile.breakevenActivationPct,
    breakevenBufferPct: EXIT_THRESHOLDS.breakevenBufferPct,
    profitLockActivationPct: EXIT_THRESHOLDS.profitLockActivationPct,
    profitGivebackPct: profile.profitGivebackPct,
    below10MADays: profile.below10MADays,
    maxHoldDays: profile.maxHoldDays,
    atr,
    atrPct: Math.round(atrPct * 100) / 100,
    agentType,
    source: 'tradeGuardian',
  };

  // Regime adjustments: tighten stops in weak markets
  if (regime) {
    if (regime.regime === 'CORRECTION' || regime.distributionDays >= 4) {
      params.hardStopPct = Math.max(4, params.hardStopPct - 1);
      params.profitGivebackPct = Math.max(30, params.profitGivebackPct - 10);
      params.maxHoldDays = Math.max(30, params.maxHoldDays - 20);
      params.regimeAdjusted = true;
    }
    if (regime.regime === 'BEAR') {
      params.hardStopPct = Math.max(3, params.hardStopPct - 2);
      params.profitGivebackPct = Math.max(25, params.profitGivebackPct - 15);
      params.maxHoldDays = Math.max(20, params.maxHoldDays - 40);
      params.regimeAdjusted = true;
    }
  }

  return params;
}

/**
 * Simulate an exit using adaptive parameters on historical bars.
 * Same multi-phase logic as the current system but with adaptive thresholds.
 *
 * @param {Array}  bars       - OHLC bars starting from entry day
 * @param {number} entryPrice - Entry price
 * @param {Object} params     - Exit parameters from generateExitParams()
 * @returns {Object} { exitIdx, exitPrice, exitReason, returnPct, maxGain, daysHeld }
 */
export function simulateAdaptiveExit(bars, entryPrice, params) {
  const {
    hardStopPct = 7,
    breakevenActivationPct = 5,
    breakevenBufferPct = 0.5,
    profitLockActivationPct = 10,
    profitGivebackPct = 50,
    below10MADays = 3,
    maxHoldDays = 90,
  } = params;

  let highSinceEntry = entryPrice;
  let consecutiveBelowMA = 0;

  // Calculate 10-day SMA from bars
  const closes = bars.map(b => b.c);

  for (let i = 1; i < bars.length && i <= maxHoldDays; i++) {
    const bar = bars[i];
    const close = bar.c;
    const low = bar.l;

    if (close > highSinceEntry) highSinceEntry = close;

    const returnFromEntry = ((close - entryPrice) / entryPrice) * 100;
    const maxGainPct = ((highSinceEntry - entryPrice) / entryPrice) * 100;
    const lowReturn = ((low - entryPrice) / entryPrice) * 100;

    // Phase 1: Hard stop
    if (lowReturn <= -hardStopPct) {
      return exitResult(i, entryPrice * (1 - hardStopPct / 100), 'HARD_STOP', entryPrice, maxGainPct, i);
    }

    // Phase 2: Breakeven stop
    if (maxGainPct >= breakevenActivationPct) {
      const breakevenStop = entryPrice * (1 - breakevenBufferPct / 100);
      if (low <= breakevenStop) {
        return exitResult(i, breakevenStop, 'BREAKEVEN_STOP', entryPrice, maxGainPct, i);
      }
    }

    // Phase 3: Profit lock
    if (maxGainPct >= profitLockActivationPct) {
      const minKeep = (profitGivebackPct / 100) * maxGainPct;
      const lockPrice = entryPrice * (1 + minKeep / 100);
      if (close <= lockPrice) {
        return exitResult(i, close, 'PROFIT_LOCK', entryPrice, maxGainPct, i);
      }
    }

    // Phase 4: Trend exit (consecutive closes below 10 MA)
    if (i >= 10) {
      const sma10 = closes.slice(Math.max(0, i - 9), i + 1).reduce((a, b) => a + b, 0) / Math.min(10, i + 1);
      if (close < sma10) {
        consecutiveBelowMA++;
        if (consecutiveBelowMA >= below10MADays) {
          return exitResult(i, close, 'BELOW_10MA', entryPrice, maxGainPct, i);
        }
      } else {
        consecutiveBelowMA = 0;
      }
    }
  }

  // Phase 5: Max hold
  const lastIdx = Math.min(bars.length - 1, maxHoldDays);
  const lastClose = bars[lastIdx]?.c || entryPrice;
  const finalGain = ((highSinceEntry - entryPrice) / entryPrice) * 100;
  return exitResult(lastIdx, lastClose, 'MAX_HOLD', entryPrice, finalGain, lastIdx);
}

function exitResult(idx, exitPrice, reason, entryPrice, maxGainPct, daysHeld) {
  const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return {
    exitIdx: idx,
    exitPrice: Math.round(exitPrice * 100) / 100,
    exitReason: reason,
    returnPct: Math.round(returnPct * 100) / 100,
    maxGain: Math.round(maxGainPct * 100) / 100,
    daysHeld,
  };
}

export { AGENT_EXIT_PROFILES, calculateATR };
