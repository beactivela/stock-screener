/**
 * Strategy Agent Base — Shared factory for all signal agents (Momentum Scout, Base Hunter, Breakout Tracker, etc.)
 *
 * Each strategy agent (Momentum Scout, Base Hunter, Breakout Tracker) is a thin
 * configuration wrapper around this base. The base handles:
 *   - Loading agent-specific weights from DB (filtered by agent_type)
 *   - Filtering the shared signal pool to match the agent's specialization
 *   - Running agent-specific A/B testing
 *   - Storing results tagged with agent_type
 *
 * Usage:
 *   const agent = createStrategyAgent({
 *     name: 'Momentum Scout',
 *     agentType: 'momentum_scout',
 *     mandatoryOverrides: { minRelativeStrength: 85 },
 *     defaultWeightOverrides: { slope10MAElite: 30 },
 *     trainingFilter: (signal) => signal.context?.ma10Slope14d >= 7
 *   });
 *   const result = await agent.optimize(signals, options);
 */

import { DEFAULT_WEIGHTS } from '../opus45Signal.js';
import {
  loadOptimizedWeights,
  storeOptimizedWeights,
  storeLearningRun,
  loadLearningRunHistory,
} from '../learning/autoOptimize.js';
import {
  evaluateWeightsOnSignals,
  MIN_AB_DELTA,
} from '../learning/iterativeOptimizer.js';

// ─── Walk-Forward + Bayesian helpers ────────────────────────────────────────
const DEFAULT_RISK_GATES = {
  minTrades: 200,
  minProfitFactor: 1.5,
  maxDrawdownPct: 20,
  minSharpe: 1,
  minSortino: 1,
};

/**
 * Adapt risk gates when OOS sample size is small.
 *
 * WHY:
 * Fixed institutional gates (200 trades, Sharpe>=1, Sortino>=1) are often too
 * strict for short walk-forward test windows. This function keeps the same gate
 * framework, but relaxes thresholds for small samples so the loop can still
 * learn while preserving guardrails.
 */
export function resolveAdaptiveRiskGates(metrics, gates = {}) {
  const merged = { ...DEFAULT_RISK_GATES, ...(gates || {}) };
  const tradeCount = metrics?.tradeCount ?? metrics?.totalSignals ?? 0;

  if (!Number.isFinite(tradeCount) || tradeCount <= 0 || tradeCount >= merged.minTrades) {
    return merged;
  }

  const sampleRatio = Math.max(0, Math.min(1, tradeCount / Math.max(merged.minTrades, 1)));
  const verySmallSample = sampleRatio < 0.6;

  return {
    ...merged,
    minTrades: Math.max(30, Math.min(merged.minTrades, Math.round(tradeCount * 0.8))),
    minProfitFactor: verySmallSample ? Math.max(1.15, merged.minProfitFactor - 0.3) : merged.minProfitFactor,
    maxDrawdownPct: verySmallSample ? merged.maxDrawdownPct + 5 : merged.maxDrawdownPct,
    minSharpe: verySmallSample ? Math.max(0.2, merged.minSharpe - 0.6) : merged.minSharpe,
    minSortino: verySmallSample ? Math.max(0.35, merged.minSortino - 0.65) : merged.minSortino,
  };
}

/**
 * Split signals into train/test windows by date (Walk-Forward Optimization).
 *
 * WHY BY DATE (not random):
 *   Random splits let future data leak into the training set — the model
 *   "sees" outcomes it shouldn't. Time-ordered splits simulate real deployment:
 *   train on the past, validate on what comes after.
 *
 * @param {Array}  signals       - Signals sorted by entryDate ascending
 * @param {number} testFraction  - Fraction reserved for out-of-sample test (default 0.2)
 * @returns {{ train: Array, test: Array, cutoffDate: string }}
 */
function walkForwardSplit(signals, testFraction = 0.2) {
  if (!signals || signals.length === 0) return { train: [], test: [], cutoffDate: null };

  const sorted = [...signals].sort((a, b) => {
    const da = new Date(a.entryDate || a.entry_date || 0);
    const db = new Date(b.entryDate || b.entry_date || 0);
    return da - db;
  });

  const cutoffIdx = Math.floor(sorted.length * (1 - testFraction));
  const cutoffDate = sorted[cutoffIdx]?.entryDate || sorted[cutoffIdx]?.entry_date || null;

  return {
    train: sorted.slice(0, cutoffIdx),
    test: sorted.slice(cutoffIdx),
    cutoffDate,
    trainStart: sorted[0]?.entryDate || sorted[0]?.entry_date,
    trainEnd: sorted[cutoffIdx - 1]?.entryDate || sorted[cutoffIdx - 1]?.entry_date,
    testStart: cutoffDate,
    testEnd: sorted[sorted.length - 1]?.entryDate || sorted[sorted.length - 1]?.entry_date,
  };
}

