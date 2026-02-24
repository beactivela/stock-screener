/**
 * Breakout Tracker — Signal Agent
 *
 * Specializes in stocks tightening near a pivot point and breaking out with volume.
 * Catches both active breakouts (< 5% from high) and pre-breakout consolidations
 * (5–10% from high) forming during corrections — which historically produce the
 * sharpest moves once the market turns.
 *
 * Thrives in: BULL regimes (complementary to Momentum Scout)
 * Budget allocation: 30% in BULL, 20% in UNCERTAIN, 20% in CORRECTION
 *
 * Filter rationale:
 *   - 5% threshold was too tight for CORRECTION markets (only ~3 signals survive).
 *   - Relaxed to 10% so the agent can train on "coiling" setups that precede breakouts.
 *   - Volume confirmation lowered to 1.2x (from 1.5x) to allow drier, tighter bases.
 *   - Minimum 5 signals (down from 10) so it can still run with smaller pools.
 *
 * Northstar alignment:
 *   - Breakout entry: close above pivot on volume ≥40% above 50d avg (VCP.breakoutVolumeMinX)
 *   - Entry within 1–2% above pivot (VCP.idealBreakoutMaxPct)
 *   - RS ≥ 80 (slightly below Northstar minimum of 85 to catch pre-breakout bases)
 *   - Hard stop: 8% (EXIT_RULES.hard.maxLossPct)
 */

import { createStrategyAgent } from './strategyAgentBase.js';
import { VCP, EXIT_RULES, CANSLIM } from './northstar.js';

const breakoutTracker = createStrategyAgent({
  name: 'Breakout Tracker',
  agentType: 'breakout_tracker',
  signalFamily: 'opus45',
  objective: 'expectancy',
  minImprovement: 0.5,
  riskGates: {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  },

  mandatoryOverrides: {
    maxDistanceFromHigh: 10,             // 10% — relaxed from Northstar's 5% ideal for CORRECTION pools
    minRelativeStrength: 80,             // Slightly below CANSLIM.minRsRating (85) to catch pre-breakout bases
    minBreakoutVolumeRatio: VCP.breakoutVolumeMinX,  // 1.40 — Northstar: ≥40% above 50d avg
  },

  // Boost entry quality and proximity-to-high weights
  defaultWeightOverrides: {
    pctFromHighIdeal: 10,       // +4 from default 6
    pctFromHighGood: 5,         // +2 from default 3
    entryVolumeConfirm: 10,     // +5 from default 5
    entryAt10MA: 15,            // +3 from default 12
  },

  // Train on signals within 10% of high with light volume confirmation
  trainingFilter: (signal) => {
    const ctx = signal.context || {};
    return (ctx.pctFromHigh || 100) <= 10 && (ctx.breakoutVolumeRatio || 0) >= 1.2;
  },

  minSignals: 5,   // Need at least 5 (not 10) since tight breakout pools are smaller
});

export default breakoutTracker;
