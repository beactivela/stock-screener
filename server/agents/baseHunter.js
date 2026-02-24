/**
 * Base Hunter — Signal Agent
 *
 * Specializes in deep, well-formed VCP bases with volume dry-up.
 * These are patient, high-conviction setups that work best during
 * market uncertainty and corrections when momentum setups fail.
 *
 * Thrives in: UNCERTAIN / CORRECTION regimes
 * Budget allocation: 10% in BULL, 50% in UNCERTAIN, 70% in CORRECTION
 *
 * Northstar alignment:
 *   - VCP 2–4 contractions (VCP.minContractions / VCP.maxContractions)
 *   - Volume dry-up required (VCP.volumeDryUpRequired)
 *   - Entry within 5% of pivot (VCP.pivotEntryMaxPctAbove)
 *   - Hard stop: 8% loss (EXIT_RULES.hard.maxLossPct)
 */

import { createStrategyAgent } from './strategyAgentBase.js';
import { VCP, EXIT_RULES, CANSLIM } from './northstar.js';

const baseHunter = createStrategyAgent({
  name: 'Base Hunter',
  agentType: 'base_hunter',
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

  // Deep base specialist — requires near-max VCP contraction count
  mandatoryOverrides: {
    minContractions: VCP.maxContractions,  // 4 contractions (Northstar VCP ideal)
    minPatternConfidence: 60,              // 60%+ confidence (tighter than default 40%)
  },

  // Boost VCP technical quality weights, reduce slope dependency
  defaultWeightOverrides: {
    vcpContractions3Plus: 12,   // +4 from default 8
    vcpContractions4Plus: 8,    // +4 from default 4
    vcpVolumeDryUp: 8,          // +4 from default 4
    vcpPatternConfidence: 8,    // +4 from default 4
    slope10MAElite: 15,         // -10 from default 25 (deep bases often have moderate slopes)
    slope10MAStrong: 12,        // -8 from default 20
  },

  // Only train on signals with deep base characteristics
  trainingFilter: (signal) => {
    const ctx = signal.context || {};
    const contractions = ctx.contractions || signal.contractions || 0;
    return contractions >= 4 && (ctx.volumeDryUp === true);
  },
});

export default baseHunter;
