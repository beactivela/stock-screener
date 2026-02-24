/**
 * Marcus — CEO Money Manager Agent
 *
 * Marcus is the top-level overseer of the entire multi-agent system.
 * His North Star goal: maximize risk-adjusted returns by allocating capital
 * only to the highest-confidence setups in the right market conditions.
 *
 * Marcus does NOT trade himself. He:
 *   1. Sets the global risk budget (exposure %) based on Market Pulse regime
 *   2. Confirms with Harry that data is fetched for all tickers and fresh (≤30 days)
 *   3. Dispatches strategy agents (Momentum Scout, Base Hunter, Breakout Tracker, Turtle Trader)
 *      and asks each to show avg return results
 *   4. Enforces portfolio-level position limits and drawdown guards
 *   5. Produces a final "Mission Briefing" summary for the Agents dashboard
 *
 * North Star goal (hard-coded):
 *   "Deploy capital exclusively into Stage-2 leaders with VCP setups,
 *    only when the broad market is in a confirmed uptrend (BULL or recovering
 *    UNCERTAIN), targeting ≥2R per trade with a max 8% loss on any position."
 *
 * Model: GPT-5.2 Codex Low (Marcus reasons at the portfolio level,
 *        not at the individual signal level — less compute needed)
 */

import { runMultiAgentOptimization, getAgentManifest, runHarryFetchOnly, checkDataFreshness } from './harryHistorian.js';
import { classifyMarket } from './marketPulse.js';
import { fetchMarketNews } from '../news/marketNews.js';
import { loadLatestLearningRun } from '../learning/index.js';
import { getStoredSignals } from '../learning/autoPopulate.js';
import { getTickerList } from '../learning/historicalSignalScanner.js';
import {
  NORTHSTAR_DOCTRINE,
  ACCOUNT,
  CANSLIM,
  VCP,
  EXIT_RULES,
  KILL_SWITCHES,
  PRINCIPLES,
  isBuyingAllowed,
  getMaxPositions,
  calcPositionSize,
} from './northstar.js';

// ─── Marcus's North Star parameters (sourced from northstar.js) ───────────────
// All values are derived directly from the Northstar doctrine so that changing
// docs/northstar.md → northstar.js automatically propagates here.

export const NORTH_STAR = {
  goal: NORTHSTAR_DOCTRINE.mission,
  targetRMultiple: 2.0,
  maxLossPct: EXIT_RULES.hard.maxLossPct,           // 8% hard stop
  allowedRegimes: ['BULL', 'UNCERTAIN'],             // isBuyingAllowed() gate
  maxPortfolioExposure: 1.0,                         // scaled by regime multiplier
  maxPositions: getMaxPositions('BULL'),             // 50 in BULL (regime-adjusted at runtime)
  minRS: CANSLIM.minRsRating,                        // 85 RS minimum
};

// ─── IBD-style market summary helpers (pure functions; unit-testable) ─────────

/**
 * Derive an IBD-style trend label from a Market Pulse regime object.
 *
 * IBD mental model:
 * - Confirmed Uptrend
 * - Uptrend Under Pressure
 * - Market in Correction
 * - Market in Downtrend
 */
export function deriveMarketOutlook(regimeResult) {
  const regime = regimeResult?.regime ?? 'UNKNOWN';
  const confidence = regimeResult?.confidence ?? 0;
  const distributionDays = regimeResult?.distributionDays ?? null;
  const raw = regimeResult?.raw ?? {};

  let trendLabel = 'Uptrend Under Pressure';
  if (regime === 'BULL') {
    const dd = typeof distributionDays === 'number' ? distributionDays : 0;
    const healthy =
      dd <= 3 &&
      (raw.spyAbove50ma !== false) &&
      (raw.qqqAbove50ma !== false);
    trendLabel = healthy ? 'Confirmed Uptrend' : 'Uptrend Under Pressure';
  } else if (regime === 'UNCERTAIN') {
    trendLabel = 'Uptrend Under Pressure';
  } else if (regime === 'CORRECTION') {
    trendLabel = 'Market in Correction';
  } else if (regime === 'BEAR') {
    trendLabel = 'Market in Downtrend';
  } else {
    trendLabel = 'Uptrend Under Pressure';
  }

  return {
    trendLabel,
    regime,
    confidence,
    distributionDays,
    raw: {
      spyClose: raw.spyClose ?? null,
      spy50ma: raw.spy50ma ?? null,
      spy200ma: raw.spy200ma ?? null,
      qqqClose: raw.qqqClose ?? null,
      qqq50ma: raw.qqq50ma ?? null,
      spyAbove50ma: raw.spyAbove50ma ?? null,
      qqqAbove50ma: raw.qqqAbove50ma ?? null,
      isFollowThroughDay: raw.isFollowThroughDay ?? null,
    },
  };
}

