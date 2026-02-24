/**
 * Harry Historian Agent — Historical Data Fetcher & Multi-Agent Coordinator
 *
 * Harry's sole responsibility: fetch at least 5 years of OHLC bar data for every
 * ticker in the universe, cache it in Supabase, and surface a clean signal pool
 * for downstream strategy agents to train on.
 *
 * Orchestrates the full multi-agent optimization pipeline:
 *   1. Market Pulse classifies the regime and sets agent budgets
 *   2. Harry fetches the shared 5-year signal pool (OHLC → historical signals)
 *   3. Strategy agents run in parallel, each on its filtered subset
 *   4. Results are merged, deduplicated, and reported per-agent
 *
 * Model: GPT-5.2 Codex (standard)
 */

import { classifyMarket } from './marketPulse.js';
import { NORTHSTAR_DOCTRINE, CANSLIM } from './northstar.js';
import momentumScout from './momentumScout.js';
import baseHunter from './baseHunter.js';
import breakoutTracker from './breakoutTracker.js';
import turtleTrader from './turtleTrader.js';
import maCrossover_10_20 from './maCrossover_10_20.js';
import { getTickerList, scanMultipleTickers } from '../learning/historicalSignalScanner.js';
import { getStoredSignals, storeSignalsInDatabase } from '../learning/autoPopulate.js';
import { isSupabaseConfigured } from '../supabase.js';
import { fetchTradingViewIndustryReturns, normalizeIndustryName } from '../tradingViewIndustry.js';

const STRATEGY_AGENTS = [momentumScout, baseHunter, breakoutTracker, turtleTrader, maCrossover_10_20];

// Same exit strategy versioning as the single-agent optimizer
const EXIT_STRATEGY_VERSION = 2;

/**
 * Regime-specific top-down filter profile:
 *   market phase -> sector relative strength -> VCP quality.
 */
export function buildTopDownFilterProfile(regimeName = 'UNCERTAIN') {
  const regime = String(regimeName || 'UNCERTAIN').toUpperCase();
  const map = {
    BULL: {
      maxSectorRankPct: 35,
      minRelativeStrength: 80,
      minPatternConfidence: 60,
      minContractions: 2,
      requireVcpValid: true,
    },
    UNCERTAIN: {
      maxSectorRankPct: 50,
      minRelativeStrength: 75,
      minPatternConfidence: 55,
      minContractions: 2,
      requireVcpValid: true,
    },
    CORRECTION: {
      maxSectorRankPct: 65,
      minRelativeStrength: 65,
      minPatternConfidence: 50,
      minContractions: 2,
      requireVcpValid: true,
    },
    BEAR: {
      maxSectorRankPct: 100,
      minRelativeStrength: 100,
      minPatternConfidence: 100,
      minContractions: 99,
      requireVcpValid: true,
    },
  };
  return map[regime] || map.UNCERTAIN;
}

function safeNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function buildSectorRankByTicker(tvPayload) {
  const returnsMap = tvPayload?.returnsMap;
  const tickerToTvIndustry = tvPayload?.tickerToTvIndustry;
  if (!(returnsMap instanceof Map) || !(tickerToTvIndustry instanceof Map) || returnsMap.size === 0) {
    return {};
  }

  const scoredIndustries = [...returnsMap.entries()].map(([industryNorm, perf]) => {
    const perf3M = safeNum(perf?.perf3M, null);
    const perf6M = safeNum(perf?.perf6M, null);
    const score = perf3M ?? perf6M ?? -9999;
    return { industryNorm, score };
  });
  scoredIndustries.sort((a, b) => b.score - a.score);

  const total = scoredIndustries.length;
  const industryRankPct = {};
  for (let i = 0; i < scoredIndustries.length; i++) {
    const pct = ((i + 1) / Math.max(total, 1)) * 100;
    industryRankPct[scoredIndustries[i].industryNorm] = round1(pct);
  }

  const sectorRankByTicker = {};
  for (const [ticker, industryRaw] of tickerToTvIndustry.entries()) {
    const normalized = normalizeIndustryName(industryRaw);
    if (!normalized) continue;
    const pct = industryRankPct[normalized];
    if (Number.isFinite(pct)) sectorRankByTicker[ticker] = pct;
  }

  return sectorRankByTicker;
}

/**
 * Convert sector rank (lower is stronger) into an RS percentile (higher is stronger).
 * Example with 3 industries: top=100, middle=50, bottom=0.
 */
export function buildSectorRsPercentileByTicker(tvPayload) {
  const returnsMap = tvPayload?.returnsMap;
  const tickerToTvIndustry = tvPayload?.tickerToTvIndustry;
  if (!(returnsMap instanceof Map) || !(tickerToTvIndustry instanceof Map) || returnsMap.size === 0) {
    return {};
  }

  const scoredIndustries = [...returnsMap.entries()].map(([industryNorm, perf]) => {
    const perf3M = safeNum(perf?.perf3M, null);
    const perf6M = safeNum(perf?.perf6M, null);
    const score = perf3M ?? perf6M ?? -9999;
    return { industryNorm, score };
  });
  scoredIndustries.sort((a, b) => b.score - a.score);

  const total = scoredIndustries.length;
  const industryPercentile = {};
  for (let i = 0; i < scoredIndustries.length; i++) {
    const pct = total <= 1 ? 100 : ((total - 1 - i) / (total - 1)) * 100;
    industryPercentile[scoredIndustries[i].industryNorm] = round1(pct);
  }

  const out = {};
  for (const [ticker, industryRaw] of tickerToTvIndustry.entries()) {
    const normalized = normalizeIndustryName(industryRaw);
    if (!normalized) continue;
    const pct = industryPercentile[normalized];
    if (Number.isFinite(pct)) out[ticker] = pct;
  }
  return out;
}

