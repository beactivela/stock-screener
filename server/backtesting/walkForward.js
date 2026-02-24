import { runRetroBacktest, aggregateResults } from '../retroBacktest.js';
import { buildWalkForwardWindows } from './windows.js';
import { scoreSummary, combineSummaries } from './scoring.js';
import { runMonteCarloSimulations } from './monteCarlo.js';
import { runVectorbtEngine } from './vectorbtEngine.js';
import { filterSignalsByDate } from './signalUtils.js';
import { createStepProgress } from './progress.js';

function pickBestCandidate(candidates, metric) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const c of candidates) {
    const score = scoreSummary(c.summary, metric);
    if (score > bestScore) {
      bestScore = score;
      best = { ...c, score };
    }
  }

  return best;
}

export async function runWalkForwardOptimization({
  tickers = [],
  signals = null,
  startDate,
  endDate,
  trainMonths = 12,
  testMonths = 3,
  stepMonths = 3,
  candidateHoldingPeriods = [60, 90, 120],
  topN = null,
  optimizeMetric = 'expectancy',
  warmupMonths = 12,
  includeMonteCarlo = false,
  monteCarloTrials = 500,
  monteCarloSeed = 42,
  engine = 'node',
  onProgress = null,
}) {
  if (Array.isArray(signals) && signals.length > 0) {
    return runWalkForwardOnSignals({
      signals,
      startDate,
      endDate,
      trainMonths,
      testMonths,
      stepMonths,
      optimizeMetric,
      includeMonteCarlo,
      monteCarloTrials,
      monteCarloSeed,
      engine,
      onProgress,
    });
  }
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const windows = buildWalkForwardWindows({
    startDate,
    endDate,
    trainMonths,
    testMonths,
    stepMonths,
  });

  if (windows.length === 0) {
    return {
      tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
      config: { startDate, endDate, trainMonths, testMonths, stepMonths },
      windows: [],
      error: 'No windows fit within date range',
    };
  }

  const totalSteps = windows.length + (includeMonteCarlo ? 1 : 0) + (engine === 'vectorbt' ? 1 : 0);
  const progress = createStepProgress({
    tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
    totalSteps,
    onProgress,
  });
  progress.emit('Starting');

  const windowResults = [];
  const testSignals = [];

  for (const window of windows) {
    progress.step(`Window ${windowResults.length + 1} of ${windows.length}`);
    const candidateResults = [];
    for (const holdingPeriod of candidateHoldingPeriods) {
      const trainResult = await runRetroBacktest({
        tickers,
        holdingPeriod,
        topN,
        fromDate: window.train.from,
        toDate: window.train.to,
        signalFrom: window.train.from,
        signalTo: window.train.to,
        warmupMonths,
      });
      candidateResults.push({
        holdingPeriod,
        summary: trainResult.summary,
        signals: trainResult.signals,
      });
    }

    const best = pickBestCandidate(candidateResults, optimizeMetric);
    const testResult = await runRetroBacktest({
      tickers,
      holdingPeriod: best?.holdingPeriod ?? candidateHoldingPeriods[0],
      topN,
      fromDate: window.test.from,
      toDate: window.test.to,
      signalFrom: window.test.from,
      signalTo: window.test.to,
      warmupMonths,
    });

    testSignals.push(...testResult.signals);
    windowResults.push({
      window,
      bestConfig: {
        holdingPeriod: best?.holdingPeriod ?? candidateHoldingPeriods[0],
        score: best?.score ?? null,
        metric: optimizeMetric,
      },
      trainSummary: best?.summary ?? null,
      testSummary: testResult.summary,
      testSignals: testResult.signals.length,
    });
  }

  const aggregate = aggregateResults(testSignals);
  const combinedTrain = combineSummaries(windowResults.map((w) => w.trainSummary).filter(Boolean));
  const combinedTest = combineSummaries(windowResults.map((w) => w.testSummary).filter(Boolean));

  let monteCarlo = null;
  if (includeMonteCarlo && testSignals.length > 0) {
    const returns = testSignals.map((s) => (s.returnPct ?? 0) / 100);
    monteCarlo = runMonteCarloSimulations({
      returns,
      trials: monteCarloTrials,
      seed: monteCarloSeed,
    });
    progress.step('Monte Carlo');
  }

  let vectorbt = null;
  if (engine === 'vectorbt' && testSignals.length > 0) {
    try {
      vectorbt = await runVectorbtEngine({
        signals: testSignals,
        startDate,
        endDate,
      });
      progress.step('vectorbt');
    } catch (e) {
      vectorbt = { error: e.message };
      progress.step('vectorbt (failed)');
    }
  }

  return {
    tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
    engine,
    config: {
      startDate,
      endDate,
      trainMonths,
      testMonths,
      stepMonths,
      candidateHoldingPeriods,
      optimizeMetric,
    },
    windows: windowResults,
    combinedTrain,
    combinedTest,
    aggregate,
    monteCarlo,
    vectorbt,
  };
}

