import {
  loadOptimizedWeights,
  storeLearningRun,
  storeOptimizedWeights,
} from '../learning/index.js';
import {
  passesRiskGates,
  resolveAdaptiveRiskGates,
} from '../agents/strategyAgentBase.js';

function toMetrics(summary) {
  if (!summary) return null;
  return {
    avgReturn: summary.avgReturn ?? null,
    expectancy: summary.expectancy ?? null,
    winRate: summary.winRate ?? null,
    avgWin: summary.avgWin ?? null,
    avgLoss: summary.avgLoss ?? null,
    profitFactor: summary.profitFactor ?? null,
    totalSignals: summary.totalSignals ?? null,
  };
}

function clampWeight(value, min = 1, max = 35) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function inferBestHoldingPeriod(result = {}) {
  const counts = new Map();
  for (const window of result.windows || []) {
    const hp = window?.bestConfig?.holdingPeriod;
    if (!Number.isFinite(hp)) continue;
    counts.set(hp, (counts.get(hp) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [hp, count] of counts.entries()) {
    if (count > bestCount) {
      best = hp;
      bestCount = count;
    }
  }
  return best;
}

function buildHierarchyVariantWeights(controlWeights, tier, result, controlMetrics, variantMetrics) {
  const next = { ...(controlWeights || {}) };
  const adjustments = [];
  const deltaExp = (variantMetrics?.expectancy ?? 0) - (controlMetrics?.expectancy ?? 0);
  if (!Number.isFinite(deltaExp) || deltaExp <= 0) {
    return { variantWeights: next, adjustments };
  }

  const apply = (key, delta, reason) => {
    if (typeof next[key] !== 'number') return;
    const oldValue = next[key];
    const newValue = clampWeight(oldValue + delta);
    if (newValue === oldValue) return;
    next[key] = newValue;
    adjustments.push({ weight: key, oldValue, newValue, delta: newValue - oldValue, reason });
  };

  if ((variantMetrics?.winRate ?? 0) > (controlMetrics?.winRate ?? 0)) {
    apply('entryRSAbove90', +1, 'Hierarchy test improved win rate');
    apply('relativeStrengthBonus', +1, 'Hierarchy test improved win rate');
  }
  if ((variantMetrics?.profitFactor ?? 0) > (controlMetrics?.profitFactor ?? 0)) {
    apply('entryVolumeConfirm', +1, 'Hierarchy test improved profit factor');
  }
  if ((variantMetrics?.avgLoss ?? 0) > (controlMetrics?.avgLoss ?? 0)) {
    apply('vcpPatternConfidence', +1, 'Hierarchy test reduced average loss');
  }

  // Holding period shape from WFO informs short/long trend emphasis.
  const bestHoldingPeriod = inferBestHoldingPeriod(result);
  if ((tier === 'wfo' || tier === 'wfo_mc') && Number.isFinite(bestHoldingPeriod)) {
    if (bestHoldingPeriod <= 60) {
      apply('recentActionStrong', +1, 'WFO favored shorter holding period');
      apply('slope10MAStrong', +1, 'WFO favored shorter holding period');
    } else if (bestHoldingPeriod >= 120) {
      apply('pullbackIdeal', +1, 'WFO favored longer holding period');
      apply('vcpContractions4Plus', +1, 'WFO favored longer holding period');
    }
  }

  // Ensure we always test at least one concrete adjustment when hierarchy is better.
  if (adjustments.length === 0) {
    apply('slope10MAElite', +1, 'Positive hierarchy expectancy delta');
  }

  return { variantWeights: next, adjustments };
}

export async function buildLearningRunFromHierarchy({
  agentType,
  tier,
  result,
  objective = 'expectancy',
  allowWeightUpdates = true,
  minImprovement = 0.25,
}) {
  if (!result) return { stored: false, reason: 'no_result' };

  let controlSummary = null;
  let variantSummary = null;
  let iterationsRun = 1;
  let signalsEvaluated = null;

  if (tier === 'wfo' || tier === 'wfo_mc') {
    controlSummary = result.combinedTrain || null;
    variantSummary = result.combinedTest || null;
    iterationsRun = Array.isArray(result.windows) ? result.windows.length : 0;
    signalsEvaluated = result.combinedTest?.totalSignals ?? null;
  } else if (tier === 'holdout') {
    controlSummary = result.inSample?.wfo?.combinedTest || result.inSample?.wfo?.combinedTrain || null;
    variantSummary = result.holdout?.node?.summary || null;
    iterationsRun = Array.isArray(result.inSample?.wfo?.windows) ? result.inSample.wfo.windows.length : 0;
    signalsEvaluated = variantSummary?.totalSignals ?? null;
  } else {
    controlSummary = result.node?.summary || result.summary || null;
    variantSummary = controlSummary;
    signalsEvaluated = controlSummary?.totalSignals ?? null;
  }

  const controlMetrics = toMetrics(controlSummary);
  const variantMetrics = toMetrics(variantSummary);
  const currentWeights = await loadOptimizedWeights(agentType || 'default');
  const controlWeights = { ...(currentWeights?.weights || {}) };

  const { variantWeights, adjustments } = buildHierarchyVariantWeights(
    controlWeights,
    tier,
    result,
    controlMetrics,
    variantMetrics
  );

  const adaptiveGates = resolveAdaptiveRiskGates(variantMetrics, {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  });
  const controlRisk = passesRiskGates(controlMetrics || {}, adaptiveGates);
  const variantRisk = passesRiskGates(variantMetrics || {}, adaptiveGates);
  const objectiveDelta = (variantMetrics?.expectancy ?? 0) - (controlMetrics?.expectancy ?? 0);
  const promoted = Boolean(
    allowWeightUpdates
    && variantRisk.passed
    && Number.isFinite(objectiveDelta)
    && objectiveDelta >= minImprovement
    && adjustments.length > 0
  );

  const promotionReason = promoted
    ? `Hierarchy(${tier}) promoted: +${objectiveDelta.toFixed(2)}% expectancy with adaptive risk gates`
    : `Hierarchy(${tier}) not promoted: delta=${Number.isFinite(objectiveDelta) ? objectiveDelta.toFixed(2) : 'n/a'}% expectancy, ${variantRisk.summary}`;

  const runData = {
    systemName: `Backtest Hierarchy (${tier})`,
    agentType: agentType || result.agent?.agentType || 'default',
    iterationsRun,
    signalsEvaluated,
    objective,
    controlWeights,
    variantWeights,
    controlSource: currentWeights?.source || 'default',
    controlMetrics,
    variantMetrics,
    promoted,
    promotionReason,
    factorChanges: adjustments,
    topFactors: [
      {
        factor: `hierarchy_${tier}`,
        description: 'Hierarchy backtest-driven weight proposal',
        deltaExpectancy: objectiveDelta,
        riskGates: {
          control: controlRisk,
          variant: variantRisk,
        },
      },
    ],
    minImprovementThreshold: minImprovement,
    criteriaSummary: `Objective=expectancy, adaptive risk gates, allowWeightUpdates=${allowWeightUpdates}`,
  };

  const storedRun = await storeLearningRun(runData);

  let weightUpdate = { updated: false, reason: 'not_promoted' };
  if (promoted) {
    const updateResult = await storeOptimizedWeights(
      {
        weights: variantWeights,
        adjustments,
        signalsAnalyzed: signalsEvaluated ?? variantMetrics?.totalSignals ?? 0,
        baselineWinRate: variantMetrics?.winRate ?? null,
        baselineAvgReturn: variantMetrics?.avgReturn ?? null,
        baselineExpectancy: variantMetrics?.expectancy ?? null,
        avgWin: variantMetrics?.avgWin ?? null,
        avgLoss: variantMetrics?.avgLoss ?? null,
        profitFactor: variantMetrics?.profitFactor ?? null,
        topFactors: runData.topFactors,
        generatedAt: new Date().toISOString(),
      },
      { activate: true, agentType: runData.agentType }
    );
    weightUpdate = {
      updated: Boolean(updateResult?.stored),
      ...updateResult,
      adjustmentsApplied: adjustments.length,
    };
  }

  return {
    ...storedRun,
    promoted,
    promotionReason,
    objectiveDelta,
    weightUpdate,
  };
}