function getObjectiveValue(metrics, objective) {
  return objective === 'expectancy'
    ? (metrics.expectancy || 0)
    : (metrics.avgReturn || 0);
}

/**
 * Risk gates: enforce statistical and psychological survivability.
 *
 * @param {Object} metrics - computeSignalMetrics() output
 * @param {Object} gates
 * @returns {{ passed: boolean, failed: string[], summary: string }}
 */
export function passesRiskGates(metrics, gates = {}) {
  const {
    minTrades = 200,
    minProfitFactor = 1.5,
    maxDrawdownPct = 20,
    minSharpe = 1,
    minSortino = 1,
  } = gates;

  const tradeCount = metrics.tradeCount ?? metrics.totalSignals ?? 0;
  const failed = [];

  if (tradeCount < minTrades) failed.push('minTrades');

  if (typeof metrics.profitFactor !== 'number' || metrics.profitFactor < minProfitFactor) {
    failed.push('profitFactor');
  }

  if (typeof metrics.maxDrawdownPct !== 'number' || metrics.maxDrawdownPct > maxDrawdownPct) {
    failed.push('maxDrawdown');
  }

  if (typeof metrics.sharpe !== 'number' || metrics.sharpe < minSharpe) {
    failed.push('sharpe');
  }

  if (typeof metrics.sortino !== 'number' || metrics.sortino < minSortino) {
    failed.push('sortino');
  }

  return {
    passed: failed.length === 0,
    failed,
    summary: failed.length === 0 ? 'risk gates passed' : `risk gates failed: ${failed.join(', ')}`,
  };
}

/**
 * Compute a Bayes factor comparing variant vs control on the test window.
 *
 * Uses the log Bayes factor under a normal likelihood model:
 *   LBF = n * delta² / (2 * sigma²)
 *   BF  = exp(LBF)
 *
 * Interpretation (Jeffreys scale):
 *   BF > 100  : decisive evidence for variant
 *   BF 10-100 : strong evidence
 *   BF 3-10   : moderate evidence
 *   BF 1-3    : anecdotal evidence
 *   BF < 1    : evidence favors control
 *
 * @param {'avgReturn'|'expectancy'} objective
 * @returns {{ bayesFactor: number, blendFactor: number, evidence: string }}
 */
function computeBayesFactor(testSignals, controlWeights, variantWeights, objective = 'avgReturn') {
  if (!testSignals || testSignals.length < 5) {
    return { bayesFactor: 1, blendFactor: 0, evidence: 'insufficient_test_data' };
  }

  const controlMetrics = evaluateWeightsOnSignals(testSignals, controlWeights);
  const variantMetrics = evaluateWeightsOnSignals(testSignals, variantWeights);

  const delta = getObjectiveValue(variantMetrics, objective) - getObjectiveValue(controlMetrics, objective);

  // Compute pooled std dev of returns across test signals
  const returns = testSignals.map(s => s.returnPct || 0);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  const sigma = Math.sqrt(variance) || 1; // avoid div/0

  // Log Bayes Factor: LBF = n * delta² / (2 * sigma²)
  const n = testSignals.length;
  const lbf = (n * delta ** 2) / (2 * sigma ** 2);
  // Cap to avoid exp overflow (BF > 10^6 is practically the same as decisive)
  const bayesFactor = delta > 0 ? Math.min(Math.exp(lbf), 1e6) : Math.exp(-lbf);

  // Map BF → blend amount (how much of the variant to mix into control)
  let blendFactor = 0;
  let evidence = 'none';
  if (delta > 0) {
    if (bayesFactor >= 100) { blendFactor = 0.40; evidence = 'decisive'; }
    else if (bayesFactor >= 10) { blendFactor = 0.30; evidence = 'strong'; }
    else if (bayesFactor >= 3)  { blendFactor = 0.20; evidence = 'moderate'; }
    else if (bayesFactor >= 1)  { blendFactor = 0.10; evidence = 'anecdotal'; }
  } else {
    evidence = 'favors_control';
  }

  return {
    bayesFactor: Math.round(bayesFactor * 100) / 100,
    blendFactor,
    evidence,
    delta: Math.round(delta * 100) / 100,
    controlAvgReturn: Math.round(controlMetrics.avgReturn * 100) / 100,
    variantAvgReturn: Math.round(variantMetrics.avgReturn * 100) / 100,
    controlObjective: Math.round(getObjectiveValue(controlMetrics, objective) * 100) / 100,
    variantObjective: Math.round(getObjectiveValue(variantMetrics, objective) * 100) / 100,
    n,
    sigma: Math.round(sigma * 100) / 100,
  };
}

