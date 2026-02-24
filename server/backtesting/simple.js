import { runRetroBacktest, aggregateResults } from '../retroBacktest.js';
import { runVectorbtEngine } from './vectorbtEngine.js';
import { createStepProgress } from './progress.js';
import { filterSignalsByDate } from './signalUtils.js';

export async function runSimpleBacktest({
  tickers = [],
  signals = null,
  startDate,
  endDate,
  holdingPeriod = 90,
  topN = null,
  engine = 'node',
  onProgress = null,
}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const totalSteps = engine === 'vectorbt' ? 2 : 1;
  const progress = createStepProgress({ tier: 'simple', totalSteps, onProgress });
  progress.emit('Starting');

  let nodeResult;
  let signalsToUse = null;

  if (Array.isArray(signals) && signals.length > 0) {
    signalsToUse = filterSignalsByDate(signals, startDate, endDate);
    const stats = aggregateResults(signalsToUse);
    nodeResult = {
      config: {
        startDate,
        endDate,
        holdingPeriod,
        tickersAnalyzed: null,
      },
      signals: signalsToUse,
      summary: stats.summary,
      byExitReason: stats.byExitReason,
      byMonth: stats.byMonth,
      byEntryMA: stats.byEntryMA,
    };
  } else {
    nodeResult = await runRetroBacktest({
      tickers,
      holdingPeriod,
      topN,
      fromDate: startDate,
      toDate: endDate,
      signalFrom: startDate,
      signalTo: endDate,
    });
    signalsToUse = nodeResult.signals;
  }

  progress.step('Node engine');

  let vectorbt = null;
  if (engine === 'vectorbt') {
    try {
      vectorbt = await runVectorbtEngine({
        signals: signalsToUse,
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
    tier: 'simple',
    engine,
    node: nodeResult,
    vectorbt,
  };
}
