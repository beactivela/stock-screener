/**
 * Turtle Trader — Signal Agent
 *
 * Long-only Turtle rules: Donchian 20/55-day breakouts, 2N stop,
 * exit on 10/20-day low. Focuses on strong, trending breakouts.
 */

import { createStrategyAgent } from './strategyAgentBase.js'

const turtleTrader = createStrategyAgent({
  name: 'Turtle Trader',
  agentType: 'turtle_trader',
  signalFamily: 'turtle',
  objective: 'expectancy',
  minImprovement: 0.5,
  riskGates: {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  },

  // Keep RS quality without enforcing VCP-specific constraints
  mandatoryOverrides: {
    minRelativeStrength: 80,
  },

  // Emphasize trend strength + breakout proximity
  defaultWeightOverrides: {
    slope10MAElite: 28,
    slope10MAStrong: 22,
    entryRSAbove90: 12,
    pctFromHighIdeal: 10,
    pctFromHighGood: 6,
    entryVolumeConfirm: 8,
  },

  trainingFilter: (signal) => {
    const ctx = signal.context || {}
    const breakout = !!(ctx.turtleBreakout20 || ctx.turtleBreakout55)
    if (!breakout) return false
    if (ctx.maAlignmentValid === false) return false
    if (ctx.priceAboveAllMAs === false) return false
    if (ctx.ma200Rising === false) return false
    if ((ctx.relativeStrength || 0) < 80) return false
    const atrPct = ctx.atr20Pct
    if (atrPct != null && (atrPct < 1 || atrPct > 8)) return false
    return true
  },

  minSignals: 8,
})

export default turtleTrader