/**
 * Blend variant into control proportional to Bayesian evidence strength.
 * Returns a new weight object: (1 - blend) * control + blend * variant.
 */
function blendWeights(controlWeights, variantWeights, blendFactor) {
  const blended = { ...controlWeights };
  for (const key of Object.keys(variantWeights)) {
    if (key.startsWith('_')) continue;
    const c = controlWeights[key];
    const v = variantWeights[key];
    if (typeof v === 'number') {
      blended[key] = typeof c === 'number'
        ? Math.max(1, Math.min(35, Math.round(c * (1 - blendFactor) + v * blendFactor)))
        : v;
    }
  }
  return blended;
}

/**
 * Exploration strategies — 8 distinct trading hypotheses.
 *
 * WHY THIS APPROACH:
 * The old approach (profitability analysis → weight adjustments ± noise) always
 * converged to the same variant because:
 *   1. Same signals → same factor profitability ranking
 *   2. confidence = score / maxScore — uniform ±noise barely changes the ratio
 *   3. Same signals pass the threshold → same avgReturn → same control/variant forever
 *
 * These strategies change RATIOS between weight categories, which meaningfully
 * shifts which signals pass the 60% confidence threshold → genuinely different
 * signal subsets → different avgReturn per run.
 *
 * Rotation: pastRunCount % 8 picks the next strategy so runs never repeat in sequence.
 * Each strategy name is stored in the learning run record for traceability.
 */