/**
 * Convert exposure sizing into a human "how aggressive should I be" label.
 */
export function deriveAggressiveness({ exposureMultiplier, maxPositions }) {
  const x = typeof exposureMultiplier === 'number' ? exposureMultiplier : 0;
  const recommendedExposurePct = Math.max(0, Math.min(100, Math.round(x * 100)));

  let label = 'Defensive';
  if (recommendedExposurePct <= 0) label = 'Cash';
  else if (recommendedExposurePct >= 90) label = 'Aggressive';
  else if (recommendedExposurePct >= 60) label = 'Moderate';
  else if (recommendedExposurePct >= 25) label = 'Defensive';
  else label = 'Very Defensive';

  return {
    label,
    recommendedExposurePct,
    maxPositions: maxPositions ?? null,
  };
}

/**
 * Translate a strategy agent optimization result into a health + confidence signal
 * for Marcus to report on the Dashboard.
 */
export function assessSubagentHealth(agentResult) {
  const agentType = agentResult?.agentType ?? 'unknown';
  const name = agentResult?.name ?? agentType;

  if (!agentResult?.success) {
    const reason = agentResult?.reason || agentResult?.error || 'failed';
    return {
      agentType,
      name,
      status: 'fail',
      confidencePct: 0,
      signalCount: agentResult?.signalCount ?? 0,
      notes: reason,
      improvements: [String(reason)],
    };
  }

  const evidence = agentResult?.bayesian?.evidence ?? 'none';
  const bayesFactor = agentResult?.bayesian?.bayesFactor ?? null;
  const testDelta = agentResult?.bayesian?.testDelta ?? null;
  const usingWFO = !!agentResult?.wfo?.usingWFO;
  const testSignals = agentResult?.wfo?.testSignals ?? null;
  const promoted = !!agentResult?.abComparison?.promoted;

  let score = 50;
  if (usingWFO) score += 15;
  if (typeof testSignals === 'number') {
    if (testSignals >= 30) score += 10;
    else if (testSignals >= 15) score += 5;
    else if (testSignals < 10) score -= 10;
  }

  if (promoted) score += 10;

  const evidenceBonus = {
    decisive: 25,
    strong: 18,
    moderate: 10,
    anecdotal: 5,
    favors_control: -10,
    insufficient_test_data: -15,
    none: 0,
  };
  score += evidenceBonus[evidence] ?? 0;

  if (typeof testDelta === 'number') {
    if (testDelta >= 1.0) score += 5;
    else if (testDelta <= -0.5) score -= 10;
  }

  const confidencePct = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'ok';
  if (!usingWFO || confidencePct < 55) status = 'warn';
  if (confidencePct < 35) status = 'fail';

  const improvements = [];
  if (!usingWFO) improvements.push('Enable a meaningful walk-forward test window (need ≥10 test signals).');
  if (typeof testSignals === 'number' && testSignals < 10) improvements.push('Increase signal pool (more tickers or longer lookback) to stabilize evidence.');
  if (evidence === 'favors_control') improvements.push('Current exploration strategy underperformed control; consider adjusting filters or reducing hypothesis changes.');
  if (typeof testDelta === 'number' && testDelta < 0) improvements.push('Variant reduced avg out-of-sample return; avoid promotion and try a different hypothesis.');

  return {
    agentType,
    name,
    status,
    confidencePct,
    signalCount: agentResult?.signalCount ?? 0,
    notes: promoted
      ? (agentResult?.abComparison?.promotionReason ?? 'Promoted')
      : (agentResult?.abComparison?.promotionReason ?? `Evidence: ${evidence}${bayesFactor != null ? ` (BF=${bayesFactor})` : ''}`),
    improvements,
  };
}

// ─── Marcus "IBD Dashboard" summary (fast; does NOT run full orchestration) ───

