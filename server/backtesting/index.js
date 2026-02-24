import { runSimpleBacktest } from './simple.js';
import { runWalkForwardOptimization } from './walkForward.js';
import { runHoldoutValidation } from './holdout.js';
import { loadAgentSignals } from './agentSignals.js';

export async function runBacktestHierarchy({
  tier = 'simple',
  engine = 'node',
  agentType = null,
  lookbackMonths = 60,
  tickerLimit = 0,
  forceRefresh = false,
  onProgress = null,
  ...options
}) {
  if (agentType) {
    if (typeof onProgress === 'function') {
      onProgress({ tier, current: 0, total: 1, label: 'Loading signals' });
    }
    const { agent, signals, meta } = await loadAgentSignals({
      agentType,
      lookbackMonths,
      tickerLimit,
      forceRefresh,
    });

    if (!signals || signals.length === 0) {
      throw new Error(`No signals available for agent: ${agentType}`);
    }

    if (typeof onProgress === 'function') {
      onProgress({
        tier,
        current: 1,
        total: 1,
        label: `Signals ready (${meta.filteredSignals})`,
      });
    }

    let result;
    switch (tier) {
      case 'simple':
        result = await runSimpleBacktest({ ...options, engine, signals, onProgress });
        break;
      case 'wfo':
        result = await runWalkForwardOptimization({ ...options, engine, signals, onProgress });
        break;
      case 'wfo_mc':
        result = await runWalkForwardOptimization({ ...options, engine, signals, includeMonteCarlo: true, onProgress });
        break;
      case 'holdout':
        result = await runHoldoutValidation({ ...options, engine, signals, onProgress });
        break;
      default:
        throw new Error(`Unsupported tier: ${tier}`);
    }

    return {
      ...result,
      agent: {
        agentType: agent.agentType,
        name: agent.name,
        meta,
      },
    };
  }

  throw new Error('agentType is required for backtest hierarchy');
}