const EXPLORATION_STRATEGIES = [
  {
    name: 'momentum_heavy',
    description: 'Steep 10MA slope + elite RS as primary predictors',
    weights: {
      slope10MAElite: 35, slope10MAStrong: 28, slope10MAGood: 15, slope10MAMinimum: 5,
      entryRSAbove90: 20, relativeStrengthBonus: 10,
      vcpContractions3Plus: 3, vcpContractions4Plus: 2, vcpVolumeDryUp: 2, vcpPatternConfidence: 2,
      pctFromHighIdeal: 8,  pctFromHighGood: 4,
      pullbackIdeal: 8,     pullbackGood: 4,
      entryAt10MA: 10, entryAt20MA: 3, entryVolumeConfirm: 4,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 6, industryTrendModerate: 3, recentActionStrong: 5, recentActionGood: 2,
    },
  },
  {
    name: 'vcp_quality',
    description: 'Deep VCP base quality, volume dry-up, and pattern confidence',
    weights: {
      slope10MAElite: 10, slope10MAStrong: 7, slope10MAGood: 4, slope10MAMinimum: 2,
      entryRSAbove90: 8,  relativeStrengthBonus: 4,
      vcpContractions3Plus: 18, vcpContractions4Plus: 22, vcpVolumeDryUp: 16, vcpPatternConfidence: 16,
      pctFromHighIdeal: 6,  pctFromHighGood: 3,
      pullbackIdeal: 12,    pullbackGood: 7,
      entryAt10MA: 14, entryAt20MA: 4, entryVolumeConfirm: 6,
      industryTop20: 10, industryTop40: 5, institutionalOwnership: 5, epsGrowthPositive: 5,
      industryTrendStrong: 4, industryTrendModerate: 2, recentActionStrong: 2, recentActionGood: 1,
    },
  },
  {
    name: 'entry_timing',
    description: 'Precision entry: 10MA entry + tight 2-5% pullback',
    weights: {
      slope10MAElite: 18, slope10MAStrong: 14, slope10MAGood: 8, slope10MAMinimum: 4,
      entryRSAbove90: 12, relativeStrengthBonus: 6,
      vcpContractions3Plus: 6, vcpContractions4Plus: 4, vcpVolumeDryUp: 4, vcpPatternConfidence: 4,
      pctFromHighIdeal: 10, pctFromHighGood: 6,
      pullbackIdeal: 25,    pullbackGood: 14,
      entryAt10MA: 30, entryAt20MA: 3, entryVolumeConfirm: 8,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 4, industryTrendModerate: 2, recentActionStrong: 4, recentActionGood: 2,
    },
  },
  {
    name: 'breakout_volume',
    description: 'Volume-confirmed breakouts near 52w high pivot',
    weights: {
      slope10MAElite: 20, slope10MAStrong: 15, slope10MAGood: 8, slope10MAMinimum: 4,
      entryRSAbove90: 14, relativeStrengthBonus: 8,
      vcpContractions3Plus: 6, vcpContractions4Plus: 4, vcpVolumeDryUp: 12, vcpPatternConfidence: 6,
      pctFromHighIdeal: 18, pctFromHighGood: 10,
      pullbackIdeal: 8,     pullbackGood: 5,
      entryAt10MA: 12, entryAt20MA: 4, entryVolumeConfirm: 28,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 6, industryTrendModerate: 3, recentActionStrong: 6, recentActionGood: 3,
    },
  },
  {
    name: 'rs_dominant',
    description: 'Relative strength (RS 90+) as the dominant selection criterion',
    weights: {
      slope10MAElite: 14, slope10MAStrong: 10, slope10MAGood: 6, slope10MAMinimum: 3,
      entryRSAbove90: 30, relativeStrengthBonus: 22,
      vcpContractions3Plus: 5, vcpContractions4Plus: 3, vcpVolumeDryUp: 3, vcpPatternConfidence: 3,
      pctFromHighIdeal: 14, pctFromHighGood: 8,
      pullbackIdeal: 8,     pullbackGood: 5,
      entryAt10MA: 10, entryAt20MA: 3, entryVolumeConfirm: 5,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 4, industryTrendModerate: 2, recentActionStrong: 3, recentActionGood: 1,
    },
  },
  {
    name: 'proximity_pivot',
    description: 'Stocks coiling within 5-10% of 52w high (pre-breakout formation)',
    weights: {
      slope10MAElite: 16, slope10MAStrong: 12, slope10MAGood: 6, slope10MAMinimum: 3,
      entryRSAbove90: 12, relativeStrengthBonus: 6,
      vcpContractions3Plus: 8, vcpContractions4Plus: 5, vcpVolumeDryUp: 6, vcpPatternConfidence: 6,
      pctFromHighIdeal: 30, pctFromHighGood: 20,
      pullbackIdeal: 10,    pullbackGood: 6,
      entryAt10MA: 12, entryAt20MA: 4, entryVolumeConfirm: 8,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 5, industryTrendModerate: 2, recentActionStrong: 4, recentActionGood: 2,
    },
  },
  {
    name: 'balanced_plus',
    description: 'Modest improvement across all criteria vs default',
    weights: {
      slope10MAElite: 28, slope10MAStrong: 22, slope10MAGood: 14, slope10MAMinimum: 6,
      entryRSAbove90: 12, relativeStrengthBonus: 5,
      vcpContractions3Plus: 9, vcpContractions4Plus: 5, vcpVolumeDryUp: 5, vcpPatternConfidence: 5,
      pctFromHighIdeal: 7,  pctFromHighGood: 4,
      pullbackIdeal: 12,    pullbackGood: 6,
      entryAt10MA: 14, entryAt20MA: 3, entryVolumeConfirm: 6,
      industryTop20: 11, industryTop40: 6, institutionalOwnership: 6, epsGrowthPositive: 6,
      industryTrendStrong: 8, industryTrendModerate: 4, recentActionStrong: 5, recentActionGood: 3,
    },
  },
  {
    name: 'fundamental_driven',
    description: 'Industry rank + institutional ownership + EPS growth as primary filters',
    weights: {
      slope10MAElite: 16, slope10MAStrong: 12, slope10MAGood: 6, slope10MAMinimum: 3,
      entryRSAbove90: 12, relativeStrengthBonus: 6,
      vcpContractions3Plus: 6, vcpContractions4Plus: 4, vcpVolumeDryUp: 5, vcpPatternConfidence: 5,
      pctFromHighIdeal: 6,  pctFromHighGood: 3,
      pullbackIdeal: 8,     pullbackGood: 5,
      entryAt10MA: 10, entryAt20MA: 3, entryVolumeConfirm: 5,
      industryTop20: 22, industryTop40: 14, institutionalOwnership: 14, epsGrowthPositive: 14,
      industryTrendStrong: 10, industryTrendModerate: 5, recentActionStrong: 4, recentActionGood: 2,
    },
  },
  {
    name: 'sector_rotation',
    description: 'Industry 3-month trend + recent price action as primary filters',
    weights: {
      slope10MAElite: 16, slope10MAStrong: 12, slope10MAGood: 6, slope10MAMinimum: 3,
      entryRSAbove90: 10, relativeStrengthBonus: 5,
      vcpContractions3Plus: 5, vcpContractions4Plus: 3, vcpVolumeDryUp: 3, vcpPatternConfidence: 3,
      pctFromHighIdeal: 6,  pctFromHighGood: 3,
      pullbackIdeal: 8,     pullbackGood: 4,
      entryAt10MA: 10, entryAt20MA: 3, entryVolumeConfirm: 5,
      industryTop20: 14, industryTop40: 8, institutionalOwnership: 5, epsGrowthPositive: 5,
      industryTrendStrong: 22, industryTrendModerate: 12, recentActionStrong: 14, recentActionGood: 7,
    },
  },
  {
    name: 'short_term_catalyst',
    description: 'Recent 5-day momentum + breakout volume — capture short-term catalysts',
    weights: {
      slope10MAElite: 18, slope10MAStrong: 14, slope10MAGood: 8, slope10MAMinimum: 4,
      entryRSAbove90: 14, relativeStrengthBonus: 8,
      vcpContractions3Plus: 5, vcpContractions4Plus: 3, vcpVolumeDryUp: 4, vcpPatternConfidence: 4,
      pctFromHighIdeal: 8,  pctFromHighGood: 4,
      pullbackIdeal: 8,     pullbackGood: 4,
      entryAt10MA: 12, entryAt20MA: 3, entryVolumeConfirm: 18,
      industryTop20: 8, industryTop40: 4, institutionalOwnership: 4, epsGrowthPositive: 4,
      industryTrendStrong: 10, industryTrendModerate: 5, recentActionStrong: 20, recentActionGood: 10,
    },
  },
];