function assessSubagentHealthFromLearningRun({ agentType, agentName }, run) {
  if (!run) {
    return {
      agentType,
      name: agentName,
      status: 'warn',
      confidencePct: 0,
      notes: 'No recent A/B run data (Supabase not configured or no runs yet).',
      improvements: ['Run an optimization cycle so Marcus can grade this agent.'],
      latestAb: null,
    };
  }

  const delta = run.delta_expectancy ?? run.deltaExpectancy ?? run.delta_avg_return ?? run.deltaAvgReturn ?? null;
  const signalsEvaluated = run.signals_evaluated ?? run.signalsEvaluated ?? null;
  const promoted = !!run.promoted;
  const profitFactor = run.variant_profit_factor ?? run.variantProfitFactor ?? null;

  let score = 45;
  if (promoted) score += 25;
  if (typeof signalsEvaluated === 'number') {
    if (signalsEvaluated >= 30) score += 10;
    else if (signalsEvaluated >= 15) score += 5;
    else score -= 10;
  }
  if (typeof delta === 'number') {
    if (delta >= 1.0) score += 15;
    else if (delta >= 0) score += 7;
    else if (delta <= -1.0) score -= 18;
    else score -= 10;
  }
  if (typeof profitFactor === 'number') {
    if (profitFactor >= 1.5) score += 8;
    else if (profitFactor < 1.0) score -= 10;
  }

  const confidencePct = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'ok';
  if (confidencePct < 55) status = 'warn';
  if (confidencePct < 35) status = 'fail';

  const improvements = [];
  if (typeof signalsEvaluated === 'number' && signalsEvaluated < 15) {
    improvements.push('Increase sample size (more signals) before trusting this agent’s learning deltas.');
  }
  if (typeof delta === 'number' && delta < 0) {
    improvements.push('Latest variant underperformed control on expectancy; keep control weights and try a different exploration strategy.');
  }
  if (!promoted) {
    improvements.push('No promotion yet; keep iterating across hypotheses to find a decisive edge.');
  }

  return {
    agentType,
    name: agentName,
    status,
    confidencePct,
    notes: run.promotion_reason ?? run.promotionReason ?? 'Latest A/B run available',
    improvements,
    latestAb: {
      runNumber: run.run_number ?? run.runNumber ?? null,
      signalsEvaluated,
      promoted,
      deltaAvgReturn: delta,
      completedAt: run.completed_at ?? run.completedAt ?? null,
    },
  };
}

/**
 * Fast Marcus snapshot for the main Dashboard.
 * This is intentionally cheap: Market Pulse + cached news + last A/B results.
 */
export async function getMarcusSummary(options = {}) {
  const { newsLimit = 8, includeNews = true } = options;

  const regime = await classifyMarket({ persist: false });
  const outlook = deriveMarketOutlook(regime);

  const maxPositions = getMaxPositions(regime.regime);
  const aggressiveness = deriveAggressiveness({
    exposureMultiplier: regime.exposureMultiplier ?? 0,
    maxPositions,
  });

  const strategyAgents = [
    { agentType: 'momentum_scout', agentName: 'Momentum Scout' },
    { agentType: 'base_hunter', agentName: 'Base Hunter' },
    { agentType: 'breakout_tracker', agentName: 'Breakout Tracker' },
    { agentType: 'turtle_trader', agentName: 'Turtle Trader' },
    { agentType: 'ma_crossover_10_20', agentName: '10-20 Cross Over' },
  ];

  const latestRuns = await Promise.all(
    strategyAgents.map(async (a) => {
      const run = await loadLatestLearningRun(a.agentType);
      return assessSubagentHealthFromLearningRun(a, run);
    })
  );

  const news = includeNews ? await fetchMarketNews({ limit: newsLimit }) : [];

  const improvements = [];
  if (outlook.trendLabel !== 'Confirmed Uptrend') {
    improvements.push('Market trend is not a Confirmed Uptrend — reduce new buys and tighten risk.');
  }
  if ((regime.distributionDays ?? 0) >= 5) {
    improvements.push('Distribution days are elevated — prefer defense and demand stronger setups.');
  }

  return {
    updatedAt: new Date().toISOString(),
    market: {
      outlook,
      exposureMultiplier: regime.exposureMultiplier ?? null,
      agentBudgets: regime.agentBudgets ?? null,
    },
    aggressiveness,
    news,
    subagents: latestRuns,
    improvements,
  };
}

// ─── Risk budget by regime ────────────────────────────────────────────────────

const REGIME_EXPOSURE = {
  BULL:        1.00,
  UNCERTAIN:   0.75,
  CORRECTION:  0.25,
  BEAR:        0.00,
};

// ─── Main Marcus orchestration ────────────────────────────────────────────────

