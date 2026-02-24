/**
 * Market Pulse — Regime Detection Agent
 *
 * Wraps distributionDays.js to classify the current market environment
 * and determine how signal budget should be allocated across strategy agents.
 *
 * Regime labels: BULL, UNCERTAIN, CORRECTION, BEAR
 * Each regime maps to:
 *   - exposureMultiplier (0–1): scales overall position sizing
 *   - agentBudgets: percentage of signal capacity per strategy agent
 *
 * Northstar alignment:
 *   - REGIME_GATE from northstar.js is the master on/off switch
 *   - Confirmed Downtrend (BEAR) → all positions exit (EXIT_RULES.hard.bearRegimeExitAll)
 *   - Max concurrent positions are regime-driven (getMaxPositions())
 */

import { getCurrentMarketCondition, getMarketRegimeForSizing } from '../learning/distributionDays.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { REGIME_GATE, EXIT_RULES } from './northstar.js';

// Configurable defaults — can be overridden from agent_configs table
const DEFAULT_REGIME_BUDGETS = {
  BULL: {
    momentum_scout: 0.40,
    breakout_tracker: 0.20,
    base_hunter: 0.10,
    turtle_trader: 0.15,
    ma_crossover_10_20: 0.15,
  },
  UNCERTAIN: {
    momentum_scout: 0.20,
    breakout_tracker: 0.15,
    base_hunter: 0.30,
    turtle_trader: 0.20,
    ma_crossover_10_20: 0.15,
  },
  CORRECTION: {
    momentum_scout: 0.08,
    breakout_tracker: 0.12,
    base_hunter: 0.50,
    turtle_trader: 0.20,
    ma_crossover_10_20: 0.10,
  },
  BEAR: {
    momentum_scout: 0,
    breakout_tracker: 0,
    base_hunter: 0,
    turtle_trader: 0,
    ma_crossover_10_20: 0,
  },
};

const EXPOSURE_MULTIPLIERS = {
  BULL:       1.0,
  UNCERTAIN:  0.75,
  CORRECTION: 0.50,
  BEAR:       0,
};

/**
 * Classify the market and return regime + agent budgets.
 *
 * @param {Object} [options]
 * @param {string} [options.date] - Target date (defaults to today)
 * @param {boolean} [options.persist] - Whether to log to market_regimes table
 * @returns {Promise<Object>} { regime, confidence, exposureMultiplier, agentBudgets, raw }
 */
export async function classifyMarket(options = {}) {
  const { date = null, persist = true } = options;

  const condition = await getCurrentMarketCondition(date);

  if (!condition) {
    return {
      regime: 'UNKNOWN',
      confidence: 0,
      exposureMultiplier: 0.25,
      agentBudgets: DEFAULT_REGIME_BUDGETS.UNCERTAIN,
      raw: null,
    };
  }

  const regime = condition.marketRegime || 'UNCERTAIN';
  const confidence = condition.regimeConfidence || 50;
  const exposureMultiplier = EXPOSURE_MULTIPLIERS[regime] ?? 0.5;
  const agentBudgets = DEFAULT_REGIME_BUDGETS[regime] || DEFAULT_REGIME_BUDGETS.UNCERTAIN;

  const result = {
    regime,
    confidence,
    exposureMultiplier,
    agentBudgets,
    distributionDays: Math.max(
      condition.spyDistributionCount25d || 0,
      condition.qqqDistributionCount25d || 0
    ),
    raw: {
      spyClose: condition.spyClose,
      spy50ma: condition.spySma50,
      spy200ma: condition.spySma200,
      qqqClose: condition.qqqClose,
      qqq50ma: condition.qqqSma50,
      spyAbove50ma: condition.spyAbove50ma,
      qqqAbove50ma: condition.qqqAbove50ma,
      isFollowThroughDay: condition.isFollowThroughDay,
    },
  };

  if (persist) {
    await logRegime(result);
  }

  return result;
}

/**
 * Persist regime classification to market_regimes table for historical review.
 */
async function logRegime(result) {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabase();
    await supabase.from('market_regimes').insert({
      classified_at: new Date().toISOString(),
      regime: result.regime,
      confidence: result.confidence,
      spy_close: result.raw?.spyClose ?? null,
      spy_50ma: result.raw?.spy50ma ?? null,
      spy_200ma: result.raw?.spy200ma ?? null,
      qqq_close: result.raw?.qqqClose ?? null,
      qqq_50ma: result.raw?.qqq50ma ?? null,
      spy_distribution_days: result.distributionDays,
      qqq_distribution_days: result.distributionDays,
      exposure_multiplier: result.exposureMultiplier,
      agent_budgets: result.agentBudgets,
    });
  } catch (e) {
    console.warn('Market Pulse: could not log regime:', e.message);
  }
}

/**
 * Quick check — should the system generate new signals right now?
 */
export async function shouldGenerateSignals() {
  const { regime, exposureMultiplier } = await classifyMarket({ persist: false });
  return {
    allowed: regime !== 'BEAR',
    regime,
    exposureMultiplier,
  };
}