/**
 * @param {Object} config
 * @param {string} config.name          - Human-readable name (e.g. "Momentum Scout")
 * @param {string} config.agentType     - DB identifier (e.g. "momentum_scout")
 * @param {Object} config.mandatoryOverrides  - Tighter MANDATORY_THRESHOLDS
 * @param {Object} config.defaultWeightOverrides - Starting weight adjustments
 * @param {Function} config.trainingFilter - (signal) => boolean, selects which signals this agent trains on
 * @param {number} config.minSignals    - Minimum filtered signals to proceed (default: 10)
 */
export function createStrategyAgent(config) {
  const {
    name,
    agentType,
    signalFamily = null,
    objective = 'expectancy',
    minImprovement = MIN_AB_DELTA,
    riskGates = DEFAULT_RISK_GATES,
    mandatoryOverrides = {},
    defaultWeightOverrides = {},
    trainingFilter = () => true,
    minSignals = 10,
  } = config;

  const mergedRiskGates = { ...DEFAULT_RISK_GATES, ...(riskGates || {}) };

  /**
   * Build starting weights for this agent by layering:
   *   DEFAULT_WEIGHTS ← DB-stored weights (if any) ← defaultWeightOverrides
   */
  async function loadWeights() {
    const stored = await loadOptimizedWeights(agentType);
    if (stored.source === 'optimized' && stored.weights) {
      return {
        weights: { ...DEFAULT_WEIGHTS, ...stored.weights },
        source: 'optimized',
        prior: stored,
      };
    }
    return {
      weights: { ...DEFAULT_WEIGHTS, ...defaultWeightOverrides },
      source: 'default',
      prior: null,
    };
  }

  /**
   * Filter the shared signal pool to only signals this agent should train on.
   * Uses mandatoryOverrides and the trainingFilter function.
   */
  function filterSignals(signals) {
    return signals.filter((signal) => {
      const ctx = signal.context || {};

      if (signalFamily && ctx.signalFamily && ctx.signalFamily !== signalFamily) return false;

      // Apply mandatory overrides as hard filters
      if (mandatoryOverrides.minRelativeStrength && (ctx.relativeStrength || 0) < mandatoryOverrides.minRelativeStrength) return false;
      if (mandatoryOverrides.min10MASlopePct14d && (ctx.ma10Slope14d || 0) < mandatoryOverrides.min10MASlopePct14d) return false;
      if (mandatoryOverrides.maxDistanceFromHigh && (ctx.pctFromHigh || 100) > mandatoryOverrides.maxDistanceFromHigh) return false;
      if (mandatoryOverrides.minContractions && (ctx.contractions || signal.contractions || 0) < mandatoryOverrides.minContractions) return false;
      if (mandatoryOverrides.minPatternConfidence && (ctx.patternConfidence || signal.patternConfidence || 0) < mandatoryOverrides.minPatternConfidence) return false;

      // Apply custom training filter
      return trainingFilter(signal);
    });
  }

  /**
   * Run a full Walk-Forward + Bayesian optimization cycle.
   *
   * HOW IT WORKS:
   *   1. Load control weights from DB (last promoted/blended, or defaults).
   *   2. Pick next exploration strategy via round-robin (pastRunCount % 8).
   *      Each strategy is a distinct weight hypothesis — different runs test
   *      genuinely different ideas so the A/B history is never a repeat.
   *   3. Walk-Forward split: sort signals by date → first 80% = train window,
   *      last 20% = test window (out-of-sample, never seen by strategy selection).
   *   4. Evaluate control vs variant on the TEST window only.
   *      This prevents overfitting: the variant can't "cheat" by being tuned
   *      on the same data it's evaluated against.
   *   5. Compute Bayes Factor from test window evidence:
   *      BF = exp(n * delta² / (2 * sigma²))
   *      Maps evidence strength → blend amount (10% anecdotal → 40% decisive).
   *   6. Blend and save. Next run's control = evidence-weighted update of this run.
   *      Over 8 runs (one per strategy) the control compounds toward the best hypothesis.
   *
   * @param {Array} allSignals - The shared signal pool (pre-scanned, 5yr deep history)
   * @param {Object} options
   * @param {Function} options.onProgress
   * @returns {Promise<Object>} Agent-level results with WFO + Bayes metadata
   */
  async function optimize(allSignals, options = {}) {
    const {
      onProgress = null,
      regimeTag = null,
      batchRunId = null,
      batchCycle = null,
    } = options;

    const startedAt = new Date().toISOString();

    // Filter signals to this agent's specialization
    const signals = filterSignals(allSignals);

    if (signals.length < minSignals) {
      console.log(`   [${name}] Only ${signals.length} signals after filtering — skipping optimization`);
      return {
        agentType,
        name,
        success: false,
        reason: `Insufficient signals (${signals.length} < ${minSignals} minimum)`,
        signalCount: signals.length,
      };
    }

    // ── 1. Walk-Forward split ────────────────────────────────────────────────
    // Test window = last 20% of signals by date (out-of-sample validation).
    // We need at least 10 test signals for a meaningful Bayes Factor.
    const wfo = walkForwardSplit(signals, 0.2);
    const testSignals = wfo.test.length >= 10 ? wfo.test : signals; // fallback: use all
    const usingWFO = wfo.test.length >= 10;

    console.log(`   [${name}] ${signals.length} signals total | WFO: ${wfo.train.length} train / ${wfo.test.length} test (${usingWFO ? 'out-of-sample' : 'fallback: all signals'})`);

    // ── 2. Load control weights ──────────────────────────────────────────────
    const { weights: startingWeights, source: startingSource } = await loadWeights();
    const controlWeights = { ...startingWeights };

    // ── 3. Pick next exploration strategy ───────────────────────────────────
    let pastRunCount = 0;
    try {
      const pastRuns = await loadLearningRunHistory(200, agentType);
      pastRunCount = pastRuns.length;
    } catch (e) {
      console.warn(`   [${name}] Could not load run history, defaulting to strategy 0:`, e.message);
    }
    const strategyIndex = pastRunCount % EXPLORATION_STRATEGIES.length;
    const strategy = EXPLORATION_STRATEGIES[strategyIndex];

    console.log(`   [${name}] Strategy #${strategyIndex}: "${strategy.name}" (run ${pastRunCount + 1})`);

    if (onProgress) {
      onProgress({
        phase: 'agent_iteration',
        agent: agentType,
        agentName: name,
        iteration: 1,
        maxIterations: 1,
        strategy: strategy.name,
        wfoTrainSize: wfo.train.length,
        wfoTestSize: wfo.test.length,
      });
    }

    // Build variant: DEFAULT_WEIGHTS + agent overrides + strategy overrides.
    // Starting from DEFAULT_WEIGHTS (not control) keeps strategies stable across runs
    // rather than compounding on top of previous blends indefinitely.
    const variantWeights = {
      ...DEFAULT_WEIGHTS,
      ...defaultWeightOverrides,
      ...strategy.weights,
    };

    // ── 4. Evaluate on TEST window (out-of-sample) ───────────────────────────
    const controlTestMetrics = evaluateWeightsOnSignals(testSignals, controlWeights);
    const variantTestMetrics = evaluateWeightsOnSignals(testSignals, variantWeights);
    const controlObjective = getObjectiveValue(controlTestMetrics, objective);
    const variantObjective = getObjectiveValue(variantTestMetrics, objective);
    const testDelta = variantObjective - controlObjective;

    // ── 5. Compute Bayes Factor ──────────────────────────────────────────────
    const bayes = computeBayesFactor(testSignals, controlWeights, variantWeights, objective);
    const adaptiveRiskGates = resolveAdaptiveRiskGates(variantTestMetrics, mergedRiskGates);
    const controlRisk = passesRiskGates(controlTestMetrics, adaptiveRiskGates);
    const variantRisk = passesRiskGates(variantTestMetrics, adaptiveRiskGates);
    const blendFactor = variantRisk.passed ? bayes.blendFactor : 0;

    const promoted = variantRisk.passed && bayes.bayesFactor >= 10 && testDelta >= minImprovement; // evidence + delta + risk gates
    const promotionReason = promoted
      ? `[${strategy.name}] BF=${bayes.bayesFactor} (${bayes.evidence}), +${testDelta.toFixed(2)}% ${objective} on ${testSignals.length} out-of-sample signals`
      : `[${strategy.name}] BF=${bayes.bayesFactor} (${bayes.evidence}), delta=${testDelta.toFixed(2)}% ${objective} — ${variantRisk.summary}`;

    console.log(`   [${name}] Test: control=${controlObjective.toFixed(2)}% variant=${variantObjective.toFixed(2)}% (${objective}) | BF=${bayes.bayesFactor} (${bayes.evidence}) | blend=${(blendFactor * 100).toFixed(0)}%`);

    // ── 6. Persist learning run ──────────────────────────────────────────────
    try {
      await storeLearningRun({
        systemName: 'Opus Signal',
        agentType,
        startedAt,
        completedAt: new Date().toISOString(),
        iterationsRun: 1,
        signalsEvaluated: testSignals.length,
        objective,
        controlWeights,
        controlSource: startingSource,
        controlMetrics: controlTestMetrics,
        variantWeights,
        variantMetrics: variantTestMetrics,
        promoted,
        promotionReason,
        factorChanges: buildSimpleFactorChanges(controlWeights, variantWeights),
        topFactors: [{
          factor: strategy.name,
          description: strategy.description,
          bayesFactor: bayes.bayesFactor,
          evidence: bayes.evidence,
          blendFactor: bayes.blendFactor,
          wfoTrainSignals: wfo.train.length,
          wfoTestSignals: wfo.test.length,
          wfoTrainStart: wfo.trainStart,
          wfoTrainEnd: wfo.trainEnd,
          wfoTestStart: wfo.testStart,
          wfoTestEnd: wfo.testEnd,
          riskGateMode: 'adaptive_oos',
          regimeTag,
          batchRunId,
          batchCycle,
        }],
        minImprovementThreshold: minImprovement,
        regimeTag,
        criteriaSummary: `Objective=${objective}, regime=${regimeTag || 'n/a'}, batchRun=${batchRunId || 'none'}, cycle=${batchCycle ?? 'n/a'}`,
      });
    } catch (e) {
      console.warn(`[${name}] Could not persist learning run:`, e.message);
    }

    // ── 7. Update weights based on Bayesian evidence ─────────────────────────
    if (promoted) {
      // Full promotion: variant decisively beat control on out-of-sample data
      try {
        await storeOptimizedWeights(
          {
            weights: variantWeights,
            adjustments: [],
            signalsAnalyzed: testSignals.length,
            baselineWinRate: variantTestMetrics.winRate,
            baselineAvgReturn: variantTestMetrics.avgReturn,
            baselineExpectancy: variantTestMetrics.expectancy,
            avgWin: variantTestMetrics.avgWin,
            avgLoss: variantTestMetrics.avgLoss,
            profitFactor: variantTestMetrics.profitFactor,
            topFactors: [{ factor: strategy.name, description: strategy.description }],
            generatedAt: new Date().toISOString(),
          },
          { activate: true, agentType }
        );
        console.log(`   [${name}] ✅ "${strategy.name}" promoted (BF=${bayes.bayesFactor}, ${bayes.evidence} evidence)`);
      } catch (e) {
        console.warn(`[${name}] Could not store promoted weights:`, e.message);
      }
    } else if (blendFactor > 0 && testDelta >= minImprovement) {
      // Bayesian incremental update: blend proportional to evidence strength
      const blendedWeights = blendWeights(controlWeights, variantWeights, blendFactor);
      try {
        await storeOptimizedWeights(
          {
            weights: blendedWeights,
            adjustments: [],
            signalsAnalyzed: testSignals.length,
            baselineWinRate: variantTestMetrics.winRate,
            baselineAvgReturn: variantTestMetrics.avgReturn,
            baselineExpectancy: variantTestMetrics.expectancy,
            avgWin: variantTestMetrics.avgWin,
            avgLoss: variantTestMetrics.avgLoss,
            profitFactor: variantTestMetrics.profitFactor,
            topFactors: [{ factor: strategy.name, description: strategy.description }],
            generatedAt: new Date().toISOString(),
          },
          { activate: true, agentType }
        );
        console.log(`   [${name}] 📈 "${strategy.name}" blended ${(blendFactor * 100).toFixed(0)}% into control (BF=${bayes.bayesFactor}, ${bayes.evidence})`);
      } catch (e) {
        console.warn(`[${name}] Could not store blended weights:`, e.message);
      }
    } else {
      const gateNote = variantRisk.passed ? 'control unchanged' : `blocked by ${variantRisk.summary}`;
      console.log(`   [${name}] ⚠️  "${strategy.name}" underperformed or failed risk gates — ${gateNote}`);
    }

    return {
      agentType,
      name,
      success: true,
      signalCount: signals.length,
      totalSignals: allSignals.length,
      iterationsRun: 1,
      strategyName: strategy.name,
      strategyDescription: strategy.description,
      strategyIndex,
      wfo: {
        trainSignals: wfo.train.length,
        testSignals: wfo.test.length,
        trainStart: wfo.trainStart,
        trainEnd: wfo.trainEnd,
        testStart: wfo.testStart,
        testEnd: wfo.testEnd,
        usingWFO,
      },
      bayesian: {
        bayesFactor: bayes.bayesFactor,
        evidence: bayes.evidence,
        blendFactor,
        testDelta,
      },
      abComparison: {
        controlMetrics: controlTestMetrics,
        variantMetrics: variantTestMetrics,
        delta: {
          avgReturn: Math.round((variantTestMetrics.avgReturn - controlTestMetrics.avgReturn) * 100) / 100,
          expectancy: Math.round((variantTestMetrics.expectancy - controlTestMetrics.expectancy) * 100) / 100,
          objective: Math.round(testDelta * 100) / 100,
        },
        promoted,
        promotionReason,
        riskGates: {
          control: controlRisk,
          variant: variantRisk,
        },
      },
    };
  }

  /**
   * Score a set of live signals using this agent's weights.
   * Returns signals that pass this agent's filters, re-scored.
   */
  async function scoreSignals(signals) {
    const { weights } = await loadWeights();
    const filtered = filterSignals(signals);
    return filtered.map((s) => ({
      ...s,
      agentType,
      agentName: name,
      agentScore: evaluateWeightsOnSignals([s], weights).avgReturn,
    }));
  }

  return {
    name,
    agentType,
    mandatoryOverrides,
    objective,
    riskGates: mergedRiskGates,
    minImprovement,
    optimize,
    filterSignals,
    scoreSignals,
    loadWeights,
  };
}

/**
 * Build a simple list of weight changes for the learning run record.
 */
function buildSimpleFactorChanges(controlWeights, variantWeights) {
  const changes = [];
  const allKeys = new Set([...Object.keys(controlWeights), ...Object.keys(variantWeights)]);
  for (const key of allKeys) {
    if (key.startsWith('_')) continue;
    const oldVal = controlWeights[key] ?? 0;
    const newVal = variantWeights[key] ?? 0;
    if (oldVal !== newVal) {
      changes.push({ weight: key, oldValue: oldVal, newValue: newVal, delta: newVal - oldVal });
    }
  }
  return changes;
}
