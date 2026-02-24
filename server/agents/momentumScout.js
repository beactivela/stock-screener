/**
 * Momentum Scout — Signal Agent
 *
 * Specializes in stocks with the steepest uptrend momentum.
 * These are the highest avg-return setups historically: steep 10 MA slope,
 * elite RS (85+), and near 52-week highs.
 *
 * Thrives in: BULL regimes
 * Budget allocation: 60% in BULL, 30% in UNCERTAIN, 10% in CORRECTION
 *
 * Northstar alignment:
 *   - RS ≥ 85 (CANSLIM.minRsRating)
 *   - Stocks within 5–15% of 52-week high (CANSLIM.maxDistFromHighPct)
 *   - Requires IBD Confirmed Uptrend (regime gate enforced by Marcus)
 */

import { createStrategyAgent } from './strategyAgentBase.js';
import { CANSLIM, VCP, EXIT_RULES } from './northstar.js';

const momentumScout = createStrategyAgent({
  name: 'Momentum Scout',
  agentType: 'momentum_scout',
  signalFamily: 'opus45',
  objective: 'expectancy',
  minImprovement: 0.25,
  riskGates: {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  },

  // Tighter mandatory thresholds — sourced from Northstar doctrine
  mandatoryOverrides: {
    minRelativeStrength: CANSLIM.minRsRating,    // 85 (Northstar CANSLIM.L)
    min10MASlopePct14d: 7,                       // 7%+ slope (momentum-specific)
    maxDistanceFromHigh: CANSLIM.maxDistFromHighPct, // 15% (Northstar technical pre-filter)
  },

  // Starting weight overrides: boost momentum-related weights
  defaultWeightOverrides: {
    slope10MAElite: 30,         // +5 from default 25
    slope10MAStrong: 25,        // +5 from default 20
    entryRSAbove90: 15,         // +5 from default 10
    pullbackIdeal: 12,          // +2 from default 10
  },

  // Only train on signals matching momentum profile
  trainingFilter: (signal) => {
    const ctx = signal.context || {};
    return (ctx.ma10Slope14d || 0) >= 7 && (ctx.relativeStrength || 0) >= 85;
  },
});

export default momentumScout;