/**
 * Run the full portfolio-level orchestration cycle.
 *
 * Flow:
 *   Marcus → Confirm data freshness with Harry (auto-refresh if stale)
 *          → Strategy agents (optimize per specialization, report avg return)
 *          → Marcus (enforce limits, produce briefing with per-agent avg return)
 *
 * @param {Object} options
 * @param {Function} options.onProgress - SSE progress callback
 * @param {boolean} options.forceRefresh - Bypass signal cache
 * @param {number}  options.tickerLimit  - Max tickers for Harry to scan
 * @returns {Promise<Object>} Mission briefing result
 */
export async function runMarcusOrchestration(options = {}) {
  const { onProgress = null, forceRefresh = false, tickerLimit = 200 } = options;

  const startedAt = Date.now();

  function emit(msg) {
    if (onProgress) onProgress(msg);
  }

  emit({ phase: 'marcus_start', message: 'Marcus: Reviewing market conditions...' });

  // ── Phase 1: Confirm data freshness with Harry ──
  emit({ phase: 'freshness_check', message: 'Marcus: Confirming data freshness with Harry...' });

  let needsRefresh = forceRefresh;
  if (!forceRefresh) {
    try {
      const [storedSignals, tickerList] = await Promise.all([
        getStoredSignals(2000),
        getTickerList(),
      ]);
      const freshness = checkDataFreshness(storedSignals, tickerList, { maxAgeDays: 30, minCoveragePct: 60 });

      emit({
        phase: 'freshness_result',
        message: `Harry data: ${freshness.ageDays}d old, ${freshness.coveragePct}% coverage (${freshness.coveredCount}/${tickerList.length} tickers)`,
        freshness,
      });

      if (!freshness.isFresh) {
        emit({ phase: 'freshness_stale', message: `Data stale or incomplete — triggering Harry refresh...` });
        needsRefresh = true;
      }
    } catch (e) {
      console.warn('Marcus: freshness check failed, proceeding with forceRefresh:', e.message);
      needsRefresh = true;
    }
  }

  // Auto-refresh if data is stale or incomplete
  if (needsRefresh && !forceRefresh) {
    try {
      await runHarryFetchOnly({
        lookbackMonths: 60,
        tickerLimit,
        forceRefresh: true,
        onProgress: (p) => emit({ ...p, source: 'harry_refresh' }),
      });
      emit({ phase: 'freshness_refreshed', message: 'Harry: Data refresh complete.' });
    } catch (e) {
      emit({ phase: 'freshness_refresh_failed', message: `Harry refresh failed: ${e.message}` });
    }
  }

  // ── Phase 2: Run Harry Historian + strategy agents ──
  emit({ phase: 'harry_start', message: 'Harry Historian: Running strategy agents...' });

  let multiAgentResult;
  try {
    multiAgentResult = await runMultiAgentOptimization({
      lookbackMonths: 60,
      tickerLimit,
      maxIterations: 20,
      targetProfit: 5,
      forceRefresh,
      onProgress: (p) => emit({ ...p, source: 'harry_historian' }),
    });
  } catch (err) {
    return {
      success: false,
      error: `Harry Historian failed: ${err.message}`,
      northStar: NORTH_STAR,
    };
  }

  const regime = multiAgentResult.regime?.regime || 'UNCERTAIN';
  const exposure = REGIME_EXPOSURE[regime] ?? 0.75;

  // Northstar doctrine: IBD Market Direction is the master gate
  if (!isBuyingAllowed(regime)) {
    emit({
      phase: 'done',
      message: `Marcus: Northstar gate closed — regime is ${regime}. No longs. ${PRINCIPLES[0]}`,
    });
    return {
      success: true,
      regime,
      exposure: 0,
      signalCount: 0,
      approvedCount: 0,
      approved: [],
      northStar: NORTH_STAR,
      briefing: `Northstar gate closed. ${regime} regime. ${PRINCIPLES[0]}`,
    };
  }

  // ── Phase 3: Collect avg return from each strategy agent ──
  emit({ phase: 'strategy_results', message: 'Marcus: Reviewing strategy agent avg returns...' });

  const agentResults = multiAgentResult.agentResults || [];
  const strategyAvgReturns = agentResults.map((r) => ({
    name: r.name,
    agentType: r.agentType,
    success: r.success,
    signalCount: r.signalCount || 0,
    controlExpectancy: r.abComparison?.controlMetrics?.expectancy ?? null,
    variantExpectancy: r.abComparison?.variantMetrics?.expectancy ?? null,
    controlAvgReturn: r.abComparison?.controlMetrics?.avgReturn ?? null,
    variantAvgReturn: r.abComparison?.variantMetrics?.avgReturn ?? null,
    promoted: r.abComparison?.promoted ?? false,
    strategyName: r.strategyName || null,
  }));

  // Northstar regime gate controls max positions (50 BULL, 10 UNCERTAIN)
  const maxPos = getMaxPositions(regime);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const briefing = buildMissionBriefing({
    regime,
    exposure,
    multiAgentResult,
    strategyAvgReturns,
    maxPos,
    elapsed,
  });

  emit({ phase: 'marcus_done', message: 'Marcus: Mission briefing complete.', briefing });

  return {
    success: true,
    regime,
    exposure,
    signalCount: multiAgentResult.signalCount || 0,
    approvedCount: Math.min(agentResults.filter((r) => r.success).length * maxPos, maxPos),
    strategyAvgReturns,
    northStar: NORTH_STAR,
    briefing,
    elapsedMs: Date.now() - startedAt,
    multiAgentResult,
  };
}