export function applyTopDownSignalFilter(signals, options = {}) {
  const {
    regime = { regime: 'UNCERTAIN' },
    profile = null,
    sectorRankByTicker = {},
    returnStats = false,
  } = options;

  const regimeName = typeof regime === 'string' ? regime : (regime?.regime || 'UNCERTAIN');
  const p = profile || buildTopDownFilterProfile(regimeName);

  const stats = {
    input: Array.isArray(signals) ? signals.length : 0,
    removedBySector: 0,
    removedByVcp: 0,
    removedByRs: 0,
    removedByPattern: 0,
    removedByContractions: 0,
    output: 0,
  };

  const filtered = (signals || []).filter((signal) => {
    const ctx = signal?.context || {};
    const ticker = signal?.ticker;
    const rank = safeNum(sectorRankByTicker?.[ticker], null);

    if (rank != null && rank > p.maxSectorRankPct) {
      stats.removedBySector++;
      return false;
    }

    const vcpValid = ctx.vcpValid === true;
    if (p.requireVcpValid && !vcpValid) {
      stats.removedByVcp++;
      return false;
    }

    const rs = safeNum(ctx.relativeStrength, null);
    if (rs != null && rs < p.minRelativeStrength) {
      stats.removedByRs++;
      return false;
    }

    const patternConfidence = safeNum(ctx.patternConfidence, safeNum(signal?.patternConfidence, null));
    if (patternConfidence != null && patternConfidence < p.minPatternConfidence) {
      stats.removedByPattern++;
      return false;
    }

    const contractions = safeNum(ctx.contractions, safeNum(signal?.contractions, null));
    if (contractions != null && contractions < p.minContractions) {
      stats.removedByContractions++;
      return false;
    }

    return true;
  });

  stats.output = filtered.length;
  return returnStats ? { signals: filtered, stats } : filtered;
}

export function buildRegimeLeaderboard(cycleResults = []) {
  const out = {};
  for (const cycle of cycleResults || []) {
    const regimeName = cycle?.regime?.regime || cycle?.regime || 'UNKNOWN';
    if (!out[regimeName]) out[regimeName] = {};
    for (const ar of cycle?.agentResults || []) {
      if (!ar?.success) continue;
      const agentType = ar.agentType || 'unknown';
      if (!out[regimeName][agentType]) {
        out[regimeName][agentType] = {
          runs: 0,
          promotions: 0,
          sumDeltaExpectancy: 0,
          avgDeltaExpectancy: 0,
          promotionRate: 0,
          bestDeltaExpectancy: null,
          worstDeltaExpectancy: null,
        };
      }
      const row = out[regimeName][agentType];
      const delta = safeNum(ar?.abComparison?.delta?.expectancy, 0);
      const promoted = Boolean(ar?.abComparison?.promoted);
      row.runs += 1;
      if (promoted) row.promotions += 1;
      row.sumDeltaExpectancy += delta;
      row.bestDeltaExpectancy = row.bestDeltaExpectancy == null ? delta : Math.max(row.bestDeltaExpectancy, delta);
      row.worstDeltaExpectancy = row.worstDeltaExpectancy == null ? delta : Math.min(row.worstDeltaExpectancy, delta);
    }
  }

  for (const regimeName of Object.keys(out)) {
    for (const agentType of Object.keys(out[regimeName])) {
      const row = out[regimeName][agentType];
      row.avgDeltaExpectancy = Math.round((row.sumDeltaExpectancy / Math.max(row.runs, 1)) * 100) / 100;
      row.promotionRate = Math.round((row.promotions / Math.max(row.runs, 1)) * 1000) / 10;
      delete row.sumDeltaExpectancy;
    }
  }

  return out;
}

/**
 * Aggregate how the top-down filter behaved across regimes in historical cycles.
 */