export async function runWalkForwardOnSignals({
  signals = [],
  startDate,
  endDate,
  trainMonths = 12,
  testMonths = 3,
  stepMonths = 3,
  optimizeMetric = 'expectancy',
  includeMonteCarlo = false,
  monteCarloTrials = 500,
  monteCarloSeed = 42,
  engine = 'node',
  onProgress = null,
}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const signalsInRange = filterSignalsByDate(signals, startDate, endDate);
  const windows = buildWalkForwardWindows({
    startDate,
    endDate,
    trainMonths,
    testMonths,
    stepMonths,
  });

  if (windows.length === 0) {
    return {
      tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
      config: { startDate, endDate, trainMonths, testMonths, stepMonths },
      windows: [],
      error: 'No windows fit within date range',
    };
  }

  const totalSteps = windows.length + (includeMonteCarlo ? 1 : 0) + (engine === 'vectorbt' ? 1 : 0);
  const progress = createStepProgress({
    tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
    totalSteps,
    onProgress,
  });
  progress.emit('Starting');

  const windowResults = [];
  const testSignals = [];

  for (const window of windows) {
    progress.step(`Window ${windowResults.length + 1} of ${windows.length}`);
    const trainSignals = filterSignalsByDate(signalsInRange, window.train.from, window.train.to);
    const testSignalsForWindow = filterSignalsByDate(signalsInRange, window.test.from, window.test.to);
    const trainStats = aggregateResults(trainSignals);
    const testStats = aggregateResults(testSignalsForWindow);

    testSignals.push(...testSignalsForWindow);
    windowResults.push({
      window,
      bestConfig: {
        holdingPeriod: null,
        score: null,
        metric: optimizeMetric,
        note: 'signals-only',
      },
      trainSummary: trainStats.summary,
      testSummary: testStats.summary,
      testSignals: testSignalsForWindow.length,
    });
  }

  const combinedTrain = combineSummaries(windowResults.map((w) => w.trainSummary));
  const combinedTest = combineSummaries(windowResults.map((w) => w.testSummary));
  const aggregate = aggregateResults(testSignals);

  let monteCarlo = null;
  if (includeMonteCarlo && testSignals.length > 0) {
    const returns = testSignals.map((s) => (s.returnPct ?? 0) / 100);
    monteCarlo = runMonteCarloSimulations({
      returns,
      trials: monteCarloTrials,
      seed: monteCarloSeed,
    });
    progress.step('Monte Carlo');
  }

  let vectorbt = null;
  if (engine === 'vectorbt' && testSignals.length > 0) {
    try {
      vectorbt = await runVectorbtEngine({
        signals: testSignals,
        startDate,
        endDate,
      });
      progress.step('vectorbt');
    } catch (e) {
      vectorbt = { error: e.message };
      progress.step('vectorbt (failed)');
    }
  }

  return {
    tier: includeMonteCarlo ? 'wfo_mc' : 'wfo',
    engine,
    config: {
      startDate,
      endDate,
      trainMonths,
      testMonths,
      stepMonths,
      optimizeMetric,
    },
    windows: windowResults,
    combinedTrain,
    combinedTest,
    aggregate,
    monteCarlo,
    vectorbt,
  };
}