// ─── Mission Briefing ────────────────────────────────────────────────────────

function buildMissionBriefing({ regime, exposure, multiAgentResult, strategyAvgReturns, maxPos, elapsed }) {
  const lines = [
    `╔══════════════════════════════════════════════════════╗`,
    `║          MARCUS — MISSION BRIEFING                   ║`,
    `╚══════════════════════════════════════════════════════╝`,
    ``,
    `Northstar Mission:`,
    `  ${NORTHSTAR_DOCTRINE.mission}`,
    ``,
    `Market Regime   : ${regime}`,
    `Portfolio Exposure: ${(exposure * 100).toFixed(0)}%`,
    `Signals Scanned : ${multiAgentResult.signalCount || 0}`,
    `Max Positions   : ${maxPos} (regime-adjusted)`,
    ``,
    `Northstar Targets:`,
    `  Annual Return : ${(ACCOUNT.annualReturnTarget * 100).toFixed(0)}%`,
    `  Win/Loss Ratio: ≥${KILL_SWITCHES.minWinLossRatio}:1 (target ≥2.5:1)`,
    `  Max Acct DD   : ${(KILL_SWITCHES.maxAccountDrawdown * 100).toFixed(0)}%`,
    `  Max Pos Loss  : ${EXIT_RULES.hard.maxLossPct}%`,
    `  RS Minimum    : ${CANSLIM.minRsRating}`,
    `  Breakout Vol  : ≥${(VCP.breakoutVolumeMinX * 100 - 100).toFixed(0)}% above 50d avg`,
    ``,
    `Signal Agent Expectancy:`,
    ...(strategyAvgReturns || []).map((a) => {
      if (!a.success) return `  • ${a.name}: FAILED`;
      const ctrl = a.controlExpectancy != null ? `${a.controlExpectancy.toFixed(2)}%` : '?';
      const variant = a.variantExpectancy != null ? `${a.variantExpectancy.toFixed(2)}%` : '?';
      return `  • ${a.name}: control ${ctrl}, variant ${variant} (${a.signalCount} signals) ${a.promoted ? '✅ PROMOTED' : ''}`;
    }),
    `Guiding Principles:`,
    ...PRINCIPLES.map((p, i) => `  ${i + 1}. ${p}`),
    ``,
    `Elapsed: ${elapsed}s`,
  ];

  return lines.join('\n');
}

// ─── Agent metadata (for the Agents dashboard) ───────────────────────────────

export const MARCUS_AGENT_META = {
  name: 'Marcus',
  title: 'CEO Money Manager Agent',
  agentType: 'marcus_ceo',
  model: 'gpt-5.2-codex-low',
  role: 'Overseer',
  northStar: NORTH_STAR.goal,
  description:
    'Top-level portfolio overseer. Confirms data freshness with Harry, reviews signal agent avg returns, enforces position limits, and produces the mission briefing.',
  subagents: [
    'harry_historian',
    'momentum_scout',
    'base_hunter',
    'breakout_tracker',
    'turtle_trader',
    'ma_crossover_10_20',
  ],
};

/**
 * Get Marcus's view of all agents (for the /api/agents/manifest endpoint).
 */
export function getMarcusManifest() {
  const subagents = getAgentManifest();
  return {
    ceo: MARCUS_AGENT_META,
    subagents: [
      {
        name: 'Harry Historian Agent',
        agentType: 'harry_historian',
        model: 'gpt-5.2-codex',
        role: 'Data Fetcher',
        description: 'Fetches 5yr OHLC data for all tickers and builds the shared signal pool. Marcus confirms freshness (≤30 days) before proceeding.',
      },
      ...subagents.map((a) => ({
        ...a,
        model: 'gpt-5.2-codex-high',
        role: 'Signal Agent',
      })),
    ],
  };
}