export function buildRegimeProfile(cycleResults = []) {
  const out = {};
  for (const cycle of cycleResults || []) {
    const regimeName = cycle?.regime?.regime || cycle?.regime || 'UNKNOWN';
    const topDown = cycle?.topDown;
    if (!topDown) continue;
    if (!out[regimeName]) {
      out[regimeName] = {
        cycles: 0,
        sumInputSignals: 0,
        sumOutputSignals: 0,
        sumRemovedBySector: 0,
        sumRemovedByVcp: 0,
        sumRemovedByRs: 0,
        sumRemovedByPattern: 0,
        sumRemovedByContractions: 0,
      };
    }
    const row = out[regimeName];
    row.cycles += 1;
    row.sumInputSignals += safeNum(topDown.input, 0);
    row.sumOutputSignals += safeNum(topDown.output, 0);
    row.sumRemovedBySector += safeNum(topDown.removedBySector, 0);
    row.sumRemovedByVcp += safeNum(topDown.removedByVcp, 0);
    row.sumRemovedByRs += safeNum(topDown.removedByRs, 0);
    row.sumRemovedByPattern += safeNum(topDown.removedByPattern, 0);
    row.sumRemovedByContractions += safeNum(topDown.removedByContractions, 0);
  }

  for (const regimeName of Object.keys(out)) {
    const row = out[regimeName];
    const cycles = Math.max(1, row.cycles);
    const avgInputSignals = row.sumInputSignals / cycles;
    const avgOutputSignals = row.sumOutputSignals / cycles;
    out[regimeName] = {
      cycles: row.cycles,
      avgInputSignals: round1(avgInputSignals),
      avgOutputSignals: round1(avgOutputSignals),
      avgSurvivalRatePct: round1(avgInputSignals > 0 ? (avgOutputSignals / avgInputSignals) * 100 : 0),
      avgRemovedBySector: round1(row.sumRemovedBySector / cycles),
      avgRemovedByVcp: round1(row.sumRemovedByVcp / cycles),
      avgRemovedByRs: round1(row.sumRemovedByRs / cycles),
      avgRemovedByPattern: round1(row.sumRemovedByPattern / cycles),
      avgRemovedByContractions: round1(row.sumRemovedByContractions / cycles),
    };
  }

  return out;
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

export function resolveSignalCacheTimestamp(signal = null) {
  if (!signal || typeof signal !== 'object') return null;
  return signal.scanDate || signal.created_at || signal.entryDate || signal.entry_date || null;
}

export function normalizeBatchValidationPolicy(policy = {}, cyclesPerAgent = 0) {
  const cycleCap = toPositiveInt(cyclesPerAgent, 0);
  const normalizeInterval = (value) => {
    const n = toPositiveInt(value, 0);
    if (cycleCap > 0 && n > cycleCap) return cycleCap;
    return n;
  };

  const minDeltaRaw = Number(policy?.minPromotedDeltaExpectancy);
  const minPromotedDeltaExpectancy = Number.isFinite(minDeltaRaw) ? minDeltaRaw : null;

  return {
    enabled: Boolean(policy?.enabled),
    validatePromotedOnly: policy?.validatePromotedOnly !== false,
    validateAgentTypes: Array.isArray(policy?.validateAgentTypes) ? policy.validateAgentTypes.filter(Boolean) : [],
    minPromotedDeltaExpectancy,
    wfoEveryNCycles: normalizeInterval(policy?.wfoEveryNCycles),
    wfoMcEveryNCycles: normalizeInterval(policy?.wfoMcEveryNCycles),
    holdoutEveryNCycles: normalizeInterval(policy?.holdoutEveryNCycles),
    holdoutOnFinalCycle: policy?.holdoutOnFinalCycle !== false,
  };
}

export function resolveValidationTiersForCycle(cycle, cyclesPerAgent, policy = {}) {
  const p = normalizeBatchValidationPolicy(policy, cyclesPerAgent);
  if (!p.enabled) return [];

  const tiers = [];
  const runWfoMc = p.wfoMcEveryNCycles > 0 && cycle % p.wfoMcEveryNCycles === 0;
  const runWfo = !runWfoMc && p.wfoEveryNCycles > 0 && cycle % p.wfoEveryNCycles === 0;
  const runHoldoutByInterval = p.holdoutEveryNCycles > 0 && cycle % p.holdoutEveryNCycles === 0;
  const runHoldoutByFinal = p.holdoutOnFinalCycle && cycle === cyclesPerAgent;

  if (runWfo) tiers.push('wfo');
  if (runWfoMc) tiers.push('wfo_mc');
  if (runHoldoutByInterval || runHoldoutByFinal) tiers.push('holdout');

  return tiers;
}

function shouldValidateAgentResult(agentResult, policy) {
  if (!agentResult?.success) return false;
  if (policy.validateAgentTypes.length > 0 && !policy.validateAgentTypes.includes(agentResult.agentType)) {
    return false;
  }
  const promoted = Boolean(agentResult?.abComparison?.promoted);
  if (policy.validatePromotedOnly && !promoted) return false;

  if (policy.minPromotedDeltaExpectancy != null) {
    const delta = safeNum(agentResult?.abComparison?.delta?.expectancy, null);
    if (delta == null || delta < policy.minPromotedDeltaExpectancy) return false;
  }
  return true;
}

/**
 * Resolve which agents should run.
 * - If agentTypes provided, return those agents regardless of budget.
 * - Otherwise, only return agents with a positive budget.
 */
export function resolveActiveAgents(agents, agentBudgets = {}, agentTypes = null) {
  const hasAgentTypes = Array.isArray(agentTypes) && agentTypes.length > 0;
  if (hasAgentTypes) {
    const requested = new Set(agentTypes);
    return agents.filter((agent) => requested.has(agent.agentType));
  }
  return agents.filter((agent) => (agentBudgets?.[agent.agentType] ?? 0) > 0);
}

/**
 * Run the full multi-agent optimization pipeline.
 *
 * @param {Object} options
 * @param {number} options.lookbackMonths  - Historical data lookback
 * @param {number} options.tickerLimit     - Max tickers to scan
 * @param {number} options.maxIterations   - Iterations per agent
 * @param {number} options.targetProfit    - Target avg return per trade
 * @param {Function} options.onProgress    - SSE progress callback
 * @param {boolean} options.forceRefresh   - Bypass signal cache
 * @param {string[]} options.agentTypes    - Subset of agents to run (null = all)
 * @returns {Promise<Object>} Combined results from all agents
 */
export async function runMultiAgentOptimization(options = {}) {
  const {
    // 60 months (5 years) — Northstar doctrine requires VCP prior uptrend ≥30%
    // and a meaningful backtest window for WFO + Bayesian optimization.
    // CANSLIM minimum RS filter (CANSLIM.minRsRating) is enforced by Sam downstream.
    lookbackMonths = 60,
    tickerLimit = 200,
    maxIterations = 20,
    targetProfit = 5,
    onProgress = null,
    forceRefresh = false,
    agentTypes = null,
    regimeOverride = null,
    topDownFilter = true,
    topDownProfile = null,
    rawSignalPool = null,
    precomputedSectorRankByTicker = null,
    batchRunId = null,
    batchCycle = null,
  } = options;

  const startedAt = Date.now();

  // ── Step 1: Market Pulse ──
  if (onProgress) {
    onProgress({ phase: 'regime', message: 'Market Pulse: classifying regime...' });
  }

  let regime;
  try {
    regime = regimeOverride || await classifyMarket();
  } catch (e) {
    console.warn('Harry Historian: Market Pulse failed, using UNCERTAIN fallback:', e.message);
    regime = {
      regime: 'UNCERTAIN',
      confidence: 0,
      exposureMultiplier: 0.75,
      agentBudgets: {
        momentum_scout: 0.20,
        breakout_tracker: 0.15,
        base_hunter: 0.30,
        turtle_trader: 0.20,
        ma_crossover_10_20: 0.15,
      },
    };
  }

  if (onProgress) {
    onProgress({
      phase: 'regime_complete',
      regime: regime.regime,
      confidence: regime.confidence,
      exposureMultiplier: regime.exposureMultiplier,
      agentBudgets: regime.agentBudgets,
      message: `Market regime: ${regime.regime} (${regime.confidence}% confidence)`,
    });
  }

  // In BEAR regime, no signals should be generated
  if (regime.regime === 'BEAR') {
    if (onProgress) {
      onProgress({ phase: 'done', message: 'BEAR regime — all agents paused.' });
    }
    return {
      success: true,
      regime,
      agentResults: [],
      summary: 'BEAR regime detected — no optimization run. All agents paused.',
    };
  }

  // ── Step 2: Fetch shared signal pool (or reuse batch-preloaded pool) ──
  let rawSignals;
  if (Array.isArray(rawSignalPool)) {
    rawSignals = rawSignalPool;
    if (onProgress) {
      onProgress({
        phase: 'batch_signal_pool_reuse',
        signalCount: rawSignals.length,
        message: `Reusing shared signal pool (${rawSignals.length} signals)`,
      });
    }
  } else {
    if (onProgress) {
      onProgress({ phase: 'scanning', message: 'Fetching historical signals...', current: 0, total: tickerLimit });
    }
    rawSignals = await fetchSignalPool({
      lookbackMonths,
      tickerLimit,
      forceRefresh,
      signalFamilies: ['opus45', 'turtle', 'ma_crossover'],
      onProgress,
    });
  }

  if (!rawSignals || rawSignals.length < 10) {
    return {
      success: false,
      error: `Insufficient signals (${rawSignals?.length || 0})`,
      regime,
    };
  }

  let signals = rawSignals;
  let topDown = null;
  if (topDownFilter) {
    if (onProgress) onProgress({ phase: 'sector_rs', message: 'Calculating sector relative strength...' });
    try {
      let sectorRankByTicker = precomputedSectorRankByTicker;
      if (!sectorRankByTicker || Object.keys(sectorRankByTicker).length === 0) {
        const tvPayload = await fetchTradingViewIndustryReturns({ useCache: true });
        sectorRankByTicker = buildSectorRankByTicker(tvPayload);
      }
      const filtered = applyTopDownSignalFilter(rawSignals, {
        regime,
        profile: topDownProfile || buildTopDownFilterProfile(regime.regime),
        sectorRankByTicker,
        returnStats: true,
      });
      signals = filtered.signals;
      topDown = filtered.stats;
      if (onProgress) {
        onProgress({
          phase: 'top_down_filter',
          message: `Top-down filter: ${topDown.output}/${topDown.input} signals survived`,
          topDown,
        });
      }
    } catch (e) {
      console.warn('Harry Historian top-down filter fallback:', e.message);
      topDown = { input: rawSignals.length, output: rawSignals.length, fallback: true };
    }
  }

  if (!signals || signals.length < 10) {
    return {
      success: false,
      error: `Insufficient top-down signals (${signals?.length || 0})`,
      regime,
      topDown,
    };
  }

  if (onProgress) {
    onProgress({
      phase: 'signals_ready',
      signalCount: signals.length,
      message: `${signals.length} signals ready — fanning out to agents...`,
    });
  }

  // ── Step 3: Fan out to strategy agents in parallel ──
  const activeAgents = resolveActiveAgents(STRATEGY_AGENTS, regime.agentBudgets, agentTypes);

  if (onProgress) {
    onProgress({
      phase: 'agents_starting',
      agents: activeAgents.map((a) => ({ name: a.name, type: a.agentType, budget: regime.agentBudgets[a.agentType] })),
      message: `Running ${activeAgents.length} agents in parallel...`,
    });
  }

  const agentPromises = activeAgents.map((agent) =>
    agent.optimize(signals, {
      maxIterations,
      targetProfit,
      regimeTag: regime.regime,
      batchRunId,
      batchCycle,
      onProgress: onProgress
        ? (p) => onProgress({ ...p, agent: agent.agentType, agentName: agent.name })
        : null,
    }).catch((err) => ({
      agentType: agent.agentType,
      name: agent.name,
      success: false,
      error: err.message,
    }))
  );

  const agentResults = await Promise.all(agentPromises);

  // ── Step 4: Merge and report ──
  const successfulAgents = agentResults.filter((r) => r.success);
  const failedAgents = agentResults.filter((r) => !r.success);

  // Build summary
  const summaryLines = [
    `Multi-Agent Optimization Complete`,
    `═══════════════════════════════════════`,
    `Regime: ${regime.regime} (${regime.confidence}% confidence)`,
    `Exposure: ${(regime.exposureMultiplier * 100).toFixed(0)}%`,
    `Total signals: ${signals.length}`,
    `Agents run: ${activeAgents.length}`,
    ``,
  ];

  for (const result of agentResults) {
    if (result.success) {
      const ab = result.abComparison;
      summaryLines.push(
        `[${result.name}] ${result.signalCount} signals`,
        `  Control: ${ab?.controlMetrics?.expectancy?.toFixed(2) || '?'}% expectancy`,
        `  Variant: ${ab?.variantMetrics?.expectancy?.toFixed(2) || '?'}% expectancy`,
        `  ${ab?.promoted ? 'PROMOTED' : 'Rejected'}: ${ab?.promotionReason || ''}`,
        ``
      );
    } else {
      summaryLines.push(`[${result.name}] FAILED: ${result.error || result.reason}`, ``);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  summaryLines.push(`Completed in ${elapsed}s`);

  const finalResult = {
    success: true,
    regime,
    signalCount: signals.length,
    topDown,
    agentResults,
    successfulAgents: successfulAgents.length,
    failedAgents: failedAgents.length,
    summary: summaryLines.join('\n'),
    elapsedMs: Date.now() - startedAt,
  };

  if (onProgress) {
    onProgress({
      phase: 'done',
      result: finalResult,
      message: `Multi-agent optimization complete (${elapsed}s)`,
    });
  }

  return finalResult;
}

/**
 * Batch loop runner for N-cycle mechanical self-learning.
 * One cycle = one strategy rotation step per selected agent.
 */
export async function runBatchLearningLoop(options = {}) {
  const {
    runId = `batch_${Date.now()}`,
    agentTypes = null,
    cyclesPerAgent = 10,
    startCycle = 1,
    existingCycles = [],
    runCycle = null,
    validationPolicy = null,
    runValidation = null,
    loadSharedResources = null,
    onProgress = null,
    onCheckpoint = null,
    stopOnError = false,
    ...rest
  } = options;

  const normalizedStartCycle = Math.max(1, Math.min(cyclesPerAgent, Number(startCycle) || 1));
  const cycles = Array.isArray(existingCycles) ? [...existingCycles] : [];
  const startedAt = new Date().toISOString();
  const normalizedValidationPolicy = normalizeBatchValidationPolicy(validationPolicy || {}, cyclesPerAgent);
  const validationSummary = {
    enabled: normalizedValidationPolicy.enabled,
    totalValidations: 0,
    passedValidations: 0,
    failedValidations: 0,
  };

  let sharedResources = { rawSignalPool: null, sectorRankByTicker: null };
  if (typeof loadSharedResources === 'function') {
    try {
      const loaded = await loadSharedResources({ runId, cyclesPerAgent, agentTypes, options: rest });
      if (loaded && typeof loaded === 'object') {
        sharedResources = {
          rawSignalPool: Array.isArray(loaded.rawSignalPool) ? loaded.rawSignalPool : null,
          sectorRankByTicker: loaded.sectorRankByTicker && typeof loaded.sectorRankByTicker === 'object'
            ? loaded.sectorRankByTicker
            : null,
        };
      }
    } catch (e) {
      console.warn('Batch shared resource loader failed:', e?.message || e);
      sharedResources = { rawSignalPool: null, sectorRankByTicker: null };
    }
  } else if (!runCycle) {
    try {
      if (onProgress) {
        onProgress({
          phase: 'batch_shared_pool_start',
          runId,
          cyclesPerAgent,
          message: 'Preparing shared signal pool once for all cycles...',
        });
      }

      const rawSignalPool = await fetchSignalPool({
        lookbackMonths: rest.lookbackMonths ?? 60,
        tickerLimit: rest.tickerLimit ?? 200,
        forceRefresh: Boolean(rest.forceRefresh ?? false),
        signalFamilies: ['opus45', 'turtle', 'ma_crossover'],
        onProgress,
      });

      let sectorRankByTicker = null;
      const shouldBuildSectorMap = rest.topDownFilter !== false;
      if (shouldBuildSectorMap) {
        if (onProgress) {
          onProgress({
            phase: 'batch_shared_sector_start',
            runId,
            cyclesPerAgent,
            message: 'Preparing shared sector relative-strength map...',
          });
        }
        try {
          const tvPayload = await fetchTradingViewIndustryReturns({ useCache: true });
          sectorRankByTicker = buildSectorRankByTicker(tvPayload);
        } catch (e) {
          console.warn('Batch shared sector map fallback:', e?.message || e);
          sectorRankByTicker = null;
        }
      }

      sharedResources = { rawSignalPool, sectorRankByTicker };
      if (onProgress) {
        onProgress({
          phase: 'batch_shared_pool_ready',
          runId,
          cyclesPerAgent,
          signalCount: rawSignalPool?.length || 0,
          message: `Shared resources ready (${rawSignalPool?.length || 0} raw signals)`,
        });
      }
    } catch (e) {
      console.warn('Batch shared resource prefetch failed, falling back to per-cycle fetch:', e?.message || e);
      sharedResources = { rawSignalPool: null, sectorRankByTicker: null };
    }
  }

  const execCycle = runCycle || (async ({ cycle, emitProgress, sharedSignalPool, sharedSectorRankByTicker }) => {
    const payload = {
      ...rest,
      agentTypes,
      forceRefresh: cycle === 1 ? Boolean(rest.forceRefresh ?? false) : false,
      rawSignalPool: sharedSignalPool,
      precomputedSectorRankByTicker: sharedSectorRankByTicker,
      batchRunId: runId,
      batchCycle: cycle,
      onProgress: emitProgress || null,
    };
    return runMultiAgentOptimization(payload);
  });

  for (let cycle = normalizedStartCycle; cycle <= cyclesPerAgent; cycle++) {
    const emitProgress = (payload = {}) => {
      if (!onProgress) return;
      onProgress({
        ...payload,
        cycle: payload?.cycle ?? cycle,
        cyclesPerAgent: payload?.cyclesPerAgent ?? cyclesPerAgent,
        runId: payload?.runId ?? runId,
      });
    };

    if (onProgress) {
      onProgress({
        phase: 'batch_cycle_start',
        cycle,
        cyclesPerAgent,
        message: `Batch cycle ${cycle}/${cyclesPerAgent} started`,
      });
    }

    let cycleResult;
    try {
      cycleResult = await execCycle({
        cycle,
        cyclesPerAgent,
        agentTypes,
        runId,
        emitProgress,
        sharedResources,
        sharedSignalPool: sharedResources.rawSignalPool,
        sharedSectorRankByTicker: sharedResources.sectorRankByTicker,
      });
    } catch (e) {
      cycleResult = {
        success: false,
        error: e?.message || 'Batch cycle failed',
        regime: { regime: 'UNKNOWN' },
        agentResults: [],
      };
      if (stopOnError) {
        cycles.push({ cycle, ...cycleResult, completedAt: new Date().toISOString() });
        break;
      }
    }

    const cycleRecord = {
      cycle,
      completedAt: new Date().toISOString(),
      success: Boolean(cycleResult?.success),
      regime: cycleResult?.regime || { regime: 'UNKNOWN' },
      signalCount: cycleResult?.signalCount ?? null,
      topDown: cycleResult?.topDown || null,
      agentResults: cycleResult?.agentResults || [],
      error: cycleResult?.error || null,
      elapsedMs: cycleResult?.elapsedMs ?? null,
      validations: [],
    };

    const validationTiers = resolveValidationTiersForCycle(cycle, cyclesPerAgent, normalizedValidationPolicy);
    if (typeof runValidation === 'function' && validationTiers.length > 0) {
      const candidateAgents = (cycleRecord.agentResults || []).filter((ar) =>
        shouldValidateAgentResult(ar, normalizedValidationPolicy)
      );

      for (const tier of validationTiers) {
        for (const agentResult of candidateAgents) {
          if (onProgress) {
            onProgress({
              phase: 'batch_validation',
              cycle,
              cyclesPerAgent,
              tier,
              agentType: agentResult.agentType,
              message: `Validation ${tier.toUpperCase()} for ${agentResult.agentType} (cycle ${cycle}/${cyclesPerAgent})`,
            });
          }

          try {
            const validationResult = await runValidation({
              runId,
              cycle,
              cyclesPerAgent,
              tier,
              agentType: agentResult.agentType,
              agentResult,
              cycleResult: cycleRecord,
            });
            cycleRecord.validations.push({
              tier,
              agentType: agentResult.agentType,
              success: true,
              result: validationResult || null,
            });
            validationSummary.totalValidations += 1;
            validationSummary.passedValidations += 1;
          } catch (e) {
            cycleRecord.validations.push({
              tier,
              agentType: agentResult.agentType,
              success: false,
              error: e?.message || 'validation_failed',
            });
            validationSummary.totalValidations += 1;
            validationSummary.failedValidations += 1;
          }
        }
      }
    }

    cycles.push(cycleRecord);

    const checkpoint = {
      runId,
      status: cycle >= cyclesPerAgent ? 'completed' : 'running',
      cycle,
      cyclesPerAgent,
      cyclesCompleted: cycles.length,
      lastCycle: cycleRecord,
      updatedAt: new Date().toISOString(),
    };
    if (onCheckpoint) await onCheckpoint(checkpoint);

    if (onProgress) {
      onProgress({
        phase: 'batch_cycle_complete',
        cycle,
        cyclesPerAgent,
        message: `Batch cycle ${cycle}/${cyclesPerAgent} complete`,
      });
    }
  }

  const leaderboardByRegime = buildRegimeLeaderboard(cycles);
  const totalAgentExecutions = cycles.reduce((sum, c) => sum + (c.agentResults?.length || 0), 0);
  const result = {
    success: true,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    cyclesPlanned: cyclesPerAgent,
    cyclesCompleted: cycles.length,
    totalAgentExecutions,
    leaderboardByRegime,
    regimeProfile: buildRegimeProfile(cycles),
    validationSummary,
    cycles,
  };

  if (onProgress) {
    onProgress({
      phase: 'batch_done',
      message: `Batch complete: ${cycles.length}/${cyclesPerAgent} cycles`,
      result,
    });
  }
  return result;
}

/**
 * Fetch the shared signal pool (cached or fresh).
 * Reuses the same caching logic as the single-agent optimizer.
 */
async function fetchSignalPool({ lookbackMonths, tickerLimit, forceRefresh, signalFamilies = ['opus45', 'turtle', 'ma_crossover'], onProgress, seedMode = false }) {
  const fetchStartedAt = Date.now();
  const cacheCheckStartedAt = Date.now();
  let cacheCheckMs = 0;
  let scanMs = 0;
  let saveMs = 0;

  // Auto-seed for first-time runs so new agents can bootstrap a signal pool
  let hasStoredSignals = false;
  if (isSupabaseConfigured()) {
    try {
      const stored = await getStoredSignals(1);
      hasStoredSignals = stored && stored.length > 0;
    } catch {
      hasStoredSignals = false;
    }
  }
  const shouldSeed = seedMode || !hasStoredSignals;
  // Try database cache first
  if (!forceRefresh && isSupabaseConfigured()) {
    try {
      if (onProgress) {
        onProgress({ phase: 'checking_db', message: 'Checking database for cached signals...' });
      }

      const storedSignals = await getStoredSignals(2000);

      if (storedSignals && storedSignals.length > 0) {
        const latestSignal = storedSignals[0];
        const scanDate = resolveSignalCacheTimestamp(latestSignal);
        const storedExitVersion = latestSignal.exitStrategyVersion || 1;
        const needsTurtle = signalFamilies.includes('turtle');
        const hasTurtleSignals = needsTurtle
          ? storedSignals.some((s) => (s.signalFamily === 'turtle') || (s.context?.signalFamily === 'turtle'))
          : true;

        if (scanDate && storedExitVersion >= EXIT_STRATEGY_VERSION) {
          const scanDateMs = new Date(scanDate).getTime();
          const ageDays = Number.isFinite(scanDateMs)
            ? (Date.now() - scanDateMs) / (1000 * 60 * 60 * 24)
            : Infinity;

          // Verify signals actually span the expected history window.
          // A real 5yr deep scan will have signals dating back to 2021-2022.
          // Stale cached signals may have lookback_months=60 in metadata but only
          // cover recent months — we detect this by checking actual entry_date span.
          const entryDates = storedSignals
            .map((s) => s.entryDate || s.entry_date)
            .filter(Boolean)
            .sort();
          const earliestEntry = entryDates[0];
          const latestEntry = entryDates[entryDates.length - 1];
          const spanDays = earliestEntry && latestEntry
            ? (new Date(latestEntry) - new Date(earliestEntry)) / (1000 * 60 * 60 * 24)
            : 0;

          // Deep scan: metadata says 5yr AND signals actually span >= 18 months of history.
          // Without the span check, retroactively-labeled data would falsely skip the rescan.
          const metadataDeep = (latestSignal.lookbackMonths || 12) >= 36;
          const isDeepScan = metadataDeep && spanDays >= 540; // 540 days ≈ 18 months
          const maxCacheAgeDays = isDeepScan ? 90 : 7;

          console.log(
            `Harry Historian cache check: ${storedSignals.length} signals, span=${spanDays.toFixed(0)}d, ` +
            `metadataDeep=${metadataDeep}, isDeepScan=${isDeepScan}, age=${ageDays.toFixed(1)}d`
          );

          if (ageDays < maxCacheAgeDays && hasTurtleSignals) {
            cacheCheckMs = Date.now() - cacheCheckStartedAt;
            if (onProgress) {
              onProgress({
                phase: 'db_cache',
                message: `Using ${storedSignals.length} signals from database (${ageDays.toFixed(1)}d old, ${isDeepScan ? '5yr deep scan' : 'recent scan'})`,
                signalCount: storedSignals.length,
                fromCache: true,
              });
            }
            console.log(
              `Harry Historian signal pool timing: cacheCheck=${cacheCheckMs}ms scan=0ms save=0ms total=${Date.now() - fetchStartedAt}ms (cache hit)`
            );
            return storedSignals;
          }
        }
      }
    } catch (e) {
      console.warn('Harry Historian: DB cache check failed:', e.message);
    } finally {
      if (cacheCheckMs === 0) cacheCheckMs = Date.now() - cacheCheckStartedAt;
    }
  }

  // Fresh scan
  let tickerList = await getTickerList();
  if (tickerLimit > 0 && tickerList.length > tickerLimit) {
    tickerList = tickerList.slice(0, tickerLimit);
  }

  const progressCallback = onProgress
    ? (p) => onProgress({ phase: 'scanning', ...p, message: `Scanning ${p.ticker}... (${p.current}/${p.total})` })
    : null;

  const scanStartedAt = Date.now();
  let scanResults = await scanMultipleTickers(tickerList, lookbackMonths, progressCallback, { signalFamilies, seedMode: shouldSeed });
  scanMs += Date.now() - scanStartedAt;

  // Auto-seed fallback: if strict scan yields 0 signals, retry with seedMode on Opus4.5
  if (!seedMode && (!scanResults.signals || scanResults.signals.length === 0)) {
    if (onProgress) {
      onProgress({ phase: 'seed_scan', message: 'No signals found. Retrying with seed mode to bootstrap signal pool...' });
    }
    const seedScanStartedAt = Date.now();
    scanResults = await scanMultipleTickers(tickerList, lookbackMonths, progressCallback, { signalFamilies, seedMode: true });
    scanMs += Date.now() - seedScanStartedAt;
  }

  // Persist to database for future runs
  if (isSupabaseConfigured() && scanResults.signals?.length > 0) {
    if (onProgress) {
      onProgress({ phase: 'saving', message: `Saving ${scanResults.signals.length} signals to database...` });
    }
    const saveStartedAt = Date.now();
    await storeSignalsInDatabase(scanResults.signals);
    saveMs = Date.now() - saveStartedAt;
  }

  console.log(
    `Harry Historian signal pool timing: cacheCheck=${cacheCheckMs}ms scan=${scanMs}ms save=${saveMs}ms total=${Date.now() - fetchStartedAt}ms`
  );

  return scanResults.signals || [];
}

/**
 * Run only Harry's data-fetch job: 5yr OHLC for all tickers → signals → save to DB.
 * No Market Pulse, no strategy agents. Used by the "Fetch 5yr history" button on the Agents page.
 *
 * @param {Object} options
 * @param {number} options.lookbackMonths - Default 60 (5 years)
 * @param {number} options.tickerLimit    - Max tickers to scan (0 = no limit, use all tickers in DB)
 * @param {boolean} options.forceRefresh  - If true, always rescan; if false, may use cache (same as fetchSignalPool)
 * @param {Function} options.onProgress   - Called with { phase, message?, current?, total?, ticker?, signalCount? }
 * @returns {Promise<{ success: boolean, signalCount: number, error?: string }>}
 */
export async function runHarryFetchOnly(options = {}) {
  const {
    lookbackMonths = 60,
    tickerLimit = 0,
    forceRefresh = true,
    signalFamilies = ['opus45', 'turtle', 'ma_crossover'],
    onProgress = null,
  } = options;

  const send = (p) => onProgress && onProgress(p);

  try {
    send({ phase: 'starting', message: 'Harry: fetching 5yr history for all tickers...' });

    const signals = await fetchSignalPool({
      lookbackMonths,
      tickerLimit,
      forceRefresh,
      signalFamilies,
      onProgress: (p) => send({ phase: p.phase, message: p.message, current: p.current, total: p.total, ticker: p.ticker, signalCount: p.signalCount }),
    });

    const count = signals?.length ?? 0;
    send({ phase: 'done', message: `Saved ${count} signals to database.`, signalCount: count });
    return { success: true, signalCount: count };
  } catch (e) {
    send({ phase: 'error', message: e.message });
    return { success: false, signalCount: 0, error: e.message };
  }
}

/**
 * Pure helper: compute data freshness and ticker coverage from stored signals.
 *
 * @param {Array} signals    - Stored historical signals (each has ticker + entryDate/entry_date)
 * @param {string[]} tickerList  - Full ticker universe we expect to have data for
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=30]      - Max acceptable age in days
 * @param {number} [opts.minCoveragePct=60]  - Minimum % of tickerList that must be present in signals
 * @returns {{ isFresh, ageDays, coveragePct, missingTickers, coveredCount }}
 */
export function checkDataFreshness(signals, tickerList, opts = {}) {
  const { maxAgeDays = 30, minCoveragePct = 60 } = opts;

  if (!tickerList || tickerList.length === 0) {
    return { isFresh: false, ageDays: Infinity, coveragePct: 0, missingTickers: [], coveredCount: 0 };
  }

  if (!signals || signals.length === 0) {
    return { isFresh: false, ageDays: Infinity, coveragePct: 0, missingTickers: [...tickerList], coveredCount: 0 };
  }

  // Most recent entry date across all signals
  const dates = signals
    .map((s) => new Date(s.entryDate || s.entry_date || 0).getTime())
    .filter((t) => t > 0);
  const newestMs = dates.length > 0 ? Math.max(...dates) : 0;
  const ageDays = newestMs > 0 ? (Date.now() - newestMs) / (1000 * 60 * 60 * 24) : Infinity;

  // Ticker coverage
  const coveredSet = new Set(signals.map((s) => s.ticker).filter(Boolean));
  const missingTickers = tickerList.filter((t) => !coveredSet.has(t));
  const coveredCount = tickerList.length - missingTickers.length;
  const coveragePct = Math.round((coveredCount / tickerList.length) * 100);

  const isFresh = ageDays < maxAgeDays && coveragePct >= minCoveragePct;

  return { isFresh, ageDays: Math.round(ageDays * 10) / 10, coveragePct, missingTickers, coveredCount };
}

/**
 * Get a summary of all registered agents and their current status.
 */
export function getAgentManifest() {
  return STRATEGY_AGENTS.map((agent) => ({
    name: agent.name,
    agentType: agent.agentType,
    mandatoryOverrides: agent.mandatoryOverrides,
  }));
}

export { STRATEGY_AGENTS };
