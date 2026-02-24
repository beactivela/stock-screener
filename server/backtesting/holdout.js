import { splitHoldoutRange, buildWalkForwardWindows } from './windows.js';
import { runWalkForwardOptimization, runWalkForwardOnSignals } from './walkForward.js';
import { runRetroBacktest, aggregateResults } from '../retroBacktest.js';
import { runVectorbtEngine } from './vectorbtEngine.js';
import { filterSignalsByDate } from './signalUtils.js';

function pickConsensusConfig(windows = [], fallbackHoldingPeriod = 90) {
  const tally = new Map();
  for (const w of windows) {
    const hp = w?.bestConfig?.holdingPeriod;
    if (!hp) continue;
    const record = tally.get(hp) || { count: 0, scoreSum: 0 };
    record.count += 1;
    record.scoreSum += typeof w.bestConfig.score === 'number' ? w.bestConfig.score : 0;
    tally.set(hp, record);
  }

  let best = null;
  for (const [holdingPeriod, info] of tally.entries()) {
    const avgScore = info.count > 0 ? info.scoreSum / info.count : 0;
    if (!best || info.count > best.count || (info.count === best.count && avgScore > best.avgScore)) {
      best = { holdingPeriod, count: info.count, avgScore };
    }
  }

  return best || { holdingPeriod: fallbackHoldingPeriod, count: 0, avgScore: null };
}

export async function runHoldoutValidation({
  tickers = [],
  signals = null,
  startDate,
  endDate,
  holdoutPct = 0.2,
  trainMonths = 12,
  testMonths = 3,
  stepMonths = 3,
  candidateHoldingPeriods = [60, 90, 120],
  topN = null,
  optimizeMetric = 'expectancy',
  warmupMonths = 12,
  engine = 'node',
  onProgress = null,
}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const { inSample, holdout, meta } = splitHoldoutRange({
    startDate,
    endDate,
    holdoutPct,
  });

  const windows = buildWalkForwardWindows({
    startDate: inSample.from,
    endDate: inSample.to,
    trainMonths,
    testMonths,
    stepMonths,
  });
  const totalSteps = windows.length + 1 + (engine === 'vectorbt' ? 1 : 0);
  const emitProgress = (current, label) => {
    if (typeof onProgress === 'function') {
      onProgress({ tier: 'holdout', current, total: totalSteps, label });
    }
  };

  let wfoResult;
  let consensus;
  let holdoutResult;
  let holdoutSignals = null;

  if (Array.isArray(signals) && signals.length > 0) {
    const inSampleSignals = filterSignalsByDate(signals, inSample.from, inSample.to);
    holdoutSignals = filterSignalsByDate(signals, holdout.from, holdout.to);

    wfoResult = await runWalkForwardOnSignals({
      signals: inSampleSignals,
      startDate: inSample.from,
      endDate: inSample.to,
      trainMonths,
      testMonths,
      stepMonths,
      optimizeMetric,
      engine: 'node',
      onProgress: (evt) => emitProgress(evt.current, `WFO: ${evt.label}`),
    });

    consensus = pickConsensusConfig(wfoResult.windows, candidateHoldingPeriods[0]);
    const stats = aggregateResults(holdoutSignals);
    holdoutResult = {
      config: {
        startDate: holdout.from,
        endDate: holdout.to,
      },
      signals: holdoutSignals,
      summary: stats.summary,
      byExitReason: stats.byExitReason,
      byMonth: stats.byMonth,
      byEntryMA: stats.byEntryMA,
    };

    emitProgress(windows.length + 1, 'Holdout evaluation');
  } else {
    wfoResult = await runWalkForwardOptimization({
      tickers,
      startDate: inSample.from,
      endDate: inSample.to,
      trainMonths,
      testMonths,
      stepMonths,
      candidateHoldingPeriods,
      topN,
      optimizeMetric,
      warmupMonths,
      engine: 'node',
      onProgress: (evt) => emitProgress(evt.current, `WFO: ${evt.label}`),
    });

    consensus = pickConsensusConfig(wfoResult.windows, candidateHoldingPeriods[0]);

    holdoutResult = await runRetroBacktest({
      tickers,
      holdingPeriod: consensus.holdingPeriod,
      topN,
      fromDate: holdout.from,
      toDate: holdout.to,
      signalFrom: holdout.from,
      signalTo: holdout.to,
      warmupMonths,
    });
    holdoutSignals = holdoutResult.signals;
    emitProgress(windows.length + 1, 'Holdout evaluation');
  }

  let vectorbt = null;
  if (engine === 'vectorbt' && holdoutSignals && holdoutSignals.length > 0) {
    try {
      vectorbt = await runVectorbtEngine({
        signals: holdoutSignals,
        startDate: holdout.from,
        endDate: holdout.to,
      });
      emitProgress(windows.length + 2, 'vectorbt');
    } catch (e) {
      vectorbt = { error: e.message };
      emitProgress(windows.length + 2, 'vectorbt (failed)');
    }
  }

  return {
    tier: 'holdout',
    engine,
    config: {
      startDate,
      endDate,
      holdoutPct,
      trainMonths,
      testMonths,
      stepMonths,
      candidateHoldingPeriods,
      optimizeMetric,
      holdoutMeta: meta,
    },
    inSample: {
      range: inSample,
      wfo: wfoResult,
      consensus,
    },
    holdout: {
      range: holdout,
      node: holdoutResult,
      vectorbt,
    },
  };
}
